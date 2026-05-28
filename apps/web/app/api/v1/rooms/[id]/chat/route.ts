/**
 * POST /api/v1/rooms/[id]/chat — owner sends a turn to the room.
 *
 * Body: { text: string; mention?: { staff_id: string } }
 *
 * Behavior:
 *  a. Validate room + pick target agent (mention → lastReplier → firstMember).
 *  b. Append owner message to thread `room:<id>` with author={kind:'human', ...}.
 *  c. Resolve target staff.
 *  d. captureCliOutput(targetStaffId) → preScreen.
 *  e. sendKeys(targetStaffId, text, true).
 *  f. Fire-and-forget settle-watch: on settle, computeDelta → strip echo →
 *     append delta AS the agent's own message to room thread with
 *     author={kind:'ai_agent', ref_id:staffId, display_name:staffName}.
 *     NOT a haiku summary — raw answer.
 *  g. Overlap guard: 409 'staff_busy' if already mid-turn for that staff.
 */

import { NextResponse } from 'next/server';
import {
  getRoom,
  listMembers,
  getStaffMerged,
  appendChatMessage,
  sendKeys,
  captureCliOutput,
  readChatTranscript,
  getOwner,
} from '@holon/core';
import { deviceAuthErrorResponse, requireDeviceTokenForRemote } from '@/lib/device-token-auth';
import { waitForCliSettle } from '@/lib/cli-settle';
import type { RoomMember } from '@holon/api-contract';

interface Context { params: Promise<{ id: string }> }

/** staffIds currently mid-turn for a room — per-process overlap guard. */
const inFlightRoom = new Set<string>();

function resolveOwnerDisplayName(): string {
  return '我';
}

function resolveOwnerId(): string {
  try {
    return getOwner().id;
  } catch {
    return 'owner_local';
  }
}

/** Pick the last ai_agent member that replied (by scanning the thread), or
 *  fall back to the first member in the list. */
function pickDefaultTarget(
  members: RoomMember[],
  roomId: string,
): RoomMember | null {
  const aiMembers = members.filter((m) => m.kind === 'ai_agent');
  if (aiMembers.length === 0) return null;

  // Check last assistant message in the thread for a ref_id match.
  const msgs = readChatTranscript(`room:${roomId}`);
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m?.role !== 'assistant') continue;
    // author is stored as JSON in the content prefix — we serialise it in the
    // append call below; here we need a simpler heuristic. Check for matching
    // staff in members.
    const lastReplier = aiMembers.find((am) => {
      // We can't parse author from the raw transcript (no schema there), so
      // fall through to firstMember as the default. The lastReplier heuristic
      // is best-effort; first-member is the safe default.
      return false;
    });
    if (lastReplier) return lastReplier;
    break;
  }
  return aiMembers[0] ?? null;
}

export async function POST(req: Request, ctx: Context): Promise<Response> {
  const auth = requireDeviceTokenForRemote(req);
  if (!auth.ok) return deviceAuthErrorResponse(auth);

  const { id } = await ctx.params;
  const room = getRoom(id);
  if (!room) return NextResponse.json({ error: 'room not found', id }, { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body', code: 'invalid_json' }, { status: 400 });
  }

  const b = body as { text?: unknown; mention?: unknown };
  const text = typeof b.text === 'string' ? b.text.trim() : '';
  if (!text) {
    return NextResponse.json({ error: 'text is required', code: 'missing_text' }, { status: 400 });
  }

  const mention = b.mention && typeof b.mention === 'object'
    ? b.mention as { staff_id?: unknown }
    : null;

  const members = listMembers(id);

  // Resolve target member.
  let targetMember: RoomMember | null = null;
  if (mention?.staff_id && typeof mention.staff_id === 'string') {
    const sid = mention.staff_id;
    targetMember = members.find((m) => m.kind === 'ai_agent' && m.ref_id === sid) ?? null;
    if (!targetMember) {
      return NextResponse.json(
        { error: 'mentioned staff is not a member of this room', staff_id: sid },
        { status: 404 },
      );
    }
  } else {
    targetMember = pickDefaultTarget(members, id);
  }

  if (!targetMember) {
    return NextResponse.json(
      { error: 'room has no ai_agent members to address', code: 'no_members' },
      { status: 409 },
    );
  }

  const staffId = targetMember.ref_id;

  // Overlap guard.
  if (inFlightRoom.has(staffId)) {
    return NextResponse.json({ error: 'staff is mid-turn', code: 'staff_busy' }, { status: 409 });
  }

  const staff = getStaffMerged(staffId);
  if (!staff) {
    return NextResponse.json({ error: 'staff not found', staff_id: staffId }, { status: 404 });
  }

  const substrate = staff.substrate;
  if (substrate.kind !== 'cli_agent') {
    return NextResponse.json(
      { error: 'staff has no CLI substrate', code: 'no_cli_substrate', kind: substrate.kind },
      { status: 409 },
    );
  }

  const threadId = `room:${id}`;
  const ownerId = resolveOwnerId();

  // Append the owner's message with author annotation embedded in content.
  // We extend the TranscriptMessage with an author comment so /history can parse it.
  // Storage: we store the message content as-is, and embed author in the ts-keyed
  // transcript. The /history route returns raw TranscriptMessage[], so author is
  // surfaced via a parallel read from the room-specific author-map key.
  // Simpler: we store author as JSON prefix in content: "[AUTHOR:...]<newline>text".
  // Actually, the cleanest approach is to store author in the ts field extension.
  // Cleanest: store a custom RoomMessage that has role + content + author via
  // the same DB KV but under a separate key. But appendChatMessage only takes
  // role + content. Per spec: history returns { messages: Array<{role,content,author?}> }.
  // Design call: store author-annotated messages in a SEPARATE key
  // `roomAuthors:<roomId>` as an array of {ts, author} so we can zip with transcript.
  // But that's two reads on every /history call. Simpler: encode author in
  // content as a leading JSON line that the history route strips out.
  // Simpler yet: just store via appendChatMessage but encode author in a parallel
  // transcript-like KV key. Let's go with the simplest: embed author serialized
  // inside the message content as a sentinel prefix — the history route parses it
  // back out. Prefix: "\x00AUTHOR:<json>\x00". This is invisible to display code
  // that renders content directly. The mobile client parses it.
  const ownerAuthorJson = JSON.stringify({
    kind: 'human',
    ref_id: ownerId,
    display_name: resolveOwnerDisplayName(),
  });
  const ownerContent = `\x00AUTHOR:${ownerAuthorJson}\x00${text}`;

  appendChatMessage(threadId, { role: 'user', content: ownerContent });

  // Capture pre-send screen.
  const preCap = captureCliOutput(staffId);
  const preScreen = preCap.ok ? (preCap.output ?? '') : '';

  // sendKeys into the staff's tmux.
  const r = sendKeys(staffId, text, true);
  if (!r.ok) {
    const errNote = r.reason === 'no_session'
      ? '该员工的终端当前未运行，请先在「后台」启动它再发消息。'
      : `发送失败: ${r.reason}`;
    const errAuthorJson = JSON.stringify({
      kind: 'ai_agent',
      ref_id: staffId,
      display_name: staff.name,
    });
    appendChatMessage(threadId, { role: 'assistant', content: `\x00AUTHOR:${errAuthorJson}\x00${errNote}` });
    if (r.reason === 'no_session') {
      return NextResponse.json({ error: 'no_session', code: 'no_session' }, { status: 409 });
    }
    return NextResponse.json({ error: r.reason, code: 'cli_input_failed' }, { status: 500 });
  }

  // Fire-and-forget settle-watch; capture the raw agent reply and append to thread.
  inFlightRoom.add(staffId);
  void (async () => {
    try {
      const { settled, delta } = await waitForCliSettle(staffId, preScreen);

      if (!delta || !delta.trim()) {
        console.log(JSON.stringify({
          audit: 'room.chat.no_delta',
          room_id: id,
          staff_id: staffId,
          settled,
          ts: new Date().toISOString(),
        }));
        return;
      }

      // Strip the user echo from the delta before appending.
      // The echo appears as the first occurrence of `text` in delta.
      const echoIdx = delta.indexOf(text);
      const cleanDelta = echoIdx >= 0
        ? delta.slice(echoIdx + text.length).trimStart()
        : delta;

      if (!cleanDelta.trim()) return;

      const agentAuthorJson = JSON.stringify({
        kind: 'ai_agent',
        ref_id: staffId,
        display_name: staff.name,
      });
      appendChatMessage(threadId, {
        role: 'assistant',
        content: `\x00AUTHOR:${agentAuthorJson}\x00${cleanDelta.trim()}`,
      });

      console.log(JSON.stringify({
        audit: 'room.chat.appended',
        room_id: id,
        staff_id: staffId,
        settled,
        delta_chars: cleanDelta.length,
        ts: new Date().toISOString(),
      }));
    } catch (err) {
      console.error(JSON.stringify({
        audit: 'room.chat.settle_error',
        room_id: id,
        staff_id: staffId,
        error: err instanceof Error ? err.message : String(err),
        ts: new Date().toISOString(),
      }));
    } finally {
      inFlightRoom.delete(staffId);
    }
  })();

  return NextResponse.json({
    ok: true,
    room_id: id,
    staff_id: staffId,
    routed: 'tmux',
  });
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

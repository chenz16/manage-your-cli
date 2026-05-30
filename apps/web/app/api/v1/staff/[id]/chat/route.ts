import { NextResponse } from 'next/server';
import { getStaffMerged, appendChatMessage, sendKeys, captureCliOutput } from '@holon/core';
import { deviceAuthErrorResponse, requireDeviceTokenForRemote } from '@/lib/device-token-auth';
import { scheduleAdoptedSummary } from '@/lib/adopted-summarizer';

interface Context { params: Promise<{ id: string }> }

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * POST /api/v1/staff/:id/chat — talk to an employee.
 *
 * UNIFIED tmux model (owner 2026-05-26): every employee is an official CLI in
 * its own persistent tmux (CLAUDE.md: "watchable + driveable"). The 前台 message
 * is piped straight INTO that tmux via send-keys, so 前台 and 后台 are the SAME
 * session — NOT a separate warm `claude --print` process (that duplicated the
 * Secretary pattern and produced a second, disconnected claude). The reply
 * streams in the 后台 terminal; summarisation, if wanted, is done by the agent's
 * own prompt. The Secretary is the ONLY warm headless relay and uses a different
 * endpoint (/api/v1/chat/owner/stream).
 */
export async function POST(req: Request, ctx: Context): Promise<Response> {
  const auth = requireDeviceTokenForRemote(req);
  if (!auth.ok) return deviceAuthErrorResponse(auth);

  const { id } = await ctx.params;
  const staff = getStaffMerged(id);
  if (!staff) return NextResponse.json({ error: 'staff not found', id }, { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body', code: 'invalid_json' }, { status: 400 });
  }

  const b = body as { messages?: unknown; summarize?: unknown };
  const raw = b.messages;
  if (!Array.isArray(raw)) {
    return NextResponse.json({ error: 'messages must be an array', code: 'invalid_messages' }, { status: 400 });
  }

  // Optional opt-in field: body.summarize === true triggers the adopted-summarizer.
  const wantSummary = b.summarize === true;

  const messages = raw
    .filter((m): m is ChatMessage =>
      typeof m === 'object' &&
      m !== null &&
      ((m as { role?: unknown }).role === 'user' || (m as { role?: unknown }).role === 'assistant') &&
      typeof (m as { content?: unknown }).content === 'string',
    )
    .slice(-30);

  const latestUser = [...messages].reverse().find((m) => m.role === 'user' && m.content.trim());
  if (!latestUser) {
    return NextResponse.json({ error: 'at least one user message required', code: 'missing_user_message' }, { status: 400 });
  }

  const threadId = `staff:${id}`;
  const userContent = latestUser.content.trim();
  appendChatMessage(threadId, { role: 'user', content: userContent });

  const substrate = staff.substrate;
  if (substrate.kind !== 'cli_agent') {
    return NextResponse.json(
      { error: 'staff has no CLI substrate', code: 'no_cli_substrate', kind: substrate.kind },
      { status: 409 },
    );
  }

  // Capture pane before send (needed for delta computation in summarizer).
  const preCapture = wantSummary ? captureCliOutput(staff.id) : null;
  const preScreen = preCapture?.ok ? (preCapture.output ?? '') : '';

  // Pipe the message into the staff's own tmux session (send-keys + Enter).
  const r = sendKeys(staff.id, userContent, true);
  if (!r.ok) {
    if (r.reason === 'no_session') {
      const note = '该员工的终端当前未运行,请先在「后台」启动它再发消息。';
      appendChatMessage(threadId, { role: 'assistant', content: note });
      return NextResponse.json({ error: 'no_session', code: 'no_session', reply: note }, { status: 409 });
    }
    return NextResponse.json({ error: r.reason, code: 'cli_input_failed' }, { status: 500 });
  }

  // Fire-and-forget summarizer when client opted in. Pass userContent so the
  // haiku can subtract the echo and summarize ONLY the CLI's response.
  if (wantSummary) {
    scheduleAdoptedSummary(staff.id, substrate.cwd, preScreen, userContent);
  }

  // Owner: 不要把"已发送到终端"这种 note 也写进 thread — thread 里只留真正的总结。
  // 返回给前端的 reply 仍然带这句作为瞬时提示,但不持久化。
  const note = '已发送到终端。回复在「后台」实时查看。';
  console.log(JSON.stringify({
    audit: 'staff.chat_turn.routed_tmux',
    staff_id: staff.id,
    external: !!substrate.external_session,
    user_chars: userContent.length,
    summarize: wantSummary,
    ts: new Date().toISOString(),
  }));
  return NextResponse.json({ reply: note, staff_id: staff.id, routed: 'tmux' });
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

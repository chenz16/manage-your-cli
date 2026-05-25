import { NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import { getStaffMerged, appendChatMessage, getOwner } from '@holon/core';
import { deviceAuthErrorResponse, requireDeviceTokenForRemote } from '@/lib/device-token-auth';
import { getEffectiveLanguage } from '@/lib/i18n/get-effective-language';
import { sendWarmTurn } from '@/lib/warm-agent';

interface Context { params: Promise<{ id: string }> }

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

// Route files may only export handlers + config (next build route-type
// validation), so prompt assembly stays as a local (non-exported) helper.
function buildStaffPrompt(
  staff: { name: string; role_label?: string | undefined; system_prompt?: string | undefined },
  userText: string,
  language: 'en' | 'zh-CN',
): string {
  const parts: string[] = [];
  if (language === 'zh-CN') {
    parts.push('[语言要求] 必须以中文为主回答，除非用户明确要求其他语言。', '');
  } else {
    parts.push('[Language] Reply in English unless the user explicitly asks otherwise.', '');
  }
  // Persona header — re-sent each turn (cheap, matches the owner-chat pattern);
  // the warm process retains the running conversation, so we only send the
  // latest user message as the actual turn content.
  const persona = (staff.system_prompt ?? '').trim();
  parts.push(`[角色] 你是「${staff.name}」${staff.role_label ? `（${staff.role_label}）` : ''}。`);
  if (persona) parts.push(persona);
  parts.push('', userText);
  return parts.join('\n');
}

const TURN_TIMEOUT_MS = 120_000;

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

  const raw = (body as { messages?: unknown })?.messages;
  if (!Array.isArray(raw)) {
    return NextResponse.json({ error: 'messages must be an array', code: 'invalid_messages' }, { status: 400 });
  }

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

  // Resolve the staff's real CLI substrate. Subscription-only — drive the
  // official CLI (claude warm process / codex exec). No API key, no stub.
  const substrate = staff.substrate;
  if (substrate.kind !== 'cli_agent') {
    return NextResponse.json(
      { error: 'staff has no CLI substrate', code: 'no_cli_substrate', kind: substrate.kind },
      { status: 409 },
    );
  }
  const cwd = substrate.cwd;
  const binary = substrate.binary || 'claude';
  const language = getEffectiveLanguage(getOwner());
  const prompt = buildStaffPrompt(staff, userContent, language);

  let reply: string;
  try {
    reply = await runStaffTurn(staff.id, binary, cwd, prompt, req.signal);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({
      audit: 'staff.chat_turn.failed', staff_id: staff.id, binary, error: message,
      ts: new Date().toISOString(),
    }));
    return NextResponse.json({ error: message, code: 'cli_turn_failed' }, { status: 502 });
  }

  reply = reply.trim();
  if (reply) appendChatMessage(threadId, { role: 'assistant', content: reply });

  console.log(JSON.stringify({
    audit: 'staff.chat_turn', staff_id: staff.id, binary,
    user_chars: userContent.length, reply_chars: reply.length, ts: new Date().toISOString(),
  }));

  return NextResponse.json({ reply, staff_id: staff.id });
}

/** Run one chat turn against the staff's CLI and resolve the full reply.
 *  claude → warm persistent process (~1.8s/turn warm). codex/other → `exec`. */
function runStaffTurn(
  key: string, binary: string, cwd: string | undefined, prompt: string, signal: AbortSignal,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`CLI turn timed out after ${TURN_TIMEOUT_MS / 1000}s`)), TURN_TIMEOUT_MS);
    const done = (fn: () => void) => { clearTimeout(timer); fn(); };

    if (binary === 'claude') {
      let assembled = '';
      sendWarmTurn(key, binary, cwd, prompt, {
        onText: (full) => { assembled = full; },
        onDone: () => done(() => resolve(assembled)),
        onError: (msg) => done(() => reject(new Error(msg))),
        signal,
      });
      return;
    }

    // codex (or other): per-turn exec — no verified persistent stream mode yet.
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(binary, ['exec', prompt], { cwd, env: process.env });
    } catch (err) {
      done(() => reject(err instanceof Error ? err : new Error(String(err))));
      return;
    }
    const onAbort = () => { try { child.kill('SIGTERM'); } catch { /* noop */ } done(() => reject(new Error('aborted'))); };
    signal.addEventListener('abort', onAbort, { once: true });
    let out = '';
    let errOut = '';
    child.stdout?.on('data', (b: Buffer) => { out += b.toString('utf8'); });
    child.stderr?.on('data', (b: Buffer) => { errOut += b.toString('utf8'); });
    child.on('error', (err: Error) => { signal.removeEventListener('abort', onAbort); done(() => reject(err)); });
    child.on('close', (code: number | null) => {
      signal.removeEventListener('abort', onAbort);
      if ((code ?? 0) !== 0 && !out.trim()) { done(() => reject(new Error(errOut.trim() || `${binary} exited ${code}`))); return; }
      done(() => resolve(out));
    });
  });
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

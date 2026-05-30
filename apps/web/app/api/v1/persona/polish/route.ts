import { NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { deviceAuthErrorResponse, requireDeviceTokenForRemote } from '@/lib/device-token-auth';

/**
 * POST /api/v1/persona/polish — LLM-polish an employee persona (system instruction).
 *
 * North Star: intelligence is the CLI's; NO api key. We spawn a one-off headless
 * `claude --print` turn (the user's own subscription auth) — a dedicated
 * persona-polish agent, separate from the Secretary's warm process so it never
 * collides with owner chat. Input/output is plain text via stdin/stdout.
 *
 * Body: { text: string, role_label?: string }
 * Reply: { polished: string }
 */

const POLISH_TIMEOUT_MS = 60_000;
const MAX_INPUT_CHARS = 4000;

export async function POST(req: Request): Promise<Response> {
  const auth = requireDeviceTokenForRemote(req);
  if (!auth.ok) return deviceAuthErrorResponse(auth);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body', code: 'invalid_json' }, { status: 400 });
  }

  const text = typeof (body as { text?: unknown })?.text === 'string'
    ? (body as { text: string }).text.trim() : '';
  if (!text) {
    return NextResponse.json({ error: 'text is required', code: 'missing_text' }, { status: 400 });
  }
  if (text.length > MAX_INPUT_CHARS) {
    return NextResponse.json({ error: `text too long (max ${MAX_INPUT_CHARS})`, code: 'text_too_long' }, { status: 400 });
  }
  const roleLabel = typeof (body as { role_label?: unknown })?.role_label === 'string'
    ? (body as { role_label: string }).role_label.trim() : '';

  const prompt = [
    '你是"员工人设润色助手"。把下面这段员工的系统指令(人设)润色得更清晰、结构化、可执行,',
    '严格保留原意与原语言。直接输出润色后的指令本身,不要任何解释、前言、客套或代码块标记。',
    '',
    roleLabel ? `员工角色:${roleLabel}` : '',
    '原始人设:',
    text,
  ].filter(Boolean).join('\n');

  let polished: string;
  try {
    polished = await runClaudePrint(prompt, req.signal);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({ audit: 'persona.polish.failed', error: message, ts: new Date().toISOString() }));
    return NextResponse.json({ error: message, code: 'polish_failed' }, { status: 502 });
  }

  polished = polished.trim();
  if (!polished) {
    return NextResponse.json({ error: 'empty polish result', code: 'empty_result' }, { status: 502 });
  }
  console.log(JSON.stringify({
    audit: 'persona.polish', in_chars: text.length, out_chars: polished.length, ts: new Date().toISOString(),
  }));
  return NextResponse.json({ polished });
}

/** One-off headless claude turn. Prompt via stdin, reply on stdout. Haiku for
 *  speed/cost (polish is a light task). Subscription auth — no api key. */
function runClaudePrint(prompt: string, signal: AbortSignal): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn('claude', ['--print', '--model', 'haiku', '--dangerously-skip-permissions'], {
        cwd: homedir(), env: process.env,
      });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    const timer = setTimeout(() => { try { child.kill('SIGTERM'); } catch { /* noop */ } reject(new Error(`polish timed out after ${POLISH_TIMEOUT_MS / 1000}s`)); }, POLISH_TIMEOUT_MS);
    const onAbort = () => { try { child.kill('SIGTERM'); } catch { /* noop */ } };
    signal.addEventListener('abort', onAbort, { once: true });
    let out = '';
    let errOut = '';
    child.stdout?.on('data', (b: Buffer) => { out += b.toString('utf8'); });
    child.stderr?.on('data', (b: Buffer) => { errOut += b.toString('utf8'); });
    child.on('error', (err: Error) => { clearTimeout(timer); signal.removeEventListener('abort', onAbort); reject(err); });
    child.on('close', (code: number | null) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      if ((code ?? 0) !== 0 && !out.trim()) { reject(new Error(errOut.trim() || `claude exited ${code}`)); return; }
      resolve(out);
    });
    try { child.stdin?.write(prompt); child.stdin?.end(); }
    catch (err) { clearTimeout(timer); reject(err instanceof Error ? err : new Error(String(err))); }
  });
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

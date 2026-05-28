import { NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { readChatTranscript } from '@holon/core';
import { deviceAuthErrorResponse, requireDeviceTokenForRemote } from '@/lib/device-token-auth';

/**
 * GET /api/v1/chat/owner-actions — 老板代办.
 *
 * Owner directive 2026-05-25: on the 小秘 page hang the boss's own action items
 * — the things that need the BOSS to act (authorize / approve / decide / reply),
 * extracted from the owner↔小秘 conversation. This is the boss-and-secretary's
 * territory; peer/external asks go through 看板 instead, not here.
 *
 * Thin shell: a one-off headless `claude --print --model haiku` over the recent
 * owner transcript (subscription auth, NO api key). Stateless.
 *
 * Reply: { items: string[] }  // ≤5, urgent-first; [] when nothing needs the boss.
 */

const TIMEOUT_MS = 45_000;
const MAX_MSGS = 30;
// Owner-actions spawns a fresh `claude --print` (8-17s each). Mobile poll
// fired this on every page mount → 8s burned per visit even when transcript
// unchanged. Cache results for 5 min keyed on transcript hash. Survives HMR
// via globalThis (perf audit 2026-05-27).
const ACTIONS_CACHE_TTL = 5 * 60_000;
const _gActions = globalThis as unknown as { __holonOwnerActionsCache?: { hash: string; items: string[]; at: number } };
function _hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

const PROMPT_HEAD = [
  '你是老板的秘书。下面是「老板(user)」和「你(assistant)」的对话记录。',
  '请提取出**需要老板本人处理/拍板**的事项 —— 例如:授权、同意、确认、决定、回复某人、做选择。',
  '规则:',
  '- 只列需要老板亲自做的;派给员工执行的活不要列(那不需要老板)。',
  '- 已经处理过/已同意的不要列。',
  '- 每条一句话(≤15字),按紧急度排序,最多 5 条。',
  '- 只输出一个 JSON 字符串数组,没有就输出 []。不要任何解释或代码块标记。',
  '',
  '对话:',
].join('\n');

function parseItems(out: string): string[] {
  let s = out.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence && fence[1]) s = fence[1].trim();
  const arr = s.match(/\[[\s\S]*\]/);
  if (arr && arr[0]) s = arr[0];
  try {
    const j = JSON.parse(s) as unknown;
    if (!Array.isArray(j)) return [];
    return j.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      .map((x) => x.trim()).slice(0, 5);
  } catch {
    return [];
  }
}

export async function GET(req: Request): Promise<Response> {
  const auth = requireDeviceTokenForRemote(req);
  if (!auth.ok) return deviceAuthErrorResponse(auth);

  const transcript = readChatTranscript('owner', MAX_MSGS);
  if (transcript.length === 0) return NextResponse.json({ items: [] });

  const convo = transcript
    .map((t) => `${t.role === 'user' ? '老板' : '你'}: ${t.content}`)
    .join('\n');

  // Cache hit: same transcript within 5 min → skip the 8-17s spawn entirely.
  const transcriptHash = _hash(convo);
  const cached = _gActions.__holonOwnerActionsCache;
  if (cached && cached.hash === transcriptHash && Date.now() - cached.at < ACTIONS_CACHE_TTL) {
    return NextResponse.json({ items: cached.items });
  }

  let out: string;
  try {
    out = await runClaudePrint(`${PROMPT_HEAD}\n${convo}`, req.signal);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({ audit: 'owner.actions.failed', error: message, ts: new Date().toISOString() }));
    return NextResponse.json({ error: message, code: 'extract_failed' }, { status: 502 });
  }

  const items = parseItems(out);
  _gActions.__holonOwnerActionsCache = { hash: transcriptHash, items, at: Date.now() };
  console.log(JSON.stringify({ audit: 'owner.actions', msgs: transcript.length, items: items.length, ts: new Date().toISOString() }));
  return NextResponse.json({ items });
}

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
    const timer = setTimeout(() => { try { child.kill('SIGTERM'); } catch { /* noop */ } reject(new Error(`owner-actions timed out after ${TIMEOUT_MS / 1000}s`)); }, TIMEOUT_MS);
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

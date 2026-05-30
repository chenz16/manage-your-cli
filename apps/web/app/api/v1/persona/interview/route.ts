import { NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { deviceAuthErrorResponse, requireDeviceTokenForRemote } from '@/lib/device-token-auth';

/**
 * POST /api/v1/persona/interview — AI 采访式人设定位 (multi-turn).
 *
 * Owner directive 2026-05-25: replace the one-off "AI 定位" with an
 * interviewer that asks one question at a time (角色 / 使命 / 日常 / 痛点),
 * then synthesizes a first-person persona. Better than a blank box for
 * non-technical owners.
 *
 * North Star: intelligence is the CLI's; NO api key. Each turn is a one-off
 * headless `claude --print` (subscription auth) carrying the full transcript
 * in the prompt — stateless server, transcript lives on the client.
 *
 * Body: {
 *   transcript: Array<{ role: 'interviewer' | 'owner', content: string }>,
 *   industry?: string   // 行业/职业 picked at onboarding — known up front, so the
 *                       // interviewer skips 角色 and tailors 使命/日常/痛点 to it.
 * }
 *   - empty transcript → returns the opening question.
 * Reply: { done: false, message } | { done: true, persona, message }
 */

const TURN_TIMEOUT_MS = 60_000;
const MAX_TRANSCRIPT_TURNS = 24;
const MAX_TURN_CHARS = 2000;

interface Turn { role: 'interviewer' | 'owner'; content: string }

function parseTranscript(body: unknown): Turn[] | null {
  const raw = (body as { transcript?: unknown })?.transcript;
  if (!Array.isArray(raw)) return null;
  if (raw.length > MAX_TRANSCRIPT_TURNS) return null;
  const out: Turn[] = [];
  for (const t of raw) {
    const role = (t as { role?: unknown })?.role;
    const content = (t as { content?: unknown })?.content;
    if ((role !== 'interviewer' && role !== 'owner') || typeof content !== 'string') return null;
    out.push({ role, content: content.slice(0, MAX_TURN_CHARS) });
  }
  return out;
}

const SYSTEM = [
  '你是一位温和、专业的"人设采访师"。你在帮一位(可能不太懂技术的)老板梳理他的个人定位,',
  '好让他的 AI 助手团队真正懂他。一次只问一个问题,口语化、具体、不绕弯。',
  '要覆盖这四个方面(按顺序,但顺着对方的话灵活追问):',
  '  1) 角色 —— 你是做什么的、什么行业、什么身份;',
  '  2) 使命 —— 你想达成什么、最在意的目标;',
  '  3) 日常 —— 平时主要忙些什么;',
  '  4) 痛点 —— 什么最占你时间、最让你头疼、最希望别人帮你分担。',
  '当四个方面都问到、信息足够时(通常 4-5 轮),把它综合成一段第一人称的人设(150 字内,自然连贯,不要分点罗列)。',
  '默认用中文,但跟随对方使用的语言。',
  '',
  '严格只输出一个 JSON 对象,不要任何解释、前后缀或代码块标记:',
  '  还要继续问 → {"done": false, "message": "<下一个问题>"}',
  '  采访完成   → {"done": true, "persona": "<第一人称人设段落>", "message": "<一句收尾的话>"}',
].join('\n');

function buildPrompt(transcript: Turn[], industry: string): string {
  const known = industry
    ? `\n\n已知背景(老板在 onboarding 时填的行业/职业):${industry}\n` +
      '不要再问"你是做什么的",直接从这个行业出发,问使命/日常/痛点,问题要贴合这一行。'
    : '';
  if (transcript.length === 0) {
    return `${SYSTEM}${known}\n\n对话还没开始。请输出开场的第一个问题(JSON,done:false)。`;
  }
  const convo = transcript
    .map((t) => `${t.role === 'interviewer' ? '采访师' : '老板'}: ${t.content}`)
    .join('\n');
  return `${SYSTEM}${known}\n\n已有对话:\n${convo}\n\n请给出你的下一步(JSON)。`;
}

interface InterviewResult { done: boolean; message: string; persona?: string }

function parseModelJson(out: string): InterviewResult | null {
  let s = out.trim();
  // Strip ``` fences if the model added them despite instructions.
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence && fence[1]) s = fence[1].trim();
  // Grab the first {...} block.
  const brace = s.match(/\{[\s\S]*\}/);
  if (brace && brace[0]) s = brace[0];
  try {
    const j = JSON.parse(s) as { done?: unknown; message?: unknown; persona?: unknown };
    const message = typeof j.message === 'string' ? j.message.trim() : '';
    const done = j.done === true;
    const persona = typeof j.persona === 'string' ? j.persona.trim() : '';
    if (done) {
      if (!persona) return null;
      return { done: true, message: message || '采访完成', persona };
    }
    if (!message) return null;
    return { done: false, message };
  } catch {
    return null;
  }
}

export async function POST(req: Request): Promise<Response> {
  const auth = requireDeviceTokenForRemote(req);
  if (!auth.ok) return deviceAuthErrorResponse(auth);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body', code: 'invalid_json' }, { status: 400 });
  }

  const transcript = parseTranscript(body);
  if (transcript === null) {
    return NextResponse.json({ error: 'invalid transcript', code: 'invalid_transcript' }, { status: 400 });
  }
  const industry = typeof (body as { industry?: unknown })?.industry === 'string'
    ? (body as { industry: string }).industry.trim().slice(0, 200) : '';

  let out: string;
  try {
    out = await runClaudePrint(buildPrompt(transcript, industry), req.signal);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({ audit: 'persona.interview.failed', error: message, ts: new Date().toISOString() }));
    return NextResponse.json({ error: message, code: 'interview_failed' }, { status: 502 });
  }

  const parsed = parseModelJson(out);
  if (!parsed) {
    // Model didn't return parseable JSON — surface its raw text as the next
    // question rather than failing the whole flow.
    const fallback = out.trim();
    if (!fallback) {
      return NextResponse.json({ error: 'empty interview result', code: 'empty_result' }, { status: 502 });
    }
    return NextResponse.json({ done: false, message: fallback });
  }

  console.log(JSON.stringify({
    audit: 'persona.interview', turns: transcript.length, done: parsed.done, ts: new Date().toISOString(),
  }));
  return NextResponse.json(parsed);
}

/** One-off headless claude turn. Prompt via stdin, reply on stdout. Haiku for
 *  speed/cost. Subscription auth — no api key. */
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
    const timer = setTimeout(() => { try { child.kill('SIGTERM'); } catch { /* noop */ } reject(new Error(`interview timed out after ${TURN_TIMEOUT_MS / 1000}s`)); }, TURN_TIMEOUT_MS);
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

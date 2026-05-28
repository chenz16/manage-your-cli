/**
 * warm-agent — keep ONE official-CLI process alive per agent and feed it turns,
 * so we pay the ~4s CLI cold-start ONCE, not every message.
 *
 * Measured (claude 2.1.148): cold turn ~5.8s, subsequent warm turns ~1.8s.
 * The stream-json stdout is a clean "fast channel" — no TUI screen-scrape.
 * Subscription-only (OAuth/Max): we drive the official `claude --print` in
 * stream-json mode. (We do NOT use `--bare` — it disables subscription auth.)
 *
 * Owner-facing Secretary uses this for speed + clean output. Workers can keep
 * using live tmux (watchable); this is the latency-critical owner path.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Delegation rules appended to the secretary's system prompt. Concrete +
// example-driven so Haiku doesn't have to infer intent.
const DELEGATION_RULES = `
你是 owner 的智能秘书。你不是员工,不要自己动手干活。

任务路由规则(必须遵守):
1. owner 让你"对 X 说...""转告 X""派给 X""问 X""让 X 干..."(X = CLI / 员工 / 我 / staff_xxx / 某人名)→ 你必须调用 mcp__holon__dispatch,参数 agent=X 名字或 id,brief=消息或任务说明。不要自己代答。
2. owner 让你做需要写代码 / build / commit / push / 安装 / 部署 / 改文件的活 → 必须 mcp__holon__dispatch 给员工(默认派给"我"或 mgr,如果不确定先 mcp__holon__list_live_agents)。不要自己 Bash/Edit/Write。
3. 不知道员工名字/id → 先 mcp__holon__list_live_agents 查,再 dispatch。
4. 派出去之后用 mcp__holon__read_agent_output 跟进结果,然后给 owner 简短汇报。
5. 只有"你好/谢谢/今天怎样"这种纯闲聊和"给我列一下..."这种纯查询(读 memory)才你自己回。

例子:
- owner: "hello to CLI" → 调 mcp__holon__dispatch({agent:"CLI", brief:"hello"}),然后回 owner:"已转 CLI"。
- owner: "让我把 README 改成 X" → 调 mcp__holon__dispatch({agent:"我", brief:"把 README 改成 X 并 commit"}),然后回 owner:"已派给 我"。
- owner: "今天天气怎样" → 你直接回(不需要 dispatch)。

输出始终极简、中文、不重复 owner 的话。
`;

interface WarmAgent {
  proc: ChildProcess;
  buf: string;
  busy: boolean;
  assembled: string;
  idleTimer: ReturnType<typeof setTimeout> | null;
  onText: ((full: string) => void) | null;
  onDone: (() => void) | null;
  onError: ((msg: string) => void) | null;
}

const G = globalThis as unknown as {
  __holonWarmAgents?: Map<string, WarmAgent>;
  __holonWarmKeep?: Map<string, { binary: string; cwd: string | undefined }>;
  __holonWarmHeartbeat?: boolean;
};
if (!G.__holonWarmAgents) G.__holonWarmAgents = new Map();
if (!G.__holonWarmKeep) G.__holonWarmKeep = new Map();
const AGENTS = G.__holonWarmAgents;
const KEEP = G.__holonWarmKeep; // keys here are kept always-warm: never reaped, respawned if they die

const IDLE_REAP_MS = 5 * 60 * 1000; // kill a warm process after 5 min idle (non-keep agents only)

/** Heartbeat: respawn any keep-warm agent that has died, so the owner's first
 *  message is never cold (after the one-time server-start boot). */
function startHeartbeat(): void {
  if (G.__holonWarmHeartbeat) return;
  G.__holonWarmHeartbeat = true;
  const t = setInterval(() => {
    for (const [key, { binary, cwd }] of KEEP) {
      const a = AGENTS.get(key);
      if (!a || a.proc.killed || a.proc.exitCode !== null) {
        AGENTS.set(key, spawnWarm(key, binary, cwd));
      }
    }
  }, 30_000);
  if (typeof t.unref === 'function') t.unref();
}

function armIdleReaper(key: string, a: WarmAgent): void {
  if (KEEP.has(key)) return; // keep-warm agents are never reaped
  if (a.idleTimer) clearTimeout(a.idleTimer);
  a.idleTimer = setTimeout(() => {
    try { a.proc.kill('SIGTERM'); } catch { /* noop */ }
    AGENTS.delete(key);
  }, IDLE_REAP_MS);
}

function spawnWarm(key: string, binary: string, cwd: string | undefined): WarmAgent {
  // claude: persistent stream-json loop. codex: fall back to per-turn `exec`
  // (no persistent stream mode verified) — handled by caller via binary check.
  // Lean Secretary defaults to a FAST model (Haiku): measured warm turn ~0.85s
  // (vs ~1.3s default). Override with HOLON_SECRETARY_MODEL. --include-partial-messages
  // streams token deltas so first text shows ~0.75s (no blank wait).
  const model = process.env.HOLON_SECRETARY_MODEL?.trim() || 'claude-haiku-4-5';
  // Lean Secretary: low reasoning effort = skip the extended-thinking phase →
  // first TEXT token sooner. Override with HOLON_SECRETARY_EFFORT.
  const effort = process.env.HOLON_SECRETARY_EFFORT?.trim() || 'low';
  const args = ['--print', '--input-format', 'stream-json', '--output-format', 'stream-json',
    '--include-partial-messages', '--verbose', '--dangerously-skip-permissions',
    '--model', model, '--effort', effort];
  // Explicitly load .mcp.json from cwd (stream-json + --print may NOT auto-
  // discover the project mcp file the way the interactive TUI does). Without
  // this the secretary spawns with no tools and just bashes work itself
  // instead of dispatching to employees.
  if (cwd) {
    const mcpPath = join(cwd, '.mcp.json');
    if (existsSync(mcpPath)) {
      args.push('--mcp-config', mcpPath);
      // Append explicit delegation rules so the secretary actually USES the
      // dispatch tool when the owner asks to relay/send anything to an
      // employee/CLI agent (without this the model just composes a reply
      // pretending to be the recipient).
      args.push('--append-system-prompt', DELEGATION_RULES);
    }
  }
  const proc = spawn(binary, args, { cwd, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
  const a: WarmAgent = {
    proc, buf: '', busy: false, assembled: '', idleTimer: null,
    onText: null, onDone: null, onError: null,
  };

  const settleTurn = () => {
    const done = a.onDone;
    a.busy = false;
    a.onText = null; a.onDone = null; a.onError = null;
    armIdleReaper(key, a);
    done?.();
  };

  proc.stdout?.on('data', (d: Buffer) => {
    a.buf += d.toString('utf8');
    let nl: number;
    while ((nl = a.buf.indexOf('\n')) >= 0) {
      const line = a.buf.slice(0, nl);
      a.buf = a.buf.slice(nl + 1);
      if (!line.trim()) continue;
      let ev: {
        type?: string;
        message?: { content?: Array<{ type: string; text?: string }> };
        event?: { type?: string; delta?: { type?: string; text?: string } };
        result?: unknown;
      };
      try { ev = JSON.parse(line); } catch { continue; }
      if (ev.type === 'stream_event') {
        // Token-by-token deltas (--include-partial-messages) → typewriter feel.
        const d = ev.event?.delta;
        if (ev.event?.type === 'content_block_delta' && d?.type === 'text_delta' && typeof d.text === 'string') {
          a.assembled += d.text;
          a.onText?.(a.assembled);
        }
      } else if (ev.type === 'assistant' && ev.message?.content) {
        // Authoritative full message — reconcile (covers any missed delta).
        const text = ev.message.content
          .filter((b) => b.type === 'text' && typeof b.text === 'string')
          .map((b) => b.text as string).join('');
        if (text && text !== a.assembled) { a.assembled = text; a.onText?.(a.assembled); }
      } else if (ev.type === 'result') {
        if (typeof ev.result === 'string' && ev.result.trim() && ev.result !== a.assembled) {
          a.assembled = ev.result; a.onText?.(a.assembled);
        }
        settleTurn();
      }
    }
  });
  proc.stderr?.on('data', () => { /* claude logs to stderr; ignore */ });
  proc.on('error', (err) => { a.onError?.(err.message); settleTurn(); });
  proc.on('exit', () => { AGENTS.delete(key); });
  return a;
}

/** Eagerly spawn the warm process (pay the ~4s cold-start in the background) so
 *  the owner's FIRST message doesn't wait. Idempotent. Called on chat mount via
 *  /api/v1/chat/warm — no user typing required. claude-only (codex has no warm mode). */
export function prewarmAgent(
  key: string, binary: string, cwd: string | undefined, keep = false,
): { warming: boolean; alreadyWarm: boolean } {
  if (binary !== 'claude') return { warming: false, alreadyWarm: false };
  if (keep) { KEEP.set(key, { binary, cwd }); startHeartbeat(); }
  const existing = AGENTS.get(key);
  if (existing && !existing.proc.killed && existing.proc.exitCode === null) {
    return { warming: false, alreadyWarm: true };
  }
  const a = spawnWarm(key, binary, cwd);
  AGENTS.set(key, a);
  armIdleReaper(key, a);
  return { warming: true, alreadyWarm: false };
}

export interface WarmTurnHandlers {
  onText: (full: string) => void;
  onDone: () => void;
  onError: (msg: string) => void;
  signal?: AbortSignal;
}

/** Send one owner turn to the agent's warm process. Spawns it (cold) on first
 *  use, reuses it (warm ~1.8s) after. NOT for codex (caller handles that). */
export function sendWarmTurn(
  key: string, binary: string, cwd: string | undefined, prompt: string, h: WarmTurnHandlers,
): void {
  let a = AGENTS.get(key);
  if (!a || a.proc.killed || a.proc.exitCode !== null) {
    a = spawnWarm(key, binary, cwd);
    AGENTS.set(key, a);
  }
  if (a.busy) { h.onError('agent busy with another turn'); return; }
  if (a.idleTimer) { clearTimeout(a.idleTimer); a.idleTimer = null; }

  a.busy = true;
  a.assembled = '';
  a.onText = h.onText;
  a.onDone = h.onDone;
  a.onError = h.onError;

  if (h.signal) {
    const onAbort = () => {
      // Don't kill the warm process on a single abort — just detach this turn's
      // handlers so the process stays warm for the next message.
      a!.onText = null; a!.onDone = null; a!.onError = null; a!.busy = false;
      armIdleReaper(key, a!);
    };
    h.signal.addEventListener('abort', onAbort, { once: true });
  }

  const msg = JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: prompt }] } });
  try {
    a.proc.stdin?.write(msg + '\n');
  } catch (err) {
    h.onError(err instanceof Error ? err.message : String(err));
    a.busy = false;
  }
}

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
import { existsSync, readFileSync, writeFileSync, mkdirSync, createWriteStream, statSync, renameSync, fsyncSync, type WriteStream } from 'node:fs';
import { join, dirname } from 'node:path';
import { holonStateRoot } from '@holon/core';
import { register as regProcess, unregister as unregProcess, touch as touchProcess, markStatus } from './process-registry';
import { setBusyProbe } from './settle-watch';
import type { SyntheticMessage } from './synthetic-producers';

// ---- Transcript persistence ----------------------------------------------
// One JSONL file per warm key; HR Path B scorer reads this back via
// `@holon/core/transcript-reader` to tighten 3 of 5 rubric items against
// actual tool_use / assistant events instead of just the final result text.
// ADR §4.7 (docs/adr/hr-evaluator-and-behavior-correction.md).
//
// Hard constraints from the spec:
//   - Append-only, non-blocking (createWriteStream, NOT writeFileSync) —
//     warm-agent is in the owner-chat hot path.
//   - Rotate at 50 MB → archive `<key>-YYYY-MM-DD.jsonl`, start fresh.
//   - Optional fsync per write via HOLON_TRANSCRIPT_FSYNC=1 (paranoid mode).
//   - Root: HOLON_TRANSCRIPT_ROOT > HOLON_STATE_ROOT/transcripts > ~/.holon/transcripts.
const TRANSCRIPT_ROTATE_BYTES = 50 * 1024 * 1024;

interface TranscriptWriter {
  stream: WriteStream;
  path: string;
  bytes: number;
}
const TRANSCRIPT_WRITERS = new Map<string, TranscriptWriter>();

function transcriptsDir(): string {
  if (process.env.HOLON_TRANSCRIPT_ROOT) return process.env.HOLON_TRANSCRIPT_ROOT;
  return join(holonStateRoot(), 'transcripts');
}

function safeKey(warmKey: string): string {
  return warmKey.replace(/[^A-Za-z0-9._-]/g, '_');
}

function rotateIfNeeded(w: TranscriptWriter, key: string): TranscriptWriter {
  if (w.bytes < TRANSCRIPT_ROTATE_BYTES) return w;
  try { w.stream.end(); } catch { /* noop */ }
  const dir = dirname(w.path);
  const safe = safeKey(key);
  // YYYY-MM-DD archive — if today's archive already exists (multiple rotations
  // in a day), bump with `-N`. Don't lose data.
  const date = new Date().toISOString().slice(0, 10);
  let archivePath = join(dir, `${safe}-${date}.jsonl`);
  let n = 1;
  while (existsSync(archivePath)) {
    archivePath = join(dir, `${safe}-${date}.${n}.jsonl`);
    n++;
  }
  try { renameSync(w.path, archivePath); } catch { /* best effort */ }
  return openTranscriptWriter(key);
}

function openTranscriptWriter(key: string): TranscriptWriter {
  const dir = transcriptsDir();
  try { mkdirSync(dir, { recursive: true }); } catch { /* noop */ }
  const path = join(dir, `${safeKey(key)}.jsonl`);
  let bytes = 0;
  try { bytes = statSync(path).size; } catch { /* new file */ }
  const stream = createWriteStream(path, { flags: 'a' });
  // Swallow async write errors — we never want a disk problem to crash the
  // warm-agent hot path. (Owner chat > log fidelity.)
  stream.on('error', () => { /* noop */ });
  const w: TranscriptWriter = { stream, path, bytes };
  TRANSCRIPT_WRITERS.set(key, w);
  return w;
}

function getTranscriptWriter(key: string): TranscriptWriter {
  const existing = TRANSCRIPT_WRITERS.get(key);
  if (existing && !existing.stream.destroyed && existing.stream.writable) {
    return rotateIfNeeded(existing, key);
  }
  return openTranscriptWriter(key);
}

export interface TranscriptAppend {
  ev_type: 'user_input' | 'assistant' | 'result' | 'tool_use' | 'tool_result';
  content: unknown;
  tokens_in?: number;
  tokens_out?: number;
  /** ISO ts override (test only). Defaults to now. */
  ts?: string;
  /** turn_id override (test only). Defaults to <key>-<ts>. */
  turn_id?: string;
}

/** Append one transcript event for a warm key. Non-blocking; returns
 *  immediately. Errors are swallowed (never breaks the hot path). */
export function appendTranscriptEvent(key: string, ev: TranscriptAppend): void {
  try {
    const w = getTranscriptWriter(key);
    const ts = ev.ts ?? new Date().toISOString();
    const line = JSON.stringify({
      ts,
      turn_id: ev.turn_id ?? `${key}-${ts}`,
      ev_type: ev.ev_type,
      content: ev.content,
      ...(ev.tokens_in !== undefined ? { tokens_in: ev.tokens_in } : {}),
      ...(ev.tokens_out !== undefined ? { tokens_out: ev.tokens_out } : {}),
    }) + '\n';
    w.stream.write(line);
    w.bytes += Buffer.byteLength(line);
    if (process.env.HOLON_TRANSCRIPT_FSYNC === '1') {
      // Paranoid mode: fsync the underlying fd. Only on if the operator asked.
      const fd = (w.stream as unknown as { fd: number | null }).fd;
      if (typeof fd === 'number') {
        try { fsyncSync(fd); } catch { /* noop */ }
      }
    }
    // Post-write rotation check (the next write will swap streams).
    if (w.bytes >= TRANSCRIPT_ROTATE_BYTES) rotateIfNeeded(w, key);
  } catch { /* never crash hot path on transcript failure */ }
}

/** Test-only: close + drop all writers (so a tmp HOLON_TRANSCRIPT_ROOT
 *  can be rm-rf'd cleanly between tests). */
export function _resetTranscriptWritersForTest(): void {
  for (const w of TRANSCRIPT_WRITERS.values()) {
    try { w.stream.end(); } catch { /* noop */ }
  }
  TRANSCRIPT_WRITERS.clear();
}

// Persist warm session ids per key so when the warm process dies (idle reap /
// HMR / OS restart), the next spawn can `claude --resume <id>` and pick up
// the same conversation history — same trick the owner uses to adopt the mgr
// tmux. Without resume, secretary loses everything on every cold spawn.
const SESSION_STORE = join(holonStateRoot(), 'warm-sessions.json');
function loadSessions(): Record<string, string> {
  try {
    if (existsSync(SESSION_STORE)) {
      return JSON.parse(readFileSync(SESSION_STORE, 'utf8')) as Record<string, string>;
    }
  } catch { /* corrupt — start fresh */ }
  return {};
}
function saveSession(key: string, sessionId: string): void {
  try {
    const all = loadSessions();
    if (all[key] === sessionId) return;
    all[key] = sessionId;
    mkdirSync(dirname(SESSION_STORE), { recursive: true });
    writeFileSync(SESSION_STORE, JSON.stringify(all, null, 2));
  } catch { /* best-effort */ }
}

interface WarmAgent {
  proc: ChildProcess;
  buf: string;
  busy: boolean;
  assembled: string;
  idleTimer: ReturnType<typeof setTimeout> | null;
  onText: ((full: string) => void) | null;
  onDone: (() => void) | null;
  onError: ((msg: string) => void) | null;
  sessionId: string | null;
}

const G = globalThis as unknown as {
  __holonWarmAgents?: Map<string, WarmAgent>;
  __holonWarmKeep?: Map<string, { binary: string; cwd: string | undefined }>;
  __holonWarmHeartbeat?: boolean;
  /** Per-secretary-key queue of pending synthetic messages. Drained
   *  (prepended) on the NEXT inbound turn. Non-preemptive: never pushed
   *  mid-turn. */
  __holonWarmSynthQueue?: Map<string, SyntheticMessage[]>;
  __holonWarmBusyProbeWired?: boolean;
};
if (!G.__holonWarmAgents) G.__holonWarmAgents = new Map();
if (!G.__holonWarmKeep) G.__holonWarmKeep = new Map();
if (!G.__holonWarmSynthQueue) G.__holonWarmSynthQueue = new Map();
const AGENTS = G.__holonWarmAgents;
const KEEP = G.__holonWarmKeep; // keys here are kept always-warm: never reaped, respawned if they die
const SYNTH_QUEUE = G.__holonWarmSynthQueue;

// One-time wiring: tell settle-watch how to ask "is this warm key busy right
// now?" — it needs that to gate the settle event (don't fire while mid-turn).
if (!G.__holonWarmBusyProbeWired) {
  G.__holonWarmBusyProbeWired = true;
  setBusyProbe((key) => {
    const a = AGENTS.get(key);
    return !!a && a.busy;
  });
}

/**
 * Enqueue synthetic messages for a warm-secretary key. The queue drains on
 * the NEXT inbound owner turn (sendWarmTurn) — NEVER pushed into a mid-turn
 * stream. That is the explicit ADR §4.3 Path B invariant ("不要打断 就是下
 * 一次提醒"). Tests verify this in warm-agent-synthetic.test.ts.
 */
export function enqueueSyntheticMessages(key: string, messages: SyntheticMessage[]): void {
  if (messages.length === 0) return;
  const existing = SYNTH_QUEUE.get(key) ?? [];
  existing.push(...messages);
  SYNTH_QUEUE.set(key, existing);
}

/** Snapshot the queue for a key — does NOT clear (test/inspection use). */
export function peekSyntheticQueue(key: string): SyntheticMessage[] {
  return [...(SYNTH_QUEUE.get(key) ?? [])];
}

/** Drain (read + clear) the queue. Used by sendWarmTurn on next inbound. */
export function drainSyntheticQueue(key: string): SyntheticMessage[] {
  const msgs = SYNTH_QUEUE.get(key) ?? [];
  SYNTH_QUEUE.delete(key);
  return msgs;
}

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
    }
  }
  // Resume the prior session if we have one. Lets the secretary keep memory
  // across HMR / idle reap / restarts (per owner: "记忆重启 要 resume").
  const prevSessionId = loadSessions()[key];
  if (prevSessionId) {
    args.push('--resume', prevSessionId);
  }
  const proc = spawn(binary, args, { cwd, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
  const a: WarmAgent = {
    proc, buf: '', busy: false, assembled: '', idleTimer: null,
    onText: null, onDone: null, onError: null,
    sessionId: prevSessionId ?? null,
  };
  if (proc.pid) {
    regProcess({
      key: `warm:${key}`,
      pid: proc.pid,
      kind: 'warm-secretary',
      ...(cwd !== undefined ? { cwd } : {}),
      ...(prevSessionId ? { sessionId: prevSessionId } : {}),
      meta: { binary, model },
    });
  }

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
        subtype?: string;
        session_id?: string;
        message?: {
          content?: Array<{
            type: string;
            text?: string;
            // tool_use blocks (claude-code Task / Read / Bash / mcp__*)
            id?: string;
            name?: string;
            input?: { description?: string; subagent_type?: string };
            // tool_result blocks
            tool_use_id?: string;
            content?: unknown;
          }>;
        };
        event?: { type?: string; delta?: { type?: string; text?: string } };
        result?: unknown;
      };
      try { ev = JSON.parse(line); } catch { continue; }
      // Init event carries the session_id; persist so a later cold spawn can
      // --resume this same session and keep the conversation memory.
      if (ev.type === 'system' && ev.subtype === 'init' && typeof ev.session_id === 'string') {
        a.sessionId = ev.session_id;
        saveSession(key, ev.session_id);
      }
      // Every stream event = heartbeat — touch the registry so the ticker
      // doesn't mark this warm process stuck mid-turn.
      touchProcess(`warm:${key}`);
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
        // Persist a transcript event for the assistant turn AND for each
        // tool_use block. HR Path B reads these back to score behavior.
        if (text) appendTranscriptEvent(key, { ev_type: 'assistant', content: text });
        for (const block of ev.message.content) {
          if (block.type === 'tool_use' && block.name) {
            appendTranscriptEvent(key, {
              ev_type: 'tool_use',
              content: {
                id: block.id,
                name: block.name,
                input: block.input ?? {},
              },
            });
          }
        }
        // Stream-json Task tool tap: register any in-process subagent that
        // the secretary spawned via the Task tool. These don't appear in
        // `ps` (they're internal to claude-code) but they're real work
        // happening on the secretary's behalf and we want them visible in
        // /api/v1/health for owner ops triage.
        for (const block of ev.message.content) {
          if (block.type === 'tool_use' && block.id && block.name) {
            const isTask = block.name === 'Task';
            // Track Task subagents + MCP holon dispatches (the high-signal
            // ones). Skip noise like Read/Bash/Glob — those don't represent
            // long-running work.
            const isHolonDispatch = block.name.startsWith('mcp__holon__');
            if (!isTask && !isHolonDispatch) continue;
            const subKey = `warm:${key}/tool:${block.id}`;
            regProcess({
              key: subKey,
              pid: proc.pid ?? 0,            // shares parent pid (in-process)
              kind: 'task-subagent',
              parentKey: `warm:${key}`,
              meta: {
                tool: block.name,
                description: block.input?.description ?? '',
                subagent_type: block.input?.subagent_type ?? '',
              },
            });
          }
        }
      } else if (ev.type === 'user' && ev.message?.content) {
        // Tool results land in synthetic 'user' messages — close out any
        // task-subagent we previously opened on tool_use.
        for (const block of ev.message.content) {
          if (block.type === 'tool_result' && block.tool_use_id) {
            const subKey = `warm:${key}/tool:${block.tool_use_id}`;
            markStatus(subKey, 'reaped');
            appendTranscriptEvent(key, {
              ev_type: 'tool_result',
              content: { tool_use_id: block.tool_use_id, content: block.content ?? null },
            });
          }
        }
      } else if (ev.type === 'result') {
        if (typeof ev.result === 'string' && ev.result.trim() && ev.result !== a.assembled) {
          a.assembled = ev.result; a.onText?.(a.assembled);
        }
        appendTranscriptEvent(key, { ev_type: 'result', content: a.assembled });
        settleTurn();
      }
    }
  });
  proc.stderr?.on('data', () => { /* claude logs to stderr; ignore */ });
  proc.on('error', (err) => { a.onError?.(err.message); settleTurn(); });
  proc.on('exit', () => {
    AGENTS.delete(key);
    unregProcess(`warm:${key}`);
  });
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

  // Persist the inbound owner prompt as the canonical turn boundary BEFORE
  // we write to stdin — readers group events by user_input boundaries
  // (transcript-reader.readRecentTurns). The synthetic-message drain
  // happens after so it's part of the same turn.
  appendTranscriptEvent(key, { ev_type: 'user_input', content: prompt });

  // Drain any synthetic messages queued by producers (HR, event-followup …)
  // and PREPEND them before the inbound owner turn. This is the §4.3-Path-B
  // next-turn-nudge channel — non-preemptive, so we only ever consult the
  // queue at the input boundary (here), never mid-turn.
  const queued = drainSyntheticQueue(key);
  const lines: string[] = [];
  for (const sm of queued) {
    // stream-json's --input-format only accepts 'user' frames on stdin, so a
    // producer's 'system' role is wrapped as a user frame with a tag prefix.
    // HR Path B uses role:'user' and so passes through as-is.
    const content = sm.role === 'system'
      ? `[synthetic:${sm.sourceProducer}] ${sm.content}`
      : sm.content;
    lines.push(JSON.stringify({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: content }] },
    }));
  }
  lines.push(JSON.stringify({
    type: 'user',
    message: { role: 'user', content: [{ type: 'text', text: prompt }] },
  }));
  try {
    a.proc.stdin?.write(lines.join('\n') + '\n');
  } catch (err) {
    h.onError(err instanceof Error ? err.message : String(err));
    a.busy = false;
  }
}

/** Test-only: clear the per-key synthetic queue. Module reload via
 *  vi.resetModules() is the canonical reset, but this helper lets a single
 *  spec scrub state without a full reload. */
export function _resetWarmAgentForTest(): void {
  SYNTH_QUEUE.clear();
}

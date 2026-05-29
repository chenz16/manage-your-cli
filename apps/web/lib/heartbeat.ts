/**
 * Heartbeat — periodic liveness check + process-tree scan + (later) per-kind
 * respawn handlers. Single ticker for everything we registered.
 *
 * Tick = 30s.
 *  1. For each entry: `pid alive?` (kill -0). Transition: alive → dead.
 *  2. For each long-lived parent (warm-secretary, tmux-employee, codex-task):
 *     `ps --ppid <pid>` to find new children. Auto-register as tree-child.
 *  3. Stuck detection: if `lastHeartbeatAt` is older than STUCK_MS AND the
 *     entry has busy expectations (set by warm-agent / settle), mark stuck.
 *
 * Respawn is the consumer's job — heartbeat just emits state. The desk
 * boots an event-bus that warm-agent / tmux-watcher subscribe to.
 */

// eval('require') keeps Node's CommonJS require in scope. Bare module names
// (no node: prefix) so webpack's loader treats it as a node builtin (no
// scheme handling needed).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const nodeRequire = eval('require') as (id: string) => any;
const { execFileSync, spawn } = nodeRequire('child_process') as typeof import('child_process');
import { flush, get, list, markStatus, pidAlive, register, unregister, type ProcessEntry } from './process-registry';

function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function binaryInteractiveArgs(binary: string): string {
  switch (binary) {
    case 'claude': return '--dangerously-skip-permissions';
    case 'codex':  return '--dangerously-bypass-approvals-and-sandbox';
    case 'gemini': return '--yolo';
    case 'qwen':   return '--yolo';
    default:       return '';
  }
}

// Respawn a dead tmux-employee. Idempotent per-entry: the entry is
// unregistered after spawn, the next discovery tick re-registers with the
// new pid. Owner request: "CLI 死了自动重启".
function respawnTmuxEmployee(entry: ProcessEntry): void {
  const session = (entry.meta?.session ?? '') as string;
  const cwd = entry.cwd ?? process.env.HOME;
  const sessionId = entry.sessionId;
  const binary = (entry.meta?.binary as string | undefined) ?? 'claude';
  if (!session) return;
  try { execFileSync('tmux', ['kill-session', '-t', session], { timeout: 1500 }); } catch { /* fine */ }
  const interactiveArgs = binaryInteractiveArgs(binary);
  // Only claude has --resume today; codex/gemini/qwen launch fresh.
  const resumePart = sessionId && binary === 'claude' ? ` --resume ${sessionId}` : '';
  const cdPart = cwd ? `cd ${shQuote(cwd)}; ` : '';
  const launchCmd = `${cdPart}exec ${binary} ${interactiveArgs}${resumePart}`;
  try {
    spawn('tmux', ['new-session', '-d', '-s', session, '-x', '120', '-y', '32',
      'bash', '-l', '-c', launchCmd], { stdio: 'ignore', detached: true }).unref();
    console.log(JSON.stringify({
      audit: 'respawn.tmux.launched', key: entry.key, session, cwd, binary,
      sessionId: sessionId ?? null, ts: new Date().toISOString(),
    }));
  } catch (err) {
    console.warn(JSON.stringify({
      audit: 'respawn.tmux.failed', key: entry.key,
      error: err instanceof Error ? err.message : String(err),
      ts: new Date().toISOString(),
    }));
  }
  unregister(entry.key);
}

const TICK_MS = 30_000;
const STUCK_MS = 10 * 60 * 1000; // 10 min of no event = mark stuck (warm); tmux-employee has its own timeout

const G = globalThis as unknown as {
  __holonHeartbeatTimer?: ReturnType<typeof setInterval>;
  __holonHeartbeatListeners?: Set<(e: ProcessEntry, was: ProcessEntry['status']) => void>;
};
if (!G.__holonHeartbeatListeners) G.__holonHeartbeatListeners = new Set();
const LISTENERS = G.__holonHeartbeatListeners;

export function onStatusChange(
  fn: (entry: ProcessEntry, prevStatus: ProcessEntry['status']) => void,
): () => void {
  LISTENERS.add(fn);
  return () => LISTENERS.delete(fn);
}

function emit(entry: ProcessEntry, prev: ProcessEntry['status']): void {
  for (const fn of LISTENERS) {
    try { fn(entry, prev); } catch { /* listener error — don't break tick */ }
  }
}

function scanChildren(parent: ProcessEntry): void {
  // ps --ppid → list child PIDs and their command. New children get auto-
  // registered so they show up in /api/v1/health and can be supervised.
  // Kept tight: only sample parents we expect to have children
  // (warm-secretary spawns tools; tmux-employee shells; codex-task etc.).
  try {
    const out = execFileSync('ps', ['--ppid', String(parent.pid), '-o', 'pid=,cmd='], {
      encoding: 'utf8',
      timeout: 2000,
    });
    for (const line of out.split('\n')) {
      const trim = line.trim();
      if (!trim) continue;
      const space = trim.indexOf(' ');
      const childPid = Number(trim.slice(0, space));
      const cmd = trim.slice(space + 1);
      if (!Number.isFinite(childPid)) continue;
      const childKey = `${parent.key}/child:${childPid}`;
      if (get(childKey)) continue; // already tracked
      register({
        key: childKey,
        pid: childPid,
        kind: 'tree-child',
        parentKey: parent.key,
        meta: { cmd: cmd.slice(0, 240) },
      });
    }
  } catch { /* ps may not exist or parent gone — ignore */ }
}

function tick(): void {
  const now = Date.now();
  // Refresh tmux employee registrations. Cheap (a few tmux + ps calls). Picks
  // up sessions that were created since last tick and keeps PIDs current if
  // the underlying claude was respawned (--resume).
  // Tmux discovery is wired separately (instrumentation.ts boot sweep). The
  // tick can't lazy-require it via webpack — @holon/core's transitive
  // node:child_process import poisons the bundle pass. Future: SQLite-direct
  // discovery so heartbeat owns the sweep without going through core.
  for (const entry of list()) {
    const wasStatus = entry.status;
    // 1. PID liveness
    if (!pidAlive(entry.pid)) {
      if (entry.status !== 'dead') {
        markStatus(entry.key, 'dead');
        emit({ ...entry, status: 'dead' }, wasStatus);
        // Inline respawn (was a separate respawn-handler.ts but the
        // late-require created webpack module-resolution headaches).
        if (entry.kind === 'tmux-employee') {
          respawnTmuxEmployee(entry);
        } else if (entry.kind === 'tree-child') {
          unregister(entry.key);
        }
        // warm-secretary: warm-agent's own KEEP heartbeat handles respawn.
      }
      continue;
    }
    // 2. Stuck detection (only for warm-secretary; tmux/codex have their own)
    if (entry.kind === 'warm-secretary' && now - entry.lastHeartbeatAt > STUCK_MS) {
      if (entry.status !== 'stuck') {
        markStatus(entry.key, 'stuck');
        emit({ ...entry, status: 'stuck' }, wasStatus);
      }
    }
    // 3. Tree-scan for parents that might spawn children
    if (entry.kind === 'warm-secretary' || entry.kind === 'tmux-employee' || entry.kind === 'codex-task') {
      scanChildren(entry);
    }
  }
  flush();
}

export function startHeartbeat(): void {
  if (G.__holonHeartbeatTimer) return;
  // Run one tick immediately so the registry reflects current state after boot.
  setTimeout(tick, 1_000);
  G.__holonHeartbeatTimer = setInterval(tick, TICK_MS);
  if (typeof G.__holonHeartbeatTimer.unref === 'function') G.__holonHeartbeatTimer.unref();
}

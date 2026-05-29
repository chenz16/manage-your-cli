/**
 * respawn-handler — subscribes to heartbeat status-change events and
 * resurrects dead processes per kind:
 *
 *  - warm-secretary  → handled by warm-agent's own KEEP+heartbeat path
 *                      (already wired); this module just logs the event.
 *  - tmux-employee   → restart the tmux session with `claude --resume <id>`
 *                      so memory carries over. Owner request:
 *                      "CLI 死了自动重启 desk重启之后 其他的能自动挂靠".
 *  - tree-child      → never respawned directly (sub-agents are spawned by
 *                      their parents; we just unregister when dead).
 *
 * The handler is registered ONCE on instrumentation boot.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const nodeRequire = eval('require') as (id: string) => any;
const { execFileSync, spawn } = nodeRequire('node:child_process') as typeof import('node:child_process');
import { onStatusChange } from './heartbeat';
import { unregister, type ProcessEntry } from './process-registry';

function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function respawnTmuxEmployee(entry: ProcessEntry): void {
  const session = (entry.meta?.session ?? '') as string;
  const cwd = entry.cwd ?? process.env.HOME;
  const sessionId = entry.sessionId;
  if (!session) {
    console.warn(JSON.stringify({
      audit: 'respawn.tmux.skipped',
      reason: 'no session in meta',
      key: entry.key,
      ts: new Date().toISOString(),
    }));
    return;
  }
  // If a tmux session with this name is somehow still there (stale handle),
  // kill it first so new-session doesn't fail.
  try {
    execFileSync('tmux', ['kill-session', '-t', session], { timeout: 1500 });
  } catch { /* not present — fine */ }
  // Build the launch command. --resume keeps the same .jsonl history so the
  // employee picks up exactly where it left off.
  const resumePart = sessionId ? ` --resume ${sessionId}` : '';
  const cdPart = cwd ? `cd ${shQuote(cwd)}; ` : '';
  const launchCmd =
    `${cdPart}exec claude --dangerously-skip-permissions${resumePart}`;
  try {
    spawn('tmux', ['new-session', '-d', '-s', session, '-x', '120', '-y', '32',
      'bash', '-l', '-c', launchCmd], { stdio: 'ignore', detached: true })
      .unref();
    console.log(JSON.stringify({
      audit: 'respawn.tmux.launched',
      key: entry.key,
      session,
      cwd,
      sessionId: sessionId ?? null,
      ts: new Date().toISOString(),
    }));
  } catch (err) {
    console.warn(JSON.stringify({
      audit: 'respawn.tmux.failed',
      key: entry.key,
      error: err instanceof Error ? err.message : String(err),
      ts: new Date().toISOString(),
    }));
  }
  // The next discoverTmuxEmployees() sweep will re-register the new claude
  // pid; until then, drop the stale entry so the registry isn't confusing.
  unregister(entry.key);
}

const G = globalThis as unknown as { __holonRespawnHandlerRegistered?: boolean };

export function startRespawnHandler(): void {
  if (G.__holonRespawnHandlerRegistered) return;
  G.__holonRespawnHandlerRegistered = true;

  onStatusChange((entry, prev) => {
    if (entry.status !== 'dead') return;
    // Avoid noise on tree-children — they come and go with their parents.
    if (entry.kind === 'tree-child') {
      unregister(entry.key);
      return;
    }
    console.log(JSON.stringify({
      audit: 'respawn.observed_death',
      key: entry.key,
      kind: entry.kind,
      prev,
      ts: new Date().toISOString(),
    }));
    if (entry.kind === 'tmux-employee') {
      respawnTmuxEmployee(entry);
    }
    // warm-secretary: warm-agent's own heartbeat (KEEP map) will respawn
    // it. Do not duplicate that path here — would double-spawn.
  });
}

/**
 * ProcessRegistry — singleton registry of every live process the harness
 * spawned or knows about (warm secretaries, tmux employees, dispatched
 * codex sub-CLIs, child processes of long-lived CLIs).
 *
 * Why one registry instead of per-subsystem ad-hoc state:
 *   - The desk needs ONE source of truth for "is X alive" so the health
 *     endpoint, mobile indicators, and the heartbeat ticker all agree.
 *   - On desk reboot, we re-hydrate from disk and reattach to PIDs that
 *     survived (e.g. tmux panes whose claude is still alive).
 *   - Sub-agents spawned by a CLI (process-tree children) get auto-
 *     discovered and registered with parentKey, so when the parent dies we
 *     know what was orphaned.
 *
 * The registry does NOT decide RESTART policy — that's the heartbeat ticker
 * and per-kind handlers (warm-agent, tmux-watcher, etc.). The registry's
 * job is "track + persist + emit events".
 */

// eval('require') keeps Node's CommonJS require in scope (new Function loses
// it). Use bare module names (no `node:` prefix) so webpack's loader can
// short-circuit the path as a node builtin instead of choking on the scheme.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const nodeRequire = eval('require') as (id: string) => any;
const { existsSync, readFileSync, writeFileSync, mkdirSync } =
  nodeRequire('fs') as typeof import('fs');
const { join, dirname } = nodeRequire('path') as typeof import('path');
const { homedir } = nodeRequire('os') as typeof import('os');

export type ProcessKind =
  | 'warm-secretary'   // in-process child via spawn (`claude --print stream-json`)
  | 'tmux-employee'    // claude inside a long-lived tmux session
  | 'codex-task'       // codex --print subprocess
  | 'tree-child'       // discovered via `ps --ppid`, parent registered
  | 'desk'             // the Next.js dev server itself (registered at boot)
  ;

export type ProcessStatus = 'alive' | 'stuck' | 'dead' | 'reaped';

export interface ProcessEntry {
  /** Stable identity used for restart / resume. Usually staff.id or 'desk' /
   *  'secretary:<staff_id>'. NOT pid — pids recycle. */
  key: string;
  pid: number;
  kind: ProcessKind;
  /** key of the parent process when discovered via tree scan / dispatch. */
  parentKey?: string;
  /** claude --resume target when respawning. */
  sessionId?: string;
  cwd?: string;
  /** Last time we saw a heartbeat / stream-json event / ps-alive confirm. */
  lastHeartbeatAt: number;
  /** Most recent known status. Heartbeat updates this; consumers read it. */
  status: ProcessStatus;
  /** When the process was first registered (epoch ms). */
  createdAt: number;
  /** Free-form labels for filtering / display. */
  meta?: Record<string, string | number | null>;
}

const STORE_PATH = join(homedir(), '.holon', 'process-registry.json');

const G = globalThis as unknown as {
  __holonProcessRegistry?: Map<string, ProcessEntry>;
  __holonProcessRegistryHydrated?: boolean;
};
if (!G.__holonProcessRegistry) G.__holonProcessRegistry = new Map();
const REG = G.__holonProcessRegistry;

function hydrateOnce(): void {
  if (G.__holonProcessRegistryHydrated) return;
  G.__holonProcessRegistryHydrated = true;
  if (!existsSync(STORE_PATH)) return;
  try {
    const arr = JSON.parse(readFileSync(STORE_PATH, 'utf8')) as ProcessEntry[];
    for (const e of arr) {
      // Mark hydrated entries as "needs verification" — heartbeat ticker
      // will confirm alive or transition to dead.
      REG.set(e.key, { ...e, status: 'alive' });
    }
  } catch { /* corrupt — start fresh */ }
}
hydrateOnce();

function persist(): void {
  try {
    mkdirSync(dirname(STORE_PATH), { recursive: true });
    writeFileSync(STORE_PATH, JSON.stringify([...REG.values()], null, 2));
  } catch { /* best-effort */ }
}

export function register(entry: Omit<ProcessEntry, 'lastHeartbeatAt' | 'status' | 'createdAt'> & {
  status?: ProcessStatus;
}): ProcessEntry {
  const now = Date.now();
  const existing = REG.get(entry.key);
  const merged: ProcessEntry = {
    ...existing,
    ...entry,
    createdAt: existing?.createdAt ?? now,
    lastHeartbeatAt: now,
    status: entry.status ?? 'alive',
  };
  REG.set(entry.key, merged);
  persist();
  return merged;
}

export function unregister(key: string): void {
  if (!REG.has(key)) return;
  REG.delete(key);
  persist();
}

export function markStatus(key: string, status: ProcessStatus): void {
  const e = REG.get(key);
  if (!e) return;
  e.status = status;
  e.lastHeartbeatAt = Date.now();
  persist();
}

export function touch(key: string): void {
  const e = REG.get(key);
  if (!e) return;
  e.lastHeartbeatAt = Date.now();
  if (e.status === 'stuck') e.status = 'alive';
  // Don't persist on every touch — heartbeat ticker persists in batch.
}

export function get(key: string): ProcessEntry | undefined {
  return REG.get(key);
}

export function list(filter?: (e: ProcessEntry) => boolean): ProcessEntry[] {
  const all = [...REG.values()];
  return filter ? all.filter(filter) : all;
}

export function listByKind(kind: ProcessKind): ProcessEntry[] {
  return list((e) => e.kind === kind);
}

export function listChildren(parentKey: string): ProcessEntry[] {
  return list((e) => e.parentKey === parentKey);
}

/** Is the OS process still alive? Cheap — kill -0 equivalent. */
export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Flush in-memory registry to disk. Called by the heartbeat ticker after
 *  it batches updates so we don't write on every touch. */
export function flush(): void {
  persist();
}

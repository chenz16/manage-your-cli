/**
 * tmux-discovery — find live CLI processes inside tmux sessions for Holon
 * cli_agent staff and register them in the ProcessRegistry.
 *
 * To avoid the webpack node:-scheme breakage when @holon/core is in the
 * import graph, this module reads the staff list via the desk's own HTTP
 * API (/api/v1/staff) instead of importing listStaffMerged directly.
 * Self-loop is fine — we're running in-process and only call it at boot
 * (and later, via heartbeat ticks).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const nodeRequire = eval('require') as (id: string) => any;
const { execFileSync } = nodeRequire('child_process') as typeof import('child_process');
import { register as regProcess, type ProcessEntry } from './process-registry';

interface StaffRow {
  id: string;
  name: string;
  role_label?: string;
  role_name?: string;
  status?: string;
  substrate?: {
    kind?: string;
    cwd?: string;
    binary?: string;
    external_session?: string;
  };
}

async function fetchStaff(port = 3110): Promise<StaffRow[]> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/staff`);
    if (!res.ok) return [];
    const json = await res.json() as { items?: StaffRow[] };
    return json.items ?? [];
  } catch {
    return [];
  }
}

function tmuxSessionForStaff(staff: StaffRow): string | null {
  const sub = staff.substrate;
  if (!sub || sub.kind !== 'cli_agent') return null;
  const external = sub.external_session;
  return external && external.trim() ? external.trim() : staff.id;
}

function tmuxHasSession(name: string): boolean {
  try {
    execFileSync('tmux', ['has-session', '-t', name], { timeout: 1500 });
    return true;
  } catch {
    return false;
  }
}

function tmuxPanePid(name: string): number | null {
  try {
    const out = execFileSync('tmux', ['list-panes', '-t', name, '-F', '#{pane_pid}'], {
      encoding: 'utf8', timeout: 1500,
    });
    const first = out.split('\n').map((s) => s.trim()).find(Boolean);
    const n = Number(first);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function findCliChild(parentPid: number): { pid: number; binary: string } | null {
  const BINARIES = ['claude', 'codex', 'gemini', 'qwen'];
  try {
    const cmd = execFileSync('ps', ['-p', String(parentPid), '-o', 'cmd='], {
      encoding: 'utf8', timeout: 1500,
    }).trim();
    for (const b of BINARIES) {
      if (new RegExp(`(^|/)${b}(\\s|$)`).test(cmd)) return { pid: parentPid, binary: b };
    }
  } catch { /* parent gone */ }
  for (const b of BINARIES) {
    try {
      const out = execFileSync('pgrep', ['-P', String(parentPid), b], {
        encoding: 'utf8', timeout: 1500,
      });
      const first = out.split('\n').map((s) => s.trim()).find(Boolean);
      const n = Number(first);
      if (Number.isFinite(n)) return { pid: n, binary: b };
    } catch { /* try next */ }
  }
  return null;
}

export async function discoverTmuxEmployees(): Promise<ProcessEntry[]> {
  const found: ProcessEntry[] = [];
  const staffs = await fetchStaff();
  for (const staff of staffs) {
    if (staff.status !== 'active') continue;
    const session = tmuxSessionForStaff(staff);
    if (!session) continue;
    if (!tmuxHasSession(session)) continue;
    const panePid = tmuxPanePid(session);
    if (!panePid) continue;
    const child = findCliChild(panePid);
    if (!child) continue;
    const cwd = staff.substrate?.cwd;
    let sessionId: string | undefined;
    try {
      const args = execFileSync('ps', ['-p', String(child.pid), '-o', 'args='], {
        encoding: 'utf8', timeout: 1500,
      });
      const m = args.match(/--resume\s+([0-9a-f-]{36})/i);
      if (m) sessionId = m[1];
    } catch { /* best-effort */ }
    const entry = regProcess({
      key: `tmux:${staff.id}`,
      pid: child.pid,
      kind: 'tmux-employee',
      ...(cwd ? { cwd } : {}),
      ...(sessionId ? { sessionId } : {}),
      meta: {
        session,
        staffName: staff.name,
        role: staff.role_label ?? staff.role_name ?? '',
        binary: child.binary,
        staffId: staff.id,
      },
    });
    found.push(entry);
  }
  return found;
}

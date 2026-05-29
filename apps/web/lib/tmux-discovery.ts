/**
 * tmux-discovery — find live claude processes inside tmux sessions owned by
 * Holon cli_agent staff and register them in the ProcessRegistry.
 *
 * Tmux sessions are created in packages/core (cli-session-service.ts) at
 * staff-create time. Rather than wire a cross-package register call there,
 * the desk runs this discovery sweep on boot + every heartbeat tick:
 *
 *   1. List all staff with substrate.kind = cli_agent.
 *   2. For each, check `tmux has-session -t <session>`.
 *   3. If present, find the claude child pid via `tmux list-panes -F #{pane_pid}`
 *      then `pgrep --parent <pane_pid> claude` (claude usually launches under
 *      a login bash, so it's a grandchild — pgrep -P is enough).
 *   4. Register/refresh in the ProcessRegistry with kind=tmux-employee.
 *
 * Dead / missing sessions just don't get registered; the heartbeat ticker will
 * later mark previously-known tmux-employees as dead when their pid is gone.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const nodeRequire = eval('require') as (id: string) => any;
const { execFileSync } = nodeRequire('node:child_process') as typeof import('node:child_process');
import { register as regProcess, type ProcessEntry } from './process-registry';
import { listStaffMerged } from '@holon/core';
import type { Staff } from '@holon/api-contract';

function tmuxSessionForStaff(staff: Staff): string | null {
  const sub = staff.substrate;
  if (sub.kind !== 'cli_agent') return null;
  // The session name convention: either substrate.external_session (when the
  // staff was adopted, like 'mgr') or the staff.id (default for fresh CLIs).
  const external = (sub as { external_session?: string }).external_session;
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

function findClaudeChildPid(parentPid: number): number | null {
  // The pane runs `bash -l` which then exec's `claude`. With `exec` claude
  // replaces bash → pane_pid IS claude. Without exec it's a child. Probe both.
  try {
    const cmd = execFileSync('ps', ['-p', String(parentPid), '-o', 'cmd='], {
      encoding: 'utf8', timeout: 1500,
    }).trim();
    if (cmd.includes('claude')) return parentPid;
  } catch { /* parent might have just died */ }
  try {
    const out = execFileSync('pgrep', ['-P', String(parentPid), 'claude'], {
      encoding: 'utf8', timeout: 1500,
    });
    const first = out.split('\n').map((s) => s.trim()).find(Boolean);
    const n = Number(first);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export function discoverTmuxEmployees(): ProcessEntry[] {
  const found: ProcessEntry[] = [];
  let staffs: Staff[];
  try {
    staffs = listStaffMerged();
  } catch {
    return found;
  }
  for (const staff of staffs) {
    if (staff.status !== 'active') continue;
    const session = tmuxSessionForStaff(staff);
    if (!session) continue;
    if (!tmuxHasSession(session)) continue;
    const panePid = tmuxPanePid(session);
    if (!panePid) continue;
    const claudePid = findClaudeChildPid(panePid);
    if (!claudePid) continue;
    const sub = staff.substrate;
    const cwd = sub.kind === 'cli_agent' ? sub.cwd : undefined;
    const entry = regProcess({
      key: `tmux:${staff.id}`,
      pid: claudePid,
      kind: 'tmux-employee',
      ...(cwd ? { cwd } : {}),
      meta: { session, staffName: staff.name, role: staff.role_label ?? staff.role_name },
    });
    found.push(entry);
  }
  return found;
}

/**
 * myc status — overall desk state.
 *
 * Core readers used:
 *   - listStaffMerged()      staff roster (all types)
 *   - getCliStatus()         tmux session running state per CLI agent
 *   - looksLikeBareShell()   alive vs idle heuristic
 *   - listJobs()             queued / running job counts
 *   - getOwner()             Secretary (owner_assistant) warm state
 */

import {
  getCliStatus,
  listJobs,
  listStaffMerged,
  looksLikeBareShell,
  getOwner,
} from '@holon/core';

/* ── Types ─────────────────────────────────────────────────────────── */

interface AgentRow {
  id: string;
  name: string;
  role: string;
  kind: string;
  alive: boolean;
  tmux_session: string;
}

interface StatusResult {
  timestamp: string;
  secretary: {
    name: string;
    role: string;
    model: string | null;
  };
  agents: AgentRow[];
  jobs: {
    queued: number;
    running: number;
    completed: number;
    failed: number;
  };
  summary: {
    total_staff: number;
    cli_agents: number;
    alive_agents: number;
  };
}

/* ── Helpers ───────────────────────────────────────────────────────── */

function isCliKind(kind: string): boolean {
  return kind === 'cli_agent' || kind === 'cli';
}

/* ── Command ───────────────────────────────────────────────────────── */

export async function runStatus({ json }: { json: boolean }): Promise<void> {
  let owner;
  try {
    owner = getOwner();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[status] owner config unavailable: ${msg}`);
    owner = null;
  }

  let allStaff: ReturnType<typeof listStaffMerged> = [];
  try {
    allStaff = listStaffMerged();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[status] staff roster unavailable: ${msg}`);
  }

  let jobs: ReturnType<typeof listJobs> = [];
  try {
    jobs = listJobs();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[status] jobs unavailable: ${msg}`);
  }

  const cliStaff = allStaff.filter((s) => isCliKind(s.substrate.kind));

  const agents: AgentRow[] = cliStaff.map((s) => {
    let running = false;
    let tmuxName = '';
    try {
      const st = getCliStatus(s.id);
      running = st.running;
      tmuxName = st.tmux_name;
    } catch {
      // non-fatal: session state read fails gracefully
    }
    const alive = running && !looksLikeBareShell(s.id);
    return {
      id: s.id,
      name: s.name,
      role: s.role_label ?? s.role_name,
      kind: s.substrate.kind,
      alive,
      tmux_session: tmuxName,
    };
  });

  const jobCounts = {
    queued: jobs.filter((j) => j.status === 'queued').length,
    running: jobs.filter((j) => j.status === 'running').length,
    completed: jobs.filter((j) => j.status === 'completed').length,
    failed: jobs.filter((j) => j.status === 'failed').length,
  };

  const result: StatusResult = {
    timestamp: new Date().toISOString(),
    secretary: owner
      ? {
          name: owner.name ?? '(unnamed)',
          role: owner.owner_role ?? 'Secretary',
          model: (owner.substrate as { model?: string } | undefined)?.model ?? null,
        }
      : { name: '(unavailable)', role: '(unavailable)', model: null },
    agents,
    jobs: jobCounts,
    summary: {
      total_staff: allStaff.length,
      cli_agents: cliStaff.length,
      alive_agents: agents.filter((a) => a.alive).length,
    },
  };

  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  /* ── Human-readable output ─────────────────────────────────────── */
  const ts = new Date(result.timestamp).toLocaleString();
  console.log(`\n== Desk Status  (${ts}) ==\n`);

  console.log('Secretary');
  if (owner) {
    console.log(`  Name  : ${result.secretary.name}`);
    console.log(`  Role  : ${result.secretary.role}`);
    if (result.secretary.model) console.log(`  Model : ${result.secretary.model}`);
  } else {
    console.log('  (owner config unavailable)');
  }

  console.log('\nCLI Agents');
  if (agents.length === 0) {
    console.log('  (none registered)');
  } else {
    const w = Math.max(...agents.map((a) => a.name.length), 4);
    console.log(`  ${'NAME'.padEnd(w)}  ALIVE  KIND        TMUX SESSION`);
    for (const a of agents) {
      const alive = a.alive ? 'yes  ' : 'no   ';
      console.log(`  ${a.name.padEnd(w)}  ${alive}  ${a.kind.padEnd(10)}  ${a.tmux_session || '-'}`);
    }
  }

  console.log('\nJobs');
  console.log(`  queued=${jobCounts.queued}  running=${jobCounts.running}  completed=${jobCounts.completed}  failed=${jobCounts.failed}`);

  console.log('\nSummary');
  console.log(`  Total staff: ${result.summary.total_staff}  CLI agents: ${result.summary.cli_agents}  Alive: ${result.summary.alive_agents}`);
  console.log('');
}

/**
 * myc usage — token / cost ledger per-agent.
 *
 * NOTE: getCostLedger() and CostLedgerEntry are defined in
 * packages/core/src/mutable-store.ts but are NOT exported from
 * @holon/core's public index (packages/core/src/index.ts).
 * The cost ledger is also ephemeral (process-scoped, in-memory only,
 * not persisted to SQLite as of TD-011) so it will always be empty in
 * a fresh headless process. This command therefore reports:
 *   - per-agent job counts from listJobs() (IS exported)
 *   - a clear notice that the cost ledger requires the running web server
 *
 * To add headless cost reporting, export getCostLedger + CostLedgerEntry
 * from packages/core/src/index.ts and this command can be wired up.
 *
 * Core readers used:
 *   - listJobs()            job history with status per staff_id
 *   - listStaffMerged()     staff name lookup
 */

import { listJobs, listStaffMerged } from '@holon/core';

/* ── Types ─────────────────────────────────────────────────────────── */

interface AgentUsageRow {
  staff_id: string;
  name: string;
  jobs_queued: number;
  jobs_running: number;
  jobs_completed: number;
  jobs_failed: number;
}

interface UsageResult {
  timestamp: string;
  note: string;
  agents: AgentUsageRow[];
  totals: {
    jobs: number;
    completed: number;
    failed: number;
  };
}

/* ── Command ───────────────────────────────────────────────────────── */

export async function runUsage({ json }: { json: boolean }): Promise<void> {
  let jobs: ReturnType<typeof listJobs> = [];
  try {
    jobs = listJobs();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[usage] jobs unavailable: ${msg}`);
  }

  let staffById: Map<string, string> = new Map();
  try {
    for (const s of listStaffMerged()) {
      staffById.set(s.id, s.name);
    }
  } catch {
    // non-fatal: fall back to id display
  }

  // Group jobs by staff_id
  const byStaff: Map<string, { q: number; r: number; c: number; f: number }> = new Map();
  for (const j of jobs) {
    const cur = byStaff.get(j.staff_id) ?? { q: 0, r: 0, c: 0, f: 0 };
    if (j.status === 'queued') cur.q++;
    else if (j.status === 'running') cur.r++;
    else if (j.status === 'completed') cur.c++;
    else if (j.status === 'failed') cur.f++;
    byStaff.set(j.staff_id, cur);
  }

  const agentRows: AgentUsageRow[] = Array.from(byStaff.entries()).map(([sid, counts]) => ({
    staff_id: sid,
    name: staffById.get(sid) ?? sid,
    jobs_queued: counts.q,
    jobs_running: counts.r,
    jobs_completed: counts.c,
    jobs_failed: counts.f,
  }));

  const result: UsageResult = {
    timestamp: new Date().toISOString(),
    note:
      'Token cost ledger (getCostLedger) is not exported from @holon/core. ' +
      'Job counts shown come from listJobs(). ' +
      'To enable per-agent token stats headlessly, export getCostLedger from packages/core/src/index.ts.',
    agents: agentRows,
    totals: {
      jobs: jobs.length,
      completed: jobs.filter((j) => j.status === 'completed').length,
      failed: jobs.filter((j) => j.status === 'failed').length,
    },
  };

  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  /* ── Human-readable output ─────────────────────────────────────── */
  const ts = new Date(result.timestamp).toLocaleString();
  console.log(`\n== Usage  (${ts}) ==\n`);

  console.log('Note: Token cost ledger is in-process only (not exported from core).');
  console.log('      Export getCostLedger() from packages/core/src/index.ts to enable.');
  console.log('      Showing job counts from listJobs() instead.\n');

  if (agentRows.length === 0) {
    console.log('No jobs recorded in this process session.');
  } else {
    const w = Math.max(...agentRows.map((r) => r.name.length), 4);
    console.log(`  ${'NAME'.padEnd(w)}  QUEUED  RUNNING  COMPLETED  FAILED`);
    for (const row of agentRows) {
      console.log(
        `  ${row.name.padEnd(w)}` +
        `  ${String(row.jobs_queued).padStart(6)}` +
        `  ${String(row.jobs_running).padStart(7)}` +
        `  ${String(row.jobs_completed).padStart(9)}` +
        `  ${String(row.jobs_failed).padStart(6)}`,
      );
    }
    console.log(`\n  Totals: ${result.totals.jobs} jobs  completed=${result.totals.completed}  failed=${result.totals.failed}`);
  }
  console.log('');
}

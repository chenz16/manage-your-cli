/**
 * Harvest-on-retire — closes task #15.
 *
 * System 0/1/2 bubble-up rule (see project_myc_system_0_1_2.md):
 *
 *   | Container destroyed | Who harvests              | Memory bubbles                                  |
 *   |---------------------|---------------------------|-------------------------------------------------|
 *   | CLI employee retired| Owning secretary (Sys 1)  | Employee CLAUDE.md  → project boss-memory       |
 *   | Project retired     | Owner (or super-agent)    | Project boss-memory → owner boss-memory (Sys 2) |
 *   | Owner               | —                          | Terminal — no layer above                       |
 *
 * Implementation is fire-and-forget on the dispatch side: dispatchCliTask
 * returns `ok=true` when the prompt is delivered, NOT when the agent has
 * finished distilling. We carry forward the same caveat noted in
 * boss-memory-recovery-service.ts (commit 8b111e0). When a real
 * "task completed" signal lands, the archive step in harvestProjectRetire
 * can be gated on it instead of running immediately.
 *
 * Super-agent slot: if env HOLON_SUPER_AGENT_STAFF_ID points at a
 * cli_agent staff id, the project-retire harvest is dispatched to THAT
 * staff (acting as the System 2 layer's harvester) instead of the
 * default memory-manager. No super-agent exists by default; owner can
 * spawn one as an ordinary cli_agent and point this env var at its id.
 * No UI for this knob in this PR — back-end slot only.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import type { Staff } from '@holon/api-contract';
import { dispatchCliTask, type DispatchCliTaskResult } from './cli-dispatch-service.js';
import { getOrCreateMemoryManagerStaff } from './memory-manager-service.js';
import { listStaffMerged } from './staff-management-service.js';
import { projectMemoryRoot, projectArchiveRoot } from './boss-memory-service.js';
import { holonAgentsHome } from './holon-paths.js';

/** Test seam: swap dispatchCliTask for a mock. */
export type HarvestDispatcher = (input: { staffId: string; brief: string }) => Promise<DispatchCliTaskResult>;
let activeDispatcher: HarvestDispatcher = (input) => dispatchCliTask(input);
export function setBossMemoryHarvestDispatcher(d: HarvestDispatcher | null): void {
  activeDispatcher = d ?? ((input) => dispatchCliTask(input));
}

function agentsHome(): string {
  return holonAgentsHome();
}

/**
 * Read the retiring employee's CLAUDE.md / AGENTS.md from its workspace.
 * Returns the concatenated text (empty string if neither exists).
 */
function readEmployeeRoleMemory(staffId: string): string {
  const dir = join(agentsHome(), staffId);
  const parts: string[] = [];
  for (const file of ['CLAUDE.md', 'AGENTS.md']) {
    const path = join(dir, file);
    if (existsSync(path)) {
      try {
        parts.push(`## ${file}\n\n${readFileSync(path, 'utf8').trim()}`);
      } catch {
        // Non-fatal — best-effort read.
      }
    }
  }
  return parts.join('\n\n');
}

/**
 * Resolve the harvester staff id for a project-retire event.
 * Order: HOLON_SUPER_AGENT_STAFF_ID (if it resolves to a live cli_agent) →
 * default memory-manager.
 */
function resolveProjectHarvester(): Staff {
  const overrideId = process.env.HOLON_SUPER_AGENT_STAFF_ID?.trim();
  if (overrideId) {
    const found = listStaffMerged().find((s) => s.id === overrideId);
    if (found && (found.substrate.kind === 'cli_agent' || found.substrate.kind === 'cli')) {
      return found;
    }
    console.warn(JSON.stringify({
      audit: 'boss.harvest_super_agent_unresolved',
      requested_staff_id: overrideId,
      ts: new Date().toISOString(),
    }));
  }
  return getOrCreateMemoryManagerStaff();
}

export interface HarvestEmployeeInput {
  staff_id: string;
  /** Secretary project id the employee belonged to (if any). */
  project_id?: string | null | undefined;
  /** Optional: pre-resolved staff record (saves a lookup). */
  staff?: Staff | undefined;
}

export interface HarvestResult {
  ok: boolean;
  dispatched: boolean;
  reason?: string | undefined;
  harvester_staff_id?: string | undefined;
  /** Where the harvested memory should land (owner = System 2; project id = System 1). */
  target_scope: 'owner' | 'project';
  target_project_id?: string | null | undefined;
  archive_path?: string | undefined;
}

/**
 * Employee retire → harvest into project boss-memory (System 1) or, if the
 * employee has no project_id, into owner boss-memory (System 2).
 *
 * Fire-and-forget: returns as soon as dispatchCliTask has delivered the
 * brief. We don't wait for the memory-manager to finish — the same caveat
 * as boss-memory-recovery-service.ts.
 */
export async function harvestEmployeeRetire(input: HarvestEmployeeInput): Promise<HarvestResult> {
  const roleMemory = readEmployeeRoleMemory(input.staff_id);
  const targetScope: 'owner' | 'project' = input.project_id ? 'project' : 'owner';
  const targetProjectId = input.project_id ?? null;
  const harvester = getOrCreateMemoryManagerStaff();

  const brief = buildEmployeeBrief({
    staffId: input.staff_id,
    projectId: targetProjectId,
    roleMemory,
    staffName: input.staff?.name ?? input.staff_id,
  });

  try {
    const r = await activeDispatcher({ staffId: harvester.id, brief });
    console.log(JSON.stringify({
      audit: 'boss.harvest_employee_dispatched',
      employee_staff_id: input.staff_id,
      project_id: targetProjectId,
      target_scope: targetScope,
      harvester_staff_id: harvester.id,
      ok: r.ok,
      reason: r.reason,
      ts: new Date().toISOString(),
    }));
    return {
      ok: r.ok,
      dispatched: r.ok,
      reason: r.reason,
      harvester_staff_id: harvester.id,
      target_scope: targetScope,
      target_project_id: targetProjectId,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({
      audit: 'boss.harvest_failed',
      kind: 'employee',
      employee_staff_id: input.staff_id,
      project_id: targetProjectId,
      error: message,
      ts: new Date().toISOString(),
    }));
    return {
      ok: false,
      dispatched: false,
      reason: message,
      target_scope: targetScope,
      target_project_id: targetProjectId,
    };
  }
}

function buildEmployeeBrief(input: {
  staffId: string;
  projectId: string | null;
  roleMemory: string;
  staffName: string;
}): string {
  const scopeLabel = input.projectId
    ? `project \`${input.projectId}\` (System 1)`
    : 'owner scope (System 2)';
  return [
    `Employee \`${input.staffName}\` (${input.staffId}) is being retired.`,
    `Distill durable contributions / decisions / unresolved items into ${scopeLabel}.`,
    '',
    'Target file (use write_memory):',
    input.projectId
      ? `  scope=decisions or roster (project_id=${input.projectId})`
      : '  scope=decisions or roster (owner-scope; do not pass project_id)',
    '',
    'Keep durable role-shape / decision content. Drop anything time-bound or per-conversation.',
    '',
    '== Employee role memory snapshot ==',
    input.roleMemory || '(empty — no CLAUDE.md or AGENTS.md at workspace)',
    '',
    'Use Holon MCP only. Markdown only. Do not invent facts.',
  ].join('\n');
}

export interface HarvestProjectInput {
  project_id: string;
  /** Optional human-readable project name for the brief. */
  project_name?: string | undefined;
}

/**
 * Project retire → harvest project boss-memory into owner boss-memory
 * (System 1 → System 2), then archive the project memory dir to
 * <boss>/projects/_archived/<project_id>_<epoch>/.
 *
 * Optional super-agent override via HOLON_SUPER_AGENT_STAFF_ID.
 *
 * Archive runs immediately after the dispatch returns — we do NOT wait
 * for the harvester agent to finish reading the dir (no completion signal
 * exists; same caveat as 8b111e0). The harvester reads from the dir
 * before we archive only if it executes synchronously, which it does NOT.
 *
 * RACE NOTE: because dispatch is fire-and-forget, in the worst case the
 * archive renames the dir out from under a still-reading agent. Mitigation:
 * the project memory dir is READ via projectMemoryRoot(project_id), and
 * after archive that path won't resolve, so a slow harvester sees an
 * empty dir. Owner can grep _archived/ to confirm content survived.
 * When a real "task completed" signal lands (see task #15 follow-up), gate
 * the archive on it.
 */
export async function harvestProjectRetire(input: HarvestProjectInput): Promise<HarvestResult> {
  const harvester = resolveProjectHarvester();
  const memorySnapshot = readProjectMemorySnapshot(input.project_id);
  const brief = buildProjectBrief({
    projectId: input.project_id,
    projectName: input.project_name ?? input.project_id,
    snapshot: memorySnapshot,
  });

  let dispatchResult: DispatchCliTaskResult;
  try {
    dispatchResult = await activeDispatcher({ staffId: harvester.id, brief });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({
      audit: 'boss.harvest_failed',
      kind: 'project',
      project_id: input.project_id,
      error: message,
      ts: new Date().toISOString(),
    }));
    return {
      ok: false,
      dispatched: false,
      reason: message,
      target_scope: 'owner',
      target_project_id: null,
    };
  }

  console.log(JSON.stringify({
    audit: 'boss.harvest_project_dispatched',
    project_id: input.project_id,
    harvester_staff_id: harvester.id,
    super_agent: harvester.id !== getOrCreateMemoryManagerStaff().id,
    ok: dispatchResult.ok,
    reason: dispatchResult.reason,
    ts: new Date().toISOString(),
  }));

  // Archive the project memory dir. Non-fatal on failure — caller can grep
  // the project dir manually if it remains.
  const archived = archiveProjectMemoryDir(input.project_id);

  const result: HarvestResult = {
    ok: dispatchResult.ok,
    dispatched: dispatchResult.ok,
    reason: dispatchResult.reason,
    harvester_staff_id: harvester.id,
    target_scope: 'owner',
    target_project_id: null,
  };
  if (archived) result.archive_path = archived;
  return result;
}

function readProjectMemorySnapshot(projectId: string): string {
  const root = projectMemoryRoot(projectId);
  const memDir = join(root, 'MEMORY');
  const indexPath = join(root, 'INDEX.md');
  const parts: string[] = [];
  if (existsSync(indexPath)) {
    try { parts.push(`## INDEX.md\n\n${readFileSync(indexPath, 'utf8').trim()}`); } catch { /* skip */ }
  }
  if (existsSync(memDir)) {
    let entries: string[] = [];
    try { entries = readdirSync(memDir).filter((f) => f.endsWith('.md')).sort(); } catch { entries = []; }
    for (const entry of entries) {
      try {
        parts.push(`## MEMORY/${entry}\n\n${readFileSync(join(memDir, entry), 'utf8').trim()}`);
      } catch {
        // skip unreadable file
      }
    }
  }
  return parts.join('\n\n');
}

function buildProjectBrief(input: { projectId: string; projectName: string; snapshot: string }): string {
  return [
    `Project \`${input.projectName}\` (${input.projectId}) is being retired (System 1 container destroyed).`,
    '',
    'Distill DURABLE OWNER-RELEVANT outcomes into owner-scope boss-memory (System 2):',
    '  - decisions that should outlive the project',
    '  - reusable patterns / lessons',
    '  - cross-project references the owner will want again',
    '',
    'Drop project-internal scaffolding, time-bound status, per-conversation churn.',
    '',
    'Use write_memory with NO project_id (or project_id=null) to write to owner scope.',
    'Target scopes: decisions, preferences, or a new owner-scope file if needed.',
    '',
    '== Project memory snapshot ==',
    input.snapshot || '(empty — project had no accumulated boss-memory)',
    '',
    'Use Holon MCP only. Markdown only. Do not invent facts.',
  ].join('\n');
}

function archiveProjectMemoryDir(projectId: string): string | null {
  const src = projectMemoryRoot(projectId);
  if (!existsSync(src)) return null;
  const epoch = Date.now();
  const dst = join(projectArchiveRoot(), `${projectId}_${epoch}`);
  try {
    mkdirSync(projectArchiveRoot(), { recursive: true });
    renameSync(src, dst);
    console.log(JSON.stringify({
      audit: 'boss.project_memory_archived',
      project_id: projectId,
      archive_path: dst,
      ts: new Date().toISOString(),
    }));
    return dst;
  } catch (err) {
    console.warn(JSON.stringify({
      audit: 'boss.project_memory_archive_failed',
      project_id: projectId,
      error: err instanceof Error ? err.message : String(err),
      ts: new Date().toISOString(),
    }));
    return null;
  }
}

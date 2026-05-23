import type { Staff } from '@holon/api-contract';
import { ensureMemoryManagerWorkspace } from './cli-memory-scaffold.js';
import { dispatchCliTask, type DispatchCliTaskResult } from './cli-dispatch-service.js';
import { createStaff, listStaffMerged } from './staff-management-service.js';

const MEMORY_MANAGER_ROLE_NAME = 'memory-manager';
const MEMORY_MANAGER_ROLE_NAME_NORMALIZED = 'memory_manager';

function memoryManagerBinary(): string {
  return process.env.HOLON_MEMORY_MANAGER_BINARY?.trim()
    || process.env.HOLON_AGENT_BINARY?.trim()
    || 'claude';
}

export function getOrCreateMemoryManagerStaff(): Staff {
  const existing = listStaffMerged().find(
    (staff) => (staff.role_name === MEMORY_MANAGER_ROLE_NAME || staff.role_name === MEMORY_MANAGER_ROLE_NAME_NORMALIZED)
      && staff.substrate.kind === 'cli_agent',
  );
  if (existing) return existing;

  const binary = memoryManagerBinary();
  const staff = createStaff({
    name: 'Memory Manager',
    role_label: 'Memory Manager',
    role_name: MEMORY_MANAGER_ROLE_NAME,
    substrate: {
      kind: 'cli_agent',
      binary,
      lifecycle: 'long',
      cwd: ensureMemoryManagerWorkspace(),
      auto_launch: true,
      args_template: binary === 'claude' ? '--dangerously-skip-permissions' : '',
      approval_rules: [],
    },
    system_prompt: 'You curate the boss memory. Read the raw append-log via read_memory, distill it into organized topic detail files, and keep INDEX.md lean with pointers and summaries via write_memory. Be concise. Markdown only.',
    max_concurrent_jobs: 1,
  });

  console.log(JSON.stringify({
    audit: 'memory_manager.staff.created',
    staff_id: staff.id,
    binary,
    cwd: staff.substrate.kind === 'cli_agent' ? staff.substrate.cwd ?? null : null,
    ts: new Date().toISOString(),
  }));
  return staff;
}

function consolidationBrief(): string {
  return [
    'Consolidate boss memory now.',
    '',
    'Use Holon MCP only:',
    '1. read_memory with scope "__log" to read the raw append-log snapshot.',
    '2. read_memory with no scope to read INDEX.md, then read any specific scopes that need closer attention.',
    '3. write_memory to add concise, organized topic notes into durable detail files.',
    '4. Keep INDEX.md lean: pointers and short summaries only.',
    '',
    'Do not invent facts. Do not use a vector DB or any external memory system. Markdown only.',
  ].join('\n');
}

export async function dispatchMemoryConsolidationTask(): Promise<DispatchCliTaskResult & { staff: { id: string; name: string } }> {
  const staff = getOrCreateMemoryManagerStaff();
  const result = await dispatchCliTask({ staffId: staff.id, brief: consolidationBrief() });
  console.log(JSON.stringify({
    audit: 'memory_manager.consolidation_dispatched',
    staff_id: staff.id,
    ok: result.ok,
    reason: result.reason,
    ts: new Date().toISOString(),
  }));
  return { ...result, staff: { id: staff.id, name: staff.name } };
}

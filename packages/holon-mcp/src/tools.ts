import { z } from 'zod';
import {
  bossMemoryRoot,
  captureCliOutput,
  createCliAgentStaff,
  createProject,
  dispatchMemoryConsolidationTask,
  dispatchCliTask,
  getCliStatus,
  killCliSession,
  launchCliSession,
  listStaffMerged,
  loadFixtures,
  looksLikeBareShell,
  readBossMemory,
  readBossMemoryLog,
  retireCliAgentStaff,
  writeBossMemory,
} from '@holon/core';

export const TOOL_NAMES = [
  'list_live_agents',
  'dispatch',
  'read_agent_output',
  'create_agent',
  'retire_agent',
  'read_memory',
  'write_memory',
  'consolidate_memory',
  'create_project',
] as const;

export const dispatchSchema = {
  agent: z.string().min(1).describe('Agent id or exact name.'),
  brief: z.string().min(1).describe('Task brief to send to the CLI agent.'),
};

export const readAgentOutputSchema = {
  agent: z.string().min(1).describe('Agent id or exact name.'),
  lines: z.number().int().min(1).max(2000).optional().describe('Scrollback lines to capture.'),
};

export const createAgentSchema = {
  role: z.string().min(1).describe('Role/name for the new CLI employee.'),
  lifecycle: z.enum(['short', 'long']).default('short').describe('short is ephemeral; long seeds a soul file.'),
  binary: z.enum(['claude', 'codex']).optional().describe('CLI engine: claude (default) or codex. Pass codex when the boss asks for a codex worker.'),
};

export const retireAgentSchema = {
  agent: z.string().min(1).describe('Agent id or exact name.'),
};

export const readMemorySchema = {
  scope: z.string().min(1).optional().describe('Optional boss-memory scope. Omit to read INDEX.md only. Use "__log" for the raw append-log snapshot.'),
};

export const writeMemorySchema = {
  scope: z.string().min(1).describe('Boss-memory scope such as decisions, roster, or project/foo.'),
  text: z.string().min(1).describe('Memory note to append.'),
};

export const createProjectSchema = {
  name: z.string().min(1).describe('Display name for the new project. Auto-slugified for memory scope.'),
  color: z.string().optional().describe('Optional CSS color string (e.g. "#4f9cf9") for the project pill.'),
};

interface ToolError {
  ok: false;
  error: string;
  message: string;
}

function classifyError(err: unknown): ToolError {
  return {
    ok: false,
    error: err instanceof Error ? err.name : 'unknown_error',
    message: err instanceof Error ? err.message : String(err),
  };
}

function isToolError(value: unknown): value is ToolError {
  return typeof value === 'object' && value !== null
    && 'ok' in value && (value as { ok: unknown }).ok === false;
}

function isCliAgent(staff: ReturnType<typeof listStaffMerged>[number]): boolean {
  return staff.substrate.kind === 'cli_agent' || staff.substrate.kind === 'cli';
}

function agentCwd(staff: ReturnType<typeof listStaffMerged>[number]): string | null {
  return staff.substrate.kind === 'cli_agent' ? staff.substrate.cwd ?? null : null;
}

function resolveAgent(agent: string): ReturnType<typeof listStaffMerged>[number] | ToolError {
  const needle = agent.trim();
  const staff = listStaffMerged().find((item) => item.id === needle || item.name === needle);
  if (!staff) {
    return { ok: false, error: 'agent_not_found', message: `No staff found for ${needle}` };
  }
  if (!isCliAgent(staff)) {
    return { ok: false, error: 'not_cli_agent', message: `${staff.name} is ${staff.substrate.kind}, not cli_agent` };
  }
  return staff;
}

function okJson(value: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

export async function listLiveAgents(): Promise<unknown> {
  try {
    return listStaffMerged()
      .filter(isCliAgent)
      .map((staff) => {
        const status = getCliStatus(staff.id);
        const alive = status.running && !looksLikeBareShell(staff.id);
        return {
          id: staff.id,
          name: staff.name,
          role: staff.role_label ?? staff.role_name,
          lifecycle: staff.substrate.kind === 'cli_agent' ? staff.substrate.lifecycle ?? 'short' : 'short',
          alive,
          cwd: agentCwd(staff),
          lastActivity: staff.created_at ?? null,
        };
      })
      .filter((agent) => agent.alive);
  } catch (err) {
    return classifyError(err);
  }
}

export async function dispatch(agent: string, brief: string): Promise<unknown> {
  try {
    const staff = resolveAgent(agent);
    if (isToolError(staff)) return staff;
    const result = await dispatchCliTask({ staffId: staff.id, brief });
    return { ...result, agent: { id: staff.id, name: staff.name } };
  } catch (err) {
    return classifyError(err);
  }
}

export async function readAgentOutput(agent: string, lines?: number): Promise<unknown> {
  try {
    const staff = resolveAgent(agent);
    if (isToolError(staff)) return staff;
    const result = captureCliOutput(staff.id, lines);
    return { ...result, agent: { id: staff.id, name: staff.name } };
  } catch (err) {
    return classifyError(err);
  }
}

export async function createAgent(role: string, lifecycle: 'short' | 'long' = 'short', binary?: 'claude' | 'codex'): Promise<unknown> {
  try {
    const staff = createCliAgentStaff({ role, lifecycle, ...(binary ? { binary } : {}) });
    const launch = launchCliSession(staff.id);
    return {
      ok: true,
      staff,
      lifecycle,
      launch,
    };
  } catch (err) {
    return classifyError(err);
  }
}

export async function retireAgent(agent: string): Promise<unknown> {
  try {
    const staff = resolveAgent(agent);
    if (isToolError(staff)) return staff;
    const killed = killCliSession(staff.id);
    const retired = retireCliAgentStaff(staff.id);
    console.log(JSON.stringify({
      audit: 'cli_agent.retired',
      staff_id: staff.id,
      lifecycle: retired.ok ? retired.lifecycle : undefined,
      ok: killed.ok,
      ts: new Date().toISOString(),
    }));
    return killed.reason
      ? { ok: killed.ok, reason: killed.reason, lifecycle: retired.ok ? retired.lifecycle : undefined, staff: retired.ok ? retired.staff : staff }
      : { ok: killed.ok, lifecycle: retired.ok ? retired.lifecycle : undefined, staff: retired.ok ? retired.staff : staff };
  } catch (err) {
    return classifyError(err);
  }
}

export async function readMemory(scope?: string): Promise<unknown> {
  try {
    if (scope?.trim() === '__log') return readBossMemoryLog();
    return readBossMemory(scope);
  } catch (err) {
    return classifyError(err);
  }
}

export async function writeMemory(scope: string, text: string): Promise<unknown> {
  try {
    return writeBossMemory(scope, text);
  } catch (err) {
    return classifyError(err);
  }
}

export async function consolidateMemory(): Promise<unknown> {
  try {
    return dispatchMemoryConsolidationTask();
  } catch (err) {
    return classifyError(err);
  }
}

/**
 * Create a project via natural language ("create project X" / "建项目 X").
 * Delegates to the same core path as POST /api/v1/projects:
 *   createProject() (project-store) + writeBossMemory() (boss-memory scaffold).
 * Returns { id, name, slug } — thin enough for the Secretary to confirm back.
 */
export async function createProjectTool(name: string, color?: string): Promise<unknown> {
  try {
    const fx = loadFixtures();
    const desk_id = fx.primary_desk_id;
    const project = createProject({
      desk_id,
      name: name.trim(),
      ...(color ? { color } : {}),
    });
    // Mirror the boss-memory scaffold from POST /api/v1/projects.
    writeBossMemory(`projects/${project.slug}`, `Project: ${project.name}\nCreated: ${project.created_at}\n`);
    return {
      ok: true,
      project: { id: project.id, name: project.name, slug: project.slug, color: project.color },
    };
  } catch (err) {
    return classifyError(err);
  }
}

export function memoryRoot(): string {
  return bossMemoryRoot();
}

export const toolResult = okJson;

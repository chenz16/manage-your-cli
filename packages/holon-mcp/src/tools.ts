import { z } from 'zod';
import {
  bossMemoryRoot,
  projectMemoryRoot,
  captureCliOutput,
  composeRoles,
  createCliAgentStaff,
  dispatchMemoryConsolidationTask,
  dispatchCliTask,
  getCliStatus,
  killCliSession,
  launchCliSession,
  listRoleTemplates,
  listStaffMerged,
  loadRoleTemplate,
  looksLikeBareShell,
  readBossMemory,
  readBossMemoryLog,
  renderPersona,
  retireCliAgentStaff,
  writeBossMemoryWithRecovery,
  writeRoleComposition,
} from '@holon/core';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const nodeRequire = eval('require') as (id: string) => any;
const { execFileSync } = nodeRequire('child_process') as typeof import('child_process');
const { join } = nodeRequire('path') as typeof import('path');

export const TOOL_NAMES = [
  'list_live_agents',
  'dispatch',
  'read_agent_output',
  'create_agent',
  'retire_agent',
  'read_memory',
  'write_memory',
  'consolidate_memory',
  'list_role_templates',
  'compose_role_persona',
  'create_agent_with_role',
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
  project_id: z.string().min(1).nullable().optional().describe('Secretary project ID. Pass null to force System 2 (owner层) access; omit to default to this MCP server\'s injected project (or owner if none).'),
};

export const listRoleTemplatesSchema = {
  tag: z.string().min(1).optional().describe('Optional tag filter (e.g. "review", "engineering"). Case-insensitive substring match against role tags.'),
};

export const composeRolePersonaSchema = {
  nominal: z.string().min(1).describe('Nominal role id (the role the agent IS — Identity & Voice come from this one).'),
  actual_ids: z.array(z.string().min(1)).optional().describe('Optional explicit compose-with list. Omit (or pass []) to use the nominal\'s default 1-hop transitive chain.'),
};

export const createAgentWithRoleSchema = {
  role_id: z.string().min(1).describe('Nominal role template id (must exist under role-templates/<id>/ROLE.md).'),
  name: z.string().min(1).describe('Display name for the new CLI agent.'),
  binary: z.enum(['claude', 'codex', 'gemini', 'qwen']).optional().describe('CLI engine. When omitted, the server picks the first INSTALLED binary in the priority order claude → codex → gemini → qwen (per project_myc_cli_priority).'),
  cwd: z.string().min(1).optional().describe('Optional override for the agent\'s working directory. Defaults to the staff-management cwd.'),
  compose_with: z.array(z.string().min(1)).optional().describe('Optional explicit compose-with list to override the role\'s default 1-hop chain.'),
};

export const writeMemorySchema = {
  scope: z.string().min(1).describe('Boss-memory scope such as decisions, roster, or architecture.'),
  text: z.string().min(1).describe('Memory note to append.'),
  project_id: z.string().min(1).nullable().optional().describe('Secretary project ID. Pass null to force System 2 (owner层) access; omit to default to this MCP server\'s injected project (or owner if none).'),
};

/**
 * System 0/1/2 project-id auto-inject:
 *
 * When this MCP server is launched on behalf of a project secretary, the
 * launcher sets `HOLON_PROJECT_ID=<sproj_id>`. The read/write memory tools
 * then default to that project's scope (System 1) without the calling LLM
 * needing to remember its own project_id.
 *
 * Owner scope (System 2) access stays EXPLICIT:
 *   - pass `project_id: null` to force owner-scope reads/writes
 *   - or unset HOLON_PROJECT_ID at the secretary launch level (owner secretary)
 *
 * Distinguishing "absent" vs "null" matters: absent → fall through to env
 * default; null → explicit owner override.
 */
function defaultProjectId(): string | undefined {
  const env = process.env.HOLON_PROJECT_ID?.trim();
  return env && env.length > 0 ? env : undefined;
}

function resolveProjectId(passed: string | null | undefined): string | undefined {
  if (passed === null) return undefined;          // explicit owner override
  if (typeof passed === 'string' && passed.trim().length > 0) return passed.trim();
  return defaultProjectId();                       // env default (or undefined for owner)
}

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

export async function readMemory(scope?: string, project_id?: string | null): Promise<unknown> {
  try {
    const resolved = resolveProjectId(project_id);
    if (scope?.trim() === '__log') return readBossMemoryLog(resolved);
    return readBossMemory(scope, resolved);
  } catch (err) {
    return classifyError(err);
  }
}

export async function writeMemory(scope: string, text: string, project_id?: string | null): Promise<unknown> {
  try {
    const resolved = resolveProjectId(project_id);
    return await writeBossMemoryWithRecovery(scope, text, resolved);
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
 * list_role_templates — discover all role templates under `role-templates/`.
 *
 * Optional `tag` arg filters by case-insensitive substring match against the
 * template's `tags` frontmatter. Returns just the catalog-shape needed by the
 * Secretary skill — `id`, `name`, `description`, `tags`, `compose_with` —
 * NOT the full 5-section body (callers can load that via
 * `compose_role_persona` if they want to preview).
 */
export async function listRoleTemplatesTool(tag?: string): Promise<unknown> {
  try {
    const all = listRoleTemplates();
    const needle = tag?.trim().toLowerCase();
    const filtered = needle
      ? all.filter((t) => t.tags.some((x) => x.toLowerCase().includes(needle)))
      : all;
    return filtered.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      tags: t.tags,
      compose_with: t.compose_with,
    }));
  } catch (err) {
    return classifyError(err);
  }
}

/**
 * compose_role_persona — preview the composed persona before materializing.
 *
 * Returns both the structured `ComposedPersona` (so the caller can show
 * conflicts) and the rendered markdown block that `writeRoleComposition`
 * would write into the new agent's memory file.
 */
export async function composeRolePersonaTool(nominal: string, actualIds?: string[]): Promise<unknown> {
  try {
    if (!loadRoleTemplate(nominal)) {
      return { ok: false, error: 'role_not_found', message: `No role template for "${nominal}"` };
    }
    const composed = composeRoles(nominal, actualIds ?? []);
    const rendered = renderPersona(composed);
    return { ok: true, persona: composed, rendered_markdown: rendered };
  } catch (err) {
    return classifyError(err);
  }
}

/**
 * CLI binary discovery (light fork of apps/web's cli-discovery — same
 * `which` probe, no version parse needed here). Kept local to holon-mcp so
 * we don't pull `apps/web` into the MCP server's dependency graph.
 *
 * Priority order (per owner memory project_myc_cli_priority):
 *   claude → codex → gemini → qwen
 */
const CLI_PRIORITY = ['claude', 'codex', 'gemini', 'qwen'] as const;
type CliBinary = typeof CLI_PRIORITY[number];

function whichInstalled(bin: string): boolean {
  try {
    const out = execFileSync('which', [bin], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 1500,
    }).trim();
    return out.length > 0;
  } catch {
    return false;
  }
}

/** Pick the first INSTALLED binary in priority order; falls back to 'claude' if none found. */
export function pickDefaultBinary(): CliBinary {
  for (const bin of CLI_PRIORITY) {
    if (whichInstalled(bin)) return bin;
  }
  return 'claude';
}

/**
 * create_agent_with_role — end-to-end create + persona-seed.
 *
 * Thin wrapper around `createCliAgentStaff` + `launchCliSession` + the
 * `writeRoleComposition` core helper. Picked the wrapper approach (not
 * extending `create_agent`) so the existing tool signature stays stable
 * for current callers.
 *
 * Default binary: when `binary` is unspecified, picks the first installed
 * CLI in priority order claude → codex → gemini → qwen (per owner memory
 * `project_myc_cli_priority`). The mobile/web `/api/v1/cli/binaries`
 * endpoint surfaces the same info to UI callers; this server-side picker
 * uses the same `which` probe.
 */
export async function createAgentWithRole(
  role_id: string,
  name: string,
  binary?: CliBinary,
  cwd?: string,
  compose_with?: string[],
): Promise<unknown> {
  try {
    const tpl = loadRoleTemplate(role_id);
    if (!tpl) {
      return { ok: false, error: 'role_not_found', message: `No role template for "${role_id}"` };
    }
    const composed = composeRoles(role_id, compose_with ?? []);
    const chosenBinary: CliBinary = binary ?? pickDefaultBinary();

    // Long lifecycle so ensureAgentMemoryFile scaffolds the per-binary file
    // we then write the Role-Composition block into.
    const staff = createCliAgentStaff({ role: name, lifecycle: 'long', binary: chosenBinary });
    const staffCwd = cwd
      ?? (staff.substrate.kind === 'cli_agent' ? staff.substrate.cwd : undefined);
    if (!staffCwd) {
      return { ok: false, error: 'no_cwd', message: 'staff has no cwd; cannot write Role-Composition' };
    }
    const memoryFile = join(staffCwd, agentMemoryFileNameForBinary(chosenBinary));
    const write = writeRoleComposition(memoryFile, composed);
    const launch = launchCliSession(staff.id);
    return {
      ok: true,
      staff,
      binary: chosenBinary,
      role_id,
      persona: composed,
      memory_file: memoryFile,
      role_composition: write,
      launch,
    };
  } catch (err) {
    return classifyError(err);
  }
}

/** Mirrors `agentMemoryFileName` in @holon/core's cli-memory-scaffold. */
function agentMemoryFileNameForBinary(binary: string): string {
  switch (binary) {
    case 'codex':  return 'AGENTS.md';
    case 'gemini': return 'GEMINI.md';
    case 'qwen':   return 'QWEN.md';
    case 'claude':
    default:       return 'CLAUDE.md';
  }
}

export function memoryRoot(project_id?: string): string {
  return project_id ? projectMemoryRoot(project_id) : bossMemoryRoot();
}

export const toolResult = okJson;

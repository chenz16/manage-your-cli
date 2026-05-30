import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { McpPluginInstallSpec, Staff } from '@holon/api-contract';
import { MCP_PLUGIN_REGISTRY, findMcpPluginManifest } from '@holon/api-contract';
import { getOwner } from './owner-config-service.js';
import { mcpPluginId } from './plugin-store.js';

function warnMemoryScaffold(action: string, err: unknown): void {
  const code = err && typeof err === 'object' && 'code' in err ? ` ${(err as { code?: string }).code}` : '';
  console.warn(`[cli-memory] ${action} failed${code}:`, err instanceof Error ? err.message : String(err));
}

function writeFileIfAbsent(path: string, content: string): void {
  if (existsSync(path)) return;
  try {
    writeFileSync(path, content, { flag: 'wx' });
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'EEXIST') return;
    warnMemoryScaffold(`write ${path}`, err);
  }
}

function writeFileBestEffort(path: string, content: string): void {
  try {
    writeFileSync(path, content);
  } catch (err) {
    warnMemoryScaffold(`write ${path}`, err);
  }
}

function mkdirIfNeeded(path: string): void {
  try {
    mkdirSync(path, { recursive: true });
  } catch (err) {
    warnMemoryScaffold(`mkdir ${path}`, err);
  }
}

/**
 * Per-binary authoritative memory file name. Each CLI loads only its own:
 *   claude  → CLAUDE.md
 *   codex   → AGENTS.md
 *   gemini  → GEMINI.md
 *   qwen    → QWEN.md
 *
 * A staff with no recorded binary (legacy / hand-attached) gets a belt-and-
 * braces pair: AGENTS.md (broadest read-target — claude reads it too) plus
 * CLAUDE.md as the fallback name older tooling expects.
 */
function agentMemoryFileName(binary: string): string {
  switch (binary) {
    case 'codex':  return 'AGENTS.md';
    case 'gemini': return 'GEMINI.md';
    case 'qwen':   return 'QWEN.md';
    case 'claude':
    default:       return 'CLAUDE.md';
  }
}

/**
 * Predicate: which recall-skill (if any) does this staff get at boot?
 *
 * Per `docs/adr/memory-as-skill.md`:
 *  - Secretary → `holon-memory-recall` (System 2 owner + System 1 project scope)
 *  - Owner-CLI → `holon-owner-recall` (System 2 only)
 *  - Employees → none (their boss injects the relevant memory slice at dispatch
 *    time; recall-on-demand would re-fetch context the boss already paid for)
 *
 * Staff schema has no `kind === 'secretary'` discriminator — the secretary is
 * identified by `role_name === 'secretary'` (see `secretary-service.ts`
 * SECRETARY_ROLE_NAME, `secretary-projects-service.ts`, `rooms-service.ts`).
 * The owner-CLI uses the OwnerAssistant role_name `'owner_assistant'` (the
 * `owner` alias is accepted for hand-rolled rows). Per ADR-015 the owner is
 * NOT normally a Staff record, but if a downstream caller wraps it as one to
 * scaffold its workspace, this predicate covers it without a schema change.
 *
 * If neither matches, returns `null` (employee → skip).
 */
function recallSkillFor(staff: Staff): 'holon-memory-recall' | 'holon-owner-recall' | null {
  const role = staff.role_name?.trim();
  if (role === 'secretary') return 'holon-memory-recall';
  if (role === 'owner_assistant' || role === 'owner') return 'holon-owner-recall';
  return null;
}

/**
 * Mirror the relevant canonical `SKILL.md` from `<repoRoot>/skills/<name>/`
 * into the agent's per-project Claude Code skills dir at
 * `<staff.cwd>/.claude/skills/<name>/SKILL.md`.
 *
 * Per-project (NOT `~/.claude/skills/`) install: keeps the install scoped to
 * the cwd this agent runs in, no global pollution; matches the per-cwd
 * memory-file model.
 *
 * Semantics: `writeFileIfAbsent` — owner can hand-edit the installed copy,
 * re-scaffold will not overwrite. Source SKILL.md edits don't hot-reload;
 * delete the per-cwd copy to pick up upstream changes (documented in ADR).
 *
 * `binary` is currently used only by callers' routing logic — kept on the
 * signature so future per-CLI variations (e.g. Codex/Gemini skill formats)
 * can branch here without a call-site change.
 *
 * Returns the absolute path of the installed file, or `null` if no skill
 * applies to this staff (employee → skip).
 */
export function installRecallSkill(
  cwd: string,
  staff: Staff,
  binary: string,
  repoRoot: string = findRepoRoot(),
): string | null {
  void binary; // reserved for per-CLI skill format branching, see JSDoc
  const skillName = recallSkillFor(staff);
  if (!skillName) return null;
  const sourcePath = join(repoRoot, 'skills', skillName, 'SKILL.md');
  if (!existsSync(sourcePath)) {
    warnMemoryScaffold(`installRecallSkill source missing ${sourcePath}`, new Error('ENOENT'));
    return null;
  }
  let content: string;
  try {
    content = readFileSync(sourcePath, 'utf8');
  } catch (err) {
    warnMemoryScaffold(`read ${sourcePath}`, err);
    return null;
  }
  const targetDir = join(cwd, '.claude', 'skills', skillName);
  mkdirIfNeeded(targetDir);
  const targetPath = join(targetDir, 'SKILL.md');
  writeFileIfAbsent(targetPath, content);
  return targetPath;
}

function agentRemit(staff: Staff): string {
  const maybePersona = (staff as Staff & { persona?: string }).persona?.trim();
  return maybePersona || staff.system_prompt?.trim() || staff.role_name?.trim() || '(set by the owner)';
}

export function agentMemoryTemplate(staff: Staff): string {
  const role = staff.role_name?.trim() || 'CLI staff';
  return `# ${staff.name} — ${role}

You are ${staff.name}, working on the owner's (CEO's) Holon desk. This file is YOUR long-term memory — you may read and edit it freely. Your CLI loads it every launch.

## Who you work for
- Owner = the CEO running this desk. Your manager = the Sr Manager.

## Your remit
${agentRemit(staff)}

${STT_CORRECTION_PROTOCOL}

## Working notes
<!-- Append durable facts, decisions, and context here as you work. -->
`;
}

/**
 * Scaffold the per-binary memory file in `cwd`. The AUTHORITATIVE filename is
 * binary-specific (claude→CLAUDE.md, codex→AGENTS.md, gemini→GEMINI.md,
 * qwen→QWEN.md). When `binary` is missing/unknown we write BOTH AGENTS.md and
 * CLAUDE.md so claude (CLAUDE.md/AGENTS.md fallback) and any of the others
 * (AGENTS.md as a generic) still pick something up. Pre-existing files are
 * never overwritten (writeFileIfAbsent semantics).
 */
export function ensureAgentMemoryFile(cwd: string, staff: Staff, binary: string): void {
  mkdirIfNeeded(cwd);
  const content = agentMemoryTemplate(staff);
  const known = binary === 'claude' || binary === 'codex' || binary === 'gemini' || binary === 'qwen';
  if (known) {
    writeFileIfAbsent(join(cwd, agentMemoryFileName(binary)), content);
    // Keep CLAUDE.md as a fallback name so a per-cwd CLAUDE.md still gets
    // picked up by older tooling — but the AUTHORITATIVE file is the per-
    // binary one above. Skip when the authoritative file IS CLAUDE.md.
    if (binary !== 'claude') {
      writeFileIfAbsent(join(cwd, 'CLAUDE.md'), content);
    }
  } else {
    // Legacy / hand-attached staff with no binary recorded: belt-and-braces.
    writeFileIfAbsent(join(cwd, 'AGENTS.md'), content);
    writeFileIfAbsent(join(cwd, 'CLAUDE.md'), content);
  }
  const repoRoot = findRepoRoot();
  ensureMcpJson(join(cwd, '.mcp.json'), repoRoot);
  // Per ADR `docs/adr/memory-as-skill.md`: secretary + owner-CLI get a recall
  // SKILL.md mirrored next to their memory file; employees skip (predicate in
  // recallSkillFor()). Safe to call unconditionally — no-op for non-matching
  // staff, idempotent for the matching ones (writeFileIfAbsent).
  installRecallSkill(cwd, staff, binary, repoRoot);
}

export function ensureManagerWorkspace(): string {
  const cwd = join(homedir(), 'holon-agents', 'manager');
  const memoryDir = join(cwd, 'MEMORY');
  mkdirIfNeeded(memoryDir);
  writeFileIfAbsent(join(cwd, 'CLAUDE.md'), `# Sr Manager — Holon desk

You are the Sr Manager of the owner's (CEO's) Holon desk. The owner talks to you in the chat box; you read worker output and summarize back, and you dispatch work to the staff CLIs. This folder is your memory and is yours to edit.

## How you work
- Read TELOS.md for the owner's goals before planning.
- Read roster.md to know who you can delegate to.
- Keep durable notes in MEMORY/ (work.md = in-flight, knowledge.md = learned facts,
  observations.md = patterns about the owner and the work).

## Memory
- MEMORY/work.md — what's in flight
- MEMORY/knowledge.md — durable facts you've learned
- MEMORY/observations.md — patterns about the owner / the work
`);
  writeFileIfAbsent(join(cwd, 'TELOS.md'), `# TELOS — owner goals & mission

<!-- The owner's goals, mission, and values. The Sr Manager reads this before
     planning. Fill in over time. -->
`);
  writeFileIfAbsent(join(cwd, 'roster.md'), `# Roster

<!-- The staff you (Sr Manager) can delegate to. One entry per staff: name, role,
     what they're good for. Kept current as staff are hired/changed. -->
`);
  writeFileIfAbsent(join(memoryDir, 'work.md'), `# work
<!-- In-flight work and current context. -->
`);
  writeFileIfAbsent(join(memoryDir, 'knowledge.md'), `# knowledge
<!-- Durable facts learned over time. -->
`);
  writeFileIfAbsent(join(memoryDir, 'observations.md'), `# observations
<!-- Patterns about the owner and the work. -->
`);
  return cwd;
}

function agentsHome(): string {
  return process.env.HOLON_AGENTS_HOME?.trim() || join(homedir(), 'holon-agents');
}

function findRepoRoot(): string {
  // NOTE: `new URL('<relative literal>', import.meta.url)` is rewritten by
  // webpack into a static asset import (breaks `next build` with "Can't resolve
  // '../../../'"). Use the bundler-safe `dirname(fileURLToPath(import.meta.url))`
  // instead. In the standalone prod server `process.cwd()` is already the repo
  // root (serve script cd's there), so the first start entry resolves it; this
  // second entry is the dev/tsx path where import.meta.url is the real src file.
  const starts = [
    process.cwd(),
    dirname(fileURLToPath(import.meta.url)),
  ];
  for (const start of starts) {
    let dir = start;
    for (;;) {
      if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return process.cwd();
}

function templateValue(raw: string, repoRoot: string, config: Record<string, unknown>): string {
  return raw.replaceAll('{repoRoot}', repoRoot).replace(/\{config\.([A-Za-z0-9_-]+)\}/g, (_match, key: string) => {
    const value = config[key];
    return typeof value === 'string' ? value : '';
  });
}

function templateArgs(rawArgs: string[], repoRoot: string, config: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const raw of rawArgs) {
    const configOnly = raw.match(/^\{config\.([A-Za-z0-9_-]+)\}$/);
    if (configOnly) {
      const key = configOnly[1];
      if (!key) continue;
      const value = config[key];
      if (Array.isArray(value)) {
        out.push(...value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0));
        continue;
      }
    }
    const value = templateValue(raw, repoRoot, config);
    if (value.length > 0) out.push(value);
  }
  return out;
}

function mcpServerEntryFromInstall(
  install: McpPluginInstallSpec,
  repoRoot: string,
  config: Record<string, unknown>,
): Record<string, unknown> | null {
  if (install.type === 'remote') {
    return {
      type: 'remote',
      url: templateValue(install.url, repoRoot, config),
      ...(install.headers ? { headers: install.headers } : {}),
    };
  }

  const env = install.env
    ? Object.fromEntries(Object.entries(install.env).map(([key, value]) => [key, templateValue(value, repoRoot, config)]))
    : undefined;
  return {
    type: 'stdio',
    command: templateValue(install.command, repoRoot, config),
    args: templateArgs(install.args, repoRoot, config),
    ...(env && Object.keys(env).length > 0 ? { env } : {}),
  };
}

function configuredMcpServers(repoRoot: string): Record<string, unknown> {
  const servers: Record<string, unknown> = {};
  const holon = findMcpPluginManifest('holon');
  if (holon) {
    const entry = mcpServerEntryFromInstall(holon.install, repoRoot, {});
    if (entry) servers[holon.id] = entry;
  }

  for (const link of getOwner().integrations) {
    if (link.kind !== 'mcp' || !link.enabled) continue;
    const id = mcpPluginId(link);
    if (!id || id === 'holon') continue;
    const manifest = findMcpPluginManifest(id);
    if (!manifest) continue;
    const entry = mcpServerEntryFromInstall(manifest.install, repoRoot, link.config);
    if (entry) servers[id] = entry;
  }
  return servers;
}

function ensureMcpJson(path: string, repoRoot: string): void {
  const registryIds = new Set(MCP_PLUGIN_REGISTRY.map((plugin) => plugin.id));
  let existingServers: Record<string, unknown> = {};
  if (existsSync(path)) {
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8')) as { mcpServers?: unknown };
      if (raw.mcpServers && typeof raw.mcpServers === 'object' && !Array.isArray(raw.mcpServers)) {
        existingServers = raw.mcpServers as Record<string, unknown>;
      }
    } catch (err) {
      warnMemoryScaffold(`read ${path}`, err);
    }
  }

  for (const id of registryIds) delete existingServers[id];
  const mcpServers = { ...existingServers, ...configuredMcpServers(repoRoot) };
  writeFileBestEffort(path, `${JSON.stringify({ mcpServers }, null, 2)}\n`);
}

/**
 * STT correction protocol — shared between the Secretary persona and every
 * employee's per-binary memory file. Employees on the receive end of a
 * dispatched voice task see the same markers and need the same rules to
 * decide when to emit `[STT_CORRECTION: 原文→纠正文]`. Owner-approved wording
 * 2026-05-30 — do not change verbatim. Lift point: A2.
 */
export const STT_CORRECTION_PROTOCOL = `## Voice input correction

When the owner's message contains any voice marker, treat the rest as
raw STT output that may have misrecognitions. Markers, by source:

  - \`[桌面语音]\` / \`[桌]\` — Windows Voice Typing via AHK (Right Alt
    → Win+H), full form first / short form on repeats within 60s
  - \`[移动语音]\` / \`[移动]\` — 微作 on-device recognizer
  - \`[语音输入]\` / \`[语]\` / \`[voice]\` — legacy / generic forms

Source matters: desk and mobile recognizers have different error
profiles — lean on the source hint when picking the most-plausible
correction. Before answering:

1. Sanity-check the literal text against the active project, recent
   boss-memory scopes, conversation history, and well-known tech terms
   (file/directory names, English loan-words, CLI flags, identifiers).
2. If a correction is warranted, emit a SINGLE line first:
   \`[STT_CORRECTION: 原文→纠正文]\`
   then proceed answering the *corrected* intent. Multiple corrections =
   multiple lines, one per replacement.
3. If no correction is needed, answer directly — do NOT emit the marker.
   Empty corrections pollute the owner's personal STT lexicon.
4. Be conservative: only correct when context makes the alternative
   clearly more plausible (e.g. "拍给 X" → "派给 X" when staff X is
   referenced; "Cris CLI" → "Codex CLI" when codex is the active topic).
   When unsure, answer the literal text and ask one sharp question.
5. When no \`[语音输入]\` marker is present, treat the text as
   authoritative — do not invent corrections.`;

const SECRETARY_PERSONA = `# Secretary

You are the CEO's secretary. Stay extremely concise.

Do light work yourself: answer, triage, summarize.

For heavy work, use Holon MCP: create_agent, dispatch, read_agent_output, then summarize back.

Default new employees to short-term. Use long-term only when the owner says so.

All memory is the boss's: read_memory for context, write_memory for training and decisions.

Never do an employee's heavy job yourself.

${STT_CORRECTION_PROTOCOL}
`;

export function ensureSecretaryWorkspace(): string {
  const cwd = join(agentsHome(), 'secretary');
  const repoRoot = findRepoRoot();
  mkdirIfNeeded(cwd);
  writeFileIfAbsent(join(cwd, 'CLAUDE.md'), SECRETARY_PERSONA);
  writeFileIfAbsent(join(cwd, 'AGENTS.md'), SECRETARY_PERSONA);
  ensureMcpJson(join(cwd, '.mcp.json'), repoRoot);
  return cwd;
}

const MEMORY_MANAGER_PERSONA = `# Memory Manager

You curate the boss's memory.

Read the raw append-log via read_memory.

Distill it into organized topic detail files and keep INDEX.md lean with pointers and summaries.

Use write_memory for all durable updates.

Be concise. Markdown only.
`;

export function ensureMemoryManagerWorkspace(): string {
  const cwd = join(agentsHome(), 'memory-manager');
  const repoRoot = findRepoRoot();
  mkdirIfNeeded(cwd);
  writeFileIfAbsent(join(cwd, 'CLAUDE.md'), MEMORY_MANAGER_PERSONA);
  writeFileIfAbsent(join(cwd, 'AGENTS.md'), MEMORY_MANAGER_PERSONA);
  ensureMcpJson(join(cwd, '.mcp.json'), repoRoot);
  return cwd;
}

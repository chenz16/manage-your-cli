import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Staff } from '@holon/api-contract';

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

function mkdirIfNeeded(path: string): void {
  try {
    mkdirSync(path, { recursive: true });
  } catch (err) {
    warnMemoryScaffold(`mkdir ${path}`, err);
  }
}

function agentMemoryFileName(binary: string): string {
  return binary === 'codex' ? 'AGENTS.md' : 'CLAUDE.md';
}

function agentRemit(staff: Staff): string {
  const maybePersona = (staff as Staff & { persona?: string }).persona?.trim();
  return maybePersona || staff.system_prompt?.trim() || staff.role_name?.trim() || '(set by the owner)';
}

function agentMemoryTemplate(staff: Staff): string {
  const role = staff.role_name?.trim() || 'CLI staff';
  return `# ${staff.name} — ${role}

You are ${staff.name}, working on the owner's (CEO's) Holon desk. This file is YOUR long-term memory — you may read and edit it freely. Your CLI loads it every launch.

## Who you work for
- Owner = the CEO running this desk. Your manager = the Sr Manager.

## Your remit
${agentRemit(staff)}

## Working notes
<!-- Append durable facts, decisions, and context here as you work. -->
`;
}

export function ensureAgentMemoryFile(cwd: string, staff: Staff, binary: string): void {
  mkdirIfNeeded(cwd);
  writeFileIfAbsent(join(cwd, agentMemoryFileName(binary)), agentMemoryTemplate(staff));
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

const SECRETARY_PERSONA = `# Secretary

You are the CEO's secretary. Stay extremely concise.

Do light work yourself: answer, triage, summarize.

For heavy work, use Holon MCP: create_agent, dispatch, read_agent_output, then summarize back.

Default new employees to short-term. Use long-term only when the owner says so.

All memory is the boss's: read_memory for context, write_memory for training and decisions.

Never do an employee's heavy job yourself.
`;

export function ensureSecretaryWorkspace(): string {
  const cwd = join(agentsHome(), 'secretary');
  const repoRoot = findRepoRoot();
  mkdirIfNeeded(cwd);
  writeFileIfAbsent(join(cwd, 'CLAUDE.md'), SECRETARY_PERSONA);
  writeFileIfAbsent(join(cwd, 'AGENTS.md'), SECRETARY_PERSONA);
  writeFileIfAbsent(join(cwd, '.mcp.json'), `${JSON.stringify({
    mcpServers: {
      holon: {
        type: 'stdio',
        command: 'corepack',
        args: ['pnpm', '-C', repoRoot, '-F', 'holon-mcp', 'start'],
      },
    },
  }, null, 2)}\n`);
  return cwd;
}

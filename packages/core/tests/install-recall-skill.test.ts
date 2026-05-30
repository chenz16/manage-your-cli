/**
 * installRecallSkill — per-ADR (`docs/adr/memory-as-skill.md`) recall SKILL.md
 * install at agent boot.
 *
 * Mapping:
 *  - role_name === 'secretary'        → holon-memory-recall (System 1+2)
 *  - role_name === 'owner_assistant'  → holon-owner-recall  (System 2 only)
 *  - everything else (employees)      → no install
 *
 * Per-project install path: `<cwd>/.claude/skills/<name>/SKILL.md`.
 * Idempotent: re-running on an existing SKILL.md must not overwrite owner
 * edits (writeFileIfAbsent semantics, like the memory file).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Staff } from '@holon/api-contract';
import { installRecallSkill } from '../src/cli-memory-scaffold.js';

function fakeStaff(role: string, name = 'Test'): Staff {
  // Only role_name + system_prompt + substrate are read here; the rest is
  // unused. Casting through unknown to dodge the full zod fixture shape.
  return {
    id: 'staff_test',
    name,
    role_name: role,
    role_label: role,
    status: 'active',
    substrate: { kind: 'cli_agent', binary: 'claude' },
    system_prompt: '',
  } as unknown as Staff;
}

// Repo root — every test resolves it the same way the production helper does.
// `findRepoRoot()` walks up from `import.meta.url` until it finds
// `pnpm-workspace.yaml`; we replicate the search here so the test never relies
// on an env override.
function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error('pnpm-workspace.yaml not found above tests/');
    dir = parent;
  }
}

describe('installRecallSkill', () => {
  let cwd: string;
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'holon-recall-skill-'));
  });
  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('secretary → installs holon-memory-recall under .claude/skills/', () => {
    const out = installRecallSkill(cwd, fakeStaff('secretary'), 'claude', repoRoot());
    const skillPath = join(cwd, '.claude', 'skills', 'holon-memory-recall', 'SKILL.md');
    expect(out).toBe(skillPath);
    expect(existsSync(skillPath)).toBe(true);
    const body = readFileSync(skillPath, 'utf8');
    // Frontmatter `name:` must match the directory so Claude Code's auto-trigger
    // matches the description against the right skill id.
    expect(body).toMatch(/^---\s*\nname:\s*holon-memory-recall/m);
    // The owner-recall skill must NOT also be installed (broader-supersedes
    // rule from the ADR § Consequences).
    expect(existsSync(join(cwd, '.claude', 'skills', 'holon-owner-recall', 'SKILL.md'))).toBe(false);
  });

  it('owner-CLI (owner_assistant) → installs holon-owner-recall', () => {
    const out = installRecallSkill(cwd, fakeStaff('owner_assistant'), 'claude', repoRoot());
    const skillPath = join(cwd, '.claude', 'skills', 'holon-owner-recall', 'SKILL.md');
    expect(out).toBe(skillPath);
    expect(existsSync(skillPath)).toBe(true);
    const body = readFileSync(skillPath, 'utf8');
    expect(body).toMatch(/^---\s*\nname:\s*holon-owner-recall/m);
    expect(existsSync(join(cwd, '.claude', 'skills', 'holon-memory-recall', 'SKILL.md'))).toBe(false);
  });

  it('employee (arbitrary role_name) → no skill installed, returns null', () => {
    const out = installRecallSkill(cwd, fakeStaff('codex-engineer'), 'codex', repoRoot());
    expect(out).toBeNull();
    // Nothing under .claude/skills/ for an employee.
    expect(existsSync(join(cwd, '.claude', 'skills'))).toBe(false);
  });

  it('idempotent — re-running keeps owner-edited SKILL.md (writeFileIfAbsent)', () => {
    const skillPath = join(cwd, '.claude', 'skills', 'holon-memory-recall', 'SKILL.md');
    mkdirSync(dirname(skillPath), { recursive: true });
    const ownerEdit = '---\nname: holon-memory-recall\ndescription: owner-tuned\n---\n\nowner body\n';
    writeFileSync(skillPath, ownerEdit);

    // Re-scaffold — must NOT clobber the owner's hand-edit.
    installRecallSkill(cwd, fakeStaff('secretary'), 'claude', repoRoot());
    expect(readFileSync(skillPath, 'utf8')).toBe(ownerEdit);
  });
});

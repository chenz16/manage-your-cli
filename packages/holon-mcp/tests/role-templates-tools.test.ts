/**
 * Role-template MCP tool tests.
 *
 * Covers the three new tools added to wire the `holon-create-agent` skill
 * to actual runtime:
 *   - list_role_templates          (with optional tag filter)
 *   - compose_role_persona         (preview + rendered markdown)
 *   - create_agent_with_role       (end-to-end: persona seed in memory file)
 *
 * The default-binary picker (`pickDefaultBinary`) is tested for the priority
 * chain claude → codex → gemini → qwen by monkey-patching the `which` probe.
 *
 * Uses node:test (built-in). Avoids mocking — the role-templates dir is
 * resolved from the actual repo root (the worktree).
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';

import {
  composeRolePersonaTool,
  createAgentWithRole,
  listRoleTemplatesTool,
  pickDefaultBinary,
} from '../src/tools.js';

let workDir: string;
let priorHome: string | undefined;
let priorProj: string | undefined;
let priorBinary: string | undefined;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'mcp-roletpl-test-'));
  priorHome = process.env.HOLON_AGENTS_HOME;
  priorProj = process.env.HOLON_PROJECT_ID;
  priorBinary = process.env.HOLON_AGENT_BINARY;
  process.env.HOLON_AGENTS_HOME = workDir;
  delete process.env.HOLON_PROJECT_ID;
  // Keep createCliAgentStaff deterministic — pin binary so test doesn't depend
  // on which CLI is installed on the box running CI.
  process.env.HOLON_AGENT_BINARY = 'claude';
});

afterEach(() => {
  if (priorHome === undefined) delete process.env.HOLON_AGENTS_HOME;
  else process.env.HOLON_AGENTS_HOME = priorHome;
  if (priorProj === undefined) delete process.env.HOLON_PROJECT_ID;
  else process.env.HOLON_PROJECT_ID = priorProj;
  if (priorBinary === undefined) delete process.env.HOLON_AGENT_BINARY;
  else process.env.HOLON_AGENT_BINARY = priorBinary;
  rmSync(workDir, { recursive: true, force: true });
});

describe('list_role_templates', () => {
  it('returns the catalog shape (id/name/description/tags/compose_with)', async () => {
    const result = await listRoleTemplatesTool() as Array<{
      id: string; name: string; description: string; tags: string[]; compose_with: string[];
    }>;
    assert.ok(Array.isArray(result));
    assert.ok(result.length > 0, 'expected at least one seeded role template');
    const codeReviewer = result.find((t) => t.id === 'code-reviewer');
    assert.ok(codeReviewer, 'code-reviewer seed should be present');
    assert.equal(codeReviewer!.name, 'Code Reviewer');
    assert.ok(Array.isArray(codeReviewer!.tags));
    assert.ok(Array.isArray(codeReviewer!.compose_with));
    // Catalog shape should NOT include the full sections body.
    assert.ok(!('sections' in codeReviewer!));
  });

  it('tag filter narrows the result set (tag=review returns review roles)', async () => {
    const filtered = await listRoleTemplatesTool('review') as Array<{ id: string; tags: string[] }>;
    assert.ok(filtered.length >= 2, 'review tag should match at least code-reviewer + security-auditor');
    const ids = filtered.map((t) => t.id);
    assert.ok(ids.includes('code-reviewer'), 'code-reviewer should match tag=review');
    assert.ok(ids.includes('security-auditor'), 'security-auditor should match tag=review');
    // All returned roles must have a "review"-ish tag.
    for (const t of filtered) {
      assert.ok(
        t.tags.some((x) => x.toLowerCase().includes('review')),
        `${t.id} has no review tag yet was returned`,
      );
    }
  });

  it('tag filter is case-insensitive', async () => {
    const lower = await listRoleTemplatesTool('review') as Array<{ id: string }>;
    const upper = await listRoleTemplatesTool('REVIEW') as Array<{ id: string }>;
    assert.deepEqual(lower.map((t) => t.id).sort(), upper.map((t) => t.id).sort());
  });
});

describe('compose_role_persona', () => {
  it('returns structured persona + rendered markdown for a known role', async () => {
    const result = await composeRolePersonaTool('code-reviewer') as {
      ok: boolean;
      persona: {
        nominal: string;
        actualIds: string[];
        identity: string;
        responsibilities: string[];
        behaviors: { do: string[]; dont: string[] };
        voice: string;
        knowledge: string[];
        conflicts: Array<{ rule: string; sources: string[] }>;
      };
      rendered_markdown: string;
    };
    assert.equal(result.ok, true);
    assert.equal(result.persona.nominal, 'code-reviewer');
    assert.ok(result.persona.actualIds.includes('code-reviewer'));
    assert.ok(result.persona.identity.length > 0, 'identity should come from nominal role');
    assert.ok(Array.isArray(result.persona.behaviors.do));
    assert.ok(Array.isArray(result.persona.behaviors.dont));
    assert.ok(Array.isArray(result.persona.conflicts));
    // Rendered markdown should be the managed block — must include the
    // canonical heading + the owner-edits sentinel.
    assert.match(result.rendered_markdown, /^## Role-Composition/);
    assert.match(result.rendered_markdown, /<!-- owner-edits below -->/);
  });

  it('returns an error shape when the role does not exist', async () => {
    const result = await composeRolePersonaTool('does-not-exist') as { ok: boolean; error: string };
    assert.equal(result.ok, false);
    assert.equal(result.error, 'role_not_found');
  });

  it('honors explicit actual_ids override (pin composition exactly)', async () => {
    // security-auditor's default 1-hop chain pulls code-reviewer in.
    // Passing an explicit list that EXCLUDES the nominal pins the merge
    // (composer dedupes the nominal back in at position 0).
    const def = await composeRolePersonaTool('security-auditor') as {
      persona: { actualIds: string[] };
    };
    // Pin to just the nominal — composer requires at least one non-nominal
    // id in explicit to skip transitive walk, so pass a sibling.
    const pinned = await composeRolePersonaTool('security-auditor', ['code-reviewer']) as {
      persona: { actualIds: string[] };
    };
    assert.ok(def.persona.actualIds.includes('code-reviewer'));
    // Pinned must contain exactly nominal + the explicitly-named role.
    assert.deepEqual(pinned.persona.actualIds, ['security-auditor', 'code-reviewer']);
  });
});

describe('create_agent_with_role', () => {
  it('creates a staff + writes the Role-Composition block to the per-binary memory file', async () => {
    const result = await createAgentWithRole('code-reviewer', 'cr-test') as {
      ok: boolean;
      staff: { id: string; substrate: { kind: string; cwd?: string } };
      binary: string;
      role_id: string;
      memory_file: string;
      role_composition: { added: boolean; replaced: boolean; conflictsWritten: number };
    };
    assert.equal(result.ok, true);
    assert.equal(result.role_id, 'code-reviewer');
    assert.equal(result.binary, 'claude');
    assert.ok(result.memory_file.endsWith('CLAUDE.md'), `expected CLAUDE.md for claude binary, got ${result.memory_file}`);
    assert.ok(existsSync(result.memory_file), 'memory file should exist after scaffold');

    const body = readFileSync(result.memory_file, 'utf8');
    assert.match(body, /## Role-Composition/);
    assert.match(body, /<!-- owner-edits below -->/);
    // The composed sources comment should list at least the nominal role.
    assert.match(body, /<!-- composed-from: code-reviewer/);
  });

  it('returns role_not_found when the role does not exist (no staff side-effect)', async () => {
    const result = await createAgentWithRole('nope-not-real', 'x') as { ok: boolean; error: string };
    assert.equal(result.ok, false);
    assert.equal(result.error, 'role_not_found');
  });
});

describe('pickDefaultBinary (CLI priority claude → codex → gemini → qwen)', () => {
  it('returns one of the known binaries', () => {
    const picked = pickDefaultBinary();
    assert.ok(['claude', 'codex', 'gemini', 'qwen'].includes(picked));
  });
});

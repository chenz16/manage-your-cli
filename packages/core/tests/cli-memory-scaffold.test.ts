/**
 * cli-memory-scaffold — per-binary memory file + STT protocol inclusion.
 *
 * A1: each CLI gets its own authoritative file name (CLAUDE.md / AGENTS.md /
 *     GEMINI.md / QWEN.md). Legacy (no binary) gets AGENTS.md + CLAUDE.md.
 *     A non-claude binary also gets a CLAUDE.md fallback for older tooling.
 * A2: the employee template embeds the STT correction protocol verbatim, the
 *     same block the Secretary persona uses.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Staff } from '@holon/api-contract';
import {
  STT_CORRECTION_PROTOCOL,
  agentMemoryTemplate,
  ensureAgentMemoryFile,
} from '../src/cli-memory-scaffold.js';

function fakeStaff(name = 'Codie', role = 'CLI staff'): Staff {
  // The function only reads a handful of fields; rest is unused. Cast to
  // satisfy the Staff zod type without building a full fixture.
  return {
    id: 'staff_test',
    name,
    role_name: role,
    role_label: role,
    status: 'active',
    substrate: { kind: 'cli_agent', binary: 'codex' },
    system_prompt: '',
  } as unknown as Staff;
}

describe('cli-memory-scaffold — per-binary filename (A1)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'holon-scaffold-'));
  });

  function clean(): void { rmSync(dir, { recursive: true, force: true }); }

  it('claude → CLAUDE.md (authoritative)', () => {
    ensureAgentMemoryFile(dir, fakeStaff(), 'claude');
    expect(existsSync(join(dir, 'CLAUDE.md'))).toBe(true);
    // Claude path doesn't double-write a duplicate.
    expect(existsSync(join(dir, 'AGENTS.md'))).toBe(false);
    expect(existsSync(join(dir, 'GEMINI.md'))).toBe(false);
    expect(existsSync(join(dir, 'QWEN.md'))).toBe(false);
    clean();
  });

  it('codex → AGENTS.md (authoritative) + CLAUDE.md (fallback)', () => {
    ensureAgentMemoryFile(dir, fakeStaff(), 'codex');
    expect(existsSync(join(dir, 'AGENTS.md'))).toBe(true);
    expect(existsSync(join(dir, 'CLAUDE.md'))).toBe(true);
    clean();
  });

  it('gemini → GEMINI.md (authoritative) + CLAUDE.md (fallback)', () => {
    ensureAgentMemoryFile(dir, fakeStaff(), 'gemini');
    expect(existsSync(join(dir, 'GEMINI.md'))).toBe(true);
    expect(existsSync(join(dir, 'CLAUDE.md'))).toBe(true);
    clean();
  });

  it('qwen → QWEN.md (authoritative) + CLAUDE.md (fallback)', () => {
    ensureAgentMemoryFile(dir, fakeStaff(), 'qwen');
    expect(existsSync(join(dir, 'QWEN.md'))).toBe(true);
    expect(existsSync(join(dir, 'CLAUDE.md'))).toBe(true);
    clean();
  });

  it('legacy (no binary) → AGENTS.md + CLAUDE.md (belt-and-braces)', () => {
    ensureAgentMemoryFile(dir, fakeStaff(), '');
    expect(existsSync(join(dir, 'AGENTS.md'))).toBe(true);
    expect(existsSync(join(dir, 'CLAUDE.md'))).toBe(true);
    expect(existsSync(join(dir, 'GEMINI.md'))).toBe(false);
    expect(existsSync(join(dir, 'QWEN.md'))).toBe(false);
    clean();
  });
});

describe('cli-memory-scaffold — STT protocol injected into employee template (A2)', () => {
  it('employee template includes the shared STT_CORRECTION_PROTOCOL verbatim', () => {
    const out = agentMemoryTemplate(fakeStaff());
    // The whole shared block must be present so dispatched voice tasks reach
    // employees with the same correction rules the Secretary follows.
    expect(out).toContain(STT_CORRECTION_PROTOCOL);
    // Sanity-check a few of the markers in the protocol text — guards against
    // an accidental wording drift.
    expect(out).toContain('[语音输入]');
    expect(out).toContain('[STT_CORRECTION:');
    expect(out).toContain('[桌面语音]');
    expect(out).toContain('[移动语音]');
  });

  it('scaffolded file on disk contains the STT protocol', () => {
    const dir = mkdtempSync(join(tmpdir(), 'holon-scaffold-stt-'));
    ensureAgentMemoryFile(dir, fakeStaff(), 'gemini');
    const body = readFileSync(join(dir, 'GEMINI.md'), 'utf8');
    expect(body).toContain('[STT_CORRECTION:');
    rmSync(dir, { recursive: true, force: true });
  });
});

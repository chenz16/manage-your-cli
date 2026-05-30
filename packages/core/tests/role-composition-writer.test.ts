/**
 * writeRoleComposition — managed-section writer in cli-memory-scaffold.
 *
 * Covers:
 *  1. Fresh file → adds the managed section.
 *  2. Re-run with same persona → idempotent (replaces, no dupe section).
 *  3. Owner-edits below sentinel preserved on re-run.
 *  4. Section with no sentinel = owner-authored → throws.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeRoleComposition } from '../src/cli-memory-scaffold.js';
import type { ComposedPersona } from '../src/role-composer.js';

let tmpRoot: string;
let memPath: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'role-writer-'));
  memPath = join(tmpRoot, 'CLAUDE.md');
});

afterEach(() => {
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* noop */ }
});

const fakePersona = (overrides: Partial<ComposedPersona> = {}): ComposedPersona => ({
  nominal: 'secretary',
  actualIds: ['secretary', '7x24-manager'],
  identity: 'I am secretary.',
  responsibilities: ['Triage.'],
  behaviors: { do: ['Be concise.'], dont: ['Do not implement.'] },
  voice: 'Terse.',
  knowledge: ['boss/INDEX.md'],
  conflicts: [],
  ...overrides,
});

describe('writeRoleComposition', () => {
  it('fresh file: adds managed section', () => {
    const r = writeRoleComposition(memPath, fakePersona());
    expect(r.added).toBe(true);
    expect(r.replaced).toBe(false);
    expect(r.conflictsWritten).toBe(0);
    const out = readFileSync(memPath, 'utf8');
    expect(out).toContain('## Role-Composition');
    expect(out).toContain('I am secretary.');
    expect(out).toContain('<!-- composition-conflicts: 0 -->');
    expect(out).toContain('<!-- owner-edits below -->');
  });

  it('idempotent re-run: replaces, no duplicate section', () => {
    writeRoleComposition(memPath, fakePersona());
    const r2 = writeRoleComposition(memPath, fakePersona());
    expect(r2.replaced).toBe(true);
    const out = readFileSync(memPath, 'utf8');
    const occurrences = out.split('## Role-Composition').length - 1;
    expect(occurrences).toBe(1);
  });

  it('preserves content below owner-edits sentinel on re-run', () => {
    writeRoleComposition(memPath, fakePersona());
    const before = readFileSync(memPath, 'utf8');
    const appended = before + '\n## Owner notes\n\nThis is owner content.\n';
    writeFileSync(memPath, appended);
    writeRoleComposition(memPath, fakePersona({ responsibilities: ['Triage.', 'New task.'] }));
    const after = readFileSync(memPath, 'utf8');
    expect(after).toContain('## Owner notes');
    expect(after).toContain('This is owner content.');
    expect(after).toContain('New task.');
  });

  it('refuses to clobber a hand-authored section (no sentinel)', () => {
    writeFileSync(memPath, '# Memory\n\n## Role-Composition\n\nHand-written by owner.\n');
    expect(() => writeRoleComposition(memPath, fakePersona())).toThrow(/sentinel/);
  });

  it('renders conflicts count correctly', () => {
    const persona = fakePersona({
      conflicts: [{ rule: 'X', sources: ['a.do', 'b.dont'] }],
    });
    const r = writeRoleComposition(memPath, persona);
    expect(r.conflictsWritten).toBe(1);
    const out = readFileSync(memPath, 'utf8');
    expect(out).toContain('<!-- composition-conflicts: 1 -->');
    expect(out).toContain('## Composition-conflicts');
  });
});

/**
 * hr-path-a — managed-section writer.
 *
 * Covers:
 *  1. Fresh file (no section) → creates `## HR-Corrections` + sentinel + entry.
 *  2. Idempotent re-write: same ruleHash REPLACES the dated line, no dupes.
 *  3. Section without sentinel = owner-authored → throws (no clobber).
 *  4. normalizeRuleText / stableRuleHash stability.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  writeHrCorrection,
  normalizeRuleText,
  stableRuleHash,
} from '../src/hr-path-a.js';

let tmpRoot: string;
let memPath: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'hr-path-a-'));
  memPath = join(tmpRoot, 'CLAUDE.md');
});

afterEach(() => {
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* noop */ }
});

describe('normalizeRuleText / stableRuleHash', () => {
  it('lowercases + collapses ws + strips trailing punct', () => {
    expect(normalizeRuleText('  Always Dispatch HEAVY  work.  '))
      .toBe('always dispatch heavy work');
    expect(normalizeRuleText('Use [[wikilinks]]!')).toBe('use [[wikilinks]]');
  });

  it('hash is stable across normalization-equivalent inputs', () => {
    const a = stableRuleHash('Always dispatch.');
    const b = stableRuleHash('always   DISPATCH');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{12}$/);
  });
});

describe('writeHrCorrection — fresh file', () => {
  it('creates the managed section with sentinel + dated entry', () => {
    const r = writeHrCorrection(memPath,
      { text: 'Always dispatch heavy work; do not execute it yourself.', source: 'owner-HR' },
      { now: new Date('2026-05-30T12:00:00Z') });
    expect(r.added).toBe(true);
    expect(r.replaced).toBe(false);

    const out = readFileSync(memPath, 'utf8');
    expect(out).toContain('## HR-Corrections');
    expect(out).toContain('<!-- managed by owner-HR');
    expect(out).toContain(`- (2026-05-30) [#${r.ruleHash}] Always dispatch heavy work`);
  });

  it('preserves existing content when appending the section', () => {
    writeFileSync(memPath, '# Existing\n\nSome owner content.\n');
    writeHrCorrection(memPath,
      { text: 'Use wikilinks.', source: 'owner-HR' },
      { now: new Date('2026-05-30T00:00:00Z') });
    const out = readFileSync(memPath, 'utf8');
    expect(out.startsWith('# Existing\n\nSome owner content.\n')).toBe(true);
    expect(out).toContain('## HR-Corrections');
  });
});

describe('writeHrCorrection — idempotence', () => {
  it('same ruleHash REPLACES the line (refreshes date), no duplicates', () => {
    const rule = { text: 'Always dispatch.', source: 'owner-HR' as const };
    writeHrCorrection(memPath, rule, { now: new Date('2026-05-28T00:00:00Z') });
    const after1 = readFileSync(memPath, 'utf8');
    expect((after1.match(/Always dispatch/g) || []).length).toBe(1);

    writeHrCorrection(memPath, rule, { now: new Date('2026-05-30T00:00:00Z') });
    const after2 = readFileSync(memPath, 'utf8');
    // Still one entry; date refreshed.
    expect((after2.match(/Always dispatch/g) || []).length).toBe(1);
    expect(after2).toContain('(2026-05-30)');
    expect(after2).not.toContain('(2026-05-28)');
  });

  it('different rules accumulate under the same section', () => {
    writeHrCorrection(memPath, { text: 'Rule A.', source: 'owner-HR' },
      { now: new Date('2026-05-30T00:00:00Z') });
    writeHrCorrection(memPath, { text: 'Rule B different.', source: 'owner-HR' },
      { now: new Date('2026-05-30T00:00:00Z') });
    const out = readFileSync(memPath, 'utf8');
    expect(out).toMatch(/Rule A/);
    expect(out).toMatch(/Rule B different/);
    expect((out.match(/## HR-Corrections/g) || []).length).toBe(1);
  });
});

describe('writeHrCorrection — owner-authored section guard', () => {
  it('throws when `## HR-Corrections` exists WITHOUT the sentinel', () => {
    writeFileSync(memPath, '# notes\n\n## HR-Corrections\n\n- my own rule\n');
    expect(() => writeHrCorrection(memPath,
      { text: 'auto rule.', source: 'owner-HR' },
      { now: new Date('2026-05-30T00:00:00Z') })).toThrow(/sentinel|refusing/i);
  });
});

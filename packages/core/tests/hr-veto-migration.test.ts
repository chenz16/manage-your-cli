/**
 * hr-veto-migration — one-shot legacy veto-file migration (ADR §4.9).
 *
 * Before §4.9 the veto file lived at
 *   `<HOLON_HR_ROOT>/promotion-vetoes.json`
 * which is HR-scoped and lost on HR re-scaffold. After §4.9 it lives at
 *   `<HOLON_AGENTS_HOME>/boss/owner/hr-promotion-vetoes.json`
 * (owner System 2; survives HR re-scaffold).
 *
 * On first boot after the migration lands, if the legacy file exists and
 * the new path does not, atomic-rename legacy → new. Idempotent.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { migrateLegacyVetoesIfNeeded } from '../src/hr-promotion.js';
import { hrVetoPath, legacyHrVetoPath } from '../src/hr-paths.js';

let tmpRoot: string;
let prevHrEnv: string | undefined;
let prevAgentsEnv: string | undefined;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'hr-veto-mig-'));
  prevHrEnv = process.env.HOLON_HR_ROOT;
  prevAgentsEnv = process.env.HOLON_AGENTS_HOME;
  process.env.HOLON_HR_ROOT = join(tmpRoot, 'hr-root');
  process.env.HOLON_AGENTS_HOME = join(tmpRoot, 'agents-home');
});

afterEach(() => {
  if (prevHrEnv === undefined) delete process.env.HOLON_HR_ROOT;
  else process.env.HOLON_HR_ROOT = prevHrEnv;
  if (prevAgentsEnv === undefined) delete process.env.HOLON_AGENTS_HOME;
  else process.env.HOLON_AGENTS_HOME = prevAgentsEnv;
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* noop */ }
});

const FIXTURE = {
  vetoes: [
    { ruleHash: 'aaa111', ruleText: 'no RAG', vetoedAt: 1700000000000 },
    { ruleHash: 'bbb222', ruleText: 'dispatch heavy work', vetoedAt: 1700000001000 },
  ],
};

function seedLegacy(): void {
  const legacy = legacyHrVetoPath();
  mkdirSync(dirname(legacy), { recursive: true });
  writeFileSync(legacy, JSON.stringify(FIXTURE));
}

describe('migrateLegacyVetoesIfNeeded — ADR §4.9', () => {
  it('moves legacy → new (2 entries preserved; old path gone)', () => {
    seedLegacy();
    expect(existsSync(legacyHrVetoPath())).toBe(true);
    expect(existsSync(hrVetoPath())).toBe(false);

    const result = migrateLegacyVetoesIfNeeded();
    expect(result).toBe('migrated');

    expect(existsSync(hrVetoPath())).toBe(true);
    expect(existsSync(legacyHrVetoPath())).toBe(false);

    const moved = JSON.parse(readFileSync(hrVetoPath(), 'utf8')) as typeof FIXTURE;
    expect(moved.vetoes).toHaveLength(2);
    expect(moved.vetoes[0]?.ruleHash).toBe('aaa111');
    expect(moved.vetoes[1]?.ruleHash).toBe('bbb222');
  });

  it('no-op when legacy file does not exist', () => {
    expect(existsSync(legacyHrVetoPath())).toBe(false);
    expect(migrateLegacyVetoesIfNeeded()).toBe('noop');
    expect(existsSync(hrVetoPath())).toBe(false);
  });

  it('skips when new path already exists; does NOT overwrite (owner data preserved)', () => {
    // Pre-existing new file (canonical).
    const newPath = hrVetoPath();
    mkdirSync(dirname(newPath), { recursive: true });
    const existing = { vetoes: [{ ruleHash: 'keep', ruleText: 'keep', vetoedAt: 1 }] };
    writeFileSync(newPath, JSON.stringify(existing));
    // Stray legacy file (e.g. owner reverted scaffold).
    seedLegacy();

    expect(migrateLegacyVetoesIfNeeded()).toBe('skipped_new_exists');

    // New path untouched.
    const after = JSON.parse(readFileSync(newPath, 'utf8')) as typeof existing;
    expect(after.vetoes).toHaveLength(1);
    expect(after.vetoes[0]?.ruleHash).toBe('keep');
    // Legacy file left in place (owner can inspect / remove manually).
    expect(existsSync(legacyHrVetoPath())).toBe(true);
  });

  it('idempotent — running twice after a successful migration is a no-op', () => {
    seedLegacy();
    expect(migrateLegacyVetoesIfNeeded()).toBe('migrated');
    expect(migrateLegacyVetoesIfNeeded()).toBe('noop');
    expect(existsSync(hrVetoPath())).toBe(true);
  });
});

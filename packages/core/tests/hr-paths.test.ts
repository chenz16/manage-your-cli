/**
 * hr-paths — env override + scaffold idempotence.
 *
 * Tests MUST NOT touch real HOME. We override HOLON_HR_ROOT to a tmpdir per
 * test and restore on teardown.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ownerHrRoot,
  hrEvaluationLogPath,
  hrVetoPath,
  legacyHrVetoPath,
  hrPromotionLogPath,
  ensureOwnerHrScaffold,
} from '../src/hr-paths.js';

let tmpRoot: string;
let tmpAgentsHome: string;
let prevHrEnv: string | undefined;
let prevAgentsEnv: string | undefined;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'hr-paths-'));
  tmpAgentsHome = mkdtempSync(join(tmpdir(), 'hr-agents-'));
  prevHrEnv = process.env.HOLON_HR_ROOT;
  prevAgentsEnv = process.env.HOLON_AGENTS_HOME;
  process.env.HOLON_HR_ROOT = tmpRoot;
  process.env.HOLON_AGENTS_HOME = tmpAgentsHome;
});

afterEach(() => {
  if (prevHrEnv === undefined) delete process.env.HOLON_HR_ROOT;
  else process.env.HOLON_HR_ROOT = prevHrEnv;
  if (prevAgentsEnv === undefined) delete process.env.HOLON_AGENTS_HOME;
  else process.env.HOLON_AGENTS_HOME = prevAgentsEnv;
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* noop */ }
  try { rmSync(tmpAgentsHome, { recursive: true, force: true }); } catch { /* noop */ }
});

describe('hr-paths', () => {
  it('honors HOLON_HR_ROOT for ownerHrRoot()', () => {
    expect(ownerHrRoot()).toBe(tmpRoot);
  });

  it('builds eval / promotion-log paths under HR root; veto path under owner System 2 root (ADR §4.9)', () => {
    expect(hrEvaluationLogPath('sproj_abc', '2026-05-30')).toBe(
      join(tmpRoot, 'evaluations', 'sproj_abc', '2026-05-30.md'),
    );
    // New veto path lives under HOLON_AGENTS_HOME/boss/owner (NOT HR-scoped).
    expect(hrVetoPath()).toBe(
      join(tmpAgentsHome, 'boss', 'owner', 'hr-promotion-vetoes.json'),
    );
    // Legacy path retained for one-shot migration only.
    expect(legacyHrVetoPath()).toBe(join(tmpRoot, 'promotion-vetoes.json'));
    expect(hrPromotionLogPath()).toBe(join(tmpRoot, 'promotions.log'));
  });

  it('ensureOwnerHrScaffold creates dirs + persona MD; idempotent on owner edits', () => {
    const r1 = ensureOwnerHrScaffold();
    expect(r1.created).toBe(true);
    expect(existsSync(join(tmpRoot, 'evaluations'))).toBe(true);
    const personaPath = join(tmpRoot, 'CLAUDE.md');
    expect(existsSync(personaPath)).toBe(true);
    const persona = readFileSync(personaPath, 'utf8');
    expect(persona).toContain('owner-HR');
    expect(persona).toContain('Rubric');

    // Owner edits persona; re-scaffold must NOT clobber.
    writeFileSync(personaPath, '# my own notes');
    const r2 = ensureOwnerHrScaffold();
    expect(r2.created).toBe(false);
    expect(readFileSync(personaPath, 'utf8')).toBe('# my own notes');
  });
});

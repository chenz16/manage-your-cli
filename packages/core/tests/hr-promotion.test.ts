/**
 * hr-promotion — B→A auto-promotion threshold + veto.
 *
 * - 3 fires in 24h → promotes (writes Path A + 🔴 line).
 * - <3 fires → no promotion.
 * - Veto file lists the ruleHash → no promotion.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { maybePromoteToA, firesInWindow } from '../src/hr-promotion.js';
import { stableRuleHash } from '../src/hr-path-a.js';
import { hrVetoPath, hrPromotionLogPath } from '../src/hr-paths.js';

let tmpRoot: string;
let memPath: string;
let prevEnv: string | undefined;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'hr-promo-'));
  memPath = join(tmpRoot, 'target.md');
  prevEnv = process.env.HOLON_HR_ROOT;
  process.env.HOLON_HR_ROOT = join(tmpRoot, 'hr-root');
});

afterEach(() => {
  if (prevEnv === undefined) delete process.env.HOLON_HR_ROOT;
  else process.env.HOLON_HR_ROOT = prevEnv;
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* noop */ }
});

const RULE_TEXT = 'Always dispatch; never DIY.';
const now = new Date('2026-05-30T12:00:00Z');
const nowMs = now.getTime();

describe('firesInWindow', () => {
  it('counts only timestamps within rolling 24h', () => {
    const fires = [
      nowMs - 25 * 60 * 60 * 1000, // out
      nowMs - 23 * 60 * 60 * 1000, // in
      nowMs - 60 * 1000,           // in
    ];
    expect(firesInWindow({ fires }, nowMs)).toBe(2);
  });
});

describe('maybePromoteToA', () => {
  it('promotes at 3 fires (writes Path A + 🔴 log line)', () => {
    const ruleHash = stableRuleHash(RULE_TEXT);
    const counter = { fires: [nowMs - 3000, nowMs - 2000, nowMs - 1000] };
    const r = maybePromoteToA(memPath, ruleHash, RULE_TEXT, counter,
      { now, agentLabel: 'sproj_acme' });
    expect(r.promoted).toBe(true);
    expect(r.reason).toBe('wrote');

    const mem = readFileSync(memPath, 'utf8');
    expect(mem).toContain('## HR-Corrections');
    expect(mem).toContain(RULE_TEXT);

    const log = readFileSync(hrPromotionLogPath(), 'utf8');
    expect(log).toContain('🔴 HR auto-promoted on sproj_acme');
    expect(log).toContain(RULE_TEXT);
  });

  it('does NOT promote below threshold', () => {
    const counter = { fires: [nowMs - 2000, nowMs - 1000] };
    const r = maybePromoteToA(memPath, stableRuleHash(RULE_TEXT), RULE_TEXT, counter, { now });
    expect(r.promoted).toBe(false);
    expect(r.reason).toBe('below_threshold');
    expect(existsSync(memPath)).toBe(false);
  });

  it('veto blocks promotion even at threshold', () => {
    const ruleHash = stableRuleHash(RULE_TEXT);
    // Write a veto file under HOLON_HR_ROOT.
    const vetoPath = hrVetoPath();
    const vetoDir = vetoPath.replace(/\/[^/]+$/, '');
    mkdirSync(vetoDir, { recursive: true });
    writeFileSync(vetoPath, JSON.stringify({
      vetoes: [{ ruleHash, ruleText: RULE_TEXT, vetoedAt: nowMs }],
    }));

    const counter = { fires: [nowMs - 3000, nowMs - 2000, nowMs - 1000] };
    const r = maybePromoteToA(memPath, ruleHash, RULE_TEXT, counter, { now });
    expect(r.promoted).toBe(false);
    expect(r.reason).toBe('vetoed');
    expect(existsSync(memPath)).toBe(false);
  });
});

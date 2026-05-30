/**
 * hr-path-b-producer — rubric scoring + counter bump + promotion-at-threshold.
 *
 * No real warm processes / no real HOME — HOLON_HR_ROOT + HOLON_HR_STATE
 * point at tmpdirs.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmpRoot: string;
let prevHrRoot: string | undefined;
let prevHrState: string | undefined;

beforeEach(async () => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'hr-pb-'));
  prevHrRoot = process.env.HOLON_HR_ROOT;
  prevHrState = process.env.HOLON_HR_STATE;
  process.env.HOLON_HR_ROOT = join(tmpRoot, 'hr-root');
  process.env.HOLON_HR_STATE = join(tmpRoot, 'hr-state.json');
  const mod = await import('./hr-path-b-producer');
  mod._resetHrCountersForTest();
});

afterEach(() => {
  if (prevHrRoot === undefined) delete process.env.HOLON_HR_ROOT;
  else process.env.HOLON_HR_ROOT = prevHrRoot;
  if (prevHrState === undefined) delete process.env.HOLON_HR_STATE;
  else process.env.HOLON_HR_STATE = prevHrState;
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* noop */ }
});

const ENTRY = {
  key: 'warm:sec_acme',
  pid: 1,
  kind: 'warm-secretary' as const,
  cwd: '', // set per-test to a fresh tmpdir
  lastHeartbeatAt: 0,
  status: 'alive' as const,
  createdAt: 0,
};

describe('scoreRubric', () => {
  it('flags forbidden-abstraction text', async () => {
    const { scoreRubric } = await import('./hr-path-b-producer');
    const r = scoreRubric('I will set up a RAG with a vector DB');
    expect(r.checks['respected-north-star']).toBe(false);
  });
  it('flags first-person DIY text as role-fidelity failure', async () => {
    const { scoreRubric } = await import('./hr-path-b-producer');
    const r = scoreRubric("OK I'll write the code myself.");
    expect(r.checks['role-fidelity']).toBe(false);
  });
  it('passes clean dispatch text', async () => {
    const { scoreRubric } = await import('./hr-path-b-producer');
    const r = scoreRubric('Dispatched to the implementation sub-agent via Task tool.');
    expect(r.checks['dispatched-not-DIY']).toBe(true);
    expect(r.checks['respected-north-star']).toBe(true);
    expect(r.checks['role-fidelity']).toBe(true);
  });
});

describe('scoreAndEmitNudges', () => {
  it('emits nudges only for failed rubric items', async () => {
    const { scoreAndEmitNudges, HR_NUDGES } = await import('./hr-path-b-producer');
    const cwd = mkdtempSync(join(tmpdir(), 'hr-target-'));
    const entry = { ...ENTRY, cwd };
    const msgs = scoreAndEmitNudges(entry, 'I will set up a RAG with vector DB myself');
    expect(msgs.length).toBeGreaterThan(0);
    expect(msgs.every((m) => m.sourceProducer === 'hr-path-b')).toBe(true);
    expect(msgs.every((m) => m.role === 'user')).toBe(true);
    const contents = msgs.map((m) => m.content);
    expect(contents).toContain(HR_NUDGES['respected-north-star']);
  });

  it('returns [] for non-scorable entry kinds', async () => {
    const { scoreAndEmitNudges } = await import('./hr-path-b-producer');
    const entry = { ...ENTRY, kind: 'desk' as const };
    const msgs = scoreAndEmitNudges(entry, 'I will set up a RAG with vector DB myself');
    expect(msgs).toEqual([]);
  });

  it('increments counter per fire and auto-promotes at threshold', async () => {
    const mod = await import('./hr-path-b-producer');
    const cwd = mkdtempSync(join(tmpdir(), 'hr-target-'));
    const entry = { ...ENTRY, cwd };
    const driftText = 'I will set up a RAG with vector DB';
    // 3 fires in quick succession → 3rd one should trigger promotion.
    const t0 = new Date('2026-05-30T00:00:00Z');
    const t1 = new Date('2026-05-30T01:00:00Z');
    const t2 = new Date('2026-05-30T02:00:00Z');
    mod.scoreAndEmitNudges(entry, driftText, { now: t0 });
    mod.scoreAndEmitNudges(entry, driftText, { now: t1 });
    const targetMem = join(cwd, 'CLAUDE.md');
    expect(existsSync(targetMem)).toBe(false); // not promoted yet
    mod.scoreAndEmitNudges(entry, driftText, { now: t2 });
    expect(existsSync(targetMem)).toBe(true);
    const mem = readFileSync(targetMem, 'utf8');
    expect(mem).toContain('HR-Corrections');
    expect(mem).toContain('RAG');
  });
});

describe('hrPathBProducer', () => {
  it('onSettle returns [] (HR does not push at settle)', async () => {
    const { hrPathBProducer } = await import('./hr-path-b-producer');
    const out = await hrPathBProducer.onSettle?.(ENTRY);
    expect(out).toEqual([]);
  });
});

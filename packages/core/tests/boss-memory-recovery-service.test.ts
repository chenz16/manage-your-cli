import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { writeBossMemory } from '../src/boss-memory-service.js';
import {
  setBossMemoryRecoveryDispatcher,
  writeBossMemoryWithRecovery,
  type RecoveryDispatcher,
} from '../src/boss-memory-recovery-service.js';

let workDir: string;
let priorEnv: string | undefined;
let auditLines: string[];
let originalLog: typeof console.log;

function rosterPath(): string {
  return join(workDir, 'boss', 'MEMORY', 'roster.md');
}

function seedRosterAtBudget(): void {
  const mDir = join(workDir, 'boss', 'MEMORY');
  mkdirSync(mDir, { recursive: true });
  const big = 'x'.repeat(95);
  writeFileSync(rosterPath(), `---\nscope: roster\nbudget: 100\n---\n${big}`);
}

function shrinkRosterToHeadroom(): void {
  // Replace with a tiny body so the next write fits.
  writeFileSync(rosterPath(), `---\nscope: roster\nbudget: 100\n---\n`);
}

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'boss-memory-recov-'));
  priorEnv = process.env.HOLON_AGENTS_HOME;
  process.env.HOLON_AGENTS_HOME = workDir;

  auditLines = [];
  originalLog = console.log;
  console.log = (msg?: unknown) => {
    if (typeof msg === 'string') auditLines.push(msg);
  };
});

afterEach(() => {
  console.log = originalLog;
  setBossMemoryRecoveryDispatcher(null);
  if (priorEnv === undefined) delete process.env.HOLON_AGENTS_HOME;
  else process.env.HOLON_AGENTS_HOME = priorEnv;
  rmSync(workDir, { recursive: true, force: true });
});

function auditEvents(): string[] {
  return auditLines
    .map((line) => {
      try { return JSON.parse(line) as { audit?: string }; } catch { return null; }
    })
    .filter((obj): obj is { audit: string } => !!obj && typeof obj.audit === 'string')
    .map((obj) => obj.audit);
}

describe('writeBossMemoryWithRecovery', () => {
  it('dispatches recovery on overflow, then the second write succeeds', async () => {
    seedRosterAtBudget();

    const dispatcher = vi.fn<RecoveryDispatcher>(async ({ scope, used, limit, attempted_chars }) => {
      // Brief MUST carry scope + budget facts; assert what the dispatcher saw.
      expect(scope).toBe('roster');
      expect(used).toBeGreaterThan(0);
      expect(limit).toBe(100);
      expect(attempted_chars).toBeGreaterThan(0);
      shrinkRosterToHeadroom();
      return { ok: true };
    });
    setBossMemoryRecoveryDispatcher(dispatcher);

    const result = await writeBossMemoryWithRecovery('roster', 'fresh note after compression');
    expect(dispatcher).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.used).toBeLessThanOrEqual(result.limit);

    const events = auditEvents();
    expect(events).toContain('boss.memory_recovery_dispatched');
    expect(events).toContain('boss.memory_recovery_succeeded');
    expect(events).not.toContain('boss.memory_recovery_failed');
  });

  it('coalesces concurrent overflows onto a single dispatch', async () => {
    seedRosterAtBudget();

    let dispatchStarted = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });

    const dispatcher = vi.fn<RecoveryDispatcher>(async () => {
      dispatchStarted += 1;
      await gate;
      shrinkRosterToHeadroom();
      return { ok: true };
    });
    setBossMemoryRecoveryDispatcher(dispatcher);

    const p1 = writeBossMemoryWithRecovery('roster', 'note A');
    const p2 = writeBossMemoryWithRecovery('roster', 'note B');

    // Let microtasks run so both calls register their overflow + coalesce.
    await new Promise((r) => setTimeout(r, 10));
    expect(dispatchStarted).toBe(1);

    release();
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(dispatcher).toHaveBeenCalledTimes(1);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
  });

  it('returns the second overflow and audits recovery_failed when compression did not free room', async () => {
    seedRosterAtBudget();

    const dispatcher = vi.fn<RecoveryDispatcher>(async () => {
      // Pretend the agent did nothing.
      return { ok: true };
    });
    setBossMemoryRecoveryDispatcher(dispatcher);

    const result = await writeBossMemoryWithRecovery('roster', 'still overflowing note');
    expect(dispatcher).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected fail');
    expect('reason' in result && result.reason).toBe('budget_exceeded');

    const events = auditEvents();
    expect(events).toContain('boss.memory_recovery_dispatched');
    expect(events).toContain('boss.memory_recovery_failed');
    expect(events).not.toContain('boss.memory_recovery_succeeded');
  });

  it('does not recurse: if the retry write itself overflows, no second dispatch fires', async () => {
    seedRosterAtBudget();

    let count = 0;
    const dispatcher = vi.fn<RecoveryDispatcher>(async () => {
      count += 1;
      // Even if a write happens inside the dispatcher, it must not trigger
      // another recovery for the same scope.
      const nested = await writeBossMemoryWithRecovery('roster', 'agent-side append');
      // Nested write should ALSO return overflow without recursing.
      expect(nested.ok).toBe(false);
      return { ok: true };
    });
    setBossMemoryRecoveryDispatcher(dispatcher);

    await writeBossMemoryWithRecovery('roster', 'outer note');
    expect(count).toBe(1);
    expect(dispatcher).toHaveBeenCalledTimes(1);
  });

  it('leaves the raw writeBossMemory API unchanged (no auto-recovery)', () => {
    seedRosterAtBudget();
    const dispatcher = vi.fn<RecoveryDispatcher>(async () => {
      shrinkRosterToHeadroom();
      return { ok: true };
    });
    setBossMemoryRecoveryDispatcher(dispatcher);

    // The bare writeBossMemory must still hand back the raw overflow shape
    // and must NOT trigger the dispatcher.
    const res = writeBossMemory('roster', 'raw call');
    expect(dispatcher).not.toHaveBeenCalled();
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('expected fail');
    expect('reason' in res && res.reason).toBe('budget_exceeded');

    // Roster body must still be the pre-write content.
    const onDisk = readFileSync(rosterPath(), 'utf8');
    expect(onDisk.endsWith('x'.repeat(95))).toBe(true);
  });
});

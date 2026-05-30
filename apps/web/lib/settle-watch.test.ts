/**
 * settle-watch.test — settle-event semantics.
 *
 * Covers:
 *  1. Idle + quiet > SETTLE_MS → emits exactly once per quiet window.
 *  2. busy=true → suppresses emit AND clears the emitted flag so the next
 *     busy→idle transition can fire again.
 *  3. status !== 'alive' → suppresses emit.
 *  4. Multiple ticks within the same quiet window emit only ONCE
 *     (idempotence).
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const STORE = join(homedir(), '.holon', 'process-registry.json');
let snapshot: string | null = null;
if (existsSync(STORE)) snapshot = readFileSync(STORE, 'utf8');

afterAll(() => {
  if (snapshot !== null) writeFileSync(STORE, snapshot);
});

beforeEach(() => {
  vi.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const G = globalThis as any;
  delete G.__holonProcessRegistry;
  delete G.__holonProcessRegistryHydrated;
  delete G.__holonSettleListeners;
  delete G.__holonSettleEmitted;
  delete G.__holonSettleTimer;
  if (existsSync(STORE)) {
    try {
      const arr = JSON.parse(readFileSync(STORE, 'utf8')) as Array<{ key?: string }>;
      const cleaned = arr.filter((e) => !(typeof e.key === 'string' && (e.key.startsWith('test:') || e.key.startsWith('swtest:'))));
      writeFileSync(STORE, JSON.stringify(cleaned, null, 2));
    } catch { /* ignore */ }
  }
});

describe('settle-watch', () => {
  it('emits settle exactly once per quiet window (idle + lastHeartbeatAt older than SETTLE_MS)', async () => {
    const { register } = await import('./process-registry');
    const { onSettle, evaluateSettle, SETTLE_MS } = await import('./settle-watch');

    const fired: string[] = [];
    onSettle((e) => fired.push(e.key));

    register({ key: 'swtest:warm:s1', pid: 12345, kind: 'warm-secretary' });
    // register() set lastHeartbeatAt to Date.now(). Drive evaluateSettle with
    // `now` pinned SETTLE_MS+1 in the future of that real-clock value.
    const e1 = (await import('./process-registry')).get('swtest:warm:s1')!;
    const future = e1.lastHeartbeatAt + SETTLE_MS + 1;
    // First tick → emits.
    expect(evaluateSettle(e1, future)).toBe(true);
    // Second tick in the same quiet window → does NOT re-emit.
    expect(evaluateSettle(e1, future + 1000)).toBe(false);
    expect(fired).toEqual(['swtest:warm:s1']);
  });

  it('does NOT emit while the warm key is busy; clears the emitted flag so next busy→idle fires again', async () => {
    const { register } = await import('./process-registry');
    const { onSettle, evaluateSettle, setBusyProbe, SETTLE_MS } = await import('./settle-watch');

    const fired: string[] = [];
    onSettle((e) => fired.push(e.key));

    let busy = true;
    setBusyProbe(() => busy);

    register({ key: 'swtest:warm:s2', pid: 22222, kind: 'warm-secretary' });
    const e = (await import('./process-registry')).get('swtest:warm:s2')!;
    const t = Date.now() + SETTLE_MS + 1;
    // Busy → no emit.
    expect(evaluateSettle(e, t)).toBe(false);
    expect(fired).toEqual([]);
    // Go idle → emit.
    busy = false;
    expect(evaluateSettle(e, t)).toBe(true);
    expect(fired).toEqual(['swtest:warm:s2']);
    // Back to busy then idle → second emit allowed (NEW window).
    busy = true;
    expect(evaluateSettle(e, t + 1)).toBe(false); // resets the emitted flag
    busy = false;
    expect(evaluateSettle(e, t + 2)).toBe(true);
    expect(fired).toEqual(['swtest:warm:s2', 'swtest:warm:s2']);
  });

  it('suppresses settle when status !== alive (stuck/dead)', async () => {
    const { register, markStatus } = await import('./process-registry');
    const { onSettle, evaluateSettle, SETTLE_MS } = await import('./settle-watch');

    const fired: string[] = [];
    onSettle((e) => fired.push(e.key));

    register({ key: 'swtest:warm:s3', pid: 33333, kind: 'warm-secretary' });
    markStatus('swtest:warm:s3', 'stuck');
    const e = (await import('./process-registry')).get('swtest:warm:s3')!;
    expect(evaluateSettle(e, Date.now() + SETTLE_MS + 1)).toBe(false);
    expect(fired).toEqual([]);
  });
});

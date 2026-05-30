/**
 * synthetic-producers.test — producer registry semantics.
 *
 * Covers:
 *  1. Multiple producers collected in one pass; messages are concatenated.
 *  2. A producer that throws does NOT block other producers (Promise.allSettled).
 *  3. Unregister stops the producer's contribution on subsequent collects.
 *  4. Producers without onSettle / onDispatchComplete are simply skipped
 *     for that phase.
 */
import { describe, it, expect, beforeEach } from 'vitest';

beforeEach(async () => {
  const mod = await import('./synthetic-producers');
  mod._resetProducersForTest();
});

const FAKE_ENTRY = {
  key: 'warm:test:s1',
  pid: 1,
  kind: 'warm-secretary' as const,
  lastHeartbeatAt: 0,
  status: 'alive' as const,
  createdAt: 0,
};

describe('synthetic-producers registry', () => {
  it('collects messages from multiple producers in registration order', async () => {
    const { registerProducer, collectOnSettle } = await import('./synthetic-producers');
    registerProducer({
      name: 'p1',
      onSettle: () => [{
        role: 'user', content: 'from p1', sourceProducer: 'p1', enqueuedAt: 1,
      }],
    });
    registerProducer({
      name: 'p2',
      onSettle: async () => [
        { role: 'user', content: 'from p2 a', sourceProducer: 'p2', enqueuedAt: 2 },
        { role: 'system', content: 'from p2 b', sourceProducer: 'p2', enqueuedAt: 3 },
      ],
    });
    const msgs = await collectOnSettle(FAKE_ENTRY);
    expect(msgs.map((m) => m.content)).toEqual(['from p1', 'from p2 a', 'from p2 b']);
  });

  it('a throwing producer does NOT block siblings', async () => {
    const { registerProducer, collectOnSettle } = await import('./synthetic-producers');
    registerProducer({ name: 'bad', onSettle: () => { throw new Error('boom'); } });
    registerProducer({
      name: 'good',
      onSettle: () => [{ role: 'user', content: 'survived', sourceProducer: 'good', enqueuedAt: 1 }],
    });
    const msgs = await collectOnSettle(FAKE_ENTRY);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]?.content).toBe('survived');
  });

  it('unregister removes the producer from future collects', async () => {
    const { registerProducer, collectOnSettle, listProducers } = await import('./synthetic-producers');
    const off = registerProducer({
      name: 'temp',
      onSettle: () => [{ role: 'user', content: 'x', sourceProducer: 'temp', enqueuedAt: 0 }],
    });
    expect(listProducers()).toHaveLength(1);
    off();
    expect(listProducers()).toHaveLength(0);
    expect(await collectOnSettle(FAKE_ENTRY)).toEqual([]);
  });

  it('skips producers without onSettle when collecting settle messages', async () => {
    const { registerProducer, collectOnSettle, collectOnDispatchComplete } = await import('./synthetic-producers');
    registerProducer({
      name: 'dispatch-only',
      onDispatchComplete: () => [{
        role: 'user', content: 'dc', sourceProducer: 'dispatch-only', enqueuedAt: 0,
      }],
    });
    expect(await collectOnSettle(FAKE_ENTRY)).toEqual([]);
    const dcMsgs = await collectOnDispatchComplete(FAKE_ENTRY, { ok: true });
    expect(dcMsgs.map((m) => m.content)).toEqual(['dc']);
  });
});

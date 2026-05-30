/**
 * warm-agent synthetic-queue + prepend-invariant tests.
 *
 * Covers (ADR §4.3 Path B + Task #20):
 *  1. Queue ordering: enqueue([M1, M2]) then sendWarmTurn(inbound) writes
 *     three stream-json lines in order M1, M2, inbound.
 *  2. Drain-on-input: after the turn writes, the queue is empty (next turn
 *     would write only the new inbound).
 *  3. Mid-turn non-preemption: when the warm agent is busy=true, enqueue
 *     does NOT push into the running stdin; the queue stays full and drains
 *     ONLY when the next inbound arrives via sendWarmTurn (which is gated
 *     by busy=false). This is the explicit ADR invariant: "不要打断 就是
 *     下一次提醒."
 *
 * We avoid spawning a real claude process — we plant a fake WarmAgent into
 * the module's global AGENTS map with a stdin sink that records writes, and
 * drive sendWarmTurn against it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Writable } from 'node:stream';

interface FakeAgent {
  proc: { stdin: Writable; killed: boolean; exitCode: number | null; pid: number };
  buf: string;
  busy: boolean;
  assembled: string;
  idleTimer: null;
  onText: null | ((s: string) => void);
  onDone: null | (() => void);
  onError: null | ((m: string) => void);
  sessionId: string | null;
}

function makeFakeAgent(): { agent: FakeAgent; writes: string[] } {
  const writes: string[] = [];
  const stdin = new Writable({
    write(chunk, _enc, cb) { writes.push(chunk.toString('utf8')); cb(); },
  });
  const agent: FakeAgent = {
    proc: { stdin, killed: false, exitCode: null, pid: 99999 },
    buf: '', busy: false, assembled: '', idleTimer: null,
    onText: null, onDone: null, onError: null, sessionId: null,
  };
  return { agent, writes };
}

beforeEach(() => {
  vi.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const G = globalThis as any;
  delete G.__holonWarmAgents;
  delete G.__holonWarmKeep;
  delete G.__holonWarmSynthQueue;
  delete G.__holonWarmBusyProbeWired;
  delete G.__holonSettleListeners;
  delete G.__holonSettleEmitted;
});

const KEY = 'test:warm:s-prepend';

function parseLines(joined: string): Array<{ text: string }> {
  return joined.split('\n').filter((l) => l.trim().length > 0).map((line) => {
    const ev = JSON.parse(line) as {
      message?: { content?: Array<{ type: string; text?: string }> };
    };
    const text = ev.message?.content?.find((b) => b.type === 'text')?.text ?? '';
    return { text };
  });
}

describe('warm-agent synthetic queue + prepend invariant', () => {
  it('queue is FIFO across enqueues', async () => {
    const wa = await import('./warm-agent');
    wa.enqueueSyntheticMessages(KEY, [
      { role: 'user', content: 'M1', sourceProducer: 'p', enqueuedAt: 1 },
    ]);
    wa.enqueueSyntheticMessages(KEY, [
      { role: 'user', content: 'M2', sourceProducer: 'p', enqueuedAt: 2 },
    ]);
    expect(wa.peekSyntheticQueue(KEY).map((m) => m.content)).toEqual(['M1', 'M2']);
  });

  it('PREPEND INVARIANT: queue [M1, M2] + sendWarmTurn(inbound) writes [M1, M2, inbound] in order', async () => {
    const wa = await import('./warm-agent');
    // Plant a fake warm agent so sendWarmTurn skips spawning a real CLI.
    const { agent, writes } = makeFakeAgent();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).__holonWarmAgents.set(KEY, agent);

    wa.enqueueSyntheticMessages(KEY, [
      { role: 'user', content: 'M1', sourceProducer: 'hr', enqueuedAt: 1 },
      { role: 'user', content: 'M2', sourceProducer: 'hr', enqueuedAt: 2 },
    ]);

    wa.sendWarmTurn(KEY, 'claude', undefined, 'inbound owner turn', {
      onText: () => undefined, onDone: () => undefined, onError: () => undefined,
    });

    expect(writes.length).toBeGreaterThan(0);
    const lines = parseLines(writes.join(''));
    expect(lines.map((l) => l.text)).toEqual(['M1', 'M2', 'inbound owner turn']);

    // Queue drained on the turn write.
    expect(wa.peekSyntheticQueue(KEY)).toEqual([]);
  });

  it('NON-PREEMPTIVE: busy=true → enqueue does NOT write to stdin; queue stays full; next sendWarmTurn drains it', async () => {
    const wa = await import('./warm-agent');
    const { agent, writes } = makeFakeAgent();
    agent.busy = true; // mid-turn
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).__holonWarmAgents.set(KEY, agent);

    wa.enqueueSyntheticMessages(KEY, [
      { role: 'user', content: 'HR-NUDGE', sourceProducer: 'hr-path-b', enqueuedAt: 1 },
    ]);

    // Nothing written while busy.
    expect(writes).toEqual([]);
    expect(wa.peekSyntheticQueue(KEY).map((m) => m.content)).toEqual(['HR-NUDGE']);

    // sendWarmTurn while busy errors out (existing behaviour) and must NOT
    // drain the queue — the nudge must still be there for the next attempt.
    let errSeen = '';
    wa.sendWarmTurn(KEY, 'claude', undefined, 'should-be-rejected', {
      onText: () => undefined,
      onDone: () => undefined,
      onError: (m) => { errSeen = m; },
    });
    expect(errSeen).toMatch(/busy/);
    expect(writes).toEqual([]);
    expect(wa.peekSyntheticQueue(KEY).map((m) => m.content)).toEqual(['HR-NUDGE']);

    // Turn finishes → busy goes false. Next inbound drains.
    agent.busy = false;
    wa.sendWarmTurn(KEY, 'claude', undefined, 'next inbound', {
      onText: () => undefined, onDone: () => undefined, onError: () => undefined,
    });
    const lines = parseLines(writes.join(''));
    expect(lines.map((l) => l.text)).toEqual(['HR-NUDGE', 'next inbound']);
    expect(wa.peekSyntheticQueue(KEY)).toEqual([]);
  });
});

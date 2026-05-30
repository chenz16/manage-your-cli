/**
 * synthetic-producers — registry of producers that emit synthetic messages
 * for warm secretaries on settle / dispatch-complete boundaries.
 *
 * Background: Task #20 + HR Path B (docs/adr/hr-evaluator-and-behavior-correction.md
 * §4.3). Producers (HR, event-followup, etc.) observe lifecycle events on a
 * warm secretary and emit messages that should be PREPENDED to the next
 * inbound owner turn (or next dispatch return). This is the NON-PREEMPTIVE
 * channel — producers never push into a running turn.
 *
 * Transport layout:
 *   heartbeat tick → settle detected → for each producer p: collect
 *     p.onSettle(entry) → enqueue into warm-agent per-secretary queue
 *   warm-agent.sendWarmTurn → drainQueue prepended before inbound
 *
 * This file owns the producer registry + the message types only. Wiring into
 * heartbeat lives in settle-watch.ts; wiring into the secretary input stream
 * lives in warm-agent.ts.
 */
import type { ProcessEntry } from './process-registry';

export interface SyntheticMessage {
  /** 'user' for HR nudges per ADR §4.3 Path B; 'system' reserved for
   *  infra-level injections (none today). */
  role: 'user' | 'system';
  content: string;
  /** Name of the SyntheticProducer that emitted this message — for audit
   *  + promotion-rule bookkeeping (§4.4 counts by producer + rule-hash). */
  sourceProducer: string;
  /** Epoch ms when the producer emitted this message (NOT when it lands
   *  on the secretary's input — that's the drain time). */
  enqueuedAt: number;
}

export interface SyntheticProducer {
  /** Stable identifier: 'hr-path-b', 'event-followup', etc. Used as the
   *  sourceProducer tag on emitted messages. */
  name: string;
  /** Called when a warm-secretary settles (idle + quiet > SETTLE_MS).
   *  Return an array (possibly empty) of synthetic messages to enqueue. */
  onSettle?(entry: ProcessEntry): SyntheticMessage[] | Promise<SyntheticMessage[]>;
  /** Called when a dispatch on this secretary completes. Slice-1 has no
   *  central dispatch-complete signal wired; callers from packages/core can
   *  invoke notifyDispatchComplete() to surface the event. */
  onDispatchComplete?(
    entry: ProcessEntry,
    dispatchResult: unknown,
  ): SyntheticMessage[] | Promise<SyntheticMessage[]>;
}

// Stash on globalThis so HMR / multiple imports share one registry — same
// pattern as process-registry / warm-agent.
const G = globalThis as unknown as {
  __holonSyntheticProducers?: Set<SyntheticProducer>;
};
if (!G.__holonSyntheticProducers) G.__holonSyntheticProducers = new Set();
const PRODUCERS = G.__holonSyntheticProducers;

/** Register a producer. Returns an unregister function. */
export function registerProducer(p: SyntheticProducer): () => void {
  PRODUCERS.add(p);
  return () => { PRODUCERS.delete(p); };
}

export function listProducers(): SyntheticProducer[] {
  return [...PRODUCERS];
}

/** Test-only: wipe all registered producers. */
export function _resetProducersForTest(): void {
  PRODUCERS.clear();
}

/** Collect onSettle messages from every producer. Awaits async producers
 *  in parallel; a producer that throws is logged and skipped (one bad
 *  producer must NOT block the others). */
export async function collectOnSettle(entry: ProcessEntry): Promise<SyntheticMessage[]> {
  const results = await Promise.allSettled(
    [...PRODUCERS]
      .filter((p) => typeof p.onSettle === 'function')
      .map(async (p) => {
        const out = await p.onSettle!(entry);
        return Array.isArray(out) ? out : [];
      }),
  );
  const messages: SyntheticMessage[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') {
      messages.push(...r.value);
    } else {
      console.warn(JSON.stringify({
        audit: 'synthetic.producer.error', phase: 'onSettle',
        error: r.reason instanceof Error ? r.reason.message : String(r.reason),
        ts: new Date().toISOString(),
      }));
    }
  }
  return messages;
}

/** Collect onDispatchComplete messages from every producer. */
export async function collectOnDispatchComplete(
  entry: ProcessEntry,
  dispatchResult: unknown,
): Promise<SyntheticMessage[]> {
  const results = await Promise.allSettled(
    [...PRODUCERS]
      .filter((p) => typeof p.onDispatchComplete === 'function')
      .map(async (p) => {
        const out = await p.onDispatchComplete!(entry, dispatchResult);
        return Array.isArray(out) ? out : [];
      }),
  );
  const messages: SyntheticMessage[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') {
      messages.push(...r.value);
    } else {
      console.warn(JSON.stringify({
        audit: 'synthetic.producer.error', phase: 'onDispatchComplete',
        error: r.reason instanceof Error ? r.reason.message : String(r.reason),
        ts: new Date().toISOString(),
      }));
    }
  }
  return messages;
}

/**
 * settle-watch — detect when a warm-secretary has settled (idle + quiet)
 * and emit a single `settle` event per quiet window.
 *
 * A warm-secretary is considered SETTLED when:
 *   - its status is 'alive' (NOT 'stuck', NOT 'reaped', NOT 'dead'); AND
 *   - it is NOT currently busy with a turn (the warm-agent module exposes a
 *     per-key busy flag — when no warm agent is busy on this key the
 *     secretary is idle); AND
 *   - its lastHeartbeatAt is older than SETTLE_MS (default 3 min).
 *
 * Idempotence: a single quiet window emits the settle event exactly once.
 * The next emit requires the secretary to go busy→idle again (we track an
 * "emitted-for-this-window" flag per key, cleared when busy is observed).
 *
 * Why a separate file vs adding into heartbeat.ts: heartbeat owns
 * liveness/stuck/respawn; settle is a higher-level signal layered on top
 * for the synthetic-message pipeline. Keeping it separate avoids cluttering
 * the liveness loop and makes the test surface smaller.
 */

import { list, type ProcessEntry } from './process-registry';
import { collectOnSettle } from './synthetic-producers';

/** Default settle window: 3 min of no event AND idle. Configurable via
 *  HOLON_SETTLE_MS for ops. Owner spec calls for 180_000. */
export const SETTLE_MS = (() => {
  const raw = Number(process.env.HOLON_SETTLE_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 180_000;
})();

const G = globalThis as unknown as {
  __holonSettleListeners?: Set<(entry: ProcessEntry) => void>;
  /** Per-key state: did we already emit for the current quiet window? */
  __holonSettleEmitted?: Map<string, boolean>;
  __holonSettleTimer?: ReturnType<typeof setInterval>;
};
if (!G.__holonSettleListeners) G.__holonSettleListeners = new Set();
if (!G.__holonSettleEmitted) G.__holonSettleEmitted = new Map();
const LISTENERS = G.__holonSettleListeners;
const EMITTED = G.__holonSettleEmitted;

/** Subscribe to settle events. Returns an unsubscribe function. */
export function onSettle(fn: (entry: ProcessEntry) => void): () => void {
  LISTENERS.add(fn);
  return () => { LISTENERS.delete(fn); };
}

function emit(entry: ProcessEntry): void {
  for (const fn of LISTENERS) {
    try { fn(entry); } catch { /* don't break the loop */ }
  }
}

/** Pluggable "is this warm-secretary busy?" hook. Defaults to false so the
 *  module is testable without standing up a real warm-agent. warm-agent.ts
 *  registers its own probe at module load. */
let isBusy: (key: string) => boolean = () => false;
export function setBusyProbe(probe: (key: string) => boolean): void {
  isBusy = probe;
}

/**
 * Examine one warm-secretary entry and emit settle if the criteria hold.
 * Exported for direct unit-test use without the interval loop.
 *
 * @param entry  the registry entry (kind === 'warm-secretary')
 * @param now    current time in ms (injected for deterministic tests)
 */
export function evaluateSettle(entry: ProcessEntry, now: number = Date.now()): boolean {
  if (entry.kind !== 'warm-secretary') return false;
  if (entry.status !== 'alive') return false;
  // Strip 'warm:' prefix the warm-agent uses for its registry keys.
  const warmKey = entry.key.startsWith('warm:') ? entry.key.slice(5) : entry.key;
  if (isBusy(warmKey)) {
    // Currently busy — clear the emitted flag so the NEXT idle window can fire.
    EMITTED.set(entry.key, false);
    return false;
  }
  const quietFor = now - entry.lastHeartbeatAt;
  if (quietFor < SETTLE_MS) return false;
  if (EMITTED.get(entry.key)) return false; // already fired this window
  EMITTED.set(entry.key, true);
  emit(entry);
  return true;
}

/** Scan all warm-secretaries; emit settle for any that qualify. */
export function settleTick(now: number = Date.now()): void {
  for (const entry of list((e) => e.kind === 'warm-secretary')) {
    evaluateSettle(entry, now);
  }
}

/** Default tick: 30s — matches heartbeat. A settle window of 180s is well
 *  over the tick granularity so we never miss a window. */
const TICK_MS = 30_000;

/** Start the settle-watch ticker. Also subscribes a producer-collector that
 *  drains synthetic messages from all registered producers and enqueues
 *  them into the warm-agent input queue. */
export function startSettleWatch(
  enqueue: (warmKey: string, messages: Awaited<ReturnType<typeof collectOnSettle>>) => void,
): void {
  if (G.__holonSettleTimer) return;
  // Producer→queue wiring. Failures inside one producer must not break others
  // (collectOnSettle handles per-producer errors); failures here drop the
  // batch with an audit line.
  onSettle((entry) => {
    void (async () => {
      try {
        const msgs = await collectOnSettle(entry);
        if (msgs.length === 0) return;
        const warmKey = entry.key.startsWith('warm:') ? entry.key.slice(5) : entry.key;
        enqueue(warmKey, msgs);
      } catch (err) {
        console.warn(JSON.stringify({
          audit: 'settle-watch.collect.failed', key: entry.key,
          error: err instanceof Error ? err.message : String(err),
          ts: new Date().toISOString(),
        }));
      }
    })();
  });
  G.__holonSettleTimer = setInterval(() => settleTick(), TICK_MS);
  if (typeof G.__holonSettleTimer.unref === 'function') G.__holonSettleTimer.unref();
}

/** Test-only: reset emit state + listeners. */
export function _resetSettleWatchForTest(): void {
  LISTENERS.clear();
  EMITTED.clear();
  isBusy = () => false;
}

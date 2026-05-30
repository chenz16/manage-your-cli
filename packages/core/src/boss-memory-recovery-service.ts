/**
 * Pattern 1 / Slice — Auto-recovery wrapper around writeBossMemory.
 *
 * When a write returns `{ ok: false, reason: 'budget_exceeded' }` we dispatch
 * the memory-manager CLI agent with a focused brief that names the offending
 * scope and asks it to compress, then retry the write exactly once.
 *
 * Hard contract:
 * - Recovery is one level deep. The retry never itself triggers a second
 *   dispatch — if the second write still overflows we surface the failure
 *   and audit `boss.memory_recovery_failed`.
 * - Concurrent overflows for the same scope coalesce onto a single dispatch;
 *   all callers await it, then each retries its own write.
 * - The underlying `writeBossMemory` is untouched — other callers still see
 *   the raw overflow signal and can choose to handle it themselves.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import {
  writeBossMemory,
  type BossMemoryWrite,
  type BossMemoryBudgetExceeded,
} from './boss-memory-service.js';
import { getOrCreateMemoryManagerStaff } from './memory-manager-service.js';
import { dispatchCliTask, type DispatchCliTaskResult } from './cli-dispatch-service.js';

export type RecoveryDispatcher = (input: {
  scope: string;
  used: number;
  limit: number;
  attempted_chars: number;
  project_id?: string | null;
}) => Promise<{ ok: boolean; reason?: string }>;

/**
 * Default dispatcher: spins up / reuses the memory-manager staff and sends
 * it a focused compression brief via dispatchCliTask. The brief NAMES the
 * scope + budget facts so the agent has the context it needs to compress
 * sanely.
 *
 * NOTE: dispatchCliTask is fire-and-forget at the CLI layer — ok=true means
 * "the prompt was delivered", not "the agent finished compressing". The
 * retry below will succeed only if the agent has actually shrunk the file
 * by the time we re-attempt; if it hasn't, the second write will overflow
 * again and surface `boss.memory_recovery_failed`.
 */
async function defaultDispatcher(input: {
  scope: string;
  used: number;
  limit: number;
  attempted_chars: number;
  project_id?: string | null;
}): Promise<DispatchCliTaskResult> {
  const staff = getOrCreateMemoryManagerStaff();
  const brief = [
    `Scope \`${input.scope}\` exceeded its budget (used ${input.used}/${input.limit} chars; trying to add ${input.attempted_chars}).`,
    '',
    'Compress the existing content: keep durable decisions / current state / unresolved items; archive resolved threads + bullet-by-bullet log.',
    'Target <= 60% of the limit so headroom remains. Write the compressed result back via write_memory.',
    '',
    'Use Holon MCP only. Markdown only. Do not invent facts.',
  ].join('\n');
  return dispatchCliTask({ staffId: staff.id, brief });
}

let activeDispatcher: RecoveryDispatcher = defaultDispatcher;

/** Test seam: swap in a mock dispatcher (e.g. one that shrinks the file). */
export function setBossMemoryRecoveryDispatcher(dispatcher: RecoveryDispatcher | null): void {
  activeDispatcher = dispatcher ?? defaultDispatcher;
}

function recoveryKey(scope: string, project_id?: string | null): string {
  return `${project_id ?? 'default'}::${scope}`;
}

/** In-flight recovery dispatches, keyed by `<project_id>::<scope>`. */
const inFlight = new Map<string, Promise<{ ok: boolean; reason?: string }>>();

/**
 * Per-async-context recursion guard. Tracks the set of scope-keys currently
 * undergoing recovery WITHIN THIS ASYNC CHAIN — propagated via AsyncLocalStorage
 * so re-entrant calls (the memory-manager dispatcher itself calling back via
 * MCP `write_memory`, or any nested write triggered inside the dispatcher) see
 * the flag and short-circuit, while a CONCURRENT external caller in an
 * independent async chain still coalesces onto the in-flight dispatch.
 *
 * This distinction is the difference between "deadlock / infinite recursion"
 * and "two HTTP requests both awaiting the same compression and retrying".
 */
const recoveryContext = new AsyncLocalStorage<Set<string>>();

export async function writeBossMemoryWithRecovery(
  scope: string,
  text: string,
  project_id?: string | null,
): Promise<BossMemoryWrite> {
  const first = writeBossMemory(scope, text, project_id);
  if (first.ok) return first;
  if (!('reason' in first) || first.reason !== 'budget_exceeded') return first;

  const overflow = first as BossMemoryBudgetExceeded;
  const key = recoveryKey(overflow.scope, project_id);

  // Recursion guard: this same async chain is already recovering this scope.
  // Surface the overflow as-is and let the outer recovery handle it.
  const ctx = recoveryContext.getStore();
  if (ctx?.has(key)) return first;

  return recoveryContext.run(new Set([...(ctx ?? []), key]), async () => {
    // Coalesce concurrent overflows on the same scope onto a single dispatch.
    let dispatchPromise = inFlight.get(key);
    if (!dispatchPromise) {
      console.log(JSON.stringify({
        audit: 'boss.memory_recovery_dispatched',
        scope: overflow.scope,
        project_id: project_id ?? null,
        used: overflow.used,
        limit: overflow.limit,
        attempted_chars: overflow.attempted_chars,
        ts: new Date().toISOString(),
      }));
      const newPromise: Promise<{ ok: boolean; reason?: string }> = activeDispatcher({
        scope: overflow.scope,
        used: overflow.used,
        limit: overflow.limit,
        attempted_chars: overflow.attempted_chars,
        project_id: project_id ?? null,
      }).then<{ ok: boolean; reason?: string }, { ok: boolean; reason?: string }>(
        (r) => (r.reason !== undefined ? { ok: !!r.ok, reason: r.reason } : { ok: !!r.ok }),
        (err) => ({ ok: false, reason: err instanceof Error ? err.message : String(err) }),
      ).finally(() => {
        inFlight.delete(key);
      });
      inFlight.set(key, newPromise);
      dispatchPromise = newPromise;
    }

    await dispatchPromise;

    // Single retry — the AsyncLocalStorage flag will short-circuit any
    // dispatcher-driven nested write that also overflows.
    const second = writeBossMemory(scope, text, project_id);
    return finalizeRecovery(second, overflow, project_id);
  });
}

function finalizeRecovery(
  second: BossMemoryWrite,
  overflow: BossMemoryBudgetExceeded,
  project_id?: string | null,
): BossMemoryWrite {

  if (second.ok) {
    console.log(JSON.stringify({
      audit: 'boss.memory_recovery_succeeded',
      scope: overflow.scope,
      project_id: project_id ?? null,
      used: second.used,
      limit: second.limit,
      ts: new Date().toISOString(),
    }));
  } else {
    console.log(JSON.stringify({
      audit: 'boss.memory_recovery_failed',
      scope: overflow.scope,
      project_id: project_id ?? null,
      reason: 'reason' in second ? second.reason : (second as { error?: string }).error,
      ts: new Date().toISOString(),
    }));
  }
  return second;
}

/**
 * sleep-consolidator-tick — periodic per-agent CLAUDE.md distiller.
 *
 * Spec: docs/adr/sleep-time-memory-consolidator.md.
 *
 * Trigger conditions (all must hold for a given live agent):
 *   1. minBytes — the file is at least HOLON_CONSOLIDATOR_MIN_BYTES (default 50KB).
 *   2. cooldown — last consolidation timestamp (sidecar) is older than
 *      HOLON_CONSOLIDATOR_MIN_INTERVAL_MS (default 24h).
 *   3. not busy — the busy-probe (shared with settle-watch) reports the
 *      warm-agent for this key is idle right now.
 *
 * Iteration target: every warm-secretary entry in the process-registry
 * (the live-agents list). For each one we resolve the per-binary memory
 * file under entry.cwd (CLAUDE.md / AGENTS.md / GEMINI.md / QWEN.md) and
 * call `consolidateMemoryFile`.
 *
 * Distill: real LLM-backed via `claudeDistill` (apps/web/lib/consolidator-
 * distill.ts) — one-shot `claude --print` per section. Falls back to the
 * `STUB_DISTILL` marker (still exported from @holon/core) on spawn timeout
 * or failure so the tick never blocks.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const nodeRequire = eval('require') as (id: string) => any;
const { join } = nodeRequire('path') as typeof import('path');

import {
  consolidateMemoryFile,
  type ConsolidationResult, type ConsolidatorOptions,
} from '@holon/core/memory-consolidator';
import { claudeDistill } from './consolidator-distill';
import { list, type ProcessEntry } from './process-registry';

const DEFAULT_TICK_MS = 6 * 60 * 60 * 1000; // 6h

const G = globalThis as unknown as {
  __holonConsolidatorTimer?: ReturnType<typeof setInterval>;
};

/** Pluggable busy-probe — same shape settle-watch uses. Defaults to "never
 *  busy" so the module is testable standalone; warm-agent registers a real
 *  probe at module load. Use {@link setBusyProbe} to inject. */
let isBusy: (warmKey: string) => boolean = () => false;
export function setBusyProbe(probe: (warmKey: string) => boolean): void {
  isBusy = probe;
}

/** Map a binary name to its authoritative memory file name. Mirrors
 *  packages/core/src/cli-memory-scaffold.ts §50. */
function memoryFileName(binary: string): string {
  switch (binary) {
    case 'claude': return 'CLAUDE.md';
    case 'codex':  return 'AGENTS.md';
    case 'gemini': return 'GEMINI.md';
    case 'qwen':   return 'QWEN.md';
    default:       return 'CLAUDE.md';
  }
}

/** Resolve the memory-file path for a warm-secretary registry entry, or
 *  null when cwd is unknown (we won't guess). */
function resolveMemoryFile(entry: ProcessEntry): string | null {
  const cwd = entry.cwd;
  if (!cwd) return null;
  const binary = (entry.meta?.binary as string | undefined) ?? 'claude';
  return join(cwd, memoryFileName(binary));
}

/** Strip the `warm:` prefix the registry uses for warm keys. */
function warmKey(entry: ProcessEntry): string {
  return entry.key.startsWith('warm:') ? entry.key.slice(5) : entry.key;
}

/** Examine one live agent and run consolidate if it qualifies. Exposed for
 *  direct unit-test use without the interval loop. */
export async function consolidateForEntry(
  entry: ProcessEntry,
  opts: Pick<ConsolidatorOptions, 'distill' | 'minBytes' | 'minIntervalMs' | 'now'>,
): Promise<ConsolidationResult | { skipped: true; reason: string }> {
  if (entry.kind !== 'warm-secretary') return { skipped: true, reason: 'wrong-kind' };
  if (entry.status !== 'alive') return { skipped: true, reason: `status:${entry.status}` };
  if (isBusy(warmKey(entry))) return { skipped: true, reason: 'busy' };
  const filePath = resolveMemoryFile(entry);
  if (!filePath) return { skipped: true, reason: 'no-cwd' };
  return consolidateMemoryFile(filePath, {
    ...opts,
    staffId: entry.key,
  });
}

function envInt(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

/** Run one consolidation sweep across all live warm-secretaries. */
export async function consolidatorTick(now: number = Date.now()): Promise<ConsolidationResult[]> {
  const minBytes = envInt('HOLON_CONSOLIDATOR_MIN_BYTES', 50 * 1024);
  const minIntervalMs = envInt('HOLON_CONSOLIDATOR_MIN_INTERVAL_MS', 24 * 60 * 60 * 1000);
  const results: ConsolidationResult[] = [];
  for (const entry of list((e) => e.kind === 'warm-secretary')) {
    try {
      const r = await consolidateForEntry(entry, {
        distill: claudeDistill, minBytes, minIntervalMs, now,
      });
      // Type narrow — only push full ConsolidationResults; the early-skip
      // shape is logged but not returned.
      if ('filePath' in r) {
        results.push(r);
        if (!r.skipped) {
          console.log(JSON.stringify({
            audit: 'consolidator.ran', key: entry.key, file: r.filePath,
            before_bytes: r.before.bytes, after_bytes: r.after.bytes,
            preserved: r.preservedSections, consolidated: r.consolidatedSections,
            ts: new Date(now).toISOString(),
          }));
        }
      } else {
        console.log(JSON.stringify({
          audit: 'consolidator.skipped', key: entry.key, reason: r.reason,
          ts: new Date(now).toISOString(),
        }));
      }
    } catch (err) {
      console.warn(JSON.stringify({
        audit: 'consolidator.failed', key: entry.key,
        error: err instanceof Error ? err.message : String(err),
        ts: new Date(now).toISOString(),
      }));
    }
  }
  return results;
}

/** Start the periodic consolidator ticker. Default interval 6h, configurable
 *  via HOLON_CONSOLIDATOR_INTERVAL_MS. Idempotent — second call is a no-op. */
export function startSleepConsolidator(): void {
  if (G.__holonConsolidatorTimer) return;
  const intervalMs = envInt('HOLON_CONSOLIDATOR_INTERVAL_MS', DEFAULT_TICK_MS);
  G.__holonConsolidatorTimer = setInterval(() => { void consolidatorTick(); }, intervalMs);
  if (typeof G.__holonConsolidatorTimer.unref === 'function') G.__holonConsolidatorTimer.unref();
}

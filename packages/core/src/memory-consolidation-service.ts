import { dispatchMemoryConsolidationTask } from './memory-manager-service.js';

const DEFAULT_MEMORY_CONSOLIDATE_MS = 10 * 60 * 1000;

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let inFlight = false;

export interface MemoryConsolidationServiceState {
  ok: true;
  started: boolean;
  intervalMs: number;
}

function memoryConsolidateMs(): number {
  const raw = process.env.HOLON_MEMORY_CONSOLIDATE_MS?.trim();
  if (!raw) return DEFAULT_MEMORY_CONSOLIDATE_MS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MEMORY_CONSOLIDATE_MS;
  return parsed;
}

function logMemoryConsolidation(audit: string, detail: Record<string, unknown>): void {
  console.log(JSON.stringify({
    audit,
    ...detail,
    ts: new Date().toISOString(),
  }));
}

function runScheduledConsolidation(intervalMs: number): void {
  if (inFlight) {
    logMemoryConsolidation('memory_manager.consolidation_skipped', {
      reason: 'previous_dispatch_in_flight',
      interval_ms: intervalMs,
    });
    return;
  }
  inFlight = true;
  dispatchMemoryConsolidationTask()
    .then((result) => {
      logMemoryConsolidation('memory_manager.consolidation_tick', {
        ok: result.ok,
        reason: result.reason,
        interval_ms: intervalMs,
        staff_id: result.staff.id,
      });
    })
    .catch((err: unknown) => {
      logMemoryConsolidation('memory_manager.consolidation_failed', {
        error: err instanceof Error ? err.name : 'unknown_error',
        message: err instanceof Error ? err.message : String(err),
        interval_ms: intervalMs,
      });
    })
    .finally(() => {
      inFlight = false;
    });
}

export function startMemoryConsolidationService(): MemoryConsolidationServiceState {
  const intervalMs = memoryConsolidateMs();
  if (intervalHandle) return { ok: true, started: false, intervalMs };

  intervalHandle = setInterval(() => runScheduledConsolidation(intervalMs), intervalMs);
  if (typeof intervalHandle.unref === 'function') intervalHandle.unref();
  logMemoryConsolidation('memory_manager.consolidation_service_started', { interval_ms: intervalMs });
  return { ok: true, started: true, intervalMs };
}

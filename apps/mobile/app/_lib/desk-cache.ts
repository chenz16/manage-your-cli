'use client';

// M-L-066 — tiny SWR-style dedupe for desk reads. On /chat first paint three
// independently-mounted consumers (TodayStrip, chat context-chips, useTabBadges)
// each fire the SAME desk endpoints within ~1s: `/api/v1/staff` 2× and
// `/api/v1/jobs` 3×. There was no sharing, so the radio woke 5 times for 2
// distinct payloads. deskFetch() coalesces by endpoint: concurrent same-path
// calls share one in-flight promise, and a freshly-resolved payload is reused
// for a short TTL window so near-simultaneous polls (15s strip + 30s badges)
// collapse to one request. Errors are NOT swallowed — network failures reject
// to every coalesced caller; non-2xx surfaces as `{ ok:false }` so each
// consumer keeps its own no-silent-failure handling (Eng Rule #4).

import { fetchWithTimeout } from './fetch-timeout';

export interface DeskResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
}

interface Entry {
  ts: number;
  result: DeskResult<unknown>;
}

const DEFAULT_TTL_MS = 4000;

const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<DeskResult<unknown>>>();

export function deskFetch<T>(
  path: string,
  opts?: { ttlMs?: number; force?: boolean },
): Promise<DeskResult<T>> {
  const ttlMs = opts?.ttlMs ?? DEFAULT_TTL_MS;
  const now = Date.now();

  if (!opts?.force) {
    const hit = cache.get(path);
    if (hit && now - hit.ts < ttlMs) {
      return Promise.resolve(hit.result as DeskResult<T>);
    }
    const pending = inflight.get(path);
    if (pending) return pending as Promise<DeskResult<T>>;
  }

  const p = (async (): Promise<DeskResult<unknown>> => {
    try {
      const res = await fetchWithTimeout(path);
      const data = res.ok ? ((await res.json()) as unknown) : null;
      const result: DeskResult<unknown> = { ok: res.ok, status: res.status, data };
      cache.set(path, { ts: Date.now(), result });
      return result;
    } finally {
      inflight.delete(path);
    }
  })();

  inflight.set(path, p);
  return p as Promise<DeskResult<T>>;
}

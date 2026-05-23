'use client';

/**
 * useOwner() — shared client-side accessor for the OwnerAssistant
 * record served by GET /api/v1/me.
 *
 * Filed as a DRY follow-up after multiple client components
 * (AppShell, ChatEmptyState, Step2AboutYou, MembersClient
 * MemberDetailInline) each grew their own fetch-in-useEffect on
 * /api/v1/me. ChatEmptyState's TODO (88bb4df) explicitly called this
 * out as the next refactor; this hook is that refactor.
 *
 * Design notes (V1.0 — intentionally minimal):
 *
 *   - **Module-level cache + listener set**, NOT React Query / SWR /
 *     Zustand. ADR-024 (storage decisions) defers caching-layer choice
 *     to V1.1 when SQLite-backed owner persistence (TD-011) lands.
 *     This hook is the swap-point: V1.1 can replace the cache with
 *     a React Query subscription without touching the N call sites.
 *
 *   - **One in-flight request shared across components**. If multiple
 *     components mount on the same page and call useOwner(), they all
 *     subscribe to the same fetch promise — no thundering herd on /me.
 *
 *   - **Refetches on `holon:reset`**. /me's DebugControls dispatches
 *     this event after wiping server state; the existing MeClient
 *     listener pattern (line 47-53) is now centralized here so every
 *     consumer auto-refreshes too.
 *
 *   - **Does NOT cover writers**. MeClient (PATCH /me) and
 *     Step2AboutYou (PATCH /me + onNext) write the record and care
 *     about the response shape; they stay self-contained because the
 *     PATCH response IS the authoritative new value. Writers should
 *     call `invalidateOwner()` to refresh other consumers — wired by
 *     the listener set automatically.
 *
 *   - **Does NOT cover polling**. Step3ConnectGmail polls /me every 2s
 *     waiting for the Gmail OAuth callback to land; the shared cache
 *     would defeat the poll. Step3 keeps its bespoke fetch.
 *
 *   - **Does NOT cover non-component callers**. owner-adapter.ts's
 *     fetchInitialMessagesFromApi runs outside React lifecycle (called
 *     by ChatRuntimeProvider's useEffect on mount) and fetches /me +
 *     /chat/threads in parallel; not a useOwner() consumer.
 */

import { useEffect, useState } from 'react';
import type { OwnerAssistant } from '@holon/api-contract';

export interface UseOwnerState {
  owner: OwnerAssistant | null;
  loading: boolean;
  error: string | null;
}

// Module-level cache shared across all useOwner() callers on the page.
let cached: OwnerAssistant | null = null;
let inflight: Promise<OwnerAssistant> | null = null;
const listeners = new Set<(s: UseOwnerState) => void>();

function notify(s: UseOwnerState): void {
  for (const fn of listeners) fn(s);
}

function startFetch(): Promise<OwnerAssistant> {
  if (inflight) return inflight;
  inflight = fetch('/api/v1/me')
    .then((r) => {
      if (!r.ok) throw new Error(`GET /api/v1/me → HTTP ${r.status}`);
      return r.json() as Promise<OwnerAssistant>;
    })
    .then((o) => {
      cached = o;
      inflight = null;
      notify({ owner: o, loading: false, error: null });
      return o;
    })
    .catch((e: unknown) => {
      inflight = null;
      const msg = e instanceof Error ? e.message : String(e);
      notify({ owner: cached, loading: false, error: msg });
      throw e;
    });
  return inflight;
}

let resetListenerInstalled = false;
function ensureResetListener(): void {
  if (resetListenerInstalled || typeof window === 'undefined') return;
  resetListenerInstalled = true;
  window.addEventListener('holon:reset', () => {
    invalidateOwner();
    if (listeners.size > 0) {
      notify({ owner: null, loading: true, error: null });
      void startFetch().catch(() => { /* error already broadcast */ });
    }
  });
}

export function useOwner(): UseOwnerState {
  const [state, setState] = useState<UseOwnerState>(() => ({
    owner: cached,
    loading: cached === null,
    error: null,
  }));

  useEffect(() => {
    ensureResetListener();
    const onChange = (next: UseOwnerState) => setState(next);
    listeners.add(onChange);
    if (cached === null && inflight === null) {
      void startFetch().catch(() => { /* error already broadcast */ });
    } else if (cached !== null) {
      // Late subscriber — sync to cached value (covers the race where
      // a sibling component triggered + completed the fetch before
      // this component's effect ran).
      setState({ owner: cached, loading: false, error: null });
    }
    return () => { listeners.delete(onChange); };
  }, []);

  return state;
}

/** Apply an authoritative owner snapshot returned by a writer endpoint. */
export function primeOwner(owner: OwnerAssistant): void {
  cached = owner;
  notify({ owner, loading: false, error: null });
}

/** Force-refetch — call after PATCH /api/v1/me / OAuth changes so
 *  other consumers pick up the new value. Safe to call from anywhere
 *  (no React context required). */
export function invalidateOwner(): void {
  inflight = null;
  if (listeners.size === 0) {
    cached = null;
    return;
  }
  notify({ owner: cached, loading: true, error: null });
  void startFetch().catch(() => { /* error already broadcast */ });
}

'use client';

/**
 * useProjects() — fetches the active project list from GET /api/v1/projects.
 *
 * Phase 1: used by <ProjectSwitcher /> to determine visibility (hidden at
 * < 2 projects) and to populate the dropdown options.
 *
 * Same module-level cache + listener pattern as useOwner() — single fetch
 * shared across co-mounted consumers, invalidatable on reset.
 */

import { useEffect, useState } from 'react';
import type { Project } from '@holon/api-contract';

export interface UseProjectsState {
  projects: Project[];
  loading: boolean;
  error: string | null;
}

let cached: Project[] | null = null;
let inflight: Promise<Project[]> | null = null;
const listeners = new Set<(s: UseProjectsState) => void>();

function notify(s: UseProjectsState): void {
  for (const fn of listeners) fn(s);
}

function startFetch(baseUrl?: string): Promise<Project[]> {
  if (inflight) return inflight;
  const url = baseUrl ? `${baseUrl}/api/v1/projects` : '/api/v1/projects';
  inflight = fetch(url, { cache: 'no-store' })
    .then((r) => {
      if (!r.ok) throw new Error(`GET ${url} → HTTP ${r.status}`);
      return r.json() as Promise<{ items: Project[] }>;
    })
    .then(({ items }) => {
      cached = items;
      inflight = null;
      notify({ projects: items, loading: false, error: null });
      return items;
    })
    .catch((e: unknown) => {
      inflight = null;
      const msg = e instanceof Error ? e.message : String(e);
      notify({ projects: cached ?? [], loading: false, error: msg });
      throw e;
    });
  return inflight;
}

let resetListenerInstalled = false;
function ensureResetListener(): void {
  if (resetListenerInstalled || typeof window === 'undefined') return;
  resetListenerInstalled = true;
  window.addEventListener('holon:reset', () => {
    cached = null;
    inflight = null;
    if (listeners.size > 0) {
      notify({ projects: [], loading: true, error: null });
      void startFetch().catch(() => { /* broadcast already happened */ });
    }
  });
}

/**
 * Fetch projects from the desk BFF.
 * @param baseUrl - optional base URL (for mobile cross-origin desk calls).
 */
export function useProjects(baseUrl?: string): UseProjectsState {
  const [state, setState] = useState<UseProjectsState>(() => ({
    projects: cached ?? [],
    loading: cached === null,
    error: null,
  }));

  useEffect(() => {
    ensureResetListener();
    const onChange = (next: UseProjectsState) => setState(next);
    listeners.add(onChange);
    if (cached === null && inflight === null) {
      void startFetch(baseUrl).catch(() => { /* broadcast already happened */ });
    } else if (cached !== null) {
      setState({ projects: cached, loading: false, error: null });
    }
    return () => { listeners.delete(onChange); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return state;
}

/** Force-invalidate cached projects (call after create/patch/delete). */
export function invalidateProjects(): void {
  cached = null;
  inflight = null;
}

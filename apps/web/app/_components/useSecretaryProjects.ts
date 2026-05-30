/**
 * useSecretaryProjects — desk-side hook for the new multi-secretary-project
 * model introduced in mobile. Each project has its own secretary staff +
 * thread; the active project drives:
 *   - which transcript the Chat hydrates from
 *   - which secretary the owner/stream route dispatches to
 *
 * Selection persists in localStorage so a browser reload keeps the same
 * project. Mirrors the mobile pattern in WeizoApp.tsx.
 */

'use client';

import { useEffect, useState } from 'react';

export interface SecretaryProject {
  id: string;
  name: string;
  secretary_staff_id: string;
  created_at: string;
  secretary_staff?: {
    id: string;
    name: string;
    role_label?: string;
  };
}

const ACTIVE_KEY = 'holon.desk.activeSecretaryProject';

export function useSecretaryProjects() {
  const [projects, setProjects] = useState<SecretaryProject[]>([]);
  const [activeId, setActiveIdRaw] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(ACTIVE_KEY) || null;
  });
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      const res = await fetch('/api/v1/secretary-projects', { cache: 'no-store' });
      if (!res.ok) return;
      const json = await res.json() as { items?: SecretaryProject[] };
      setProjects(json.items ?? []);
    } catch { /* swallow */ }
    finally { setLoading(false); }
  };

  useEffect(() => { void refresh(); }, []);

  // Auto-select first project if nothing is selected and projects exist.
  useEffect(() => {
    if (activeId) return;
    if (projects.length === 0) return;
    setActiveIdInternal(projects[0]!.id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, activeId]);

  const setActiveIdInternal = (id: string | null) => {
    setActiveIdRaw(id);
    if (typeof window === 'undefined') return;
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
  };

  const active = activeId ? projects.find((p) => p.id === activeId) ?? null : null;
  const threadId = active ? `project:${active.id}` : 'owner';

  return {
    projects,
    active,
    activeId,
    threadId,
    loading,
    setActiveId: setActiveIdInternal,
    refresh,
  };
}

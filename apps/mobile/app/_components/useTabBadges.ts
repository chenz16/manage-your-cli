'use client';

// M004 Pass #4 — Tab badge polling hook. Returns presence counts for
// /inbound (queued missions awaiting owner) and /today (active jobs).
// Polls every 30s per plan R-4 (don't over-fetch); also refreshes on
// tab visibility change so coming back from background feels instant.

import { useEffect, useState } from 'react';
import { deskFetch } from '../_lib/desk-cache';

export type TabBadges = { inbound: number; today: number };

const POLL_MS = 30_000;

type MissionLike = { state?: string };
type JobLike = { status?: string };

export function useTabBadges(): TabBadges {
  const [badges, setBadges] = useState<TabBadges>({ inbound: 0, today: 0 });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        // M-L-066 — `/api/v1/jobs` is shared with TodayStrip via the dedupe
        // cache so the strip's 15s poll and this 30s poll coalesce when they
        // land in the same TTL window.
        const [missionsRes, jobsRes] = await Promise.all([
          deskFetch<{ items?: MissionLike[] }>('/api/v1/missions?state=queued'),
          deskFetch<{ items?: JobLike[] }>('/api/v1/jobs'),
        ]);
        if (cancelled) return;
        const missions = missionsRes.ok ? (missionsRes.data ?? { items: [] }) : { items: [] };
        const jobs = jobsRes.ok ? (jobsRes.data ?? { items: [] }) : { items: [] };
        if (cancelled) return;
        const inbound = (missions.items ?? []).filter((m) => m.state === 'queued').length;
        const today = (jobs.items ?? []).filter(
          (j) => j.status === 'queued' || j.status === 'running',
        ).length;
        setBadges({ inbound, today });
      } catch (e) {
        // Best-effort polling — keep prior badge state on transient errors.
        // Surfaced to dev console (Eng Rule #4: no silent failure); no UI
        // affordance for badge fetch errors by design (V1 mobile is thin).
        console.warn('[useTabBadges] fetch failed', e);
      }
    }

    void load();
    const interval = setInterval(load, POLL_MS);
    const onVisibility = () => {
      if (typeof document !== 'undefined' && !document.hidden) void load();
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility);
    }
    return () => {
      cancelled = true;
      clearInterval(interval);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility);
      }
    };
  }, []);

  return badges;
}

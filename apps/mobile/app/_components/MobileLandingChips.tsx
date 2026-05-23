'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { deskApi } from '../_lib/desk-api';

// Mirror of EMPTY_SUGGESTIONS from apps/web/app/_components/ChatSurface.tsx,
// translated into Chinese for mobile owners. Tap → /chat?prompt=<chip>.
const LANDING_CHIPS: ReadonlyArray<string> = [
  '看一下收件请求',
  '团队里都有谁？',
  '最近交付了哪些？',
  '今天有什么任务？',
];

interface Micro {
  active_jobs: number;
  delivered_overnight: number;
}

interface JobRow { status: 'queued' | 'running' | 'completed' | 'failed' }
interface JobsApi { items: JobRow[] }
interface DelivRow { created_at?: string; status?: string }
interface DelivApi { items: DelivRow[] }

const OVERNIGHT_MS = 12 * 60 * 60 * 1000;

export function MobileLandingChips() {
  const router = useRouter();
  const [micro, setMicro] = useState<Micro | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [jobsRes, delivRes] = await Promise.all([
          fetch(deskApi('/api/v1/jobs'), { cache: 'no-store' }),
          fetch(deskApi('/api/v1/deliverables'), { cache: 'no-store' }),
        ]);
        if (!jobsRes.ok || !delivRes.ok) return;
        const jobs = (await jobsRes.json()) as JobsApi;
        const deliv = (await delivRes.json()) as DelivApi;
        const active = jobs.items.filter((j) => j.status === 'running' || j.status === 'queued').length;
        const cutoff = Date.now() - OVERNIGHT_MS;
        const overnight = deliv.items.filter((d) => {
          if (!d.created_at) return false;
          const t = Date.parse(d.created_at);
          return Number.isFinite(t) && t >= cutoff;
        }).length;
        if (!cancelled) setMicro({ active_jobs: active, delivered_overnight: overnight });
      } catch {
        // Desk BFF offline / proxy not wired — landing still shows brand + chips.
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  const microLine = micro && (micro.active_jobs > 0 || micro.delivered_overnight > 0)
    ? `${micro.active_jobs} 个任务在跑 · 过去 12 小时交付 ${micro.delivered_overnight} 项`
    : null;

  return (
    <>
      {microLine && (
        <p className="landing-micro" aria-live="polite">{microLine}</p>
      )}
      <div className="landing-chips" role="list" aria-label="Suggested prompts">
        {LANDING_CHIPS.map((chip) => (
          <button
            key={chip}
            type="button"
            role="listitem"
            className="landing-chip"
            onClick={() => router.push(`/chat/?prompt=${encodeURIComponent(chip)}`)}
          >
            {chip}
          </button>
        ))}
      </div>
    </>
  );
}

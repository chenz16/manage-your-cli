'use client';

// M-L-017 / M-L-021 · today-strip on /chat. Always renders: top line is
// a permanent MetricsBar (date · active staff · 交付). When jobs exist,
// adds a collapsible second line ("X 执行中 [全部 →]") that expands to
// 3 active-job rows. Mibusy MetricsBar + TodayFeed pattern.

import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { deskFetch } from '../_lib/desk-cache';

interface JobRow {
  id: string;
  staff_id: string;
  brief: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  created_at: string;
}

interface Summary {
  active_staff: number;
  running: number;
  queued: number;
  delivered_today: number;
  jobs: ReadonlyArray<JobRow>;
}

const ACTIVE: ReadonlyArray<JobRow['status']> = ['queued', 'running'];

function formatDate(d: Date): string {
  // "5月18日 周日" — mibusy MetricsBar header style.
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const w = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()] ?? '';
  return `${m}月${day}日 ${w}`;
}

// M-L-043 — handle exposed via ref so /chat's PullToRefresh can re-trigger
// the strip's load() on pull-down (the chat surface owns the gesture wrapper).
export interface TodayStripHandle {
  refresh: () => Promise<void>;
}

export const TodayStrip = forwardRef<TodayStripHandle>(function TodayStrip(_props, ref) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [open, setOpen] = useState(false);
  // M-L-044 — surface desk-unreachable instead of silently presenting stale
  // numbers as current. On fetch failure we keep last-known summary but flag
  // it stale so the metrics row shows a "·读取桌面失败" affordance; the owner
  // must not read 0/stale as real (no-silent-failure, owner-trust POV).
  const [stale, setStale] = useState(false);

  // M-L-066 — read jobs/staff through the shared dedupe cache so /chat's
  // 3 concurrent consumers coalesce to one request per endpoint. `force`
  // bypasses the TTL for pull-to-refresh (owner expects fresh numbers).
  const load = useCallback(async (force = false) => {
    try {
      const [jr, sr, dr] = await Promise.all([
        deskFetch<{ items: JobRow[] }>('/api/v1/jobs', { force }),
        deskFetch<{ items: { status?: string }[] }>('/api/v1/staff', { force }),
        deskFetch<{ items: { created_at?: string }[] }>('/api/v1/deliverables', { force }),
      ]);
      if (!jr.ok || !sr.ok || !dr.ok) {
        throw new Error(`desk unreachable: jobs=${jr.status} staff=${sr.status} deliverables=${dr.status}`);
      }
      const jb = jr.data ?? { items: [] };
      const sb = sr.data ?? { items: [] };
      const db = dr.data ?? { items: [] };
      const jobs = (jb.items || []).filter((j) => ACTIVE.includes(j.status));
      const today = new Date().toISOString().slice(0, 10);
      const delivered_today = (db.items || []).filter((d) => (d.created_at ?? '').slice(0, 10) === today).length;
      setSummary({
        active_staff: (sb.items || []).filter((s) => s.status === 'active').length,
        running: jobs.filter((j) => j.status === 'running').length,
        queued: jobs.filter((j) => j.status === 'queued').length,
        delivered_today,
        jobs,
      });
      setStale(false);
    } catch {
      // Don't surface stale numbers as current — flag the row instead of
      // swallowing. Last-known summary stays so layout doesn't jump.
      setStale(true);
    }
  }, []);

  useImperativeHandle(ref, () => ({ refresh: () => load(true) }), [load]);

  // M-L-063 — battery/data: pause polling while the tab is hidden (phone
  // locked / app backgrounded) so we stop waking the radio for 3 no-store
  // fetches every cycle. Re-arm + load immediately on visible. Cadence backed
  // off 8s→15s (delivered-today/active-staff change slowly). Mirrors
  // useTabBadges' visibility gating, but here we also clear the interval.
  useEffect(() => {
    let h: ReturnType<typeof setInterval> | null = null;

    const stop = () => {
      if (h !== null) { clearInterval(h); h = null; }
    };
    const start = () => {
      if (h === null) h = setInterval(load, 15000);
    };
    const onVisibility = () => {
      if (typeof document !== 'undefined' && document.hidden) {
        stop();
      } else {
        void load();
        start();
      }
    };

    void load();
    if (typeof document === 'undefined' || !document.hidden) start();
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility);
    }
    return () => {
      stop();
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility);
      }
    };
  }, [load]);

  const dateStr = formatDate(new Date());
  const active = summary ? summary.running + summary.queued : 0;
  const hasDetail = active > 0;
  const ChevIcon = open ? ChevronDown : ChevronRight;

  return (
    <div className={open ? 't-strip t-strip-open' : 't-strip'}>
      <div className="t-strip-metrics">
        <span className="t-strip-date">{dateStr}</span>
        <span className="t-strip-stats">
          <span className="t-strip-stat">
            <strong>{summary?.active_staff ?? '·'}</strong>
            <span className="muted"> 在岗</span>
          </span>
          <span className="t-strip-stat">
            <strong>{active}</strong>
            <span className="muted"> 执行中</span>
          </span>
          <span className="t-strip-stat">
            <strong>{summary?.delivered_today ?? 0}</strong>
            <span className="muted"> 交付</span>
          </span>
          {stale && (
            <span className="t-strip-stale" role="status" title="无法读取桌面，下方数字可能已过期">
              ·读取桌面失败
            </span>
          )}
        </span>
      </div>

      {hasDetail && (
        <button
          type="button"
          className="t-strip-summary"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          <ChevIcon size={14} aria-hidden="true" strokeWidth={2} />
          <span className="t-strip-summary-text muted">
            {open ? '收起在跑任务' : `展开 ${active} 个在跑任务`}
          </span>
          <a className="t-strip-link" href="/today/" onClick={(e) => e.stopPropagation()}>全部 →</a>
        </button>
      )}

      {open && summary && summary.jobs.length > 0 && (
        <ul className="t-strip-list">
          {summary.jobs.slice(0, 3).map((j) => (
            <li key={j.id} className="t-strip-row" data-status={j.status}>
              <span className={`t-strip-dot t-strip-dot-${j.status}`} aria-hidden="true" />
              <span className="t-strip-brief">{j.brief}</span>
              <span className="t-strip-staff muted">{j.staff_id.slice(-4)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});

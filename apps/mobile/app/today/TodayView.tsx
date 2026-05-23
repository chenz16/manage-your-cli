'use client';

import { useCallback, useEffect, useState } from 'react';
import { JobCard } from './_components/JobCard';
import { PullToRefresh } from '../_components/PullToRefresh';
import type { JobRow, JobsApiResponse } from './_components/types';
import { fetchWithTimeout } from '../_lib/fetch-timeout';

type LoadState =
  | { status: 'loading' }
  | { status: 'ok'; jobs: JobRow[]; names: Map<string, string>; dispatcher: boolean | null; fetched_at: string }
  | { status: 'error'; message: string };

const ACTIVE_STATUSES: ReadonlyArray<JobRow['status']> = ['queued', 'running'];

export function TodayView() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  const load = useCallback(async () => {
    try {
      // Fetch jobs + staff together so JobCard can show *who* is on a job
      // (M-L-040) — same /api/v1/staff source TodayStrip uses.
      const [r, sr] = await Promise.all([
        fetchWithTimeout('/api/v1/jobs'),
        fetchWithTimeout('/api/v1/staff'),
      ]);
      if (!r.ok) throw new Error(`GET /api/v1/jobs → ${r.status}`);
      const body: JobsApiResponse = await r.json();
      const sb = sr.ok ? (await sr.json() as { items?: { id: string; name?: string }[] }) : { items: [] };
      const names = new Map<string, string>(
        (sb.items ?? []).filter((s) => s.name).map((s) => [s.id, s.name as string]),
      );
      // Plan calls for /api/v1/jobs?active=true; desk BFF does not honor
      // that filter today, so partition client-side (mobile is consumer-
      // only — pushing a filter into desk-side is an M-G-NNN delta).
      const jobs = body.items
        .filter((j) => ACTIVE_STATUSES.includes(j.status))
        .sort((a, b) => (b.created_at).localeCompare(a.created_at));
      setState({
        status: 'ok',
        jobs,
        names,
        dispatcher: body.dispatcher?.running ?? null,
        fetched_at: new Date().toLocaleTimeString(),
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setState({ status: 'error', message });
    }
  }, []);

  // M-L-064 — battery/data: this was the most aggressive poll in the app
  // (4s → 900 req/hr/endpoint while foregrounded-idle, and it kept firing
  // when backgrounded). Pause polling while the tab is hidden (phone locked /
  // app backgrounded) and re-arm + load immediately on visible. Cadence
  // backed off 4s→10s — job status changes far slower than 4s. Mirrors
  // TodayStrip's visibility gating (M-L-063).
  useEffect(() => {
    let h: ReturnType<typeof setInterval> | null = null;

    const stop = () => {
      if (h !== null) { clearInterval(h); h = null; }
    };
    const start = () => {
      if (h === null) h = setInterval(() => void load(), 10000);
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

  return (
    <PullToRefresh onRefresh={load}>
    <div className="mobile-shell">
      <header className="mobile-header">
        <div className="mobile-brand">今日</div>
        <div className="mobile-subtitle">
          在跑任务 · {state.status === 'ok'
            ? `${state.jobs.length} 活跃 · 调度 ${state.dispatcher === null ? '?' : state.dispatcher ? '● 运行中' : '○ 已停'}`
            : '加载中…'}
        </div>
      </header>

      <section className="mobile-section">
        {state.status === 'loading' && (
          <div className="m-card"><p className="muted">加载 /api/v1/jobs…</p></div>
        )}

        {state.status === 'error' && (
          <div className="m-card">
            <p>读取桌面 BFF 失败</p>
            <p className="muted">{state.message}</p>
            <button type="button" className="m-btn" onClick={() => void load()}>重试</button>
          </div>
        )}

        {state.status === 'ok' && state.jobs.length === 0 && (
          // M-L-009 — work-tool empty state: explains *what causes work to
          // appear here* + one concrete next-action chip. No chat-app phrasing.
          <div className="m-card m-empty-card">
            <div className="m-empty-title">暂无在跑任务</div>
            <p className="m-empty-hint">
              在聊天里给桌面 AI 下指令 · staff 接到任务后会出现在这里
            </p>
            <a className="m-empty-chip" href="/chat/">
              <span>打开聊天</span>
              <span className="m-chev">›</span>
            </a>
          </div>
        )}

        {state.status === 'ok' && state.jobs.length > 0 && (
          <div className="m-list">
            {state.jobs.map((j) => (<JobCard key={j.id} job={j} staffName={state.names.get(j.staff_id)} />))}
          </div>
        )}

        {state.status === 'ok' && (
          <div className="muted m-card-footnote">最近拉取 {state.fetched_at} · 每 10 秒自动刷新（后台暂停）</div>
        )}
      </section>
    </div>
    </PullToRefresh>
  );
}

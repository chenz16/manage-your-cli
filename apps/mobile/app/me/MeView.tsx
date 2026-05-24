'use client';

import { useCallback, useState } from 'react';
import type { OwnerAssistant } from '@holon/api-contract';
import { PullToRefresh } from '../_components/PullToRefresh';
import { VoiceBugReport } from '../_components/VoiceBugReport';
import { deskOrigin } from '../_lib/desk-origin';
import { fetchWithTimeout } from '../_lib/fetch-timeout';
import { useVisiblePoll } from '../_lib/useVisiblePoll';

type LoadState =
  | { status: 'loading' }
  | { status: 'ok'; owner: OwnerAssistant; fetched_at: string }
  | { status: 'error'; message: string };

const DESK_ORIGIN = deskOrigin();

function formatMc(mc: number | undefined): string {
  if (mc == null) return '—';
  return `$${(mc / 100_000).toFixed(2)}`;
}

export function MeView() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  const load = useCallback(async () => {
    // No setState({ status: 'loading' }) here — the 15s poll would flash the
    // budget meter away every tick. Initial state is already 'loading', so the
    // first load shows it; polls overwrite ok/error in place (mirrors TodayView).
    try {
      const r = await fetchWithTimeout('/api/v1/me');
      if (!r.ok) throw new Error(`GET /api/v1/me → ${r.status}`);
      const owner: OwnerAssistant = await r.json();
      setState({ status: 'ok', owner, fetched_at: new Date().toLocaleTimeString() });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setState({ status: 'error', message });
    }
  }, []);

  // Budget moves slowly — 15s poll. M-L-065 — gated on Page-Visibility so it
  // stops while the phone is locked / app backgrounded (today/staff/inbound
  // share the same useVisiblePoll guard).
  useVisiblePoll(load, 15000);

  return (
    <PullToRefresh onRefresh={load}>
    <div className="mobile-shell">
      <header className="mobile-header">
        <div className="mobile-brand">我</div>
        <div className="mobile-subtitle">桌面人设 · 只读 · 在桌面端切换</div>
      </header>

      <section className="mobile-section">
        {state.status === 'loading' && (
          <div className="m-card"><p className="muted">加载 /api/v1/me…</p></div>
        )}

        {state.status === 'error' && (
          <div className="m-card">
            <p>读取 /api/v1/me 失败</p>
            <p className="muted">{state.message}</p>
            <button type="button" className="m-btn" onClick={() => void load()}>重试</button>
          </div>
        )}

        {state.status === 'ok' && (
          <>
            <div className="m-card">
              <div className="m-card-title">{state.owner.owner_name || state.owner.name}</div>
              {state.owner.owner_role && (
                <div className="m-card-sub">{state.owner.owner_role}</div>
              )}
              {state.owner.owner_intro && (
                <p className="m-card-body">{state.owner.owner_intro}</p>
              )}
              <a
                className="m-row-link"
                href={`${DESK_ORIGIN}/me`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <span>在桌面端切换人设</span>
                <span className="m-chev">›</span>
              </a>
            </div>

            <div className="m-card">
              <div className="m-card-title">反馈</div>
              <p className="m-card-body muted">遇到问题？说出来，小秘会帮你记录并跟进。</p>
              <VoiceBugReport />
            </div>

            <BudgetMeter
              cap_mc={state.owner.monthly_budget_mc}
              fetched_at={state.fetched_at}
              onRefresh={() => void load()}
            />
          </>
        )}
      </section>
    </div>
    </PullToRefresh>
  );
}

function BudgetMeter({
  cap_mc,
  fetched_at,
  onRefresh,
}: {
  cap_mc: number | undefined;
  fetched_at: string;
  onRefresh: () => void;
}) {
  // mtd_mc for the owner is not yet exposed by a desk BFF route in V1
  // (per-staff `/api/v1/staff/:id/cost` exists, but the owner_assistant
  // is not a staff record). Surface the cap honestly; show MTD as
  // "pending" with a refresh that re-fetches /me when desk adds the
  // aggregate endpoint.
  const mtd_mc: number | undefined = undefined;
  const pct = cap_mc && cap_mc > 0 && mtd_mc != null
    ? Math.min(100, Math.round((mtd_mc / cap_mc) * 100))
    : 0;
  return (
    <div className="m-card">
      <div className="m-card-title">月度预算</div>
      <div className="m-meter">
        <div className="m-meter-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="m-meter-legend">
        <span>{formatMc(mtd_mc)} <span className="muted">本月已用</span></span>
        <span>{formatMc(cap_mc)} <span className="muted">上限</span></span>
      </div>
      <div className="muted m-card-footnote">
        owner 维度的 MTD 汇总等桌面端落地端点 · 最近一次拉取 {fetched_at}。
      </div>
      <button type="button" className="m-btn" onClick={onRefresh}>刷新</button>
    </div>
  );
}

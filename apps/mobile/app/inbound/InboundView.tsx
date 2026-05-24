'use client';

// M-L-012 — /inbound mobile surface. Read-only V1 view of peer missions
// awaiting owner approval. Per docs/mobile-architecture-principles.md
// Principle 1 (thin client): no Accept/Reject here, that's V2 + desk-only.
// Deep-link CTA to desk /inbound for triage.

import { useCallback, useState } from 'react';
import type { Mission } from '@holon/api-contract';

// ListMissionsResponse is not in api-contract — use an inline type
type ListMissionsResponse = { items: Mission[] };
import { PullToRefresh } from '../_components/PullToRefresh';
import { deskOrigin } from '../_lib/desk-origin';
import { fetchWithTimeout } from '../_lib/fetch-timeout';
import { useVisiblePoll } from '../_lib/useVisiblePoll';

const DESK_ORIGIN = deskOrigin();

// V1 mobile shows missions still waiting on the owner (queued). Other
// states (accepted/in_progress/blocked/...) belong on /today or the
// desk-side inbound view.
const AWAITING_STATES: ReadonlyArray<Mission['state']> = ['queued'];

type LoadState =
  | { status: 'loading' }
  | { status: 'ok'; items: Mission[]; fetched_at: string }
  | { status: 'error'; message: string };

export function InboundView() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  const load = useCallback(async () => {
    try {
      const r = await fetchWithTimeout('/api/v1/missions?state=queued');
      if (!r.ok) throw new Error(`GET /api/v1/missions → ${r.status}`);
      const body = (await r.json()) as ListMissionsResponse;
      const items = [...body.items]
        .filter((m) => AWAITING_STATES.includes(m.state))
        .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''));
      setState({ status: 'ok', items, fetched_at: new Date().toLocaleTimeString() });
    } catch (e) {
      setState({ status: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  // M-L-025 — auto-poll like /today + /staff. 10s cadence: peer missions
  // arrive much less frequently than internal jobs, so polling slower is
  // fine and saves desk-BFF round-trips. M-L-065 — gated on visibility so
  // the poll pauses while the phone is locked / app backgrounded.
  useVisiblePoll(load, 10000);

  return (
    <PullToRefresh onRefresh={load}>
    <div className="mobile-shell">
      <header className="mobile-header">
        <div className="mobile-brand">收件</div>
        <div className="mobile-subtitle">
          {state.status === 'ok'
            ? `${state.items.length} 待主人确认 · 只读 · 桌面端 /inbound 处理`
            : state.status === 'loading' ? 'loading…' : 'error'}
        </div>
      </header>

      <section className="mobile-section">
        {state.status === 'loading' && (
          <div className="m-card"><p className="muted">加载 /api/v1/missions…</p></div>
        )}

        {state.status === 'error' && (
          <div className="m-card">
            <p>读取桌面 BFF 失败</p>
            <p className="muted">{state.message}</p>
            <button type="button" className="m-btn" onClick={() => void load()}>重试</button>
          </div>
        )}

        {state.status === 'ok' && state.items.length === 0 && (
          // M-L-009 work-tool empty-state pattern: explain trigger + one
          // concrete next-action chip that deep-links to the desk surface.
          <div className="m-card m-empty-card">
            <div className="m-empty-title">暂无收件请求</div>
            <p className="m-empty-hint">
              V1 期间这里展示其他 desk 经主人确认后接收的工作 · V2 解锁同伴协作
            </p>
            <a
              className="m-empty-chip"
              href={`${DESK_ORIGIN}/inbound`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span>在桌面端查看 /inbound</span>
              <span className="m-chev">›</span>
            </a>
          </div>
        )}

        {state.status === 'ok' && state.items.length > 0 && (
          <>
            <div className="m-list">
              {state.items.map((m) => <InboundCard key={m.id} m={m} />)}
            </div>
            <a
              className="m-empty-chip m-inbound-cta"
              href={`${DESK_ORIGIN}/inbound`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span>在桌面端查看 /inbound · 接受 / 拒绝</span>
              <span className="m-chev">›</span>
            </a>
            <div className="muted m-card-footnote">Last polled {state.fetched_at}</div>
          </>
        )}
      </section>
    </div>
    </PullToRefresh>
  );
}

function InboundCard({ m }: { m: Mission }) {
  const ts = m.created_at ? m.created_at.slice(0, 10) : '';
  return (
    <article className="m-card m-inbound-card" data-mission-id={m.id}>
      <div className="m-inbound-top">
        <span className="m-inbound-state">待确认</span>
        <span className="m-inbound-form">{m.form}</span>
        <span className="m-deliv-grow" />
        {ts && <span className="m-deliv-ts">{ts}</span>}
      </div>
      <div className="m-card-title">{m.title}</div>
      <div className="m-card-sub">来自 {m.sender_display_name}</div>
    </article>
  );
}

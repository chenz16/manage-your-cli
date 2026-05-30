'use client';

// M-L-012 — /inbound mobile surface. V2: repointed to the boss-backlog
// /api/v1/todos (status=pending) now that 待分配 supersedes the old missions
// inbox. The former /api/v1/missions + ListMissionsResponse (never existed on
// the CLI desktop BFF) are removed; this component is now a thin alias into
// the same todo store that TodayView leads with.

import { useCallback, useState } from 'react';
import type { Todo } from '@holon/api-contract';
import { PullToRefresh } from '../_components/PullToRefresh';
import { holonApiFetch } from '../_lib/mobile-runtime';
import { useVisiblePoll } from '../_lib/useVisiblePoll';

type LoadState =
  | { status: 'loading' }
  | { status: 'ok'; items: Todo[]; fetched_at: string }
  | { status: 'error'; message: string };

export function InboundView() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  const load = useCallback(async () => {
    try {
      const r = await holonApiFetch('/api/v1/todos');
      if (!r.ok) throw new Error(`GET /api/v1/todos → ${r.status}`);
      const body = (await r.json()) as { items?: Todo[] };
      const items = (body.items ?? [])
        .filter((t) => t.status === 'pending')
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
      setState({ status: 'ok', items, fetched_at: new Date().toLocaleTimeString() });
    } catch (e) {
      setState({ status: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  useVisiblePoll(load, 10000);

  return (
    <PullToRefresh onRefresh={load}>
      <div className="mobile-shell">
        <header className="mobile-header">
          <div className="mobile-brand">收件</div>
          <div className="mobile-subtitle">
            {state.status === 'ok'
              ? `${state.items.length} 待分配`
              : state.status === 'loading' ? 'loading…' : 'error'}
          </div>
        </header>

        <section className="mobile-section">
          {state.status === 'loading' && (
            <div className="m-card"><p className="muted">加载待分配…</p></div>
          )}

          {state.status === 'error' && (
            <div className="m-card">
              <p>读取失败</p>
              <p className="muted">{state.message}</p>
              <button type="button" className="m-btn" onClick={() => void load()}>重试</button>
            </div>
          )}

          {state.status === 'ok' && state.items.length === 0 && (
            <div className="m-card m-empty-card">
              <div className="m-empty-title">暂无待分配的活</div>
              <p className="m-empty-hint">在"今日"标签里添加要派的活</p>
              <a className="m-empty-chip" href="/today/">
                <span>去今日</span>
                <span className="m-chev">›</span>
              </a>
            </div>
          )}

          {state.status === 'ok' && state.items.length > 0 && (
            <>
              <div className="m-list">
                {state.items.map((t) => (
                  <article key={t.id} className="m-card m-inbound-card">
                    <div className="m-inbound-top">
                      <span className="m-inbound-state">待分配</span>
                      <span className="m-deliv-grow" />
                      <span className="m-deliv-ts">{t.created_at.slice(0, 10)}</span>
                    </div>
                    <div className="m-card-title">{t.text}</div>
                  </article>
                ))}
              </div>
              <div className="muted m-card-footnote">Last polled {state.fetched_at}</div>
            </>
          )}
        </section>
      </div>
    </PullToRefresh>
  );
}

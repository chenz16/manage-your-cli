'use client';

import { useCallback, useEffect, useState } from 'react';
import type {
  Deliverable,
  GetDeliverableResponse,
  ListDeliverablesResponse,
} from '@holon/api-contract';
import { DeliverableCard } from './_components/DeliverableCard';
import { PullToRefresh } from '../_components/PullToRefresh';
import { deskOrigin } from '../_lib/desk-origin';
import { fetchWithTimeout } from '../_lib/fetch-timeout';

const DESK_ORIGIN = deskOrigin();

export const STATUS_LABEL: Record<Deliverable['status'], string> = {
  draft: 'Draft', final: 'Final', accepted: 'Accepted', rejected: 'Rejected', revised: 'Revised',
};
export const ORIGIN_ICON: Record<Deliverable['origin_label'], string> = {
  local: '🤖', remote: '📥', submitted: '📤',
};

// M-L-039 — the deliverable detail is the payoff surface: the owner opens
// their actual work product. Markdown renders as text (unchanged). Structured
// bodies (table/chart/slides/…) used to dump raw JSON.stringify here, which
// reads as a machine error, not work. Instead we recognise the structured
// kind, show a one-line labelled summary, and deep-link to the desk where the
// content renders in full. Mobile is a thin client; full structured rendering
// stays desk-side.
type BodyView =
  | { kind: 'markdown'; text: string }
  | { kind: 'empty' }
  | { kind: 'structured'; label: string; summary: string };

function structuredSummary(b: Record<string, unknown>): { label: string; summary: string } {
  const explicit = typeof b.kind === 'string' ? b.kind : undefined;
  const rows = Array.isArray(b.rows) ? b.rows.length : undefined;
  const cols = Array.isArray(b.columns)
    ? b.columns.length
    : rows !== undefined && Array.isArray(b.rows) && b.rows[0] && typeof b.rows[0] === 'object'
      ? Object.keys(b.rows[0] as object).length
      : undefined;
  const slides = Array.isArray(b.slides) ? b.slides.length : undefined;
  const series = Array.isArray(b.series)
    ? b.series.length
    : Array.isArray(b.datasets) ? b.datasets.length : undefined;

  if (explicit === 'table' || rows !== undefined) {
    const parts = [rows !== undefined ? `${rows} 行` : null, cols !== undefined ? `${cols} 列` : null].filter(Boolean);
    return { label: '📊 表格', summary: parts.length ? parts.join(' × ') : '结构化表格数据' };
  }
  if (explicit === 'chart' || series !== undefined || 'chart' in b) {
    return { label: '📈 图表', summary: series !== undefined ? `${series} 个数据系列` : '可视化图表数据' };
  }
  if (explicit === 'slides' || slides !== undefined) {
    return { label: '🖼 幻灯片', summary: slides !== undefined ? `${slides} 张` : '幻灯片内容' };
  }
  return { label: '📦 结构化内容', summary: `${Object.keys(b).length} 个字段` };
}

function bodyView(d: Deliverable): BodyView {
  const b = d.body;
  if (b && typeof b === 'object' && 'markdown' in b) return { kind: 'markdown', text: (b as { markdown: string }).markdown };
  if (b && typeof b === 'object') return { kind: 'structured', ...structuredSummary(b as Record<string, unknown>) };
  return { kind: 'empty' };
}

type ListState =
  | { status: 'loading' }
  | { status: 'ok'; items: Deliverable[] }
  | { status: 'error'; message: string };

export function DeliverablesView() {
  const [state, setState] = useState<ListState>({ status: 'loading' });
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetchWithTimeout('/api/v1/deliverables');
      if (!r.ok) throw new Error(`GET /api/v1/deliverables → ${r.status}`);
      const body = (await r.json()) as ListDeliverablesResponse;
      const items = [...body.items].sort((a, b) =>
        (b.created_at ?? '').localeCompare(a.created_at ?? ''),
      );
      setState({ status: 'ok', items });
    } catch (e) {
      setState({ status: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (openId !== null) return <Detail id={openId} onClose={() => setOpenId(null)} />;

  return (
    <PullToRefresh onRefresh={load}>
    <div className="mobile-shell">
      <header className="mobile-header">
        <div className="mobile-brand">交付</div>
        <div className="mobile-subtitle">
          {state.status === 'ok'
            ? `${state.items.length} 件产出`
            : state.status === 'loading' ? '加载中…' : '错误'}
        </div>
      </header>

      <section className="mobile-section">
        {state.status === 'loading' && (
          <div className="m-card"><p className="muted">加载 /api/v1/deliverables…</p></div>
        )}
        {state.status === 'error' && (
          <div className="m-card">
            <p>读取桌面 BFF 失败</p>
            <p className="muted">{state.message}</p>
            <button type="button" className="m-btn" onClick={() => void load()}>重试</button>
          </div>
        )}
        {state.status === 'ok' && state.items.length === 0 && (
          // M-L-009 — work-tool empty state: explains *what causes deliverables
          // to appear* + chip with one concrete next action. NOT chat-app phrasing.
          <div className="m-card m-empty-card">
            <div className="m-empty-title">暂无交付物</div>
            <p className="m-empty-hint">
              staff 完成工作后产出的文件 · 表格 · PDF · 图表会汇集到这里
            </p>
            <a className="m-empty-chip" href="/chat/">
              <span>在工作台下指令</span>
              <span className="m-chev">›</span>
            </a>
          </div>
        )}
        {state.status === 'ok' && state.items.length > 0 && (
          <div className="m-list">
            {state.items.map((d) => <DeliverableCard key={d.id} d={d} onOpen={setOpenId} />)}
          </div>
        )}
      </section>
    </div>
    </PullToRefresh>
  );
}

type DetailState =
  | { status: 'loading' }
  | { status: 'ok'; d: Deliverable }
  | { status: 'error'; message: string };

function Detail({ id, onClose }: { id: string; onClose: () => void }) {
  const [s, setS] = useState<DetailState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    fetchWithTimeout(`/api/v1/deliverables/${id}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`BFF ${r.status}`);
        const j = (await r.json()) as GetDeliverableResponse;
        if (!cancelled) setS({ status: 'ok', d: j.deliverable });
      })
      .catch((e: unknown) => {
        if (!cancelled) setS({ status: 'error', message: e instanceof Error ? e.message : String(e) });
      });
    return () => { cancelled = true; };
  }, [id]);

  return (
    <div className="mobile-shell m-deliv-detail-shell">
      <header className="mobile-header m-deliv-detail-header">
        <button type="button" className="m-deliv-back" onClick={onClose} aria-label="返回列表">‹ 返回</button>
        <div className="m-deliv-detail-title-wrap">
          <div className="mobile-brand m-deliv-detail-title">
            {s.status === 'ok' ? s.d.title : s.status === 'loading' ? '加载中…' : '错误'}
          </div>
          {s.status === 'ok' && (
            <div className="mobile-subtitle">
              <span className={`m-deliv-status m-deliv-status-${s.d.status}`}>{STATUS_LABEL[s.d.status]}</span>
              <span className="m-deliv-detail-origin">{ORIGIN_ICON[s.d.origin_label]} {s.d.origin_label}</span>
              {s.d.created_at && <span> · {s.d.created_at.slice(0, 10)}</span>}
            </div>
          )}
        </div>
      </header>

      <section className="mobile-section m-deliv-detail-body">
        {s.status === 'loading' && (<div className="m-card"><p className="muted">加载中…</p></div>)}
        {s.status === 'error' && (
          <div className="m-card">
            <p>读取交付物失败</p>
            <p className="muted">{s.message}</p>
            <button type="button" className="m-btn" onClick={onClose}>返回</button>
          </div>
        )}
        {s.status === 'ok' && (() => {
          const v = bodyView(s.d);
          if (v.kind === 'markdown') return <article className="m-deliv-body">{v.text}</article>;
          if (v.kind === 'empty') return <article className="m-deliv-body muted">(暂无内容)</article>;
          return (
            <div className="m-card m-empty-card">
              <div className="m-empty-title">{v.label}</div>
              <p className="m-empty-hint">{v.summary} · 此类内容手机端暂不支持完整渲染</p>
              <a
                className="m-empty-chip"
                href={`${DESK_ORIGIN}/deliverables`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <span>在桌面端打开查看完整内容</span>
                <span className="m-chev">›</span>
              </a>
            </div>
          );
        })()}
      </section>
    </div>
  );
}

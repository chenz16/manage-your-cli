'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Todo } from '@holon/api-contract';
import { JobCard } from './_components/JobCard';
import { PullToRefresh } from '../_components/PullToRefresh';
import type { JobRow, JobsApiResponse } from './_components/types';
import { holonApiFetch } from '../_lib/mobile-runtime';
import { fetchWithTimeout } from '../_lib/fetch-timeout';

/* ── Todo section state ─────────────────────────────────────── */
type TodosState =
  | { status: 'loading' }
  | { status: 'ok'; items: Todo[] }
  | { status: 'error'; message: string };

/* ── Jobs section state ─────────────────────────────────────── */
type JobsState =
  | { status: 'loading' }
  | { status: 'ok'; jobs: JobRow[]; names: Map<string, string>; fetched_at: string }
  | { status: 'error'; message: string };

const ACTIVE_STATUSES: ReadonlyArray<JobRow['status']> = ['queued', 'running'];

export function TodayView() {
  const [todosState, setTodosState] = useState<TodosState>({ status: 'loading' });
  const [jobsState, setJobsState] = useState<JobsState>({ status: 'loading' });

  // Add input state
  const [addText, setAddText] = useState('');
  const [adding, setAdding] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  /* ── Todos loader ──────────────────────────────────────────── */
  const loadTodos = useCallback(async () => {
    try {
      const r = await holonApiFetch('/api/v1/todos');
      if (!r.ok) throw new Error(`GET /api/v1/todos → ${r.status}`);
      const body = (await r.json()) as { items?: Todo[] };
      setTodosState({ status: 'ok', items: body.items ?? [] });
    } catch (e) {
      setTodosState({ status: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  /* ── Jobs loader ───────────────────────────────────────────── */
  const loadJobs = useCallback(async () => {
    try {
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
      const jobs = body.items
        .filter((j) => ACTIVE_STATUSES.includes(j.status))
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
      setJobsState({ status: 'ok', jobs, names, fetched_at: new Date().toLocaleTimeString() });
    } catch (e) {
      setJobsState({ status: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  const loadAll = useCallback(() => {
    void loadTodos();
    void loadJobs();
  }, [loadTodos, loadJobs]);

  /* ── Poll ─────────────────────────────────────────────────── */
  useEffect(() => {
    let h: ReturnType<typeof setInterval> | null = null;
    const stop = () => { if (h !== null) { clearInterval(h); h = null; } };
    const start = () => { if (h === null) h = setInterval(loadAll, 10000); };
    const onVisibility = () => {
      if (typeof document !== 'undefined' && document.hidden) {
        stop();
      } else {
        loadAll();
        start();
      }
    };
    loadAll();
    if (typeof document === 'undefined' || !document.hidden) start();
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [loadAll]);

  /* ── Add todo ─────────────────────────────────────────────── */
  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = addText.trim();
    if (!text) return;
    setAdding(true);
    try {
      const r = await holonApiFetch('/api/v1/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!r.ok) throw new Error(`POST /api/v1/todos → ${r.status}`);
      setAddText('');
      await loadTodos();
    } catch (e) {
      console.error('[TodayView] addTodo failed', e);
    } finally {
      setAdding(false);
      inputRef.current?.focus();
    }
  };

  /* ── Todo actions ─────────────────────────────────────────── */
  const patchTodo = async (id: string, patch: { status?: Todo['status']; text?: string }) => {
    try {
      const r = await holonApiFetch(`/api/v1/todos/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!r.ok) throw new Error(`PATCH /api/v1/todos/${id} → ${r.status}`);
      await loadTodos();
    } catch (e) {
      console.error('[TodayView] patchTodo failed', e);
    }
  };

  const removeTodo = async (id: string) => {
    try {
      const r = await holonApiFetch(`/api/v1/todos/${id}`, { method: 'DELETE' });
      if (!r.ok && r.status !== 404) throw new Error(`DELETE /api/v1/todos/${id} → ${r.status}`);
      await loadTodos();
    } catch (e) {
      console.error('[TodayView] deleteTodo failed', e);
    }
  };

  /* ── Derived lists ─────────────────────────────────────────── */
  const allTodos = todosState.status === 'ok' ? todosState.items : [];
  const pending = allTodos.filter((t) => t.status === 'pending');
  const delegated = allTodos.filter((t) => t.status === 'delegated');
  const done = allTodos.filter((t) => t.status === 'done');

  const delivTotal = pending.length + delegated.length + done.length;

  return (
    <PullToRefresh onRefresh={loadAll}>
      <div className="mobile-shell">
        <header className="mobile-header">
          <div className="mobile-brand">今日</div>
          <div className="mobile-subtitle">待分配的活 · 进行中 · 交付</div>
        </header>

        {/* ─── 待分配 (top, biggest) ──────────────────────────── */}
        <section className="mobile-section">
          <div className="m-section-label">待分配</div>

          {/* Add input */}
          <form className="m-todo-add-form" onSubmit={(e) => void handleAdd(e)}>
            <input
              ref={inputRef}
              className="m-input m-todo-add-input"
              placeholder="加一件要派的活…"
              value={addText}
              onChange={(e) => setAddText(e.target.value)}
              disabled={adding}
              aria-label="新增待分配"
            />
            <button
              type="submit"
              className="m-btn-primary m-todo-add-btn"
              disabled={adding || !addText.trim()}
            >
              加
            </button>
          </form>

          {todosState.status === 'loading' && (
            <div className="m-card"><p className="muted">加载中…</p></div>
          )}
          {todosState.status === 'error' && (
            <div className="m-card">
              <p className="muted">{todosState.message}</p>
              <button type="button" className="m-btn" onClick={() => void loadTodos()}>重试</button>
            </div>
          )}

          {todosState.status === 'ok' && pending.length === 0 && (
            <div className="m-card m-empty-card">
              <div className="m-empty-title">暂无待分配的活</div>
              <p className="m-empty-hint">在上面输入要交给小秘的任务</p>
            </div>
          )}

          {todosState.status === 'ok' && pending.length > 0 && (
            <div className="m-list">
              {pending.map((t) => (
                <TodoCard
                  key={t.id}
                  todo={t}
                  onDelegate={() => void patchTodo(t.id, { status: 'delegated' })}
                  onDone={() => void patchTodo(t.id, { status: 'done' })}
                  onDelete={() => void removeTodo(t.id)}
                />
              ))}
            </div>
          )}
        </section>

        {/* ─── 进行中 (jobs + delegated todos, compact) ──────── */}
        <section className="mobile-section">
          <div className="m-section-label m-section-label-sm">进行中</div>

          {jobsState.status === 'loading' && (
            <div className="m-card m-compact"><p className="muted" style={{ fontSize: 13 }}>加载任务…</p></div>
          )}
          {jobsState.status === 'error' && (
            <div className="m-card m-compact"><p className="muted" style={{ fontSize: 13 }}>{jobsState.message}</p></div>
          )}

          {delegated.length > 0 && (
            <div className="m-list">
              {delegated.map((t) => (
                <div key={t.id} className="m-card m-compact m-todo-delegated">
                  <span className="m-delegated-badge">已派</span>
                  <span className="m-card-title" style={{ fontSize: 14 }}>{t.text}</span>
                  <button
                    type="button"
                    className="m-btn-ghost m-todo-action"
                    onClick={() => void patchTodo(t.id, { status: 'done' })}
                    title="完成"
                  >完成</button>
                </div>
              ))}
            </div>
          )}

          {jobsState.status === 'ok' && jobsState.jobs.length > 0 && (
            <div className="m-list">
              {jobsState.jobs.map((j) => (
                <JobCard key={j.id} job={j} staffName={jobsState.names.get(j.staff_id)} />
              ))}
            </div>
          )}

          {jobsState.status === 'ok' && jobsState.jobs.length === 0 && delegated.length === 0 && (
            <div className="m-card m-compact">
              <p className="muted" style={{ fontSize: 13 }}>暂无进行中的任务</p>
            </div>
          )}

          {jobsState.status === 'ok' && (
            <div className="muted m-card-footnote">最近拉取 {jobsState.fetched_at}</div>
          )}
        </section>

        {/* ─── 交付 (de-emphasized, count + link) ──────────────── */}
        <section className="mobile-section">
          <div className="m-section-label m-section-label-sm m-section-label-muted">交付</div>
          <div className="m-card m-compact m-deliverables-link-card">
            <a href="/deliverables/" className="m-deliverables-link">
              <span className="muted" style={{ fontSize: 13 }}>
                {done.length > 0 ? `${done.length} 已完成` : '0 已完成'}
                {delivTotal > 0 ? ` · ${delivTotal} 共` : ''}
              </span>
              <span className="muted" style={{ fontSize: 13 }}>· 交付物 <span className="m-chev">›</span></span>
            </a>
          </div>
        </section>
      </div>
    </PullToRefresh>
  );
}

/* ── TodoCard ──────────────────────────────────────────────── */
function TodoCard({
  todo,
  onDelegate,
  onDone,
  onDelete,
}: {
  todo: Todo;
  onDelegate: () => void;
  onDone: () => void;
  onDelete: () => void;
}) {
  return (
    <article className="m-card m-todo-card" data-todo-id={todo.id}>
      <div className="m-todo-text">{todo.text}</div>
      <div className="m-todo-actions">
        <button type="button" className="m-btn-secondary m-todo-action" onClick={onDelegate}>
          派给小秘
        </button>
        <button type="button" className="m-btn-ghost m-todo-action" onClick={onDone}>
          完成
        </button>
        <button type="button" className="m-btn-ghost m-todo-action m-todo-delete" onClick={onDelete}>
          删除
        </button>
      </div>
    </article>
  );
}

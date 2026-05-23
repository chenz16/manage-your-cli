'use client';

import { useEffect, useRef, useState } from 'react';

const COLLAPSE_KEY = 'holon-bugqueue-resolved-collapsed-v1';

/**
 * BugQueue — /me Debug section showing all filed bugs + per-bug fix
 * status. Auto-refreshes every 5s while mounted.
 *
 * iter-008 Phase 5. Per user: "给出bug list 和fix状态". The watcher
 * (in @holon/core) handles the actual auto-creation of jobs for the
 * Maintenance staff; this component is read-only + one re-process
 * button.
 */

interface Bug {
  id: string;
  filed_at: string;
  processed: boolean;
  no_dispatch: boolean;
  status?: 'fixed' | 'needs-human' | 'not-reproducible' | 'unknown';
  diagnosis?: string;
  files_changed?: string[];
  job_id?: string;
  job_status?: string;
  deliverable_id?: string;
  description_preview: string;
}

function StatusPill({ bug }: { bug: Bug }) {
  const base = { fontSize: 11, fontWeight: 600, padding: '2px 6px', borderRadius: 4 } as const;
  if (bug.processed) {
    const color = bug.status === 'fixed' ? 'var(--green, #2e7d32)'
      : bug.status === 'not-reproducible' ? 'var(--ink-mute)'
      : bug.status === 'needs-human' ? 'var(--gold, #b58c00)'
      : 'var(--ink-mute)';
    const label = bug.status === 'fixed' ? '✓ fixed'
      : bug.status === 'not-reproducible' ? '— not-repro'
      : bug.status === 'needs-human' ? '⚠ needs-human'
      : 'processed';
    return <span style={{ ...base, color, background: 'var(--bg-alt)' }}>{label}</span>;
  }
  if (bug.no_dispatch) {
    return <span style={{ ...base, color: 'var(--ink-mute)', background: 'var(--bg-alt)' }}>○ not dispatched</span>;
  }
  return <span style={{ ...base, color: 'var(--ink-mute)', background: 'var(--bg-alt)' }}>queued</span>;
}

function isActive(b: Bug): boolean {
  // Active = still in flight (queued / no-dispatch) OR needs human eyes.
  // Resolved = fixed / not-reproducible — these dominate the list over time, so collapse.
  if (!b.processed) return true;
  return b.status === 'needs-human';
}

export function BugQueue() {
  const [items, setItems] = useState<Bug[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const resolvedRef = useRef<HTMLDetailsElement | null>(null);
  const restoredRef = useRef(false);

  async function pull() {
    try {
      const r = await fetch('/api/v1/admin/bugs', { cache: 'no-store' });
      if (!r.ok) { setError(`HTTP ${r.status}`); return; }
      const j = await r.json();
      setItems(j.items ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    void pull();
    const h = setInterval(() => { void pull(); }, 5000);
    return () => clearInterval(h);
  }, []);

  // Restore + persist the resolved-group collapse state. Default = collapsed.
  useEffect(() => {
    const el = resolvedRef.current;
    if (!el || restoredRef.current) return;
    try {
      const saved = localStorage.getItem(COLLAPSE_KEY);
      el.open = saved === 'open';
    } catch { /* localStorage may be unavailable */ }
    restoredRef.current = true;
  }, [items.length]);

  function onResolvedToggle(e: React.SyntheticEvent<HTMLDetailsElement>) {
    try { localStorage.setItem(COLLAPSE_KEY, e.currentTarget.open ? 'open' : 'closed'); }
    catch { /* localStorage may be unavailable */ }
  }

  async function reprocess(id: string) {
    setBusyId(id);
    try {
      await fetch(`/api/v1/admin/bugs/${id}/reprocess`, { method: 'POST' });
      await pull();
    } finally {
      setBusyId(null);
    }
  }

  const active = items.filter(isActive);
  const resolved = items.filter((b) => !isActive(b));

  const renderRow = (b: Bug) => (
    <details key={b.id} style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '8px 12px' }}>
      <summary style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
        <StatusPill bug={b} />
        <code style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--ink-mute)' }}>{b.id.slice(0, 30)}</code>
        <span style={{ flex: 1, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {b.description_preview || '(no description)'}
        </span>
        {b.no_dispatch && !b.processed && (
          <button
            type="button"
            className="btn btn-primary"
            style={{ fontSize: 11, padding: '2px 8px' }}
            onClick={(e) => { e.preventDefault(); void reprocess(b.id); }}
            disabled={busyId === b.id}
            title="Drop _no_dispatch.md so the watcher picks this up"
          >
            {busyId === b.id ? '…' : '▶ dispatch'}
          </button>
        )}
        {b.processed && (
          <button
            type="button"
            className="btn"
            style={{ fontSize: 11, padding: '2px 8px' }}
            onClick={(e) => { e.preventDefault(); void reprocess(b.id); }}
            disabled={busyId === b.id}
            title="Drop _processed.md so the watcher re-queues this bug"
          >
            {busyId === b.id ? '…' : '↻ reprocess'}
          </button>
        )}
      </summary>
      <div style={{ marginTop: 8, fontSize: 12, lineHeight: 1.55, color: 'var(--ink)' }}>
        <div><strong>Filed:</strong> {b.filed_at.replace('T', ' ').slice(0, 19)} UTC</div>
        {b.job_id && (
          <div><strong>Job:</strong> <code style={{ fontFamily: 'monospace' }}>{b.job_id}</code> · {b.job_status}</div>
        )}
        {b.deliverable_id && (
          <div><strong>Deliverable:</strong> <a href="/deliverables" style={{ color: 'var(--green, #2e7d32)' }}>{b.deliverable_id.slice(0, 30)}</a></div>
        )}
        {b.diagnosis && (
          <div style={{ marginTop: 6 }}><strong>Diagnosis:</strong> {b.diagnosis}</div>
        )}
      </div>
    </details>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 12, color: 'var(--ink-mute)' }}>
        Filed bugs auto-assign to the <strong>Maintenance</strong> staff. Status updates every 5s.
        {items.length > 0 && (
          <span style={{ marginLeft: 6 }}>· {active.length} active · {resolved.length} resolved</span>
        )}
        {error && <span style={{ color: 'var(--red, #c0392b)', marginLeft: 6 }}>· {error}</span>}
      </div>
      {items.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--ink-mute)', fontStyle: 'italic', padding: '8px 0' }}>
          No bugs filed yet. Click the red 🐞 in the top Nav (or ⌘/Ctrl+Shift+B) to file one.
        </div>
      ) : (
        <>
          {active.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {active.map(renderRow)}
            </div>
          )}
          {resolved.length > 0 && (
            <details
              ref={resolvedRef}
              onToggle={onResolvedToggle}
              style={{ borderTop: active.length > 0 ? '1px dashed var(--line)' : undefined, paddingTop: active.length > 0 ? 10 : 0 }}
            >
              <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--ink-mute)', userSelect: 'none' }}>
                Resolved · {resolved.length} fixed / not-reproducible (click to expand)
              </summary>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                {resolved.map(renderRow)}
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}

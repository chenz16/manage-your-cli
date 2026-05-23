'use client';

import { useEffect, useState } from 'react';

/**
 * Click-through folder browser modal. Opens off the "Browse…" button
 * next to the Sandbox directory field. Lists subdirs of the current
 * path via /api/v1/admin/fs/list and lets the user navigate up
 * (breadcrumb) or down (click a row), then confirm with "Use this
 * folder". Per bug bug-20260517-200707-wql1smrg.
 */

interface ListResult {
  path: string;
  entries: { name: string; isDir: boolean }[];
  crumbs: { name: string; path: string }[];
}

export function FolderPicker({
  initialPath,
  onPick,
  onClose,
}: {
  initialPath: string;
  onPick: (path: string) => void;
  onClose: () => void;
}) {
  const [cwd, setCwd] = useState(initialPath);
  const [data, setData] = useState<ListResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/v1/admin/fs/list?path=${encodeURIComponent(cwd)}`)
      .then(async (r) => {
        const j = await r.json();
        if (cancelled) return;
        if (!r.ok) {
          setError(typeof j?.error === 'string' ? j.error : `list failed (${r.status})`);
          return;
        }
        setData(j as ListResult);
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [cwd]);

  return (
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
      }}
    >
      <div
        style={{
          background: '#fff', borderRadius: 10, border: '1px solid var(--ink)',
          width: 560, maxWidth: '92vw', maxHeight: '80vh', display: 'flex',
          flexDirection: 'column', overflow: 'hidden',
        }}
      >
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <strong style={{ fontSize: 14 }}>Pick a folder</strong>
          <div style={{ flex: 1 }} />
          <button type="button" className="btn" style={{ fontSize: 12, padding: '4px 10px' }} onClick={onClose}>Cancel</button>
        </div>

        <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--line)', fontSize: 12, color: 'var(--ink-mute)', display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
          {(data?.crumbs ?? []).map((c, i) => (
            <span key={c.path} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <button
                type="button"
                onClick={() => setCwd(c.path)}
                style={{
                  background: 'transparent', border: 'none', padding: '2px 4px', cursor: 'pointer',
                  fontFamily: 'monospace', fontSize: 12, color: 'var(--ink)', textDecoration: 'underline',
                }}
              >{c.name}</button>
              {i < (data?.crumbs?.length ?? 0) - 1 && <span>/</span>}
            </span>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
          {loading && <div style={{ padding: '12px 16px', fontSize: 12, color: 'var(--ink-mute)' }}>Loading…</div>}
          {error && (
            <div style={{ padding: '12px 16px', fontSize: 12, color: 'var(--red, #c0392b)' }}>
              {error}
            </div>
          )}
          {!loading && !error && data && data.entries.length === 0 && (
            <div style={{ padding: '12px 16px', fontSize: 12, fontStyle: 'italic', color: 'var(--ink-mute)' }}>
              (no subfolders)
            </div>
          )}
          {!loading && !error && data?.entries.map((e) => (
            <button
              key={e.name}
              type="button"
              onClick={() => setCwd(`${data.path}${data.path.endsWith('/') ? '' : '/'}${e.name}`)}
              style={{
                width: '100%', textAlign: 'left', background: 'transparent', border: 'none',
                padding: '8px 16px', cursor: 'pointer', fontFamily: 'monospace', fontSize: 13,
                color: 'var(--ink)', borderBottom: '1px solid var(--bg-alt, #f5f5f5)',
              }}
              onMouseOver={(ev) => (ev.currentTarget.style.background = 'var(--bg-alt, #f5f5f5)')}
              onMouseOut={(ev) => (ev.currentTarget.style.background = 'transparent')}
            >
              📁 {e.name}
            </button>
          ))}
        </div>

        <div style={{ padding: '10px 16px', borderTop: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <code style={{ flex: 1, fontFamily: 'monospace', fontSize: 12, color: 'var(--ink-mute)', overflowX: 'auto', whiteSpace: 'nowrap' }}>
            {data?.path ?? cwd}
          </code>
          <button
            type="button"
            className="btn btn-primary"
            style={{ fontSize: 12, padding: '4px 12px' }}
            disabled={!data}
            onClick={() => { if (data) onPick(data.path); }}
          >
            Use this folder
          </button>
        </div>
      </div>
    </div>
  );
}

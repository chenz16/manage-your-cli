'use client';

import { useCallback, useEffect, useState } from 'react';

interface BugItem {
  name: string;
  title: string;
  body: string;
}

/**
 * Bug Report — file an issue from the app; it lands as a markdown file in
 * BUGS_DIR (same convention as bugs/README.md) so Claude scans + fixes it.
 * Lists existing reports newest-first.
 */
export function BugsClient() {
  const [title, setTitle] = useState('');
  const [where, setWhere] = useState('');
  const [saw, setSaw] = useState('');
  const [expected, setExpected] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [items, setItems] = useState<BugItem[]>([]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/bugs');
      const body = (await res.json()) as { items?: BugItem[] };
      setItems(body.items ?? []);
    } catch {
      /* list is best-effort; the form still works */
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function submit() {
    if (!title.trim()) {
      setStatus('Add a one-line title.');
      return;
    }
    setStatus('Filing…');
    try {
      const res = await fetch('/api/v1/bugs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, where, saw, expected }),
      });
      const body = (await res.json()) as { ok?: boolean; name?: string; error?: string };
      if (!res.ok || !body.ok) {
        setStatus(`Failed: ${body.error ?? res.status}`);
        return;
      }
      setStatus(`Filed as ${body.name}. Claude will pick it up.`);
      setTitle('');
      setWhere('');
      setSaw('');
      setExpected('');
      void refresh();
    } catch (err) {
      setStatus(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return (
    <main className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Bug Report</p>
          <h1 className="page-title">File a bug</h1>
          <p className="page-subtitle">
            Describe what went wrong. It is saved as a markdown report Claude scans, turns into a
            tracked task, and fixes.
          </p>
        </div>
      </header>

      <section className="card" style={{ padding: 20, display: 'grid', gap: 14, maxWidth: 760 }}>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={{ fontSize: 13, color: 'var(--ink-mute)' }}>Title (one line)</span>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="CLI window too small" />
        </label>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={{ fontSize: 13, color: 'var(--ink-mute)' }}>Where (page / feature)</span>
          <input className="input" value={where} onChange={(e) => setWhere(e.target.value)} placeholder="/members CLI terminal" />
        </label>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={{ fontSize: 13, color: 'var(--ink-mute)' }}>Saw (what happened)</span>
          <textarea className="input" value={saw} onChange={(e) => setSaw(e.target.value)} rows={3} />
        </label>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={{ fontSize: 13, color: 'var(--ink-mute)' }}>Expected (what you wanted)</span>
          <textarea className="input" value={expected} onChange={(e) => setExpected(e.target.value)} rows={2} />
        </label>
        <div>
          <button type="button" className="btn primary" onClick={submit} disabled={!title.trim()}>
            File bug
          </button>
        </div>
        {status && <p style={{ margin: 0, color: 'var(--ink-mute)', fontSize: 13 }}>{status}</p>}
      </section>

      <section className="card" style={{ padding: 20, display: 'grid', gap: 12, maxWidth: 760, marginTop: 18 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Filed reports ({items.length})</h2>
        {items.length === 0 && (
          <p style={{ margin: 0, color: 'var(--ink-mute)', fontSize: 13 }}>No bugs filed yet.</p>
        )}
        {items.map((b) => (
          <details key={b.name} style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }}>
            <summary style={{ cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>{b.title}</summary>
            <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, color: 'var(--ink-mute)', marginTop: 8 }}>{b.body}</pre>
          </details>
        ))}
      </section>
    </main>
  );
}

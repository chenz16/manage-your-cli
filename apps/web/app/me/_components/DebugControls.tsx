'use client';

import { useState } from 'react';

/**
 * Debug controls for /me — wipes runtime state (chat history, queued
 * jobs, worker-produced deliverables) via POST /api/v1/admin/reset.
 *
 * Per user 2026-05-16 ("配置里面要有一键清除 聊天记录 member 也要有一键
 * 清除等 这样方便调试 产品的时候到时偶关闭掉"). Mock fixtures are
 * read-only baseline — no "clear members" needed since the roster only
 * grows via real hires (not yet implemented).
 *
 * Hide in production by gating on `NEXT_PUBLIC_HOLON_ENABLE_DEBUG`.
 */
export function DebugControls() {
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);

  async function reset() {
    if (!confirm('Wipe chat history + queued jobs + worker deliverables? Mock fixtures stay intact.')) return;
    setBusy(true);
    setLastResult(null);
    try {
      const r = await fetch('/api/v1/admin/reset', { method: 'POST' });
      const j = await r.json();
      setLastResult(`✅ ok · prev session: ${j.bridge?.previous_session_id?.slice(0, 8) ?? '—'} · jobs wiped: ${j.store?.jobs_cleared ?? 0} · deliverables wiped: ${j.store?.deliverables_cleared ?? 0}`);
      // Soft-refresh so the chat panel reflects the wipe.
      window.dispatchEvent(new Event('holon:reset'));
    } catch (e) {
      setLastResult(`❌ failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function fullReload() {
    if (!confirm('Reset then hard-reload the page?')) return;
    setBusy(true);
    try {
      await fetch('/api/v1/admin/reset', { method: 'POST' });
      window.location.reload();
    } catch {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button" onClick={reset} disabled={busy}
          className="btn"
          style={{ borderColor: 'var(--red, #c0392b)', color: 'var(--red, #c0392b)' }}
        >
          🧹 Wipe chat + jobs + worker deliverables
        </button>
        <button
          type="button" onClick={fullReload} disabled={busy}
          className="btn"
          style={{ borderColor: 'var(--red, #c0392b)', color: 'var(--red, #c0392b)' }}
        >
          ♻️ Reset + reload page
        </button>
      </div>
      {lastResult && (
        <div style={{ fontSize: 12, color: 'var(--ink-mute)', fontFamily: 'monospace' }}>
          {lastResult}
        </div>
      )}
      <div style={{ fontSize: 11, color: 'var(--ink-mute)', fontStyle: 'italic' }}>
        Mock data (staff, peer connections, mission inbox) is read-only baseline and stays.
        Hide this whole section in prod by gating on NEXT_PUBLIC_HOLON_ENABLE_DEBUG=1.
      </div>
    </div>
  );
}

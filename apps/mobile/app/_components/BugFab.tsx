'use client';

import { useEffect, useState } from 'react';
import { deskApi } from '../_lib/desk-api';

/**
 * Floating bug-report FAB for the mobile shell. Mobile-tuned subset of
 * the desk's BugReportButton: text-only payload (no screenshot capture
 * in Pass #1 — defer per M002 risk R-3), prepends `[mobile]` so the
 * mobile-dev-daemon picker sees it. POSTs to /api/v1/admin/bugs via
 * next.config.ts rewrite to desk BFF.
 */

export function BugFab() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(ev: KeyboardEvent) {
      if (ev.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  async function submit() {
    const desc = text.trim();
    if (!desc) {
      setResult('❌ 请填写描述');
      return;
    }
    setBusy(true);
    setResult(null);
    const payload = {
      description: `[mobile] ${desc}`,
      url: window.location.href,
      route: window.location.pathname,
      viewport: { w: window.innerWidth, h: window.innerHeight },
      user_agent: navigator.userAgent,
      ts: new Date().toISOString(),
      screenshot_data_url: null,
      screenshot_filename: null,
      screenshots: [],
    };
    try {
      const r = await fetch(deskApi('/api/v1/admin/bugs'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const j = await r.json().catch(() => ({} as { error?: string }));
      if (!r.ok) {
        setResult(`❌ ${j.error ?? `提交失败 (HTTP ${r.status})`}`);
      } else {
        setResult(`✅ 已提交 · 修复约 3 分钟后到达`);
        setText('');
        setTimeout(() => { setOpen(false); setResult(null); }, 2000);
      }
    } catch (e) {
      setResult(`❌ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="bug-fab"
        onClick={() => setOpen(true)}
        aria-label="报告问题"
        title="报告问题"
      >
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <ellipse cx="12" cy="13" rx="5" ry="6" />
          <path d="M9.5 7.5 L8 4.5" />
          <path d="M14.5 7.5 L16 4.5" />
          <path d="M7 10 L4 9" />
          <path d="M7 13 L4 13" />
          <path d="M7 16 L4 17.5" />
          <path d="M17 10 L20 9" />
          <path d="M17 13 L20 13" />
          <path d="M17 16 L20 17.5" />
        </svg>
      </button>

      {open && (
        <div
          className="bug-fab-backdrop"
          onClick={() => !busy && setOpen(false)}
          role="presentation"
        >
          <div
            className="bug-fab-sheet"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="报告问题"
          >
            <div className="bug-fab-sheet-grip" />
            <div className="bug-fab-sheet-title">报告问题</div>
            <div className="bug-fab-sheet-hint">
              标记 <code>[mobile]</code> · 自动派给 mobile daemon 修
            </div>
            <textarea
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={5}
              placeholder="哪里出问题了？期望是什么？"
              className="bug-fab-textarea m-textarea"
              disabled={busy}
            />
            {result && <div className="bug-fab-result">{result}</div>}
            <div className="bug-fab-actions">
              <button
                type="button"
                className="m-btn-secondary"
                onClick={() => setOpen(false)}
                disabled={busy}
              >
                取消
              </button>
              <button
                type="button"
                className="m-btn-primary"
                onClick={submit}
                disabled={busy || !text.trim()}
              >
                {busy ? '提交中…' : '发送'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

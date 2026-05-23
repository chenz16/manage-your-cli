'use client';

import { useEffect, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import { useT } from '../../../lib/i18n/useT';

/**
 * CliTerminal — in-browser terminal for a CLI staff's tmux session.
 *
 * iter-008 phase 1. Uses xterm.js for the renderer (no node-pty needed
 * on the client). I/O via the 3 SSE/HTTP endpoints we shipped in
 * iter-007 step 8:
 *
 *   POST   /api/v1/staff/:id/cli/launch   — start session if needed
 *   POST   /api/v1/staff/:id/cli/input    — send keystrokes
 *   GET    /api/v1/staff/:id/cli/stream   — SSE: scrollback + live out
 *   DELETE /api/v1/staff/:id/cli          — kill session
 *
 * Per user 2026-05-16 "本地也可以直接access 我的app也可以access 就是
 * 透彻" — owner can ALSO attach a local terminal via
 * `tmux a -t holon-<staff_id>` and see the same session. We surface
 * that command in the toolbar.
 */

interface Props {
  staffId: string;
  staffName: string;
  onClose: () => void;
}

export function CliTerminal({ staffId, staffName, onClose }: Props) {
  const { t } = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const streamRef = useRef<EventSource | null>(null);

  const [status, setStatus] = useState<'idle' | 'launching' | 'running' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [localAttachCmd, setLocalAttachCmd] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Mount the terminal once.
  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.2,
      theme: {
        background: '#0e0e10',
        foreground: '#e6e6e6',
        cursor: '#9bd28a',
        black: '#1a1a1d',
        brightBlack: '#5a5a5d',
        red: '#e0533a',
        green: '#9bd28a',
        yellow: '#e6b35c',
        blue: '#6a9fc0',
        magenta: '#c084c4',
        cyan: '#73c4c4',
        white: '#d7d7d7',
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    // Defer fit() one paint frame — the container needs layout dimensions
    // before fit() can compute cols/rows. Calling immediately throws
    // "Cannot read properties of undefined (reading 'dimensions')".
    requestAnimationFrame(() => { try { fit.fit(); } catch {} });
    termRef.current = term;
    fitRef.current = fit;

    // Forward keystrokes to backend (chunked — xterm fires per char).
    let inputBuf = '';
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const flushSoon = () => {
      if (flushTimer) return;
      flushTimer = setTimeout(() => {
        flushTimer = null;
        const payload = inputBuf;
        inputBuf = '';
        if (!payload) return;
        // Treat the bytes literally — don't auto-add Enter, the user
        // already pressed it (xterm emits \r as part of input on Enter).
        fetch(`/api/v1/staff/${staffId}/cli/input`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ input: payload, enter: false }),
        }).catch(() => {});
      }, 16); // ~60Hz coalescing
    };
    const disposable = term.onData((data) => {
      inputBuf += data;
      flushSoon();
    });

    // Push the fitted xterm grid size to the tmux session so the cursor +
    // line wrapping line up (detached tmux defaults to 80x24 otherwise).
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const syncSize = () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const t = termRef.current;
        if (!t || !t.cols || !t.rows) return;
        fetch(`/api/v1/staff/${staffId}/cli/resize`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cols: t.cols, rows: t.rows }),
        }).catch(() => {});
      }, 150);
    };
    const onResize = () => { requestAnimationFrame(() => { try { fit.fit(); syncSize(); } catch {} }); };
    window.addEventListener('resize', onResize);
    // Also fit when the container's intrinsic size changes (panel
    // expand / sidebar drag). ResizeObserver fires sync — defer to
    // next paint to avoid the same "dimensions undefined" race.
    const ro = new ResizeObserver(onResize);
    ro.observe(containerRef.current);

    return () => {
      window.removeEventListener('resize', onResize);
      ro.disconnect();
      disposable.dispose();
      streamRef.current?.close();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [staffId]);

  // Launch + start streaming on mount (or when staffId changes).
  useEffect(() => {
    let cancelled = false;

    async function go() {
      setStatus('launching');
      setErrorMsg(null);
      try {
        const r = await fetch(`/api/v1/staff/${staffId}/cli/launch`, { method: 'POST' });
        const j = await r.json();
        if (cancelled) return;
        if (!r.ok || !j.ok) {
          setStatus('error');
          setErrorMsg(j.error ?? `HTTP ${r.status}`);
          return;
        }
        setLocalAttachCmd(j.local_attach_cmd ?? null);

        // Open SSE stream — EventSource auto-reconnects, perfect for tmux output.
        const es = new EventSource(`/api/v1/staff/${staffId}/cli/stream`);
        streamRef.current = es;
        es.onmessage = (ev) => {
          if (!termRef.current) return;
          try {
            const data = JSON.parse(ev.data);
            if (data.type === 'chunk' && typeof data.text === 'string') {
              termRef.current.write(data.text);
            }
          } catch { /* malformed frame */ }
        };
        es.onerror = () => {
          // EventSource auto-retries; just note the blip in the gutter.
          setErrorMsg(t('staff.cli.stream_reconnecting'));
          setTimeout(() => setErrorMsg(null), 1500);
        };
        setStatus('running');
        // The initial fit() ran before the session existed, so the resize
        // POST then would have 404'd. Now the session is up — re-fit and push
        // the real grid size so the cursor lines up from the first paint.
        setTimeout(() => {
          try { fitRef.current?.fit(); } catch {}
          const term = termRef.current;
          if (term?.cols && term?.rows) {
            fetch(`/api/v1/staff/${staffId}/cli/resize`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ cols: term.cols, rows: term.rows }),
            }).catch(() => {});
          }
        }, 250);
      } catch (e) {
        if (cancelled) return;
        setStatus('error');
        setErrorMsg(e instanceof Error ? e.message : String(e));
      }
    }
    void go();

    return () => {
      cancelled = true;
      streamRef.current?.close();
      streamRef.current = null;
    };
  }, [staffId]);

  async function copyAttach() {
    if (!localAttachCmd) return;
    try {
      await navigator.clipboard.writeText(localAttachCmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard denied */ }
  }

  async function killSession() {
    if (!confirm(t('staff.cli.kill_confirm'))) return;
    try {
      await fetch(`/api/v1/staff/${staffId}/cli`, { method: 'DELETE' });
    } finally {
      onClose();
    }
  }

  return (
    <div className="cli-terminal-wrap">
      <div className="cli-terminal-bar">
        <div style={{ fontSize: 13, fontWeight: 600 }}>{staffName}{t('staff.cli.title_suffix')}</div>
        <span className={`cli-terminal-status cli-terminal-status-${status}`}>
          {status === 'launching' && t('staff.cli.status.launching')}
          {status === 'running' && t('staff.cli.status.running')}
          {status === 'error' && t('staff.cli.status.error')}
        </span>
        {errorMsg && (
          <span style={{ fontSize: 11, color: 'var(--ink-mute)', fontStyle: 'italic' }}>{errorMsg}</span>
        )}
        <div style={{ flex: 1 }} />
        {localAttachCmd && (
          <button
            type="button" className="btn" style={{ fontSize: 11, padding: '4px 8px' }}
            onClick={copyAttach} title={t('staff.cli.tmux_attach_title')}
          >
            {copied ? t('staff.cli.tmux_copied') : t('staff.cli.tmux_attach')}
          </button>
        )}
        <button
          type="button" className="btn" style={{ fontSize: 11, padding: '4px 8px' }}
          onClick={killSession}
        >
          {t('staff.cli.kill')}
        </button>
        <button
          type="button" className="btn" style={{ fontSize: 11, padding: '4px 8px' }}
          onClick={onClose}
        >
          {t('staff.cli.close')}
        </button>
      </div>
      <div ref={containerRef} className="cli-terminal-body" />
    </div>
  );
}

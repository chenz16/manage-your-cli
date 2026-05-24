'use client';

import { useState, useEffect } from 'react';

interface WeChatStatus {
  connected: boolean;
  accountId?: string;
  baseUrl?: string | null;
  savedAt?: string | null;
}

/**
 * My WeChat — shows the WeChat bind identity on /me.
 * Read-only: bind action lives in /connectors → Connect WeChat (iOS).
 */
export function MyWeChatSection(): React.ReactElement {
  const [status, setStatus] = useState<WeChatStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/v1/connectors/wechat/status')
      .then((r) => {
        if (!r.ok) throw new Error(`GET /api/v1/connectors/wechat/status ${r.status}`);
        return r.json() as Promise<WeChatStatus>;
      })
      .then((j) => setStatus(j))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  function formatSavedAt(savedAt: string): string {
    try {
      return new Date(savedAt).toLocaleString();
    } catch {
      return savedAt;
    }
  }

  return (
    <section className="card" style={{ padding: 20 }}>
      <h2 className="section-title" style={{ marginTop: 0 }}>My WeChat</h2>
      <p style={{ fontSize: 13, color: 'var(--ink-mute)', marginTop: -4, marginBottom: 16 }}>
        Your WeChat identity bound to this desk — used by the mobile channel to
        relay messages. Bind it in{' '}
        <a href="/connectors" style={{ color: 'var(--accent)' }}>
          Connectors → Connect WeChat (iOS)
        </a>.
      </p>

      {error && (
        <p style={{ fontSize: 13, color: 'var(--red, #c0392b)' }}>
          Failed to load WeChat status: {error}
        </p>
      )}

      {!error && status === null && (
        <p style={{ fontSize: 13, color: 'var(--ink-mute)' }}>Loading…</p>
      )}

      {!error && status !== null && (
        status.connected ? (
          <div style={{
            display: 'flex', flexDirection: 'column', gap: 8,
            background: 'var(--bg-alt)', borderRadius: 8, padding: '10px 14px',
            border: '1px solid var(--line)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{
                fontSize: 12, fontWeight: 600, color: 'var(--green, #27ae60)',
                background: 'color-mix(in srgb, var(--green, #27ae60) 12%, transparent)',
                borderRadius: 4, padding: '2px 8px', border: '1px solid color-mix(in srgb, var(--green, #27ae60) 30%, transparent)',
              }}>
                Connected
              </span>
              <span style={{ fontSize: 13, color: 'var(--ink)' }}>
                WeChat account <code style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>{status.accountId}</code>
              </span>
            </div>
            {status.savedAt && (
              <span style={{ fontSize: 12, color: 'var(--ink-mute)' }}>
                Bound at {formatSavedAt(status.savedAt)}
              </span>
            )}
            {status.baseUrl && (
              <span style={{ fontSize: 12, color: 'var(--ink-mute)', fontFamily: 'ui-monospace, monospace' }}>
                {status.baseUrl}
              </span>
            )}
          </div>
        ) : (
          <p style={{ fontSize: 13, color: 'var(--ink-mute)', fontStyle: 'italic' }}>
            Not connected — bind it in{' '}
            <a href="/connectors" style={{ color: 'var(--accent)' }}>
              Connectors → Connect WeChat (iOS)
            </a>.
          </p>
        )
      )}
    </section>
  );
}

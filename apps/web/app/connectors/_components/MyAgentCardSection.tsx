'use client';

import { useState, useEffect } from 'react';

/**
 * My Agent Card — shows the desk's own A2A identity URL + QR code.
 * Analogous to WeChat "My QR code": this is what you hand to peers so they
 * can add this desk as an A2A connection.
 *
 * QR rendering mirrors ConnectPhoneSection: external qrserver.com image URL,
 * so no client-side canvas library is needed and SSR is safe.
 */
export function MyAgentCardSection(): React.ReactElement {
  const [agentCardUrl, setAgentCardUrl] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setAgentCardUrl(`${window.location.origin}/.well-known/agent-card.json`);
    }
  }, []);

  async function copyUrl(): Promise<void> {
    if (!agentCardUrl) return;
    await navigator.clipboard.writeText(agentCardUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const qrSrc = agentCardUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(agentCardUrl)}`
    : null;

  return (
    <section className="card" style={{ padding: 20 }}>
      <h2 className="section-title" style={{ marginTop: 0 }}>My Agent Card</h2>
      <p style={{ fontSize: 13, color: 'var(--ink-mute)', marginTop: -4, marginBottom: 16 }}>
        Other Holon desks connect to this desk using this address — A2A peers.
        Share it the same way you would share a QR code: paste the URL into their{' '}
        <strong>Connectors → Connect to Holon</strong> panel.
      </p>

      {agentCardUrl ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* URL row */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
            background: 'var(--bg-alt)', borderRadius: 8, padding: '10px 14px',
            border: '1px solid var(--line)',
          }}>
            <code style={{ fontSize: 12, color: 'var(--ink)', wordBreak: 'break-all', flex: 1, fontFamily: 'ui-monospace, monospace' }}>
              {agentCardUrl}
            </code>
            <button
              type="button"
              className="btn"
              style={{ fontSize: 12, padding: '4px 12px', flexShrink: 0 }}
              onClick={() => { void copyUrl(); }}
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>

          {/* QR code */}
          {qrSrc && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qrSrc}
                alt="Agent card QR code"
                width={180}
                height={180}
                style={{ borderRadius: 8, border: '1px solid var(--line)', display: 'block' }}
              />
              <span style={{ fontSize: 11, color: 'var(--ink-mute)' }}>
                Scan to connect from another desk
              </span>
            </div>
          )}
        </div>
      ) : (
        <p style={{ fontSize: 13, color: 'var(--ink-mute)' }}>Loading…</p>
      )}
    </section>
  );
}

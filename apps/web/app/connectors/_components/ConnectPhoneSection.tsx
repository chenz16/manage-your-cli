'use client';

import { useState } from 'react';

interface PairStartResponse {
  code: string;
  expires_at: string;
  lan_url: string;
  qr_payload: string;
  lan_candidates?: string[];
}

/**
 * Inner content for the "Connect Phone" card on /connectors.
 * The surrounding card/eyebrow/title shell is provided by the parent page;
 * this component renders only the pairing UI fields.
 */
export function ConnectPhoneSection(): React.ReactElement {
  const [pairing, setPairing] = useState<PairStartResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startPairing(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const resp = await fetch('/api/v1/pair/start', { method: 'POST' });
      const data = await resp.json() as PairStartResponse | { error?: string; code?: string };
      if (!resp.ok) {
        const err = data as { error?: string; code?: string };
        throw new Error(`${err.code ?? 'pair_start_failed'}: ${err.error ?? resp.status}`);
      }
      setPairing(data as PairStartResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const qrSrc = pairing
    ? `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(pairing.qr_payload)}`
    : null;
  const alternativeLanCandidates = pairing?.lan_candidates?.filter((ip) => !pairing.lan_url.includes(`//${ip}:`)) ?? [];

  return (
    <div className="conn-field">
      <div className="conn-actions">
        <button type="button" className="btn btn-primary" onClick={() => { void startPairing(); }} disabled={busy}>
          {busy ? 'Starting…' : 'Start pairing'}
        </button>
      </div>

      {error && (
        <div role="alert" className="conn-error" style={{ marginTop: 12 }}>
          {error}
        </div>
      )}

      {pairing && (
        <div style={{
          marginTop: 16,
          display: 'grid',
          gridTemplateColumns: '180px minmax(0, 1fr)',
          gap: 16,
          alignItems: 'start',
        }}>
          {qrSrc && (
            // External QR rendering keeps this pass dependency-free; the BFF pair flow is local.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={qrSrc}
              alt="Pairing QR code"
              width={180}
              height={180}
              style={{ border: '1px solid var(--line)', borderRadius: 8, background: '#fff' }}
            />
          )}
          <div style={{ minWidth: 0 }}>
            <div style={{
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: 32,
              fontWeight: 700,
              letterSpacing: 0,
              lineHeight: 1,
              marginBottom: 8,
            }}>
              {pairing.code}
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-mute)', lineHeight: 1.5 }}>
              Expires at {new Date(pairing.expires_at).toLocaleTimeString()}.
            </div>
            <code style={{
              display: 'block',
              marginTop: 8,
              padding: 8,
              borderRadius: 6,
              background: 'var(--bg-alt, #f7f7f5)',
              color: 'var(--ink-mute)',
              fontSize: 11,
              whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere',
            }}>
              {pairing.lan_url}
            </code>
            {alternativeLanCandidates.length > 0 && (
              <div style={{
                marginTop: 10,
                fontSize: 12,
                color: 'var(--ink-mute)',
                lineHeight: 1.5,
              }}>
                <div>If your phone cannot reach this, try:</div>
                <div style={{
                  marginTop: 4,
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 6,
                }}>
                  {alternativeLanCandidates.map((ip) => (
                    <code
                      key={ip}
                      style={{
                        padding: '3px 6px',
                        borderRadius: 6,
                        background: 'var(--bg-alt, #f7f7f5)',
                        color: 'var(--ink-mute)',
                        fontSize: 11,
                      }}
                    >
                      {ip}
                    </code>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

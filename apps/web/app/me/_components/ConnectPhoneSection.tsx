'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';

interface PairStartResponse {
  code: string;
  expires_at: string;
  lan_url: string;
  qr_payload: string;
  lan_candidates?: string[];
}

// Refresh the code this many ms before it expires.
const REFRESH_BEFORE_EXPIRY_MS = 15_000;

export function ConnectPhoneSection(): React.ReactElement {
  const [pairing, setPairing] = useState<PairStartResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearRefreshTimer = useCallback(() => {
    if (refreshTimerRef.current !== null) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
  }, []);

  // Generate QR data URL from payload string.
  async function generateQr(payload: string): Promise<string | null> {
    try {
      return await QRCode.toDataURL(payload, {
        width: 180,
        margin: 1,
        color: { dark: '#000000', light: '#ffffff' },
      });
    } catch {
      return null;
    }
  }

  const startPairing = useCallback(async (): Promise<void> => {
    clearRefreshTimer();
    setBusy(true);
    setError(null);
    try {
      const resp = await fetch('/api/v1/pair/start', { method: 'POST' });
      const data = await resp.json() as PairStartResponse | { error?: string; code?: string };
      if (!resp.ok) {
        const err = data as { error?: string; code?: string };
        throw new Error(`${err.code ?? 'pair_start_failed'}: ${err.error ?? resp.status}`);
      }
      const p = data as PairStartResponse;
      setPairing(p);

      // Generate local QR code.
      const dataUrl = await generateQr(p.qr_payload);
      setQrDataUrl(dataUrl);

      // Schedule auto-refresh before code expires.
      const expiresMs = new Date(p.expires_at).getTime();
      const msUntilRefresh = Math.max(0, expiresMs - Date.now() - REFRESH_BEFORE_EXPIRY_MS);
      refreshTimerRef.current = setTimeout(() => {
        void startPairing();
      }, msUntilRefresh);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [clearRefreshTimer]);

  // Cleanup timer on unmount.
  useEffect(() => {
    return () => clearRefreshTimer();
  }, [clearRefreshTimer]);

  const alternativeLanCandidates =
    pairing?.lan_candidates?.filter((ip) => !pairing.lan_url.includes(`//${ip}:`)) ?? [];

  return (
    <section className="card" style={{ padding: 20 }}>
      <h2 className="section-title" style={{ marginTop: 0 }}>配对手机 / 扫码连接</h2>
      <p style={{ fontSize: 13, color: 'var(--ink-mute)', marginTop: -4, marginBottom: 12 }}>
        手机与桌面在同一局域网时，扫码即可自动配对，无需手动输入地址。
      </p>
      <button
        type="button"
        className="btn"
        onClick={() => { void startPairing(); }}
        disabled={busy}
      >
        {busy ? '生成中…' : pairing ? '刷新二维码' : '开始配对'}
      </button>

      {error && (
        <div
          role="alert"
          style={{
            marginTop: 12,
            padding: '8px 10px',
            borderRadius: 6,
            border: '1px solid rgba(192,57,43,0.35)',
            background: 'rgba(192,57,43,0.10)',
            color: 'var(--red, #c0392b)',
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      {pairing && (
        <div
          style={{
            marginTop: 16,
            display: 'grid',
            gridTemplateColumns: '180px minmax(0, 1fr)',
            gap: 16,
            alignItems: 'start',
          }}
        >
          {qrDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={qrDataUrl}
              alt="配对二维码"
              width={180}
              height={180}
              style={{ border: '1px solid var(--line)', borderRadius: 8, background: '#fff' }}
            />
          ) : (
            <div
              style={{
                width: 180,
                height: 180,
                border: '1px solid var(--line)',
                borderRadius: 8,
                background: 'var(--bg-alt, #f7f7f5)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 12,
                color: 'var(--ink-mute)',
              }}
            >
              二维码生成失败
            </div>
          )}
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: 32,
                fontWeight: 700,
                letterSpacing: 0,
                lineHeight: 1,
                marginBottom: 8,
              }}
            >
              {pairing.code}
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-mute)', lineHeight: 1.5 }}>
              有效期至 {new Date(pairing.expires_at).toLocaleTimeString()}，即将自动刷新。
            </div>
            <code
              style={{
                display: 'block',
                marginTop: 8,
                padding: 8,
                borderRadius: 6,
                background: 'var(--bg-alt, #f7f7f5)',
                color: 'var(--ink-mute)',
                fontSize: 11,
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
              }}
            >
              {pairing.lan_url}
            </code>
            {alternativeLanCandidates.length > 0 && (
              <div
                style={{
                  marginTop: 10,
                  fontSize: 12,
                  color: 'var(--ink-mute)',
                  lineHeight: 1.5,
                }}
              >
                <div>若手机无法连接，也可尝试：</div>
                <div
                  style={{
                    marginTop: 4,
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 6,
                  }}
                >
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
    </section>
  );
}

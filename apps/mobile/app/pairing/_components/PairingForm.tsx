'use client';

import { useState } from 'react';
import {
  installMobileApiFetchProxy,
  normalizeBaseUrl,
  writeDesktopConnection,
} from '../../_lib/mobile-runtime';
import { deskOrigin } from '../../_lib/desk-origin';

// Matches apps/web/app/api/v1/pair/claim/route.ts success shape:
//   { ok: true; device_token: string; device_id: string; paired_at: string }
// Failure shape (route returns result.reason in both error + code fields):
//   { error: string; code: string }  (non-ok HTTP status)
interface PairClaimOk {
  ok: true;
  device_token: string;
  device_id: string;
  paired_at: string;
}

interface PairClaimErr {
  error?: string;
  code?: string;
}

export function PairingForm() {
  const [baseUrl, setBaseUrl] = useState(deskOrigin);
  const [pairingCode, setPairingCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const base = normalizeBaseUrl(baseUrl);
      const code = pairingCode.replace(/\D/g, '');
      if (code.length < 4) throw new Error('请输入桌面端显示的配对码。');

      const resp = await fetch(`${base}/api/v1/pair/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });

      const data = (await resp.json().catch(() => ({}))) as PairClaimOk | PairClaimErr;

      if (!resp.ok || !('ok' in data) || !data.ok || !(data as PairClaimOk).device_token) {
        const err = data as PairClaimErr;
        const detail = err.error ?? err.code ?? `HTTP ${resp.status}`;
        throw new Error(`配对失败：${detail}`);
      }

      const ok = data as PairClaimOk;
      writeDesktopConnection({ baseUrl: base, deviceToken: ok.device_token });
      installMobileApiFetchProxy();
      window.dispatchEvent(new Event('holon:mobile-paired'));
      window.location.href = '/';
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mobile-pairing-shell">
      <form className="mobile-pairing-panel" onSubmit={onSubmit}>
        <div>
          <div className="mobile-pairing-kicker">Holon 移动端</div>
          <h1 className="mobile-pairing-title">连接桌面端</h1>
        </div>

        <label className="mobile-pairing-field">
          <span>桌面端地址</span>
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="http://192.168.1.100:3000"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            disabled={busy}
          />
        </label>

        <label className="mobile-pairing-field">
          <span>配对码</span>
          <input
            value={pairingCode}
            onChange={(e) => setPairingCode(e.target.value)}
            placeholder="072615"
            inputMode="numeric"
            autoComplete="one-time-code"
            disabled={busy}
          />
        </label>

        {error && (
          <div className="mobile-pairing-error" role="alert">
            {error}
          </div>
        )}

        <button className="mobile-pairing-submit" type="submit" disabled={busy}>
          {busy ? '连接中…' : '连接'}
        </button>
      </form>
    </main>
  );
}

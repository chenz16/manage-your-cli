'use client';

import { useState } from 'react';
import {
  installMobileApiFetchProxy,
  normalizeBaseUrl,
  writeDesktopConnection,
} from '../../_lib/mobile-runtime';
import { deskOrigin } from '../../_lib/desk-origin';

// Step 1: phone POSTs /api/v1/pair/request → gets requestId
// Step 2: user reads 4-digit code from desk, enters it → POSTs /api/v1/pair/confirm

interface PairRequestOk {
  requestId: string;
  expires_at: string;
}

interface PairRequestErr {
  error?: string;
  code?: string;
}

interface PairConfirmOk {
  ok: true;
  device_token: string;
  device_id: string;
  paired_at: string;
}

interface PairConfirmErr {
  error?: string;
  code?: string;
}

type Step = 'request' | 'confirm';

export function PairingForm() {
  const [baseUrl, setBaseUrl] = useState(deskOrigin);
  const [step, setStep] = useState<Step>('request');
  const [requestId, setRequestId] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function onRequest(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const base = normalizeBaseUrl(baseUrl);
      const resp = await fetch(`${base}/api/v1/pair/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceName: '微作' }),
      });

      const data = (await resp.json().catch(() => ({}))) as PairRequestOk | PairRequestErr;

      if (!resp.ok || !('requestId' in data) || !data.requestId) {
        const err = data as PairRequestErr;
        const detail = err.error ?? err.code ?? `HTTP ${resp.status}`;
        throw new Error(`连不上桌面,确认地址和同一网络: ${detail}`);
      }

      setRequestId((data as PairRequestOk).requestId);
      setStep('confirm');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onConfirm(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const base = normalizeBaseUrl(baseUrl);
      const digits = code.replace(/\D/g, '');
      if (digits.length < 4) {
        throw new Error('请输入桌面端显示的 4 位验证码。');
      }

      const resp = await fetch(`${base}/api/v1/pair/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, code: digits }),
      });

      const data = (await resp.json().catch(() => ({}))) as PairConfirmOk | PairConfirmErr;

      if (!resp.ok || !('ok' in data) || !(data as PairConfirmOk).device_token) {
        const err = data as PairConfirmErr;
        // Map typed failures to Chinese
        if (resp.status === 410 || err.code === 'expired') {
          throw new Error('验证码已过期,请重新请求');
        }
        if (resp.status === 401 || err.code === 'bad_code') {
          throw new Error('验证码不对');
        }
        if (resp.status === 404 || err.code === 'not_found') {
          throw new Error('配对请求失效,请重新请求');
        }
        throw new Error(`配对失败：${err.error ?? err.code ?? `HTTP ${resp.status}`}`);
      }

      const ok = data as PairConfirmOk;
      writeDesktopConnection({ baseUrl: normalizeBaseUrl(baseUrl), deviceToken: ok.device_token });
      installMobileApiFetchProxy();
      window.dispatchEvent(new Event('holon:mobile-paired'));
      window.location.href = '/';
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function goBack() {
    setStep('request');
    setCode('');
    setError('');
    setRequestId('');
  }

  return (
    <main className="mobile-pairing-shell">
      {step === 'request' ? (
        <form className="mobile-pairing-panel" onSubmit={onRequest}>
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

          {error && (
            <div className="mobile-pairing-error" role="alert">
              {error}
            </div>
          )}

          <button className="mobile-pairing-submit" type="submit" disabled={busy}>
            {busy ? '请求中…' : '请求连接'}
          </button>
        </form>
      ) : (
        <form className="mobile-pairing-panel" onSubmit={onConfirm}>
          <div>
            <div className="mobile-pairing-kicker">Holon 移动端</div>
            <h1 className="mobile-pairing-title">输入验证码</h1>
          </div>

          <p style={{ textAlign: 'center', fontSize: 14, color: 'var(--ink-soft, #555)', margin: '0 0 16px' }}>
            在桌面上查看 4 位验证码并输入
          </p>

          <label className="mobile-pairing-field">
            <span>4 位验证码</span>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
              placeholder="0000"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={4}
              disabled={busy}
              style={{ fontSize: 28, letterSpacing: '0.3em', textAlign: 'center' }}
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
            />
          </label>

          {error && (
            <div className="mobile-pairing-error" role="alert">
              {error}
            </div>
          )}

          <button
            className="mobile-pairing-submit"
            type="submit"
            disabled={busy || code.replace(/\D/g, '').length < 4}
          >
            {busy ? '连接中…' : '连接'}
          </button>

          <button
            type="button"
            className="mobile-pairing-submit"
            style={{ marginTop: 8, background: 'transparent', color: 'var(--ink-mute, #888)', border: '1px solid var(--line, #ddd)' }}
            onClick={goBack}
            disabled={busy}
          >
            重新请求
          </button>
        </form>
      )}
    </main>
  );
}

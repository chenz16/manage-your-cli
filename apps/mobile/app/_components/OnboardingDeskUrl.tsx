'use client';

// OnboardingDeskUrl.tsx — first-launch screen. Shown when no desk URL has
// been configured yet (neither localStorage nor build-time env). User types
// their desk's LAN URL, taps "Test connection", and on green continues to
// the existing pairing flow.
//
// Renders Chinese strings (mobile UI is 中文 per project convention) but the
// example commands stay English (terminal output is English everywhere).

import { useState } from 'react';
import { pingDesk, writeDeskOrigin, normalizeUrl } from '../_lib/desk-url-storage';

interface Props {
  onContinue: () => void;
}

type TestState =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'ok'; version?: string }
  | { kind: 'fail'; error: string };

export function OnboardingDeskUrl({ onContinue }: Props): React.JSX.Element {
  const [url, setUrl] = useState('');
  const [state, setState] = useState<TestState>({ kind: 'idle' });

  async function onTest() {
    if (!url.trim()) {
      setState({ kind: 'fail', error: '请输入桌面地址' });
      return;
    }
    setState({ kind: 'testing' });
    const r = await pingDesk(url, 5000);
    if (r.ok) {
      const next: TestState = r.version !== undefined
        ? { kind: 'ok', version: r.version }
        : { kind: 'ok' };
      setState(next);
    } else {
      setState({ kind: 'fail', error: r.error ?? '无法连接' });
    }
  }

  function onContinueClick() {
    try {
      writeDeskOrigin(normalizeUrl(url));
      onContinue();
    } catch (e) {
      setState({ kind: 'fail', error: e instanceof Error ? e.message : String(e) });
    }
  }

  const canContinue = state.kind === 'ok';

  return (
    <div className="mobile-pairing-shell" data-testid="onboarding-desk-url">
      <div className="mobile-pairing-panel">
        <div className="mobile-pairing-kicker">微作 · Weizo</div>
        <h1 className="mobile-pairing-title">设置桌面地址</h1>
        <p className="mobile-pairing-subtitle">
          首次使用,请填写桌面端的局域网地址。
        </p>

        <div className="mobile-pairing-field">
          <label className="mobile-pairing-label">Desk URL</label>
          <input
            className="mobile-pairing-input"
            type="url"
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="http://192.168.1.50:3110"
            value={url}
            onChange={(e) => { setUrl(e.target.value); setState({ kind: 'idle' }); }}
            data-testid="onboarding-desk-url-input"
          />
          <p className="mobile-pairing-help" style={{ fontSize: 12, color: '#666', marginTop: 8 }}>
            如何找到桌面 IP?在桌面终端运行:<br />
            Linux / WSL: <code>hostname -I | awk &apos;{'{'}print $1{'}'}&apos;</code><br />
            Mac: 系统偏好设置 → 网络
          </p>
        </div>

        <button
          type="button"
          className="mobile-pairing-submit"
          onClick={() => { void onTest(); }}
          disabled={state.kind === 'testing'}
          data-testid="onboarding-desk-url-test"
        >
          {state.kind === 'testing' ? '测试中…' : '测试连接'}
        </button>

        {state.kind === 'ok' && (
          <div className="mobile-pairing-success" style={{ marginTop: 10, color: '#0a7d2c' }}>
            🟢 已连接{state.version ? ` (desk v${state.version})` : ''}
          </div>
        )}
        {state.kind === 'fail' && (
          <div className="mobile-pairing-error" style={{ marginTop: 10 }}>
            🔴 无法连接 — 请检查桌面是否启动、是否在同一 WiFi。<br />
            <span style={{ fontSize: 12, color: '#666' }}>{state.error}</span>
          </div>
        )}

        <button
          type="button"
          className="mobile-pairing-submit"
          style={{ marginTop: 16, opacity: canContinue ? 1 : 0.4 }}
          disabled={!canContinue}
          onClick={onContinueClick}
          data-testid="onboarding-desk-url-continue"
        >
          继续
        </button>
      </div>
    </div>
  );
}

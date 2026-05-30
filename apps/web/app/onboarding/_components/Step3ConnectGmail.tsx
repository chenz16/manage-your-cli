'use client';

/**
 * Step 3 — Connect Gmail (optional).
 *
 * Per plan.md: single Connect button + Skip-for-now link.
 *
 * iter-013 Pass #3 (ADR-024): the OAuth dance is now driven by NextAuth v5
 * via `signIn('google')` (matches /me AuthorizationsSection). The iter-011
 * `/api/v1/integrations/oauth/gmail/authorize` route was deleted in Pass #4
 * (0c72ada) — hard-navving to it returned 404 and stranded first-time
 * customers on this step (L-056). `callbackUrl` returns the user to
 * `/onboarding?step=3&gmail=connected` so the existing `/api/v1/me`
 * integrations poll picks up the new account row + advances to Step 4.
 */

import { useCallback, useEffect, useState } from 'react';
import { signIn, signOut, useSession } from 'next-auth/react';
import type { OwnerAssistant } from '@holon/api-contract';
import { useT } from '../../../lib/i18n/useT';

interface Props {
  onBack: () => void;
  onSkip: () => void;
  onSkipOnboarding: () => void;
}

async function isGmailConnected(): Promise<boolean> {
  try {
    const r = await fetch('/api/v1/me', { cache: 'no-store' });
    if (!r.ok) return false;
    const o = (await r.json()) as OwnerAssistant;
    return Array.isArray(o.integrations) && o.integrations.some((it) => it.kind === 'gmail');
  } catch {
    return false;
  }
}

export function Step3ConnectGmail({ onBack, onSkip, onSkipOnboarding }: Props) {
  const { t } = useT();
  const [connected, setConnected] = useState<boolean | null>(null);
  // iter-017 V1.0 replay: useSession surfaces the live NextAuth account
  // so a returning owner sees "Already connected as <email>" with
  // Re-auth / Skip / Disconnect actions, instead of the auto-advance
  // that fires for first-run customers.
  const { data: session } = useSession();
  const sessionEmail = session?.user?.email ?? null;
  const [alreadyConnectedAtMount] = useState<boolean>(() => Boolean(sessionEmail));

  const check = useCallback(async () => {
    const ok = await isGmailConnected();
    setConnected(ok);
  }, []);

  // Initial check + on-focus + 2s poll while step is mounted.
  useEffect(() => {
    void check();
    const onFocus = () => { void check(); };
    window.addEventListener('focus', onFocus);
    const t = window.setInterval(() => { void check(); }, 2000);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.clearInterval(t);
    };
  }, [check]);

  // Once connected, advance (Skip path = onSkip with no flag, connect
  // path = onSkip with the flag flipped via Page state). Here we just
  // route Connected detection through `onSkip` semantically — Page's
  // `onSkip` callback marks gmail_connected=false. For the connected
  // case we want the flag to be true, so we set it inline + advance.
  //
  // Suppressed on REPLAY: when the owner arrived already connected
  // (alreadyConnectedAtMount), don't auto-advance — let them see the
  // banner and choose Re-auth / Skip / Disconnect explicitly.
  useEffect(() => {
    if (connected && !alreadyConnectedAtMount) {
      try { window.localStorage.setItem('holon-onboarding-gmail-just-connected', '1'); } catch { /* quota */ }
      // Page reads gmail_connected from its own state; advancing via
      // a custom event lets the page set the flag + goto(4) atomically.
      window.dispatchEvent(new CustomEvent('holon-onboarding:gmail-connected'));
    }
  }, [connected, alreadyConnectedAtMount]);

  function skipToNext(): void {
    try { window.localStorage.setItem('holon-onboarding-gmail-just-connected', '1'); } catch { /* quota */ }
    window.dispatchEvent(new CustomEvent('holon-onboarding:gmail-connected'));
  }

  return (
    <>
      <h1 className="onb-title">Connect your Gmail (optional)</h1>
      <p className="onb-sub">
        With Gmail connected, your AI staff can summarize your inbox each
        morning, draft replies in your voice, and pull thread context when
        you ask. You can skip this and connect later from Settings.
      </p>

      {alreadyConnectedAtMount && sessionEmail && (
        <div
          className="onb-card"
          role="note"
          style={{ background: '#e8f5e9', borderColor: '#2e7d32', display: 'flex', flexDirection: 'column', gap: 10 }}
        >
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--green, #2e7d32)' }}>
            ✓ Already connected as <code style={{ fontFamily: 'monospace' }}>{sessionEmail}</code>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button
              type="button"
              className="btn"
              onClick={() => { void signIn('google', { prompt: 'consent', callbackUrl: '/onboarding?step=4' }); }}
              title="Re-run the Google consent screen — useful if you need to add a scope or switch accounts."
            >
              Re-auth
            </button>
            <button
              type="button"
              className="btn"
              onClick={skipToNext}
              title="Keep the current connection; move to the next step."
            >
              Skip to next step
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => { void signOut({ callbackUrl: '/onboarding?step=4' }); }}
              title="Disconnect Gmail and return to this step to reconnect or skip."
            >
              Disconnect
            </button>
          </div>
        </div>
      )}

      {!connected && (
        /* L-089 fix: technical Cloud Console warning collapsed behind <details>;
         * 4 screenshot placeholders removed (they rendered as broken dashed boxes). */
        <details style={{ fontSize: 12, color: 'var(--ink-mute)', margin: '0 0 4px' }}>
          <summary style={{ cursor: 'pointer', userSelect: 'none' }}>
            Show technical details — first-time Cloud Console setup (~15 min)
          </summary>
          <div style={{ marginTop: 8, padding: '10px 12px', background: '#fff8e1', border: '1px solid #f0c800', borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ lineHeight: 1.5 }}>
              Google requires a one-time Cloud Console setup (creating a project,
              enabling the Gmail API, and authorizing a redirect URL) before any
              third-party app can read your inbox. You only do this once.{' '}
              <a href="/docs/integrations/gmail-oauth.md" target="_blank" rel="noopener">
                Open the 9-step walkthrough →
              </a>
            </div>
            <div>
              <strong>3 common errors:</strong>
              <ul style={{ margin: '6px 0 0 18px', padding: 0, lineHeight: 1.7 }}>
                <li><code>redirect_uri_mismatch</code> — the URL in Google Cloud Console doesn't exactly match <code>http://localhost:3000/api/auth/callback/google</code>. Copy-paste it; no trailing slash.</li>
                <li><code>invalid_client</code> — Client ID or Client Secret was mistyped when added to <code>.env</code>. Re-copy both from the Credentials page.</li>
                <li><code>403 · Gmail API not enabled</code> — you created the OAuth credentials but forgot Step 3 of the walkthrough: enable the Gmail API for your project.</li>
              </ul>
            </div>
          </div>
        </details>
      )}

      <div className="onb-card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {connected ? (
          <div style={{ fontSize: 14, color: 'var(--green, #2e7d32)' }}>
            ✓ Gmail connected. Continuing…
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={() => {
                // TEST_MODE handling lives in auth.ts via Credentials-as-google
                // provider swap; UI stays mode-agnostic (no NEXT_PUBLIC mirror,
                // no client-side branch).
                void signIn('google', { callbackUrl: '/onboarding?step=4&gmail=connected' });
              }}
              className="btn btn-primary"
              style={{ alignSelf: 'flex-start' }}
            >
              Connect Gmail
            </button>
            <div style={{ fontSize: 12, color: 'var(--ink-mute)' }}>
              Opens Google in a new tab. After you click "Allow", come back
              here — we'll detect the connection and move on automatically.
            </div>
          </>
        )}
      </div>

      <div className="onb-controls">
        <button type="button" className="btn" onClick={onBack}>Back</button>
        <button type="button" className="btn onb-skip-link onb-skip-heavy" onClick={onSkipOnboarding} title="Exit onboarding entirely. Resume from /me → Replay onboarding.">
          {t('onboarding.skip_onboarding', 'Skip onboarding')}
        </button>
        <div className="spacer" />
        <button type="button" className="btn" onClick={onSkip}>
          {t('onboarding.skip_this_step', 'Skip this step')}
        </button>
      </div>
    </>
  );
}

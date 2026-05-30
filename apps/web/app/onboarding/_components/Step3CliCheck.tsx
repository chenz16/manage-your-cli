'use client';

/**
 * Step 3 — CLI capability check.
 *
 * "Manage Your CLI" is a thin shell around the owner's CLI subscriptions.
 * Without at least one installed CLI binary, the secretary has nothing
 * to drive — so before we wire up Gmail / persona / try-delegating, we
 * show the owner exactly what their desk has + what's missing + how to
 * install it.
 *
 * Behavior:
 *   - On mount: GET /api/v1/cli/binaries
 *   - Render one row per known CLI (claude / codex / gemini / qwen):
 *       installed → ✅ + version + path
 *       missing   → ❌ + install hint + docs link
 *   - Continue is ENABLED iff at least one CLI is installed.
 *   - Zero installed → big help block + "Check again" (force=1, busts the
 *     10s server-side cache) + Continue disabled.
 *
 * This step is positioned BETWEEN Step 2 (about you) and the existing
 * later steps (Gmail / try-delegating / watch). See page.tsx for routing.
 */

import { useCallback, useEffect, useState } from 'react';

interface CliBinaryStatus {
  name: 'claude' | 'codex' | 'gemini' | 'qwen';
  label: string;
  installed: boolean;
  path: string | null;
  version: string | null;
  install_hint: string;
  docs_url: string;
}

interface Props {
  onBack: () => void;
  onNext: () => void;
  onSkipStep: () => void;
  onSkipOnboarding: () => void;
}

export function Step3CliCheck({ onBack, onNext, onSkipStep, onSkipOnboarding }: Props) {
  const [binaries, setBinaries] = useState<CliBinaryStatus[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (force: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/v1/cli/binaries${force ? '?force=1' : ''}`, { cache: 'no-store' });
      const j = (await r.json()) as { binaries?: CliBinaryStatus[]; error?: string };
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setBinaries(Array.isArray(j.binaries) ? j.binaries : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(false); }, [load]);

  const installedCount = binaries?.filter((b) => b.installed).length ?? 0;
  const canContinue = installedCount > 0;

  return (
    <>
      <h1 className="onb-title">Detecting your CLI subscriptions</h1>
      <p className="onb-sub">
        Holon doesn&rsquo;t ship its own model — it drives the CLIs you
        already pay for. We checked your desk for the four supported ones.
        At least one is needed to continue.
      </p>

      <div className="onb-card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {loading && <div style={{ fontSize: 13, color: 'var(--ink-mute)' }}>Scanning…</div>}
        {error && <div style={{ fontSize: 13, color: 'var(--red, #c0392b)' }}>Discovery failed: {error}</div>}
        {!loading && !error && binaries && binaries.map((b) => (
          <CliRow key={b.name} bin={b} />
        ))}
      </div>

      {!loading && !error && installedCount === 0 && (
        <div
          className="onb-card"
          style={{ marginTop: 12, background: 'var(--warn-bg, #fff8e1)', borderColor: 'var(--warn-line, #e0b400)' }}
        >
          <div style={{ fontWeight: 600, marginBottom: 6 }}>No CLI detected.</div>
          <div style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--ink-mute)' }}>
            Holon is a shell — it needs at least one of the CLIs above so the
            secretary has something to drive. Pick whichever subscription you
            already pay for, run its install command above in a terminal, then
            come back and click <strong>Check again</strong>.
          </div>
        </div>
      )}

      <div className="onb-controls">
        <button type="button" className="btn" onClick={onBack} disabled={loading}>Back</button>
        <button
          type="button"
          className="btn onb-skip-link onb-skip-heavy"
          onClick={onSkipOnboarding}
          disabled={loading}
          title="Exit onboarding entirely. Resume any time from /me → Replay onboarding."
        >
          Skip onboarding
        </button>
        <div className="spacer" />
        <button
          type="button"
          className="btn"
          onClick={() => void load(true)}
          disabled={loading}
          title="Re-scan your $PATH for CLI binaries. Bypasses the 10-second cache."
        >
          {loading ? 'Scanning…' : 'Check again'}
        </button>
        <button
          type="button"
          className="btn"
          onClick={onSkipStep}
          disabled={loading}
          title="Skip this check. You can still continue but most features won't work without a CLI."
        >
          Skip this step
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={onNext}
          disabled={loading || !canContinue}
          title={canContinue ? 'At least one CLI detected — continue.' : 'Install at least one CLI to continue.'}
        >
          Continue
        </button>
      </div>
    </>
  );
}

function CliRow({ bin }: { bin: CliBinaryStatus }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 16 }} aria-hidden>{bin.installed ? '✅' : '❌'}</span>
        <span style={{ fontWeight: 600, minWidth: 110 }}>{bin.label}</span>
        {bin.installed ? (
          <>
            {bin.version && <span style={{ fontSize: 12, color: 'var(--ink-mute)' }}>· v{bin.version}</span>}
            {bin.path && (
              <span style={{ fontSize: 11, color: 'var(--ink-mute)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                · {bin.path}
              </span>
            )}
          </>
        ) : (
          <span style={{ fontSize: 12, color: 'var(--ink-mute)' }}>not found</span>
        )}
      </div>
      {!bin.installed && (
        <div style={{ paddingLeft: 24, fontSize: 12, color: 'var(--ink-mute)', display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div>
            Install: <code style={{ fontFamily: 'monospace' }}>{bin.install_hint}</code>
          </div>
          <div>
            <a href={bin.docs_url} target="_blank" rel="noreferrer" style={{ color: 'var(--ink-mute)', textDecoration: 'underline' }}>
              Official docs →
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

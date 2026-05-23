'use client';

/**
 * /onboarding — first-launch 5-step wizard.
 *
 * iter-012 Pass #3. Per plan.md § Pass #3 components 1-5.
 *
 * Step state machine + localStorage persistence. Step components live
 * in ./_components/Step{1..5}*.tsx. On Step 5 completion we POST
 * /api/v1/me/complete-onboarding (audit-only) and redirect to /.
 *
 * State persisted under `holon-onboarding-state-v1`:
 *   { current_step, persona_id, gmail_connected, started_at }
 * The "finished" flag is `holon-onboarded-v1` (truthy when set) per
 * Q-004 default. Layout reads that flag for the /-redirect check.
 */

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Step1Welcome } from './_components/Step1Welcome';
import { Step2AboutYou } from './_components/Step2AboutYou';
import { Step3ConnectGmail } from './_components/Step3ConnectGmail';
import { Step4TryDelegating } from './_components/Step4TryDelegating';
import { Step5WatchDeliverable } from './_components/Step5WatchDeliverable';
import './_components/onboarding.css';

const STATE_KEY = 'holon-onboarding-state-v1';
const DONE_KEY = 'holon-onboarded-v1';

interface OnbState {
  current_step: 1 | 2 | 3 | 4 | 5;
  persona_id: string | null;
  gmail_connected: boolean;
  started_at: number;
}

const DEFAULT_STATE: OnbState = {
  current_step: 1,
  persona_id: null,
  gmail_connected: false,
  started_at: Date.now(),
};

function loadState(): OnbState {
  if (typeof window === 'undefined') return DEFAULT_STATE;
  try {
    const raw = window.localStorage.getItem(STATE_KEY);
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw) as Partial<OnbState>;
    return {
      current_step: (parsed.current_step ?? 1) as OnbState['current_step'],
      persona_id: parsed.persona_id ?? null,
      gmail_connected: !!parsed.gmail_connected,
      started_at: parsed.started_at ?? Date.now(),
    };
  } catch {
    return DEFAULT_STATE;
  }
}

function saveState(s: OnbState): void {
  try { window.localStorage.setItem(STATE_KEY, JSON.stringify(s)); } catch { /* quota */ }
}

export default function OnboardingPage() {
  // useSearchParams requires a Suspense boundary in Next 15 to avoid
  // build-time bail-out warnings on client pages.
  return (
    <Suspense fallback={<div className="onb-wrap"><div className="onb-sub">Loading…</div></div>}>
      <OnboardingInner />
    </Suspense>
  );
}

function OnboardingInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [state, setState] = useState<OnbState>(DEFAULT_STATE);
  const [hydrated, setHydrated] = useState(false);

  // Hydrate from localStorage on mount.
  useEffect(() => {
    const loaded = loadState();
    setState(loaded);
    setHydrated(true);
  }, []);

  // L-054 · already-onboarded guard. If DONE_KEY is set, a customer
  // landed here via bookmark / accidental click / /me-config exploration
  // — silently bounce back to / rather than re-run the 5-step wizard
  // (which would PATCH owner_name + stack a second persona).
  useEffect(() => {
    if (!hydrated) return;
    let done = false;
    try { done = window.localStorage.getItem(DONE_KEY) === '1'; } catch { /* private mode */ }
    if (done) router.replace('/');
  }, [hydrated, router]);

  // OAuth callback return: ?step=3&gmail=connected → advance to Step 4.
  // (Per plan.md Step 3 component.) Falls back to a no-op if those
  // params aren't present.
  useEffect(() => {
    if (!hydrated) return;
    const stepParam = searchParams.get('step');
    const gmailParam = searchParams.get('gmail');
    if (stepParam === '3' && gmailParam === 'connected') {
      setState((s) => {
        const next = { ...s, gmail_connected: true, current_step: 4 as const };
        saveState(next);
        return next;
      });
    }
  }, [hydrated, searchParams]);

  // Step 3 detects post-OAuth via /api/v1/me polling and dispatches
  // this event. We advance to Step 4 with gmail_connected=true.
  // (See Q-007 for the rationale on this indirect path.)
  useEffect(() => {
    function onGmailConnected() {
      setState((s) => {
        if (s.current_step !== 3) return s;
        const next = { ...s, gmail_connected: true, current_step: 4 as const };
        saveState(next);
        return next;
      });
    }
    window.addEventListener('holon-onboarding:gmail-connected', onGmailConnected);
    return () => window.removeEventListener('holon-onboarding:gmail-connected', onGmailConnected);
  }, []);

  const updateState = useCallback((patch: Partial<OnbState>) => {
    setState((s) => {
      const next = { ...s, ...patch };
      saveState(next);
      return next;
    });
  }, []);

  const goto = useCallback((step: OnbState['current_step']) => {
    updateState({ current_step: step });
  }, [updateState]);

  const completeOnboarding = useCallback(async () => {
    try {
      await fetch('/api/v1/me/complete-onboarding', { method: 'POST' });
    } catch { /* non-blocking */ }
    try {
      window.localStorage.setItem(DONE_KEY, '1');
      window.localStorage.removeItem(STATE_KEY);
    } catch { /* quota */ }
    router.push('/');
  }, [router]);

  // Owner directive 2026-05-19: skip-for-now exit on every step. Sets the
  // existing DONE_KEY (matches the AppShell L-052 gate convention) so the
  // user doesn't bounce back into /onboarding from /. State is preserved
  // (we do NOT clear STATE_KEY) so /me → Replay onboarding picks up where
  // they left off. No new schema, no API call — purely client-side exit.
  const skipOnboarding = useCallback(() => {
    try { window.localStorage.setItem(DONE_KEY, '1'); } catch { /* quota */ }
    router.push('/');
  }, [router]);

  // Owner directive 2026-05-19 20:35 ("你应该只是 skip 一步啊"): per-step
  // skip that ONLY advances to the next step, never exits onboarding. On
  // the final step there is no next step, so we treat it as completion
  // (which fires the audit + sets DONE_KEY via completeOnboarding).
  //
  // iter-018 Pass #4 (2026-05-19 ~21:04Z): bumped final-step boundary
  // from 5 → 6 with the new Step 6 (Choose LLM) added.
  const skipStep = useCallback((current: OnbState['current_step']) => {
    if (current < 5) {
      goto((current + 1) as OnbState['current_step']);
    } else {
      void completeOnboarding();
    }
  }, [goto, completeOnboarding]);

  const dots = useMemo(() => [1, 2, 3, 4, 5] as const, []);

  if (!hydrated) {
    return (
      <div className="onb-wrap">
        <div className="onb-sub">Loading…</div>
      </div>
    );
  }

  return (
    <div className="onb-wrap">
      <div className="onb-header">
        <div className="onb-brand">Holon</div>
        <div className="onb-progress" aria-label={`Step ${state.current_step} of 5`}>
          {dots.map((d) => (
            <div
              key={d}
              className={`onb-dot${d === state.current_step ? ' active' : d < state.current_step ? ' done' : ''}`}
            />
          ))}
        </div>
      </div>

      <div className="onb-body">
        {state.current_step === 1 && (
          <Step1Welcome
            onNext={() => goto(2)}
            onSkipStep={() => skipStep(1)}
            onSkipOnboarding={skipOnboarding}
          />
        )}
        {state.current_step === 2 && (
          <Step2AboutYou
            onBack={() => goto(1)}
            onNext={() => goto(3)}
            onSkipStep={() => skipStep(2)}
            onSkipOnboarding={skipOnboarding}
          />
        )}
        {state.current_step === 3 && (
          <Step3ConnectGmail
            onBack={() => goto(2)}
            onSkip={() => {
              updateState({ gmail_connected: false });
              goto(4);
            }}
            onSkipOnboarding={skipOnboarding}
          />
        )}
        {state.current_step === 4 && (
          <Step4TryDelegating
            personaId={state.persona_id}
            gmailConnected={state.gmail_connected}
            onBack={() => goto(3)}
            onNext={() => goto(5)}
            onSkipStep={() => skipStep(4)}
            onSkipOnboarding={skipOnboarding}
          />
        )}
        {state.current_step === 5 && (
          <Step5WatchDeliverable
            startedAt={state.started_at}
            onBack={() => goto(4)}
            onDone={completeOnboarding}
            onSkipStep={() => skipStep(5)}
            onSkipOnboarding={skipOnboarding}
          />
        )}
      </div>
    </div>
  );
}

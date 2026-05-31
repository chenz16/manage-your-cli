'use client';

/**
 * /onboarding — first-launch 6-step wizard.
 *
 * iter-019 (feat/desk-cli-discovery): inserted Step 3 "CLI capability
 * check" between Step 2 (About you) and the prior Step 3 (Gmail). Holon
 * is a thin shell — without at least one CLI binary on the desk, the
 * secretary has nothing to drive. Renumbered subsequent steps:
 *   Gmail (was 3) → 4, TryDelegating (was 4) → 5, Watch (was 5) → 6.
 * Component class names retained (Step3ConnectGmail / Step4TryDelegating /
 * Step5WatchDeliverable) to keep the diff narrow; their PROPS-level
 * position number is updated where it matters (back/next handlers).
 *
 * iter-012 Pass #3. Per plan.md § Pass #3 components 1-5.
 *
 * Step state machine + localStorage persistence. State persisted under
 * `holon-onboarding-state-v1`:
 *   { current_step, persona_id, gmail_connected, started_at }
 * The "finished" flag is `holon-onboarded-v1` (truthy when set) per
 * Q-004 default. Layout reads that flag for the /-redirect check.
 */

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Step1Welcome } from './_components/Step1Welcome';
import { Step2AboutYou } from './_components/Step2AboutYou';
import { Step3CliCheck } from './_components/Step3CliCheck';
import { Step4TryDelegating } from './_components/Step4TryDelegating';
import { Step5WatchDeliverable } from './_components/Step5WatchDeliverable';
import './_components/onboarding.css';

const STATE_KEY = 'holon-onboarding-state-v1';
const DONE_KEY = 'holon-onboarded-v1';

type Step = 1 | 2 | 3 | 4 | 5;
const FINAL_STEP: Step = 5;

interface OnbState {
  current_step: Step;
  persona_id: string | null;
  started_at: number;
}

const DEFAULT_STATE: OnbState = {
  current_step: 1,
  persona_id: null,
  started_at: Date.now(),
};

function loadState(): OnbState {
  if (typeof window === 'undefined') return DEFAULT_STATE;
  try {
    const raw = window.localStorage.getItem(STATE_KEY);
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw) as Partial<OnbState>;
    const rawStep = (parsed.current_step ?? 1) as number;
    const step = (rawStep >= 1 && rawStep <= FINAL_STEP ? rawStep : 1) as Step;
    return {
      current_step: step,
      persona_id: parsed.persona_id ?? null,
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
  return (
    <Suspense fallback={<div className="onb-wrap"><div className="onb-sub">Loading…</div></div>}>
      <OnboardingInner />
    </Suspense>
  );
}

function OnboardingInner() {
  const router = useRouter();
  const [state, setState] = useState<OnbState>(DEFAULT_STATE);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const loaded = loadState();
    setState(loaded);
    setHydrated(true);
  }, []);

  // L-054 · already-onboarded guard.
  useEffect(() => {
    if (!hydrated) return;
    let done = false;
    try { done = window.localStorage.getItem(DONE_KEY) === '1'; } catch { /* private mode */ }
    if (done) router.replace('/');
  }, [hydrated, router]);

  // feat/remove-nextauth: Gmail OAuth step removed; the wizard is now 5 steps
  // (Welcome → AboutYou → CliCheck → TryDelegating → WatchDeliverable).
  // Legacy `?step=4&gmail=connected` URLs from older installs map onto the
  // current TryDelegating step.

  const updateState = useCallback((patch: Partial<OnbState>) => {
    setState((s) => {
      const next = { ...s, ...patch };
      saveState(next);
      return next;
    });
  }, []);

  const goto = useCallback((step: Step) => {
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

  const skipOnboarding = useCallback(() => {
    try { window.localStorage.setItem(DONE_KEY, '1'); } catch { /* quota */ }
    router.push('/');
  }, [router]);

  const skipStep = useCallback((current: Step) => {
    if (current < FINAL_STEP) {
      goto((current + 1) as Step);
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
        <div className="onb-progress" aria-label={`Step ${state.current_step} of ${FINAL_STEP}`}>
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
          <Step3CliCheck
            onBack={() => goto(2)}
            onNext={() => goto(4)}
            onSkipStep={() => skipStep(3)}
            onSkipOnboarding={skipOnboarding}
          />
        )}
        {state.current_step === 4 && (
          <Step4TryDelegating
            personaId={state.persona_id}
            gmailConnected={false}
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

'use client';

/**
 * Step 1 — Welcome + persona picker.
 *
 * Reverted per owner directive 2026-05-20T~01:44Z:
 *   "你现在 onboarding 先聊聊你 ... 这个很 ugly 啊 还是以前的"
 *   → back to original persona-picker welcome. NOT the 7-Q form (ugly).
 *
 * The pain-point interview now lives at /meeting as a conversational
 * LLM chat. ChatEmpty chip routes there when the nudge state fires.
 *
 * Interface uses onNext (current onboarding/page.tsx call signature)
 * instead of old onPicked so no caller changes are needed.
 */

import { useEffect, useState } from 'react';
import type { PersonaPreset } from '@holon/core';
import { useT } from '../../../lib/i18n/useT';

interface Props {
  onNext: () => void;
  onSkipStep: () => void;
  onSkipOnboarding: () => void;
}

export function Step1Welcome({ onNext, onSkipStep, onSkipOnboarding }: Props) {
  const { t } = useT();
  const [personas, setPersonas] = useState<PersonaPreset[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/v1/personas')
      .then((r) => r.json())
      .then((j: { items: PersonaPreset[] }) => setPersonas(j.items ?? []))
      .catch(() => setPersonas([]));
  }, []);

  async function pick(p: PersonaPreset | null) {
    setError(null);
    const id = p?.id ?? 'custom';
    setPending(id);
    try {
      if (p) {
        const r = await fetch('/api/v1/me/apply-persona', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ persona_id: p.id }),
        });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          setError((j as { error?: string }).error ?? `HTTP ${r.status}`);
          setPending(null);
          return;
        }
      }
      setSelectedId(id);
      onNext();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPending(null);
    }
  }

  return (
    <>
      <h1 className="onb-title">{t('onboarding.step1.title', 'Welcome to Holon')}</h1>
      <p className="onb-sub">
        {t(
          'onboarding.step1.body',
          "Holon gives you a small team of AI staff who work at your desk \u2014 drafting emails, summarizing inboxes, putting decks together. Pick the role that fits you best and we'll set up sensible defaults. You can change anything later in Settings.",
        )}
      </p>

      <div className="onb-persona-grid">
        {personas.map((p) => {
          const isSel = selectedId === p.id;
          const isPending = pending === p.id;
          return (
            <button
              key={p.id}
              type="button"
              className={`onb-persona-card${isSel ? ' selected' : ''}`}
              onClick={() => pick(p)}
              disabled={pending !== null}
              aria-pressed={isSel}
            >
              <span className="icon">{p.icon}</span>
              <span className="name">{p.name}</span>
              <span className="tag">{p.tagline}</span>
              {isPending && <span className="tag" style={{ fontStyle: 'italic' }}>Applying\u2026</span>}
            </button>
          );
        })}
        <button
          type="button"
          className={`onb-persona-card${selectedId === 'custom' ? ' selected' : ''}`}
          onClick={() => pick(null)}
          disabled={pending !== null}
        >
          <span className="icon">✏️</span>
          <span className="name">{t('onboarding.step1.custom_card_label', "None of these fit \u2014 I'll customize")}</span>
          <span className="tag">{t('onboarding.step1.custom_card_tag', 'Skip the preset and describe your role yourself in the next step.')}</span>
        </button>
      </div>

      {personas.length === 0 && (
        <div className="onb-sub" style={{ fontStyle: 'italic' }}>Loading roles\u2026</div>
      )}
      {error && (
        <div className="onb-sub" style={{ color: 'var(--red, #c0392b)' }}>{error}</div>
      )}

      <div className="onb-controls">
        <button
          type="button"
          className="btn onb-skip-link onb-skip-heavy"
          onClick={onSkipOnboarding}
          title="Exit onboarding entirely. Resume any time from /me \u2192 Replay onboarding."
        >
          {t('onboarding.skip_onboarding', 'Skip onboarding')}
        </button>
        <div className="spacer" />
        <button
          type="button"
          className="btn"
          onClick={onSkipStep}
          title="Move to the next step without picking a role. You can set one later from /me."
        >
          {t('onboarding.skip_this_step', 'Skip this step')}
        </button>
      </div>
      <p className="onb-sub onb-skip-hint">
        You can complete this later from <a href="/me">/me \u2192 Replay onboarding</a>.
      </p>
    </>
  );
}

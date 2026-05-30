'use client';

/**
 * Step 2 — About you. Captures owner_name + owner_intro.
 *
 * Pre-fills owner_name + owner_intro from the persona's default
 * (loaded via /api/v1/me which returns the OwnerAssistant — already
 * mutated by Step 1's apply-persona). owner_name is the only required
 * field; Next is disabled until it has content.
 *
 * iter-017 V1.0 replay: when owner re-enters /onboarding from
 * /me Settings ("Replay onboarding"), useOwner() returns the live
 * record so this form pre-fills with the current values — user can
 * review, edit, or just hit Next (PATCH is idempotent). Full Pass #13
 * lifecycle (skip-if-unchanged short-circuit, audit, badge) deferred
 * to V1.1.
 *
 * Reuses the /api/v1/me PATCH endpoint (whitelist includes both
 * owner_name + owner_intro per route.ts ALLOWED_FIELDS).
 */

import { useEffect, useState } from 'react';
import { invalidateOwner, useOwner } from '../../../lib/hooks/useOwner';
import { useT } from '../../../lib/i18n/useT';

interface Props {
  onBack: () => void;
  onNext: () => void;
  onSkipStep: () => void;
  onSkipOnboarding: () => void;
}

export function Step2AboutYou({ onBack, onNext, onSkipStep, onSkipOnboarding }: Props) {
  const { owner } = useOwner();
  const { t } = useT();
  const [name, setName] = useState('');
  const [intro, setIntro] = useState('');
  const [introPlaceholder, setIntroPlaceholder] = useState('');
  const [language, setLanguage] = useState<'auto' | 'en' | 'zh-CN'>('auto');
  const [hydrated, setHydrated] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Prefill form once the owner record is available. Guarded by
  // `hydrated` so user keystrokes after first paint aren't clobbered
  // by a late hook re-fetch (e.g. holon:reset event).
  useEffect(() => {
    if (hydrated || !owner) return;
    setName(owner.owner_name ?? '');
    setIntro(owner.owner_intro ?? '');
    setIntroPlaceholder(owner.owner_intro || 'e.g. "I run a 6-person trade-show booth-design firm in Frankfurt. Most of my week is client emails, supplier coordination, and quoting new projects."');
    setLanguage(owner.language_preference ?? 'auto');
    setHydrated(true);
  }, [owner, hydrated]);

  async function saveAndNext() {
    if (!name.trim()) { setError('Please enter your name so your AI knows how to greet you.'); return; }
    setSaving(true);
    setError(null);
    try {
      const r = await fetch('/api/v1/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner_name: name.trim(), owner_intro: intro.trim(), language_preference: language }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${r.status}`);
      }
      // Invalidate the shared cache so siblings (ChatEmptyState, etc.)
      // pick up the new name/intro on their next read.
      invalidateOwner();
      onNext();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <h1 className="onb-title">Tell us about yourself</h1>
      <p className="onb-sub">
        Your AI staff will greet you by name and use your short intro as
        background context — so its first draft sounds like it understands
        your business, not a generic template.
      </p>

      <div className="onb-card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 12, color: 'var(--ink-mute)' }}>Language</span>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value as 'auto' | 'en' | 'zh-CN')}
            style={{
              padding: '8px 12px', borderRadius: 10, border: '1px solid var(--ink)',
              fontSize: 14, fontFamily: 'inherit', color: 'var(--ink)', background: '#fff',
              outline: 'none',
            }}
          >
            <option value="auto">Auto (detect from browser)</option>
            <option value="en">English</option>
            <option value="zh-CN">中文 (Simplified)</option>
          </select>
          <span style={{ fontSize: 11, color: 'var(--ink-mute)', fontStyle: 'italic' }}>
            {t('onboarding.step2.language_caveat_partial', 'Most of the UI already speaks your language. A few advanced screens will follow.')}
          </span>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 12, color: 'var(--ink-mute)' }}>Your name (what should we call you?)</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Sarah"
            style={{
              padding: '8px 12px', borderRadius: 10, border: '1px solid var(--ink)',
              fontSize: 14, fontFamily: 'inherit', color: 'var(--ink)', background: '#fff',
              outline: 'none',
            }}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 12, color: 'var(--ink-mute)' }}>One or two sentences about your business (optional, but recommended)</span>
          <textarea
            value={intro}
            onChange={(e) => setIntro(e.target.value)}
            placeholder={introPlaceholder}
            rows={5}
            style={{
              padding: '10px 12px', borderRadius: 10, border: '1px solid var(--ink)',
              fontSize: 13, fontFamily: 'inherit', color: 'var(--ink)', background: '#fff',
              outline: 'none', lineHeight: 1.5, resize: 'vertical',
            }}
          />
        </label>
        {error && <div style={{ fontSize: 13, color: 'var(--red, #c0392b)' }}>{error}</div>}
      </div>

      <div className="onb-controls">
        <button type="button" className="btn" onClick={onBack} disabled={saving}>Back</button>
        <button
          type="button"
          className="btn onb-skip-link onb-skip-heavy"
          onClick={onSkipOnboarding}
          disabled={saving}
          title="Exit onboarding entirely. Resume any time from /me → Replay onboarding."
        >
          {t('onboarding.skip_onboarding', 'Skip onboarding')}
        </button>
        <div className="spacer" />
        <button
          type="button"
          className="btn"
          onClick={onSkipStep}
          disabled={saving}
          title="Move to the next step without saving these fields. You can fill them in later from /me."
        >
          {t('onboarding.skip_this_step', 'Skip this step')}
        </button>
        <button type="button" className="btn btn-primary" onClick={saveAndNext} disabled={saving || !name.trim()}>
          {saving ? 'Saving…' : 'Next'}
        </button>
      </div>
    </>
  );
}

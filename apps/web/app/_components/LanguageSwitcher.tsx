'use client';

import { useState } from 'react';
import type { OwnerAssistant } from '@holon/api-contract';
import { primeOwner, useOwner } from '../../lib/hooks/useOwner';
import { getEffectiveLanguage } from '../../lib/i18n/get-effective-language';
import { useT } from '../../lib/i18n/useT';
import { reloadForLanguageChange, type ExplicitLang } from './language-reload';

export function LanguageSwitcher({ collapsed = false, hideLabel = false }: { collapsed?: boolean; hideLabel?: boolean }) {
  const { t } = useT();
  // `error` surfaces a failed GET /api/v1/me — without this the provider
  // silently falls back to 'en', which is exactly how a transient server
  // hiccup after the reload masquerades as "the switcher is a dummy"
  // (bug-20260522). Engineering Rule #4: no silent failure.
  const { owner, error: ownerError } = useOwner();
  const current: ExplicitLang = owner
    ? getEffectiveLanguage(owner, typeof navigator !== 'undefined' ? navigator.language : undefined)
    : 'en';
  const [saving, setSaving] = useState<ExplicitLang | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function setLanguage(next: ExplicitLang) {
    // Early-return only when the *effective* UI language already matches the
    // requested one (so clicking the already-active button is a no-op).
    // The previous `next === owner?.language_preference` guard mis-fired on
    // 'auto'/undefined preferences — it never matched, forcing a needless
    // reload — and never short-circuited the active button. Compare against
    // the resolved `current` instead.
    if (saving || next === current) return;
    setSaving(next);
    setError(null);
    const res = await fetch('/api/v1/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language_preference: next } satisfies Partial<OwnerAssistant>),
    }).catch((e: unknown) => {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    });
    if (!res) {
      setSaving(null);
      return;
    }
    if (!res.ok) {
      setError(`HTTP ${res.status}`);
      setSaving(null);
      return;
    }
    const updated = await res.json().catch((e: unknown) => {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    }) as OwnerAssistant | null;
    if (updated) primeOwner(updated);
    reloadForLanguageChange(next);
  }

  const title = current === 'zh-CN' ? '切换语言' : 'Switch language';

  return (
    <div className="language-switcher" title={collapsed ? title : undefined}>
      {!collapsed && !hideLabel && <span className="language-switcher-label">{current === 'zh-CN' ? '语言' : 'Language'}</span>}
      <div className="language-switcher-options" aria-label={title}>
        <button
          type="button"
          className={current === 'zh-CN' ? 'active' : undefined}
          onClick={() => { void setLanguage('zh-CN'); }}
          disabled={saving !== null}
          aria-pressed={current === 'zh-CN'}
        >
          中
        </button>
        <button
          type="button"
          className={current === 'en' ? 'active' : undefined}
          onClick={() => { void setLanguage('en'); }}
          disabled={saving !== null}
          aria-pressed={current === 'en'}
        >
          EN
        </button>
      </div>
      {saving && !collapsed && <span className="language-switcher-label">{t('me.preferences.language_hint')}</span>}
      {error && !collapsed && <span className="language-switcher-error">{t('language_switcher.save_failed')}</span>}
      {ownerError && !collapsed && !error && (
        <span className="language-switcher-error">{t('language_switcher.load_failed')}</span>
      )}
    </div>
  );
}

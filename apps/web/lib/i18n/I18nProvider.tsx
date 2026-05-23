'use client';

/**
 * I18nProvider — V1.0 minimal i18n framework (iter-017 Pass #12 part 1).
 *
 * Intentionally MICRO: no next-intl, no react-intl, no ICU. Just a
 * Context that picks dict[lang][key] || dict.en[key] || fallback || key.
 *
 * Why micro:
 *   - Phase A (91a2127) added `owner.language_preference` + onboarding /
 *     /me dropdown. Nav single-language render (d1af814/52a7e43) proved
 *     out the resolution rule (getEffectiveLanguage).
 *   - But Nav was the only thing translated. Owner directive 2026-05-19
 *     ('其他的page没有换啊') — pull the rest of the product over.
 *   - V1.1 Pass #12 part 2 can swap this for next-intl + CI sync check
 *     + auto-fix translation agent. The hook surface (useT().t) stays.
 *
 * Mount at the AppShell client-boundary in app/layout.tsx (NOT around
 * server components — Context only works under a Client Component).
 *
 * Owner === null (still loading /me) → defaults to 'en' to match the
 * Nav fallback and avoid a flash of wrong language on first paint.
 */

import { createContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useOwner } from '../hooks/useOwner';
import { getEffectiveLanguage } from './get-effective-language';
import enDict from './dictionary/en.json';
import zhDict from './dictionary/zh-CN.json';

export type Lang = 'en' | 'zh-CN';

type Dict = Record<string, string>;

const DICTIONARIES: Record<Lang, Dict> = {
  en: enDict as Dict,
  'zh-CN': zhDict as Dict,
};

export interface I18nContextValue {
  lang: Lang;
  dict: Dict;
}

export const I18nContext = createContext<I18nContextValue>({
  lang: 'en',
  dict: enDict as Dict,
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const { owner } = useOwner();

  /* navigator.language is only safe to read on the client AFTER mount —
   * during SSR / first hydration tick `typeof navigator === 'undefined'`.
   * We resolve to 'en' during hydration then re-resolve when owner lands
   * (matches Nav.tsx behavior). */
  const [navLang, setNavLang] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (typeof navigator !== 'undefined') setNavLang(navigator.language);
  }, []);

  const lang: Lang = useMemo(() => {
    if (!owner) return 'en';
    return getEffectiveLanguage(owner, navLang);
  }, [owner, navLang]);

  const value = useMemo<I18nContextValue>(() => ({
    lang,
    dict: DICTIONARIES[lang],
  }), [lang]);

  /* Stash the live dict on globalThis so non-React-context consumers
   * (assistant-ui adapter generators, event listeners, fetch-side
   * error rendering) can read translations without lifting all of that
   * code into a hook. Updated whenever language flips. Owner directive
   * 2026-05-19 19:48 (chat cancelled-footer i18n). */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const g = window as unknown as { __holonI18nDict?: Record<string, string> };
    g.__holonI18nDict = DICTIONARIES[lang];
  }, [lang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

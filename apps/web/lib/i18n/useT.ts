'use client';

/**
 * useT — V1.0 minimal translation hook.
 *
 *   const { t, lang, tFmt } = useT();
 *   t('today.page_title')                     // "Today" | "今日"
 *   t('today.page_title', 'Today')            // same, with fallback if key missing
 *   tFmt('members.count', { n: 3 })           // replaces {n}
 *
 * Lookup chain: dict[lang][key] → dict.en[key] → fallback → key.
 *
 * Returning `lang` from the same hook lets components do conditional
 * branching when the english/chinese sentences don't decompose 1:1
 * (e.g. mid-sentence <strong>), without forcing a second hook call.
 *
 * Pure lookup. No proxy. No tagged-template magic. We pay the
 * complexity later if V1.1 swaps to next-intl.
 */

import { useContext, useCallback } from 'react';
import { I18nContext, type Lang } from './I18nProvider';
import enDict from './dictionary/en.json';

const EN: Record<string, string> = enDict as Record<string, string>;

export interface UseTReturn {
  t: (key: string, fallback?: string) => string;
  tFmt: (key: string, vars: Record<string, string | number>, fallback?: string) => string;
  lang: Lang;
}

export function useT(): UseTReturn {
  const { dict, lang } = useContext(I18nContext);

  const t = useCallback((key: string, fallback?: string): string => {
    const v = dict[key];
    if (typeof v === 'string') return v;
    const fb = EN[key];
    if (typeof fb === 'string') return fb;
    return fallback ?? key;
  }, [dict]);

  const tFmt = useCallback((key: string, vars: Record<string, string | number>, fallback?: string): string => {
    let s = t(key, fallback);
    for (const [k, v] of Object.entries(vars)) {
      s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
    return s;
  }, [t]);

  return { t, tFmt, lang };
}

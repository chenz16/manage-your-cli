'use client';

export type ExplicitLang = 'en' | 'zh-CN';

const ONE_YEAR_SECONDS = 31_536_000;

export function setHolonLangCookie(language: ExplicitLang): void {
  document.cookie = `holon-lang=${language}; path=/; max-age=${ONE_YEAR_SECONDS}`;
}

export function reloadForLanguageChange(language: ExplicitLang, delayMs = 250): void {
  setHolonLangCookie(language);
  window.setTimeout(() => window.location.reload(), delayMs);
}

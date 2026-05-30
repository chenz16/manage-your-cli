import type { OwnerAssistant } from '@holon/api-contract';

/**
 * iter-017 Phase A — resolve the effective UI language for an owner.
 *
 * Phase A persists `owner.language_preference` but does NOT swap UI
 * strings yet (full i18n framework with t() + locale files lands in
 * V1.1 iter-017 Pass). Call sites that already gate on a language
 * (e.g. Nav's dual-label rendering by agent ad3f0f93d45f62d03) can
 * consume this helper today; everything else inherits browser default.
 *
 * Resolution order:
 *   1. Explicit owner.language_preference ('en' | 'zh-CN')
 *   2. navigatorLanguage prefix-match on 'zh' → 'zh-CN'
 *   3. Fallback → 'en'
 */
export function getEffectiveLanguage(
  owner: Pick<OwnerAssistant, 'language_preference'>,
  navigatorLanguage?: string,
): 'en' | 'zh-CN' {
  if (owner.language_preference === 'en') return 'en';
  if (owner.language_preference === 'zh-CN') return 'zh-CN';
  if (navigatorLanguage?.startsWith('zh')) return 'zh-CN';
  // Product default is zh-CN (WeChat/mobile-first product for Chinese users).
  return 'zh-CN';
}

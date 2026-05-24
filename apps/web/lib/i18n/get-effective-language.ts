/**
 * getEffectiveLanguage — single source of truth for "which UI language
 * should this owner see, right now".
 *
 * Lives in apps/web/lib/i18n/ (NOT @holon/core) because L-082 caught a
 * P0 client-bundle regression when Nav.tsx imported the same helper
 * from @holon/core: the barrel pulled worker-dispatcher →
 * node:child_process, which webpack can't bundle for client components.
 *
 * Inlined copy from packages/core/src/owner-language.ts. Pure function,
 * 8 lines, zero deps. Nav.tsx + I18nProvider both import from here so
 * the rule stays in exactly one place on the client side; @holon/core
 * stays server-only.
 */
import type { OwnerAssistant } from '@holon/api-contract';

export function getEffectiveLanguage(
  owner: Pick<OwnerAssistant, 'language_preference'>,
  navigatorLanguage?: string,
): 'en' | 'zh-CN' {
  if (owner.language_preference === 'en') return 'en';
  if (owner.language_preference === 'zh-CN') return 'zh-CN';
  if (navigatorLanguage?.startsWith('zh')) return 'zh-CN';
  // Product default is zh-CN (WeChat/mobile-first product for Chinese users).
  // Only 'en' explicit preference overrides to English; auto + browser-zh → zh-CN.
  return 'zh-CN';
}

'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import clsx from 'clsx';
import type { ReactNode } from 'react';
import type { OptionalFeature } from '@holon/api-contract';
import { useOwner } from '../../lib/hooks/useOwner';
import { getEffectiveLanguage } from '../../lib/i18n/get-effective-language';

// 2026-05-19 (iter-017 Pass #12 part 1): the previously-inlined
// getEffectiveLanguage moved to apps/web/lib/i18n/get-effective-language.ts
// so Nav + I18nProvider share one client-safe copy. NOT @holon/core —
// L-082: barrel-import there pulls worker-dispatcher → node:child_process
// and breaks the client bundle.

/* CRITICAL: use `next/link`, NOT plain <a href>. Plain anchors trigger
 * full page reloads which destroy all client state (chat history,
 * assistant-ui runtime, every React component). The chat-persistence
 * bug reported 2026-05-16 was caused by this. */

/**
 * Vertical sidebar navigation (L-014 · 2026-05-18 — Copilot-style).
 * Pre-L-014 this was a horizontal tab strip; the active item is now
 * highlighted in a vertical stack along the left rail.
 *
 * `collapsed` (controlled by parent AppShell): when true, only icons
 * render; the parent rail width shrinks to 56px. Labels still show on
 * hover via tooltip (title attribute). Active item is highlighted via
 * `usePathname()`.
 *
 * Owner settings stay pinned to the rail floor so the nav remains focused.
 */

interface NavItem {
  key: string;
  href: string;
  label: string;
  /** Chinese label for the item. Per owner directive 2026-05-19
   * ('不要混杂 选择一个就行') Nav renders ONE language based on
   * owner.language_preference (resolved via getEffectiveLanguage).
   * labelZh is also concatenated into the collapsed-rail tooltip
   * ("Today · 今日") since collapsed mode has no inline text. */
  labelZh?: string;
  icon: ReactNode;
  /** Path pattern that marks this item active. */
  activeWhen: (path: string) => boolean;
  optionalFeature?: OptionalFeature;
}

/* Nav restructured 2026-05-19 (ADR-029 alignment): the left rail now
 * reads as DAILY VERBS first, configuration second. Primary group =
 * owner's everyday actions (see status, triage incoming, review
 * deliverables, manage the team). Library group = catalogs the owner
 * curates occasionally, NOT every-session traffic.
 *
 * Pre-2026-05-19 layout had Team buried in the secondary group next to
 * Skills/References, treating "manage employees" as a supporting
 * activity. That's wrong for B2B SMB owners: managing the team IS the
 * daily work. Team is promoted to primary. Skills + References stay
 * accessible but visually de-weighted under a small "LIBRARY" caption,
 * mirroring how Notion/Linear surface "secondary catalogs" without
 * stealing eye-fixation from work verbs.
 *
 * Home renamed to "Today" — verb-form, matches the underlying route
 * concept (/ and /today share intent: "what's happening right now"). */
const primaryItems: NavItem[] = [
  {
    key: 'chat',
    href: '/',
    label: 'Chat',
    labelZh: '??',
    activeWhen: (p) => p === '/',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
      </svg>
    ),
  },
  {
    key: 'todo',
    href: '/today',
    label: 'Today',
    labelZh: 'Today',
    optionalFeature: 'todo',
    activeWhen: (p) => p.startsWith('/today'),
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 6h13" />
        <path d="M8 12h13" />
        <path d="M8 18h13" />
        <path d="M3 6h.01" />
        <path d="M3 12h.01" />
        <path d="M3 18h.01" />
      </svg>
    ),
  },
  {
    key: 'members',
    href: '/members',
    label: 'Team',
    labelZh: 'Team',
    optionalFeature: 'members',
    activeWhen: (p) => p.startsWith('/members'),
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    key: 'deliverables',
    href: '/deliverables',
    label: 'Drops',
    labelZh: 'Drops',
    optionalFeature: 'deliverables',
    activeWhen: (p) => p.startsWith('/deliverables'),
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6" />
        <path d="M9 15l2 2 4-5" />
      </svg>
    ),
  },
  {
    key: 'bugs',
    href: '/bugs',
    label: 'Bug Report',
    labelZh: 'Bug Report',
    optionalFeature: 'bugs',
    activeWhen: (p) => p.startsWith('/bugs'),
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="8" y="6" width="8" height="14" rx="4" />
        <path d="M12 2v4" />
        <path d="M5 9l3 2" /><path d="M19 9l-3 2" />
        <path d="M3 14h5" /><path d="M16 14h5" />
        <path d="M5 19l3-2" /><path d="M19 19l-3-2" />
      </svg>
    ),
  },
];

const secondaryItems: NavItem[] = [
  {
    key: 'skills',
    href: '/skills',
    label: 'Skills',
    optionalFeature: 'skills',
    labelZh: '技能',
    activeWhen: (p) => p.startsWith('/skills'),
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2l3 7h7l-5.5 4.5L18.5 21 12 16.8 5.5 21l2-7.5L2 9h7z" />
      </svg>
    ),
  },
  {
    key: 'references',
    href: '/references',
    label: 'References',
    optionalFeature: 'references',
    labelZh: '资料',
    activeWhen: (p) => p.startsWith('/references'),
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5z" />
      </svg>
    ),
  },
  {
    key: 'templates',
    href: '/templates',
    label: 'Templates',
    optionalFeature: 'templates',
    labelZh: '模板',
    activeWhen: (p) => p.startsWith('/templates'),
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6" />
        <path d="M8 13h8" />
        <path d="M8 17h5" />
      </svg>
    ),
  },
  {
    key: 'connectors',
    href: '/connectors',
    label: 'Connectors',
    labelZh: 'Connectors',
    optionalFeature: 'connectors',
    activeWhen: (p) => p.startsWith('/connectors'),
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 2v6" />
        <path d="M15 2v6" />
        <rect x="6" y="8" width="12" height="6" rx="2" />
        <path d="M12 14v4a4 4 0 0 1-4 4H6" />
      </svg>
    ),
  },
];

/* 2026-05-18 (bug-20260518-045748): Me-gear pinned to the bottom of
 * the rail — VS Code / Discord / Linear / Slack pattern where
 * profile/settings live at the rail floor. Owner direction is explicit
 * ("把config放到左下角 大家都这么做"); supersedes the inline placement
 * from bug-044356. The footer uses `margin-top: auto` so the gear sits
 * against the rail floor regardless of viewport height.
 *
 * Label is just "Me" — NOT "Me · Config" (bug-20260518-124449). Owner
 * direction from bug-034009 ("齿轮就行了 不需要字体") and bug-123933
 * ("把文字拿掉") is that the word "Config" should not appear anywhere
 * visible — gear icon is self-explanatory. Prior fixes only removed the
 * visible label span but left "Me · Config" in `title`/`aria-label`,
 * which still surfaces as a hover tooltip with the unwanted "Config"
 * text. Tooltip is now plain "Me". */
const footerItems: NavItem[] = [
  {
    key: 'me',
    href: '/me',
    label: 'Me',
    activeWhen: (p) => p.startsWith('/me'),
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
  },
];

interface NavProps {
  collapsed?: boolean;
}

export function Nav({ collapsed = false }: NavProps) {
  const path = usePathname();
  /* Single-language rendering (2026-05-19, supersedes 87ed934 stacked
   * bilingual per owner directive '不要混杂 选择一个就行'). Owner picks
   * EN or zh-CN in /me Settings (Phase A · 91a2127); we render only that
   * one. owner === null (still loading) → English fallback so there's no
   * flash of wrong language. Collapsed-rail tooltip stays bilingual —
   * collapsed mode loses ALL inline text, so the hover hint is the one
   * place we keep both languages as a small affordance. */
  const { owner } = useOwner();
  const hiddenFeatures = new Set<OptionalFeature>(owner?.hidden_features ?? []);
  const visiblePrimaryItems = primaryItems.filter((item) => !item.optionalFeature || !hiddenFeatures.has(item.optionalFeature));
  const visibleSecondaryItems = secondaryItems.filter((item) => !item.optionalFeature || !hiddenFeatures.has(item.optionalFeature));
  const lang = owner
    ? getEffectiveLanguage(owner, typeof navigator !== 'undefined' ? navigator.language : undefined)
    : 'en';

  function renderItem(item: NavItem, opts?: { iconOnly?: boolean }) {
    const iconOnly = opts?.iconOnly === true;
    const displayLabel = lang === 'zh-CN' && item.labelZh ? item.labelZh : item.label;
    return (
      <Link
        key={item.key}
        href={item.href}
        className={clsx('nav-item', iconOnly && 'nav-item-icon-only', item.activeWhen(path) && 'active')}
        data-nav={item.key}
        aria-current={item.activeWhen(path) ? 'page' : undefined}
        /* Collapsed-mode tooltip stays bilingual ("Today · 今日") — the
         * one place we surface both languages, since collapsed rail has
         * no inline text at all. Expanded mode tooltip matches the
         * single chosen language. */
        title={iconOnly && item.labelZh ? `${item.label} · ${item.labelZh}` : displayLabel}
        aria-label={iconOnly ? displayLabel : undefined}
        prefetch={false}
      >
        <span className="nav-icon">{item.icon}</span>
        {!iconOnly && <span className="nav-label">{displayLabel}</span>}
      </Link>
    );
  }

  return (
    <nav className={clsx('nav', collapsed && 'nav-collapsed')} aria-label="Primary">
      {visiblePrimaryItems.map((item) => renderItem(item))}
      {/* ADR-029 alignment: "LIBRARY" caption introduces the catalog
       * group (Skills, References). Catalogs are configuration the owner
       * curates occasionally — they should look distinct from the work
       * verbs above so eye-fixation stays on Today/Inbound/Deliverables/
       * Team. Caption is hidden in collapsed-rail mode (icons only). */}
      {visibleSecondaryItems.length > 0 && (
        <>
          <div className="nav-section-label" aria-hidden="true">{lang === 'zh-CN' ? '资料' : 'Library'}</div>
          <div className="nav-secondary-group">
            {visibleSecondaryItems.map((item) => renderItem(item))}
          </div>
        </>
      )}
      {/* Me-gear pinned to the rail floor (bug-20260518-045748) — the
       * .nav-footer rule uses margin-top: auto to push this against the
       * bottom of the rail, mirroring VS Code / Discord / Linear.
       * Rendered icon-only (bug-20260518-123933) with label "Me" only
       * (bug-20260518-124449): owner has repeatedly asked that the word
       * "Config" not appear anywhere visible — including tooltip text. */}
      <div className="nav-footer">
        <div className="nav-divider" role="separator" aria-hidden="true" />
        {footerItems.map((item) => renderItem(item, { iconOnly: true }))}
      </div>
    </nav>
  );
}

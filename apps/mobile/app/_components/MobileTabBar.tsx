'use client';

// M-L-005 / M-L-007 / M-L-017 — 4-tab bottom nav per docs/mobile-architecture-principles.md
// Principle 2 (mobile menu = 4 max). Chinese labels matching desk's
// vision-v2-product-shape.md persona vocabulary.
//
// Route mapping (M-L-017 swapped 今日 → 成员; chat page absorbs today-strip):
//   工作台 → /chat   (chat + today-strip merged — control plane)
//   收件   → /inbound (peer missions awaiting owner approval — read-only V1)
//   成员   → /staff  (staff catalog · tap → /staff/detail?id=<id> · 派活 jumps back to /chat)
//   更多   → /more   (catalog of every desk surface; /today + /me deep-link here)

import {
  Inbox,
  LayoutList,
  MessageSquare,
  MessageSquareDot,
  Users,
  UsersRound,
} from 'lucide-react';
import { usePathname } from 'next/navigation';
import type { ComponentType, SVGProps } from 'react';
import { useTabBadges, type TabBadges } from './useTabBadges';

type IconComp = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;
type Tab = {
  href: string;
  label: string;
  icon: IconComp;
  iconActive?: IconComp;
  // M004 Pass #4 — names the badge slot this tab reads from useTabBadges().
  // Tabs without a badgeKey never render a dot.
  badgeKey?: keyof TabBadges;
};

// M-L-010: active variants give a stronger glance-while-walking signal.
// Lucide is outline-only; we pair Dot/Check siblings where available and
// fall back to a heavier strokeWidth in the markup for the rest.
// M-L-047 — trailing-slash hrefs so Capacitor's static-asset server resolves
// `/chat/` → `/chat/index.html` (trailingSlash:true export). isActive()
// normalizes both sides so the active-tab signal survives the slash form.
// Tab 2 is now 今日 → /today/ (boss backlog 待分配 + jobs). /inbound
// still exists as an alias but is no longer the primary nav entry.
const TABS: ReadonlyArray<Tab> = [
  { href: '/chat/',    label: '工作台', icon: MessageSquare, iconActive: MessageSquareDot, badgeKey: 'today' },
  { href: '/today/',   label: '今日',   icon: Inbox,         badgeKey: 'inbound' },
  { href: '/staff/',   label: '成员',   icon: Users,         iconActive: UsersRound },
  { href: '/more/',    label: '更多',   icon: LayoutList },
];

function stripSlash(p: string): string {
  return p !== '/' && p.endsWith('/') ? p.slice(0, -1) : p;
}

function isActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  const p = stripSlash(pathname);
  const h = stripSlash(href);
  if (p === '/' && h === '/chat') return true;
  if (p === h) return true;
  return p.startsWith(h + '/');
}

export function MobileTabBar() {
  const pathname = usePathname();
  const badges = useTabBadges();
  return (
    <nav className="bottom-tabs" aria-label="Holon mobile navigation">
      {TABS.map((t) => {
        const active = isActive(pathname, t.href);
        const Icon = active && t.iconActive ? t.iconActive : t.icon;
        const badgeCount = t.badgeKey ? badges[t.badgeKey] : 0;
        const hasBadge = badgeCount > 0;
        const ariaLabel = hasBadge ? `${t.label}, ${badgeCount} 待处理` : undefined;
        return (
          <a
            key={t.href}
            className={active ? 'tab-link active' : 'tab-link'}
            href={t.href}
            aria-current={active ? 'page' : undefined}
            aria-label={ariaLabel}
          >
            <span className="tab-icon-wrap">
              <Icon size={20} strokeWidth={active ? 2.3 : 1.9} aria-hidden="true" />
              {hasBadge && <span className="tab-badge" aria-hidden="true" />}
            </span>
            <span>{t.label}</span>
          </a>
        );
      })}
    </nav>
  );
}

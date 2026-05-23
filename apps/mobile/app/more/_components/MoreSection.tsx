'use client';

// M-L-007 — read-only card row for the /more entry-point.
// Title + one-line summary + small body preview + "在桌面端编辑" deep-link
// to the matching desk route. Per docs/mobile-architecture-principles.md
// Principle 1: mobile is a thin shell, never an editor.

import type { ReactNode } from 'react';
import { deskOrigin } from '../../_lib/desk-origin';

const DESK_ORIGIN = deskOrigin();

type Props = {
  title: string;
  summary: string;
  /** Optional right-aligned mini-badge on the title row (M-L-011, scannable
   *  counts inline with the section title — e.g., "3" or "5·12"). */
  badge?: string | undefined;
  /** Optional preview body — counts, names, etc. */
  children?: ReactNode;
  /** Desk route to deep-link, e.g. "/me", "/members". Opens desk:3000 in
   *  a new tab. Omit to hide CTA. Mutually exclusive with mobileHref. */
  deskHref?: string;
  /** Mobile-internal route, e.g. "/today" — opens in the same tab so it
   *  stays inside the phone-shell. Use this for surfaces that exist on the
   *  mobile side and SHOULD NOT round-trip through desk. */
  mobileHref?: string;
  /** Override CTA label (defaults to 在桌面端编辑 for deskHref, 打开 for mobileHref). */
  ctaLabel?: string;
};

export function MoreSection({ title, summary, badge, children, deskHref, mobileHref, ctaLabel }: Props) {
  const isInternal = Boolean(mobileHref);
  const href = isInternal ? mobileHref! : (deskHref ? `${DESK_ORIGIN}${deskHref}` : undefined);
  const label = ctaLabel ?? (isInternal ? '打开' : '在桌面端编辑');
  return (
    <article className="m-card more-section">
      <div className="more-row more-header">
        <div className="m-card-title">{title}</div>
        {badge && <span className="more-badge">{badge}</span>}
      </div>
      <div className="m-card-sub">{summary}</div>
      {children && <div className="more-row">{children}</div>}
      {href && (
        <a
          className="more-cta"
          href={href}
          {...(isInternal ? {} : { target: '_blank', rel: 'noopener noreferrer' })}
        >
          <span>{label}</span>
          <span className="m-chev">›</span>
        </a>
      )}
    </article>
  );
}

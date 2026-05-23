'use client';

/**
 * Empty-state coaching panel for `/members` (day-one SMB owner).
 *
 * Mounts iff the INITIAL roster payload has zero items (server-rendered
 * `initial.items.length === 0`) — NOT a filtered subview. Filter-driven
 * "0 in this kind" keeps the slim `deliv-empty` strip instead, so a user
 * who has hired staff doesn't get re-coached every time they flip the
 * Peer / Virtual / Linked / CLI chips.
 *
 * Persona target (Sarah-Chen pass · 2026-05-19 — mirrors InboundEmptyState
 * ship `8d837e8`, TodayEmptyState `ca17140`, ChatEmptyState `88bb4df`):
 *   - Finished /onboarding + first chat reply, navigated to /members
 *     expecting "my Desk AI" + her starter team.
 *   - Saw empty grid + a lone "+ Hire" button. Read as "the assistant I
 *     just talked to isn't even a member?" — confusion gap between the
 *     Desk AI (singular, attached to chat) and hired staff (plural,
 *     flat-roster per ADR-015).
 *   - Needs the Desk-AI-vs-Staff distinction surfaced AND a low-risk
 *     starter action ("just keep using chat") next to the hire path.
 *
 * Pure presentational addition — inline styles match InboundEmptyState
 * convention; no global CSS, no API surface change beyond reading the
 * sibling `owner_assistant` field already on ListStaffResponse.
 */

import type { ReactNode } from 'react';
import { useT } from '../../../lib/i18n/useT';

export function MembersEmptyState() {
  const { t } = useT();
  return (
    <section
      className="card"
      style={{ padding: 24, marginTop: 12, marginBottom: 16 }}
      aria-labelledby="members-empty-title"
    >
      <h2
        id="members-empty-title"
        className="section-title"
        style={{ margin: 0, fontSize: 20 }}
      >
        {t('members.empty.title')}
      </h2>
      <p style={{ fontSize: 13, color: 'var(--ink-mute)', lineHeight: 1.5, marginTop: 8, marginBottom: 16 }}>
        {t('members.empty.body_lead')}<strong>{t('members.empty.body_desk_ai')}</strong>{t('members.empty.body_mid')}<strong>{t('members.empty.body_staff')}</strong>{t('members.empty.body_tail')}<a href="/me" style={{ color: 'var(--ink-mute)' }}>/me</a>{t('members.empty.body_tail2')}
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
        <StarterLink href="/" label={t('members.empty.starter_chat')} />
        <StarterLink href="#hire" label={t('members.empty.starter_hire')} />
      </div>

      <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12, fontSize: 11, color: 'var(--ink-mute)', lineHeight: 1.5 }}>
        {t('members.empty.why_label')}{' '}
        <a
          href="/docs/decisions/015-myself-out-of-members.md"
          style={{ color: 'var(--ink-mute)', textDecoration: 'underline' }}
        >
          {t('members.empty.why_link')}
        </a>
      </div>
    </section>
  );
}

function StarterLink({ href, label }: { href: string; label: string }): ReactNode {
  return (
    <a
      href={href}
      className="btn"
      style={{
        fontSize: 13,
        padding: '8px 14px',
        border: '1px solid var(--line)',
        borderRadius: 8,
        textDecoration: 'none',
        color: 'var(--ink)',
        background: 'var(--bg)',
      }}
    >
      &rarr; {label}
    </a>
  );
}

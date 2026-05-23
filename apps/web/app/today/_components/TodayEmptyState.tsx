'use client';

/**
 * Empty-state coaching panel for `/today` (day-one SMB owner).
 *
 * Mounts iff the whole page is empty (zero queue items, all 6 buckets
 * empty, zero activity events). Replaces the otherwise-silent grid of
 * six "0" cards with an explainer of what the tracker is FOR plus 3
 * starter actions that unblock the first hour.
 *
 * Persona target (Sarah-Chen pass · 2026-05-19):
 *   - Just finished /onboarding + first /chat send → lands on /today.
 *   - Sees six unlabeled-feeling "0" cards, no activity, no queue.
 *   - Without coaching, reads as "broken" or "nothing to do here".
 *
 * Pure presentational addition - no store or API touched.
 * Bucket legend labels are pulled from the same BUCKET_META source
 * of truth in TodayClient.tsx (passed in via props) so a rename
 * there propagates here automatically — no drift.
 *
 * TODO(deferred): once we have telemetry on which starter action
 * SMB owners click first, swap the order. Likely "Hire" > "Skills"
 * > "Chat" for trade-show persona based on /onboarding completion
 * funnel.
 */

import type { ReactNode } from 'react';

export interface BucketLegendEntry {
  key: string;
  label: string;
  blurb: string;
}

export function TodayEmptyState({ legend }: { legend: ReadonlyArray<BucketLegendEntry> }) {
  return (
    <section
      className="card"
      style={{ padding: 24, marginTop: 12, marginBottom: 16 }}
      aria-labelledby="today-empty-title"
    >
      <h2
        id="today-empty-title"
        className="section-title"
        style={{ margin: 0, fontSize: 20 }}
      >
        Your work tracker is empty &mdash; that&rsquo;s expected on day one.
      </h2>
      <p style={{ fontSize: 13, color: 'var(--ink-mute)', lineHeight: 1.5, marginTop: 8, marginBottom: 16 }}>
        This page shows you everything in flight across your desk: work
        you&rsquo;ve delegated, what&rsquo;s coming in, and what&rsquo;s
        been delivered. Once you start delegating, things will appear
        here automatically.
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
        <StarterLink href="/" label="Start a chat with your desk AI" />
        <StarterLink href="/members" label="Hire a staff member" />
        <StarterLink href="/me" label="Set up your skills + integrations" />
      </div>

      <div style={{ borderTop: '1px solid var(--line)', paddingTop: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-mute)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
          What each bucket means
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 6, fontSize: 12, lineHeight: 1.5 }}>
          {legend.map((b) => (
            <div key={b.key} style={{ color: 'var(--ink-mute)' }}>
              <strong style={{ color: 'var(--ink)' }}>{b.label}</strong>
              {' — '}
              {b.blurb}
            </div>
          ))}
        </div>
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

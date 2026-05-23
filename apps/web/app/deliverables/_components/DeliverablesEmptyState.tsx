'use client';

/**
 * Empty-state coaching panel for `/deliverables` (day-one SMB owner).
 *
 * Mounts iff the underlying initial payload has zero items (not
 * just the current filter view). Sits ABOVE the existing chip-bar
 * + grid so the layout reads as a real surface from day one.
 *
 * Persona target (Sarah-Chen pass · 2026-05-19 — mirrors /today
 * ship `ca17140`, /chat ship `88bb4df`, /inbound this same ship):
 *   - Finished /onboarding + first /chat send. Navigated to
 *     /deliverables expecting "what's done".
 *   - Empty grid + "No deliverables yet. Ask the Desk AI for a
 *     write-up and it'll land here." (the old inline copy)
 *     reads as terse and doesn't explain the review loop.
 *   - Needs to know (a) what objects land here, and (b) the
 *     accept-ships / reject-revises review-loop semantics.
 *
 * Pure presentational addition - no store or API touched.
 * Inline styles match the TodayEmptyState convention; no CSS-class
 * debt for a transient day-one surface.
 *
 * TODO(deferred): bonus "N jobs in flight — deliverables will
 * appear here when they finish." line was spec'd, but the
 * /deliverables page only receives ListDeliverablesResponse —
 * surfacing an in-flight mission count would require either a
 * second server-side fetch in page.tsx (logic change) or a
 * client-side `/api/v1/missions` call (render-time fetch).
 * Both violate "presentational only / no API / no store" guard
 * for this ship. Wire when /deliverables payload grows an
 * `in_flight_count` field (additive contract change, separate
 * iteration).
 */

import type { ReactNode } from 'react';

export function DeliverablesEmptyState() {
  return (
    <section
      className="card"
      style={{ padding: 24, marginTop: 12, marginBottom: 16 }}
      aria-labelledby="deliverables-empty-title"
    >
      <h2
        id="deliverables-empty-title"
        className="section-title"
        style={{ margin: 0, fontSize: 20 }}
      >
        No drops yet &mdash; they show up here when staff finish work.
      </h2>
      <p style={{ fontSize: 13, color: 'var(--ink-mute)', lineHeight: 1.5, marginTop: 8, marginBottom: 16 }}>
        Every time one of your staff completes a job &mdash; a draft
        email, a PPT, a spreadsheet, a summary &mdash; the result
        lands here as a drop. You review it; if accepted,
        it ships.
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <StarterLink href="/" label="Delegate work via desk chat" />
        <StarterLink href="/skills" label="Check what your AI can do at /skills" />
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

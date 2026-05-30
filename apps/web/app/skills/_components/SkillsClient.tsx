'use client';

import { useEffect, useMemo, useState } from 'react';
import type { SkillDescriptor, SkillKind } from '@holon/core';
import type { TriageSkill } from '@holon/api-contract';
import { useT } from '../../../lib/i18n/useT';

const COLLAPSE_KEY = 'holon-skills-collapsed-v1';

function loadCollapsed(): Set<SkillKind> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(COLLAPSE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((x): x is SkillKind => typeof x === 'string') as SkillKind[]);
  } catch (error) {
    void error;
    return new Set();
  }
}

function saveCollapsed(s: Set<SkillKind>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...s]));
  } catch (error) { void error; }
}

const KIND_LABEL: Record<SkillKind, string> = {
  office: 'Office — PPT · Excel · PDF · Viz · Format',
  media: 'Media — Image · Video gen',
  engineering: 'Engineering — Build · Code · CI',
  communication: 'Communication — Email · Feishu · Meet · Discord',
  research: 'Research — Search · Browse · Digest',
  ops: 'Ops — Kanban · Files · Automations',
};

// Render order — high-traffic categories first.
const KIND_ORDER: SkillKind[] = ['office', 'media', 'engineering', 'communication', 'research', 'ops'];

// Kinds available when creating a NEW skill (full enum — no reservations).
const NEW_KIND_OPTIONS: SkillKind[] = ['office', 'media', 'engineering', 'communication', 'research', 'ops'];

// Hard-coded set of built-in (read-only-deletable) skill ids — the entries
// shipped in SKILL_CATALOG. Built-ins can be soft-hidden via DELETE (tombstone)
// but the × button is suppressed in the UI to keep the catalog stable; only
// user-defined skills (added via the modal) are user-deletable from this UI.
const BUILTIN_SKILL_IDS = new Set<string>([
  'make_slides', 'make_spreadsheet', 'make_pdf', 'make_chart', 'web_build',
  'summarize_inbox', 'format_deliverable', 'generate_image', 'generate_video',
  'browse_web', 'run_code', 'feishu_doc', 'google_meet', 'kanban',
  'decompose_task', 'ambiguity_probe',
  'create_agent', 'update_agent', 'dismiss_agent',
  'create_skill', 'update_skill', 'delete_skill',
  'create_template', 'update_template', 'delete_template',
  'extract_references', 'create_reference', 'update_reference', 'delete_reference',
  'discord_post',
  // bug-184313: catalog skills whose ids were missing from the built-in set —
  // they rendered under "Yours" instead of "Store".
  'summarize_email_brief', 'help',
]);

/**
 * Hand-written "when to use this" hints for well-known catalog skills.
 * Written for Sarah-Chen (SMB owner) persona — plain English, concrete
 * trigger phrase, what she gets back. Skills not in this map fall back to
 * a kind-based generic hint (see kindHint()). Add entries here as new
 * catalog skills land or when usage telemetry shows a hint is missing.
 *
 * Why a const map in the component (not the manifest):
 *   - keeps the manifest stable (no schema migration)
 *   - copy iteration is UI-team-owned, doesn't require a backend reviewer
 *   - if/when this grows past ~20 entries we promote to manifest field
 *     `sarah_chen_blurb?: string` (kept optional / backward-compat).
 */
const WHEN_TO_USE: Record<string, string> = {
  make_slides:        'When you ask "make a deck about X" — returns an outline first, then a real .pptx file.',
  make_spreadsheet:   'When you have a CSV or numbers to crunch — outputs an .xlsx with a summary of what changed.',
  make_pdf:           'When you need a printable / shareable polished document — outputs a real .pdf file.',
  make_chart:         'When you say "show this as a chart" — picks bar/line/pie automatically, returns image or interactive HTML.',
  summarize_inbox:    'When you ask "what\'s in my inbox?" — triages threads into actions, not a wall of text.',
  format_deliverable: 'Auto-runs after staff finishes a job — turns raw work into a clean report with title, summary, and links.',
  generate_image:     'When you need a hero image / mockup / illustration — describe it in plain words, get a PNG.',
  generate_video:     'When you need a short product demo / promo clip — describe a scene, get an MP4.',
  browse_web:         'When you ask about something current ("what did competitor X announce?") — staff actually opens pages, not training data.',
  run_code:           'When a request needs real computation (math, parsing, scraping) — staff runs Python sandboxed and returns the result.',
  google_meet:        'When you say "schedule a call with X" — creates the Meet link and the calendar invite in one shot.',
  feishu_doc:         'When your team lives in Feishu — staff can read/write Feishu docs as part of a job.',
  discord_post:       'When you want staff to drop an update in a Discord channel (standup, release note, alert).',
  kanban:             'When staff needs to move a card on your board — "mark the design task as done", "move login to In Review".',
  decompose_task:     'Used internally — staff breaks a vague request into ordered steps before starting work.',
  ambiguity_probe:    'Used internally — staff asks YOU a clarifying question when a request is too vague to start safely.',
};

const KIND_HINT: Record<SkillKind, string> = {
  office:        'When you need a polished office file (deck, spreadsheet, PDF, chart).',
  media:         'When you need an image, video, or other media asset generated.',
  engineering:   'When the request needs real code, a build, or a deploy.',
  communication: 'When staff needs to send / read a message in your email or chat tool.',
  research:      'When the answer requires looking things up on the live web, not training data.',
  ops:           'When staff needs to move files, update a board, or run a background automation.',
};

function whenToUseHint(s: SkillDescriptor): string {
  return WHEN_TO_USE[s.id] ?? KIND_HINT[s.kind];
}

function prefillComposer(text: string): void {
  // Reuses the same custom-event bridge wired by ChatSurface's
  // ComposerPrefillBridge (see UX review agent's recent changes).
  // If chat isn't mounted (e.g. on /skills which has no split layout),
  // this just no-ops — the user has the text in their clipboard via
  // the on-screen example anyway.
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('holon:prefill-composer', { detail: { text } }));
}

function scrollToSkill(id: string): void {
  if (typeof document === 'undefined') return;
  const el = document.querySelector(`[data-skill-id="${id}"]`);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('skill-card-flash');
    setTimeout(() => el.classList.remove('skill-card-flash'), 1200);
  }
}

function SkillCard({ s, openId, setOpenId, byId, onDeleted, isExample = false }: {
  s: SkillDescriptor;
  openId: string | null;
  setOpenId: (id: string | null) => void;
  byId: Map<string, SkillDescriptor>;
  onDeleted: (id: string) => void;
  /** Render as a "STORE" (built-in catalog) card — adds badge + subtle tint
   *  so Sarah can tell at-a-glance whether a card is hers vs. a built-in. */
  isExample?: boolean;
}) {
  const open = openId === s.id;
  const calls = s.calls ?? [];
  const consults = s.consults ?? [];
  const [deleting, setDeleting] = useState(false);

  // Built-ins are protected from delete in the UI — only user-defined
  // skills (added via the + New modal) are deletable here.
  const canDelete = !BUILTIN_SKILL_IDS.has(s.id);
  const hint = whenToUseHint(s);

  async function onDelete() {
    if (!window.confirm(`Delete skill "${s.name}"? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      const resp = await fetch(`/api/v1/skills/${encodeURIComponent(s.id)}`, { method: 'DELETE' });
      if (resp.ok) {
        onDeleted(s.id);
      } else {
        const j = (await resp.json().catch(() => ({}))) as { error?: string };
        alert(`Delete failed: ${j.error ?? resp.status}`);
      }
    } finally {
      setDeleting(false);
    }
  }

  return (
    <article className={`skill-card${open ? ' is-open' : ''}${isExample ? ' is-example' : ''}`} data-skill-id={s.id}>
      <header className="skill-card-head">
        <span className="skill-card-icon" aria-hidden="true">{s.icon}</span>
        <div className="skill-card-titles">
          <h3 className="skill-card-name">
            {s.name}
            {isExample && <span className="skill-card-badge" title="Built-in Store skill — works out of the box">STORE</span>}
          </h3>
          {/* Tagline pulled up to lead-line role: larger, normal-weight ink, no
              monospace — Sarah reads this BEFORE the description. */}
          <p className="skill-card-tagline-prominent">{s.tagline}</p>
        </div>
        <span className={`skill-card-status${s.implemented ? ' is-ready' : ''}`}>
          {s.implemented ? '● ready' : '○ scaffold'}
        </span>
      </header>
      <p className="skill-card-when-to-use">
        <span className="skill-card-when-to-use-label">When to use:</span> {hint}
      </p>
      <p className="skill-card-desc">{s.description}</p>

      {calls.length > 0 && (
        <div className="skill-card-refs">
          <span className="skill-card-refs-label">→ Calls:</span>
          {calls.map((rid) => {
            const ref = byId.get(rid);
            const label = ref ? `${ref.icon} ${ref.name}` : `? ${rid}`;
            return (
              <button
                key={rid}
                type="button"
                className={`skill-ref-chip${ref ? '' : ' is-missing'}`}
                onClick={() => ref && scrollToSkill(rid)}
                title={ref ? ref.tagline : `Unknown skill id: ${rid}`}
                disabled={!ref}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}

      {consults.length > 0 && (
        <div className="skill-card-refs">
          <span className="skill-card-refs-label">📖 Consults:</span>
          {consults.map((rid) => (
            <a
              key={rid}
              href={`/references#${rid}`}
              className="skill-ref-chip skill-ref-chip-consult"
              title={`Reference: ${rid}`}
            >
              {rid}
            </a>
          ))}
        </div>
      )}

      <div className="template-card-actions">
        <button
          type="button"
          className="skill-card-toggle"
          onClick={() => setOpenId(open ? null : s.id)}
          aria-expanded={open}
        >
          {open ? 'Hide examples' : `Examples (${s.examples.length})`}
        </button>
        {canDelete && (
          <button
            type="button"
            className="skill-card-toggle"
            onClick={onDelete}
            disabled={deleting}
            title="Delete this user-defined skill"
            style={{ marginLeft: 'auto', color: 'var(--ink-danger, #b00)' }}
          >
            {deleting ? 'Deleting…' : '× delete'}
          </button>
        )}
      </div>

      {open && (
        <ul className="skill-card-examples">
          {s.examples.map((ex, i) => (
            <li key={i}>
              <button
                type="button"
                className="skill-card-example"
                title="Click to copy to chat composer"
                onClick={() => prefillComposer(ex)}
              >
                <span className="skill-card-example-text">{ex}</span>
                <span className="skill-card-example-cta">→ try</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

/* ── + New modal ─────────────────────────────────────────────────────── */

function NewSkillModal({
  onClose, onCreated,
}: { onClose: () => void; onCreated: (s: SkillDescriptor) => void }) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<SkillKind>('ops');
  const [tagline, setTagline] = useState('');
  const [icon, setIcon] = useState('');
  const [descText, setDescText] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [examplesText, setExamplesText] = useState('');
  const [callsText, setCallsText] = useState('');
  const [consultsText, setConsultsText] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onDirectSubmit() {
    setError(null);
    if (!name.trim() || !descText.trim()) {
      setError('name and description are required');
      return;
    }
    const tags = tagsText.trim()
      ? tagsText.split(',').map((s) => s.trim()).filter(Boolean)
      : undefined;
    const examples = examplesText.trim()
      ? examplesText.split('\n').map((s) => s.trim()).filter(Boolean)
      : undefined;
    const calls = callsText.trim()
      ? callsText.split(',').map((s) => s.trim()).filter(Boolean)
      : undefined;
    const consults = consultsText.trim()
      ? consultsText.split(',').map((s) => s.trim()).filter(Boolean)
      : undefined;

    setSubmitting(true);
    try {
      const r = await fetch('/api/v1/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'direct',
          name: name.trim(),
          kind,
          description: descText.trim(),
          ...(tagline.trim() ? { tagline: tagline.trim() } : {}),
          ...(icon.trim() ? { icon: icon.trim() } : {}),
          ...(tags ? { tags } : {}),
          ...(examples ? { examples } : {}),
          ...(calls ? { calls } : {}),
          ...(consults ? { consults } : {}),
        }),
      });
      const j = await r.json() as SkillDescriptor & { error?: string };
      if (!r.ok) {
        setError(j.error ?? `HTTP ${r.status}`);
      } else {
        onCreated(j);
        onClose();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog" aria-modal="true" aria-label="Create new skill"
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--paper, #fff)', color: 'var(--ink)',
          width: 'min(720px, 92vw)', maxHeight: '90vh', overflowY: 'auto',
          borderRadius: 8, padding: 20,
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>+ New Skill</h2>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', fontSize: 20, cursor: 'pointer', color: 'inherit' }}
            aria-label="Close"
          >×</button>
        </div>

        {error && (
          <div style={{ padding: 10, marginBottom: 12, background: 'rgba(180,0,0,0.12)', color: '#fdd', borderRadius: 4, fontSize: 12 }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <label style={{ fontSize: 12 }}>
              Name *
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={inputStyle}
                placeholder="e.g. Summarize Transcript"
              />
            </label>
            <div style={{ display: 'flex', gap: 10 }}>
              <label style={{ fontSize: 12, flex: 1 }}>
                Kind *
                <select value={kind} onChange={(e) => setKind(e.target.value as SkillKind)} style={inputStyle}>
                  {NEW_KIND_OPTIONS.map((k) => (
                    <option key={k} value={k}>{k}</option>
                  ))}
                </select>
              </label>
              <label style={{ fontSize: 12, width: 100 }}>
                Icon
                <input
                  value={icon}
                  onChange={(e) => setIcon(e.target.value)}
                  style={inputStyle}
                  placeholder="✨"
                />
              </label>
            </div>
            <label style={{ fontSize: 12 }}>
              Tagline
              <input
                value={tagline}
                onChange={(e) => setTagline(e.target.value)}
                style={inputStyle}
                placeholder="one-line description"
              />
            </label>
            <label style={{ fontSize: 12 }}>
              Description *
              <textarea
                value={descText}
                onChange={(e) => setDescText(e.target.value)}
                rows={4}
                style={inputStyle}
                placeholder="2-4 sentences: when to reach for it, what it produces"
              />
            </label>
            <label style={{ fontSize: 12 }}>
              Tags (comma-separated)
              <input
                value={tagsText}
                onChange={(e) => setTagsText(e.target.value)}
                style={inputStyle}
                placeholder="transcript, summary, exec"
              />
            </label>
            <label style={{ fontSize: 12 }}>
              Examples (one per line)
              <textarea
                value={examplesText}
                onChange={(e) => setExamplesText(e.target.value)}
                rows={3}
                style={inputStyle}
                placeholder="Summarize this transcript into a 1-page exec brief"
              />
            </label>
            <label style={{ fontSize: 12 }}>
              Calls (comma-separated skill ids — optional)
              <input
                value={callsText}
                onChange={(e) => setCallsText(e.target.value)}
                style={inputStyle}
                placeholder="ambiguity_probe, format_deliverable"
              />
            </label>
            <label style={{ fontSize: 12 }}>
              Consults (comma-separated reference / template ids — optional)
              <input
                value={consultsText}
                onChange={(e) => setConsultsText(e.target.value)}
                style={inputStyle}
                placeholder="weekly-status-update, wcag-2-2"
              />
            </label>
            <button
              type="button"
              onClick={onDirectSubmit}
              disabled={submitting || !name.trim() || !descText.trim()}
              style={{
                marginTop: 8, padding: '8px 16px',
                background: 'var(--green)', color: '#fff', border: 'none', borderRadius: 4,
                cursor: submitting ? 'not-allowed' : 'pointer', fontSize: 13,
                opacity: (submitting || !name.trim() || !descText.trim()) ? 0.6 : 1,
                alignSelf: 'flex-start',
              }}
            >
              {submitting ? 'Saving…' : 'Save Skill'}
            </button>
        </div>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  display: 'block', width: '100%', marginTop: 4, padding: 6,
  background: 'var(--bg-alt)', color: 'var(--ink)',
  border: '1px solid var(--rule, #444)', borderRadius: 4,
  fontFamily: 'inherit', fontSize: 13, boxSizing: 'border-box',
};

// ── Triage Rules Section ───────────────────────────────────────────────────

const BUILTIN_TRIAGE_SKILL_IDS = new Set<string>([
  'triage-urgent-surface',
  'triage-from-untrusted-decline',
  'triage-known-peer-accept',
  'triage-fallback-surface',
]);

const DECISION_LABELS: Record<string, string> = {
  auto_accept: '✔ auto-accept',
  auto_decline: '✘ auto-decline',
  surface_to_owner: '⬆ surface to owner',
};

function TriageSkillCard({ s, onToggled }: {
  s: TriageSkill & { _builtin?: boolean };
  onToggled: (id: string, enabled: boolean) => void;
}) {
  const { tFmt } = useT();
  const [open, setOpen] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const isBuiltin = s._builtin ?? BUILTIN_TRIAGE_SKILL_IDS.has(s.id);

  async function handleToggle() {
    setToggling(true);
    setToggleError(null);
    const next = !s.enabled;
    // Optimistic update is driven by parent re-render after onToggled.
    try {
      const resp = await fetch(`/api/v1/triage-skills/${encodeURIComponent(s.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      });
      if (resp.ok) {
        onToggled(s.id, next);
      } else {
        const j = (await resp.json().catch(() => ({}))) as { error?: string };
        setToggleError(j.error ?? 'Toggle failed');
      }
    } catch (error) {
      void error;
      setToggleError('Toggle failed — network error');
    } finally {
      setToggling(false);
    }
  }

  const filterSummary = s.pre_filter
    ? Object.entries(s.pre_filter).map(([k, v]) => `${k}=${String(v)}`).join(', ')
    : null;

  return (
    <article
      style={{
        border: `1px solid ${s.enabled ? 'var(--green)' : 'var(--line)'}`,
        borderRadius: 6,
        padding: '10px 12px',
        background: s.enabled ? 'rgba(46,125,82,0.06)' : 'var(--bg-alt)',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        opacity: s.enabled ? 1 : 0.75,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {/* Priority badge */}
        <span style={{
          fontFamily: 'monospace', fontSize: 11, fontWeight: 700,
          background: 'var(--rule, #444)', color: 'var(--ink-mute)', borderRadius: 3,
          padding: '1px 5px', letterSpacing: 0.04,
        }}>
          {tFmt('skills.triage.priority_label', { n: s.priority })}
        </span>

        {/* Name */}
        <span style={{ fontWeight: 600, fontSize: 14, flex: 1 }}>{s.name}</span>

        {/* Built-in badge */}
        {isBuiltin && (
          <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: 0.06,
            background: 'var(--rule, #444)', color: 'var(--ink-mute)',
            borderRadius: 3, padding: '1px 5px',
          }}>
            BUILT-IN
          </span>
        )}

        {/* Enable/Disable toggle */}
        <button
          type="button"
          onClick={handleToggle}
          disabled={toggling}
          title={s.enabled ? 'Click to disable this rule' : 'Click to enable this rule'}
          style={{
            padding: '3px 10px', fontSize: 12, cursor: toggling ? 'not-allowed' : 'pointer',
            border: 'none', borderRadius: 4,
            background: s.enabled ? 'var(--green)' : 'var(--ink-mute)',
            color: '#fff', fontWeight: 600, opacity: toggling ? 0.6 : 1,
            transition: 'background 0.15s',
            minWidth: 56,
          }}
          aria-pressed={s.enabled}
        >
          {toggling ? '…' : s.enabled ? 'ON' : 'OFF'}
        </button>
      </div>

      {/* Description */}
      <p style={{ margin: 0, fontSize: 12, color: 'var(--ink-mute)', lineHeight: 1.45 }}>
        {s.description}
      </p>

      {/* Allowed decisions */}
      {s.allowed_decisions.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--ink-mute)', fontWeight: 600 }}>Can decide:</span>
          {s.allowed_decisions.map((d) => (
            <span key={d} style={{
              fontSize: 11, borderRadius: 3, padding: '1px 6px',
              background: 'var(--rule, #444)', color: 'var(--ink-mute)',
            }}>
              {DECISION_LABELS[d] ?? d}
            </span>
          ))}
        </div>
      )}

      {/* Toggle error */}
      {toggleError && (
        <div style={{ fontSize: 11, color: 'var(--ink-danger, #f88)', marginTop: 2 }}>
          {toggleError}
        </div>
      )}

      {/* Detail expand */}
      <div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: 'var(--ink-mute)', fontSize: 11, padding: '0 0 0 0',
          }}
          aria-expanded={open}
        >
          {open ? '▾ Hide details' : '▸ Details'}
        </button>

        {open && (
          <div style={{
            marginTop: 8, padding: 10, borderRadius: 4,
            background: 'var(--bg-alt, rgba(255,255,255,0.04))',
            border: '1px solid var(--rule, #444)', fontSize: 12,
            display: 'flex', flexDirection: 'column', gap: 6,
          }}>
            {/* Pre-filter */}
            <div>
              <span style={{ fontWeight: 600, color: 'var(--ink-mute)' }}>Pre-filter: </span>
              <span style={{ fontFamily: 'monospace', color: 'var(--ink)' }}>
                {filterSummary ?? 'matches all'}
              </span>
            </div>

            {/* System prompt */}
            {s.system_prompt ? (
              <div>
                <span style={{ fontWeight: 600, color: 'var(--ink-mute)' }}>System prompt:</span>
                <pre style={{
                  margin: '4px 0 0', padding: 8, borderRadius: 4, fontSize: 11,
                  background: 'var(--bg, #111)', color: 'var(--ink)', whiteSpace: 'pre-wrap',
                  maxHeight: 160, overflowY: 'auto',
                }}>
                  {s.system_prompt}
                </pre>
              </div>
            ) : (
              <div style={{ color: 'var(--ink-mute)', fontStyle: 'italic' }}>
                No system prompt - pre-filter alone drives the decision.
              </div>
            )}

            <div style={{ color: 'var(--ink-mute)', fontSize: 11 }}>
              ID: <code>{s.id}</code> · Kind: <code>triage</code> · Priority: <code>{s.priority}</code>
              {isBuiltin && <> · <em>Read-only (built-in). Clone/edit flow deferred to a later pass.</em></>}
            </div>
          </div>
        )}
      </div>
    </article>
  );
}

const TRIAGE_COLLAPSE_KEY = 'holon-triage-rules-collapsed-v1';

function TriageRulesSection() {
  const { t, tFmt } = useT();
  const [rules, setRules] = useState<Array<TriageSkill & { _builtin?: boolean }>>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);

  // Hydrate collapse state from localStorage after mount.
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        setCollapsed(window.localStorage.getItem(TRIAGE_COLLAPSE_KEY) === 'true');
      } catch (error) { void error; }
    }
  }, []);

  // Fetch triage skills on mount.
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/v1/triage-skills');
        if (r.ok) {
          const j = await r.json() as { items: Array<TriageSkill & { _builtin?: boolean }> };
          setRules(j.items);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function toggleCollapse(): void {
    setCollapsed((prev) => {
      const next = !prev;
      try { window.localStorage.setItem(TRIAGE_COLLAPSE_KEY, String(next)); } catch (error) { void error; }
      return next;
    });
  }

  // Optimistic toggle — flip `enabled` in local state immediately; on error
  // the card reverts via its own toggleError display + the state stays flipped
  // (a full refresh corrects it, which is acceptable for V1).
  function handleToggled(id: string, enabled: boolean): void {
    setRules((prev) => prev.map((s) => s.id === id ? { ...s, enabled } : s));
  }

  const { builtinRules, yourRules } = useMemo(() => {
    const b: Array<TriageSkill & { _builtin?: boolean }> = [];
    const y: Array<TriageSkill & { _builtin?: boolean }> = [];
    for (const r of rules) {
      (BUILTIN_TRIAGE_SKILL_IDS.has(r.id) ? b : y).push(r);
    }
    return { builtinRules: b, yourRules: y };
  }, [rules]);

  return (
    <section style={{ marginTop: 32 }}>
      {/* Section header — mirrors the skills-section-title button pattern */}
      <button
        type="button"
        className="skills-section-title"
        aria-expanded={!collapsed}
        onClick={toggleCollapse}
        style={{ width: '100%', textAlign: 'left' }}
      >
        <span className={`skills-section-chevron${collapsed ? ' is-collapsed' : ''}`} aria-hidden="true">▾</span>
        <span>
          {t('skills.triage.section_title')}
          <span style={{ fontWeight: 400, marginLeft: 8, fontSize: 12, color: 'var(--ink-mute)' }}>
            — {t('skills.triage.section_subtitle')}
          </span>
        </span>
        <span className="skills-section-count">{rules.length}</span>
      </button>

      {!collapsed && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 12 }}>
          {loading && (
            <div style={{ color: 'var(--ink-mute)', fontSize: 13, padding: '8px 0' }}>
              Loading triage rules…
            </div>
          )}

          {!loading && yourRules.length > 0 && (
            <div>
              <h3 style={{
                fontSize: 11, fontWeight: 700, color: 'var(--ink-mute)',
                letterSpacing: 0.08, textTransform: 'uppercase', margin: '0 0 8px',
              }}>
                {t('skills.triage.yours_group')} <span style={{ color: 'var(--ink-mute)' }}>· {yourRules.length}</span>
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {yourRules.map((r) => (
                  <TriageSkillCard key={r.id} s={r} onToggled={handleToggled} />
                ))}
              </div>
            </div>
          )}

          {!loading && builtinRules.length > 0 && (
            <div>
              <h3 style={{
                fontSize: 11, fontWeight: 700, color: 'var(--ink-mute)',
                letterSpacing: 0.08, textTransform: 'uppercase', margin: '0 0 8px',
              }}>
                {t('skills.triage.builtin_group')} <span style={{ color: 'var(--ink-mute)' }}>· {tFmt('skills.triage.count', { n: builtinRules.length })}</span>
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {builtinRules.map((r) => (
                  <TriageSkillCard key={r.id} s={r} onToggled={handleToggled} />
                ))}
              </div>
            </div>
          )}

          {!loading && rules.length === 0 && (
            <div style={{ color: 'var(--ink-mute)', fontSize: 13 }}>
              No triage rules found. Built-in rules ship with Holon — if this is empty, check core initialization.
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export function SkillsClient({ skills }: { skills: SkillDescriptor[] }) {
  const { t } = useT();
  const [items, setItems] = useState<SkillDescriptor[]>(skills);
  const [openId, setOpenId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<SkillKind>>(() => new Set());
  const [showModal, setShowModal] = useState(false);

  // Hydrate collapsed-state from localStorage after mount (SSR-safe).
  useEffect(() => { setCollapsed(loadCollapsed()); }, []);

  async function refresh() {
    const r = await fetch('/api/v1/skills');
    if (r.ok) {
      const j = await r.json() as { items: SkillDescriptor[] };
      setItems(j.items);
    }
  }

  function toggleSection(k: SkillKind): void {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      saveCollapsed(next);
      return next;
    });
  }
  // Partition: yours vs store (built-in catalog).
  // Per user 2026-05-17: "user 不想看那种" — store default-hidden.
  const { yourItems, exampleItems } = useMemo(() => {
    const y: SkillDescriptor[] = [];
    const e: SkillDescriptor[] = [];
    for (const s of items) (BUILTIN_SKILL_IDS.has(s.id) ? e : y).push(s);
    return { yourItems: y, exampleItems: e };
  }, [items]);

  const grouped = useMemo(() => {
    const g: Record<SkillKind, SkillDescriptor[]> = {
      office: [], media: [], engineering: [], communication: [], research: [], ops: [],
    };
    for (const s of yourItems) g[s.kind].push(s);
    return g;
  }, [yourItems]);

  const examplesGrouped = useMemo(() => {
    const g: Record<SkillKind, SkillDescriptor[]> = {
      office: [], media: [], engineering: [], communication: [], research: [], ops: [],
    };
    for (const s of exampleItems) g[s.kind].push(s);
    return g;
  }, [exampleItems]);

  // byId stays full so call-chips can resolve cross-references (a user
  // skill's `calls: ['decompose_task']` should still chip-link).
  const byId = useMemo(() => {
    const m = new Map<string, SkillDescriptor>();
    for (const s of items) m.set(s.id, s);
    return m;
  }, [items]);
  const readyCount = items.filter((s) => s.implemented).length;

  // Store block — default collapsed.
  const EXAMPLES_KEY = '__examples__' as SkillKind;
  const isExamplesOpen = collapsed.has(EXAMPLES_KEY);
  function toggleExamples(): void {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(EXAMPLES_KEY)) next.delete(EXAMPLES_KEY); else next.add(EXAMPLES_KEY);
      saveCollapsed(next);
      return next;
    });
  }

  return (
    <>
      <div className="page-strip">
        <h1 className="page-strip-title">{t('skills.page_title')}</h1>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setShowModal(true)}
          style={{ marginRight: 12 }}
        >
          {t('skills.new_button')}
        </button>
        <div style={{ fontSize: 12, color: 'var(--ink-mute)' }}>
          {yourItems.length} {t('skills.count.yours')} · {exampleItems.length} {t('skills.count.examples')}
          {readyCount > 0 && <> · {readyCount} {t('skills.count.ready')}</>}
        </div>
      </div>

      {/* Above-strip explainer panel — always visible, sets context for Sarah Chen
       *  on her first /skills visit. Frames skills in concrete owner terms
       *  (reading email, drafting decks, summarizing meetings) and tells her
       *  the binding model (per-staff allow/deny lives on /members). */}
      <div className="skills-explainer">
        <p className="skills-explainer-lead">
          <strong>{t('skills.explainer.lead')}</strong>{t('skills.explainer.lead_tail')}
        </p>
        <p className="skills-explainer-sub">
          Enable a skill here to make it available to your staff. Each staff member can be allowed or denied
          specific skills from their card on <a href="/members" className="skills-explainer-link">/members</a>.
          Click any <em>Store</em> card below to drop a sample prompt into the chat composer and try it.
        </p>
      </div>

      {yourItems.length === 0 && (
        <div className="skills-yours-empty">
          <p className="skills-yours-empty-lead">
            <strong>{t('skills.yours_empty.lead')}</strong>
          </p>
          <p className="skills-yours-empty-body">
            The <strong>Store</strong> below shows what your AI can do out of the box — click any one to try it in chat,
            or use the <strong>+ New</strong> button above to add a skill directly.
          </p>
        </div>
      )}

      <div className="skills-stack">
        {KIND_ORDER.map((k) => {
          const list = grouped[k];
          if (list.length === 0) return null;
          const isCollapsed = collapsed.has(k);
          return (
            <section key={k} className={`skills-section${isCollapsed ? ' is-collapsed' : ''}`}>
              <button
                type="button"
                className="skills-section-title"
                aria-expanded={!isCollapsed}
                onClick={() => toggleSection(k)}
              >
                <span className={`skills-section-chevron${isCollapsed ? ' is-collapsed' : ''}`} aria-hidden="true">▾</span>
                <span>{KIND_LABEL[k]}</span>
                <span className="skills-section-count">{list.length}</span>
              </button>
              {!isCollapsed && (
                <div className="skills-grid">
                  {list.map((s) => (
                    <SkillCard
                      key={s.id}
                      s={s}
                      openId={openId}
                      setOpenId={setOpenId}
                      byId={byId}
                      onDeleted={() => refresh()}
                    />
                  ))}
                </div>
              )}
            </section>
          );
        })}

        {/* Store block — default collapsed. The 30 built-in skills
         * shipped with Holon. Per user 2026-05-17 "user 不想看那种" —
         * these stay tucked away unless explicitly expanded. Sarah-Chen
         * pass 2026-05-19: title copy + per-card STORE badge make the
         * built-in-vs-yours distinction obvious without reading docs. */}
        {exampleItems.length > 0 ? (
          <section className={`skills-section examples-section${!isExamplesOpen ? ' is-collapsed' : ''}`}>
            <button
              type="button"
              className="skills-section-title"
              aria-expanded={isExamplesOpen}
              onClick={toggleExamples}
            >
              <span className={`skills-section-chevron${!isExamplesOpen ? ' is-collapsed' : ''}`} aria-hidden="true">▾</span>
              <span>Store — {exampleItems.length} built-in skills, use as reference or clone; more shared items later.</span>
              <span className="skills-section-count">{exampleItems.length}</span>
            </button>
            {isExamplesOpen && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {KIND_ORDER.map((k) => {
                  const list = examplesGrouped[k];
                  if (list.length === 0) return null;
                  return (
                    <div key={k}>
                      <h3 style={{
                        fontSize: 11, fontWeight: 600, color: 'var(--ink-mute)',
                        letterSpacing: 0.08, textTransform: 'uppercase',
                        margin: '0 0 8px',
                      }}>{KIND_LABEL[k]} <span style={{ color: 'var(--ink-mute)' }}>· {list.length}</span></h3>
                      <div className="skills-grid">
                        {list.map((s) => (
                          <SkillCard
                            key={s.id}
                            s={s}
                            openId={openId}
                            setOpenId={setOpenId}
                            byId={byId}
                            onDeleted={() => refresh()}
                            isExample
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        ) : (
          // Defensive — catalog should never be empty in production (ships
          // with 30 starter skills), but if a deployment ever loads an empty
          // manifest we still want a non-broken-looking page.
          <div className="skills-yours-empty">
            <p className="skills-yours-empty-body">
              No starter skills loaded. Use <strong>+ New</strong> above to add your first skill.
            </p>
          </div>
        )}
      </div>

      {showModal && (
        <NewSkillModal
          onClose={() => { setShowModal(false); refresh(); }}
          onCreated={() => refresh()}
        />
      )}
    </>
  );
}


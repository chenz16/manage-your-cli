'use client';

import { useEffect, useMemo, useState } from 'react';
import type { TemplateDescriptor, TemplateKind } from '@holon/core';
import { useT } from '../../../lib/i18n/useT';

const COLLAPSE_KEY = 'holon-templates-collapsed-v1';

function loadCollapsed(): Set<TemplateKind> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(COLLAPSE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((x): x is TemplateKind => typeof x === 'string') as TemplateKind[]);
  } catch (error) {
    void error;
    return new Set();
  }
}

function saveCollapsed(s: Set<TemplateKind>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...s]));
  } catch (error) { void error; }
}

const KIND_LABEL: Record<TemplateKind, string> = {
  hr: 'HR — Offer · 1:1 · People',
  marketing: 'Marketing — Briefs · Campaigns',
  sales: 'Sales — Proposals · Outreach',
  finance: 'Finance — Investor · Reports',
  engineering: 'Engineering — PRDs · Specs',
  ops: 'Ops — Status · Meetings · Notes',
};

// Render order — high-traffic categories first.
const KIND_ORDER: TemplateKind[] = ['ops', 'engineering', 'hr', 'sales', 'marketing', 'finance'];

const KIND_OPTIONS: TemplateKind[] = ['ops', 'engineering', 'hr', 'sales', 'marketing', 'finance'];

// _builtin is now server-authoritative — attached per item in GET /api/v1/templates.
// No client-side BUILTIN_TEMPLATE_IDS set needed.

/**
 * Hand-written "when to use this" hints for well-known catalog templates.
 * Written for Sarah-Chen (SMB owner) persona — plain English, concrete
 * trigger phrase. Templates not in this map fall back to a kind-based
 * generic hint (see KIND_HINT). Mirrors WHEN_TO_USE in SkillsClient.
 */
const WHEN_TO_USE: Record<string, string> = {
  'weekly-status-update':    'Drafting Monday status mails — fills the "this week / next week / blockers" shape.',
  'investor-update-monthly': 'End-of-month investor email — KPIs, highlights, lowlights, asks, runway.',
  '1on1-agenda':             'Before a 1:1 with a direct report — their topics first, then yours, then open actions.',
  'offer-letter':             'When you have a verbal yes and need to send the formal offer.',
  'marketing-brief':         'Kicking off a campaign — audience, goal, channels, deadlines in one shape.',
  'sales-proposal':          'After discovery — turns notes into a structured proposal the prospect can sign.',
  'prd-feature':              'Specing a new feature — problem, users, scope, non-goals, success metric.',
  'meeting-minutes':          'Capturing what happened in a meeting — decisions, owners, deadlines, follow-ups.',
};

const KIND_HINT: Record<TemplateKind, string> = {
  hr:          'When generating people-ops docs (offer, 1:1, review, PIP, etc.).',
  marketing:   'When generating marketing artifacts (briefs, campaign plans, launch copy).',
  sales:       'When generating sales artifacts (proposals, outreach sequences, deal summaries).',
  finance:     'When generating finance / investor artifacts (updates, reports, board decks).',
  engineering: 'When generating engineering artifacts (PRDs, specs, design docs).',
  ops:         'When generating ops artifacts (status updates, meeting notes, runbooks).',
};

function whenToUseHint(t: TemplateDescriptor): string {
  return WHEN_TO_USE[t.id] ?? KIND_HINT[t.kind];
}

function prefillComposer(text: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('holon:prefill-composer', { detail: { text } }));
}

async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.clipboard) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    void error;
    return false;
  }
}

function TemplateCard({ t, onDeleted, isExample = false }: {
  t: TemplateDescriptor & { _builtin?: boolean };
  onDeleted: (id: string) => void;
  /** Render as a "STORE" (built-in catalog) card — adds badge + subtle tint
   *  so Sarah can tell at-a-glance whether a card is hers vs. a built-in. */
  isExample?: boolean;
}) {
  const [showBody, setShowBody] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sent, setSent] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const isBuiltin = t._builtin ?? false;
  const hint = whenToUseHint(t);

  async function onCopy() {
    const ok = await copyToClipboard(t.body);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    }
  }
  function onSend() {
    prefillComposer(t.body);
    setSent(true);
    setTimeout(() => setSent(false), 1400);
  }
  async function onDelete() {
    if (!window.confirm(`Delete template "${t.name}"? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      const r = await fetch(`/api/v1/templates/${encodeURIComponent(t.id)}`, { method: 'DELETE' });
      if (r.ok) {
        onDeleted(t.id);
      } else {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        alert(`Delete failed: ${j.error ?? r.status}`);
      }
    } finally {
      setDeleting(false);
    }
  }

  return (
    <article className={`skill-card${showBody ? ' is-open' : ''}${isExample ? ' is-example' : ''}`} data-template-id={t.id}>
      <header className="skill-card-head">
        <span className="skill-card-icon" aria-hidden="true">{t.icon}</span>
        <div className="skill-card-titles">
          <h3 className="skill-card-name">
            {t.name}
            {isExample && <span className="skill-card-badge" title="Built-in Store template — works out of the box">STORE</span>}
          </h3>
          <p className="skill-card-tagline-prominent">{t.tagline}</p>
        </div>
        <span className="skill-card-status is-ready">● ready</span>
      </header>
      <p className="skill-card-when-to-use">
        <span className="skill-card-when-to-use-label">When to use:</span> {hint}
      </p>
      <p className="skill-card-desc">{t.description}</p>

      {t.variables.length > 0 && (
        <div className="skill-card-refs">
          <span className="skill-card-refs-label">Fields:</span>
          {t.variables.map((v) => (
            <span
              key={v.name}
              className="skill-ref-chip"
              title={v.hint ?? v.label}
            >
              {v.label}
            </span>
          ))}
        </div>
      )}

      <div className="template-card-actions">
        <button
          type="button"
          className="skill-card-toggle"
          onClick={() => setShowBody((v) => !v)}
          aria-expanded={showBody}
        >
          {showBody ? 'Hide body' : 'Show body'}
        </button>
        <button
          type="button"
          className="skill-card-toggle"
          onClick={onCopy}
          title="Copy the markdown body to clipboard"
        >
          {copied ? 'Copied ✓' : 'Copy body'}
        </button>
        <button
          type="button"
          className="skill-card-toggle"
          onClick={onSend}
          title="Send the body into the chat composer"
        >
          {sent ? 'Sent ✓' : 'Send to chat'}
        </button>
        {!isBuiltin && (
          <button
            type="button"
            className="skill-card-toggle"
            onClick={onDelete}
            disabled={deleting}
            title="Delete this user-defined template"
            style={{ marginLeft: 'auto', color: 'var(--ink-danger, #b00)' }}
          >
            {deleting ? 'Deleting…' : '× delete'}
          </button>
        )}
      </div>

      {showBody && (
        <pre className="template-card-body" aria-label="Template body preview">
          {t.body}
        </pre>
      )}
    </article>
  );
}

/* ── + New modal ─────────────────────────────────────────────────────── */

function NewTemplateModal({
  onClose, onCreated,
}: { onClose: () => void; onCreated: (t: TemplateDescriptor) => void }) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<TemplateKind>('ops');
  const [tagline, setTagline] = useState('');
  const [body, setBody] = useState('');
  const [variablesText, setVariablesText] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [icon, setIcon] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onDirectSubmit() {
    setError(null);
    if (!name.trim() || !body.trim()) {
      setError('name and body are required');
      return;
    }
    let variables: { name: string; label: string; hint?: string }[] | undefined;
    if (variablesText.trim()) {
      try {
        const parsed = JSON.parse(variablesText) as unknown;
        if (!Array.isArray(parsed)) throw new Error('variables must be an array');
        variables = parsed as { name: string; label: string; hint?: string }[];
      } catch (e) {
        setError(`variables JSON invalid: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
    }
    const tags = tagsText.trim()
      ? tagsText.split(',').map((s) => s.trim()).filter(Boolean)
      : undefined;

    setSubmitting(true);
    try {
      const r = await fetch('/api/v1/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'direct',
          name: name.trim(),
          kind,
          body,
          ...(tagline.trim() ? { tagline: tagline.trim() } : {}),
          ...(icon.trim() ? { icon: icon.trim() } : {}),
          ...(tags ? { tags } : {}),
          ...(variables ? { variables } : {}),
        }),
      });
      const j = await r.json() as TemplateDescriptor & { error?: string };
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
      role="dialog" aria-modal="true" aria-label="Create new template"
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
          <h2 style={{ margin: 0, fontSize: 18 }}>+ New Template</h2>
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
                placeholder="e.g. Sales Pipeline Review"
              />
            </label>
            <div style={{ display: 'flex', gap: 10 }}>
              <label style={{ fontSize: 12, flex: 1 }}>
                Kind *
                <select value={kind} onChange={(e) => setKind(e.target.value as TemplateKind)} style={inputStyle}>
                  {KIND_OPTIONS.map((k) => (
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
                  placeholder="📄"
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
              Tags (comma-separated)
              <input
                value={tagsText}
                onChange={(e) => setTagsText(e.target.value)}
                style={inputStyle}
                placeholder="weekly, pipeline, sales"
              />
            </label>
            <label style={{ fontSize: 12 }}>
              Body * (markdown; use {'{{placeholders}}'})
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={8}
                style={{ ...inputStyle, fontFamily: 'monospace' }}
                placeholder={'# {{title}}\n\n## Section\n{{section_content}}'}
              />
            </label>
            <label style={{ fontSize: 12 }}>
              Variables JSON (optional — array of {'{name,label,hint?}'})
              <textarea
                value={variablesText}
                onChange={(e) => setVariablesText(e.target.value)}
                rows={4}
                style={{ ...inputStyle, fontFamily: 'monospace' }}
                placeholder={'[{"name":"title","label":"Doc title"}]'}
              />
            </label>
            <button
              type="button"
              onClick={onDirectSubmit}
              disabled={submitting || !name.trim() || !body.trim()}
              style={{
                marginTop: 8, padding: '8px 16px',
                background: 'var(--accent, #2a6)', color: '#fff', border: 'none', borderRadius: 4,
                cursor: submitting ? 'not-allowed' : 'pointer', fontSize: 13,
                opacity: (submitting || !name.trim() || !body.trim()) ? 0.6 : 1,
                alignSelf: 'flex-start',
              }}
            >
              {submitting ? 'Saving…' : 'Save Template'}
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

export function TemplatesClient({ templates }: { templates: (TemplateDescriptor & { _builtin?: boolean })[] }) {
  const { t } = useT();
  // Live list — we re-fetch on create/delete to stay in sync with the
  // server-side merge (overrides + tombstones + dynamic). SSR seeded.
  const [items, setItems] = useState<(TemplateDescriptor & { _builtin?: boolean })[]>(templates);
  const [collapsed, setCollapsed] = useState<Set<TemplateKind>>(() => new Set());
  const [showModal, setShowModal] = useState(false);

  useEffect(() => { setCollapsed(loadCollapsed()); }, []);

  async function refresh() {
    const r = await fetch('/api/v1/templates');
    if (r.ok) {
      const j = await r.json() as { items: (TemplateDescriptor & { _builtin?: boolean })[] };
      setItems(j.items);
    }
  }

  function toggleSection(k: TemplateKind): void {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      saveCollapsed(next);
      return next;
    });
  }

  // Partition: yours vs store (built-in catalog).
  // Per user 2026-05-17: "user 不想看那种" — store default-hidden.
  // _builtin is server-authoritative per item.
  const { yourItems, exampleItems } = useMemo(() => {
    const y: (TemplateDescriptor & { _builtin?: boolean })[] = [];
    const e: (TemplateDescriptor & { _builtin?: boolean })[] = [];
    for (const t of items) (t._builtin ? e : y).push(t);
    return { yourItems: y, exampleItems: e };
  }, [items]);

  const grouped = useMemo(() => {
    const g: Record<TemplateKind, (TemplateDescriptor & { _builtin?: boolean })[]> = {
      hr: [], marketing: [], sales: [], finance: [], engineering: [], ops: [],
    };
    for (const t of yourItems) g[t.kind].push(t);
    return g;
  }, [yourItems]);

  const examplesGrouped = useMemo(() => {
    const g: Record<TemplateKind, (TemplateDescriptor & { _builtin?: boolean })[]> = {
      hr: [], marketing: [], sales: [], finance: [], engineering: [], ops: [],
    };
    for (const t of exampleItems) g[t.kind].push(t);
    return g;
  }, [exampleItems]);

  // Store block — default collapsed.
  const EXAMPLES_KEY = '__examples__' as TemplateKind;
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
        <h1 className="page-strip-title">{t('templates.page_title')}</h1>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          onClick={() => setShowModal(true)}
          style={{
            padding: '4px 10px', fontSize: 12,
            background: 'var(--accent, #2a6)', color: '#fff',
            border: 'none', borderRadius: 4, cursor: 'pointer',
            marginRight: 12,
          }}
        >
          {t('templates.new_button')}
        </button>
        <div style={{ fontSize: 12, color: 'var(--ink-mute)' }}>
          {yourItems.length} {t('templates.count.yours')} · {exampleItems.length} {t('templates.count.examples')}
        </div>
      </div>

      {/* Above-strip explainer panel — always visible, sets context for
       *  Sarah Chen on her first /templates visit. Frames templates as
       *  the "shapes for deliverables" the AI fills instead of starting
       *  from scratch. */}
      <div className="skills-explainer">
        <p className="skills-explainer-lead">
          <strong>{t('templates.explainer.lead')}</strong>{t('templates.explainer.lead_tail')}
        </p>
        <p className="skills-explainer-sub">
          When you ask your AI to &quot;write this week&apos;s update&quot;, it uses the matching template instead of
          starting from scratch. Enable a template below to make it available.
        </p>
      </div>

      {yourItems.length === 0 && (
        <div className="skills-yours-empty">
          <p className="skills-yours-empty-lead">
            <strong>{t('templates.yours_empty.lead')}</strong>
          </p>
          <p className="skills-yours-empty-body">
            The <strong>Store</strong> below shows common built-in deliverable shapes — click any to enable it,
            or use the <strong>+ New</strong> button above to add a custom template directly.
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
                  {list.map((t) => (
                    <TemplateCard key={t.id} t={t} onDeleted={() => refresh()} />
                  ))}
                </div>
              )}
            </section>
          );
        })}

        {/* Store block — default collapsed. The 8 built-in templates. */}
        {exampleItems.length > 0 && (
          <section className={`skills-section examples-section${!isExamplesOpen ? ' is-collapsed' : ''}`}>
            <button
              type="button"
              className="skills-section-title"
              aria-expanded={isExamplesOpen}
              onClick={toggleExamples}
            >
              <span className={`skills-section-chevron${!isExamplesOpen ? ' is-collapsed' : ''}`} aria-hidden="true">▾</span>
              <span>Store — built-in templates shipped with Holon, use as reference or clone; more shared items later.</span>
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
                        {list.map((t) => (
                          <TemplateCard key={t.id} t={t} onDeleted={() => refresh()} isExample />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}
      </div>

      {showModal && (
        <NewTemplateModal
          onClose={() => { setShowModal(false); refresh(); }}
          onCreated={() => refresh()}
        />
      )}
    </>
  );
}

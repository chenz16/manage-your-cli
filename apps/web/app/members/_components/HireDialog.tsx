'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { OwnerAssistant } from '@holon/api-contract';
import { useT } from '../../../lib/i18n/useT';

/**
 * HireDialog — modal for `+ Hire` on /members.
 *
 * iter-008 Phase 3. Mirror of mibusy's RecruitButton pattern:
 *   - Owner types ONE short description ("market analyst, focus on
 *     vendor research")
 *   - "Generate" button asks LLM (via /api/v1/admin/polish with a
 *     hint) to produce a full system_prompt
 *   - Owner reviews + edits the draft
 *   - "Hire" POSTs /api/v1/staff
 *
 * Works for any role — the LLM fills in the persona.
 *
 * Sarah-Chen polish (2026-05-19):
 *   - Quick-pick chips for the 3 most common SMB roles (email triage /
 *     slide-deck maker / research aide) — fills the sketch with one tap.
 *   - Derived suggestion: if `owner.owner_intro` mentions trade-show /
 *     booth / marketing / 客户邮件 / 展会, default the sketch to an
 *     email-triage assistant — Sarah can override before generating.
 *   - Review-step labels now spell out what each field is FOR (where it
 *     appears, how it's used), so a non-technical owner isn't guessing.
 *   - Footer reminds the owner that skill-level deny-list lives in the
 *     staff's gear icon → "Skills allowed" (not in this hire flow).
 */

interface QuickPick {
  /** Persona-style label (what Sarah picks). */
  label: string;
  /** One-line plain-English explanation of what this staff DOES. */
  blurb: string;
  /** What gets dropped into the sketch textarea. */
  sketch: string;
}

/** Quick-pick presets — labels / blurbs / sketches are owner-language
 *  via the i18n dictionary (staff.hire.quick_pick.*). The factory takes
 *  the active `t()` so the picks render in the chosen language at use
 *  site instead of frozen at module load. */
function buildQuickPicks(t: (k: string) => string): QuickPick[] {
  return [
    {
      label: t('staff.hire.quick_pick.email_label'),
      blurb: t('staff.hire.quick_pick.email_blurb'),
      sketch: t('staff.hire.quick_pick.email_sketch'),
    },
    {
      label: t('staff.hire.quick_pick.slides_label'),
      blurb: t('staff.hire.quick_pick.slides_blurb'),
      sketch: t('staff.hire.quick_pick.slides_sketch'),
    },
    {
      label: t('staff.hire.quick_pick.research_label'),
      blurb: t('staff.hire.quick_pick.research_blurb'),
      sketch: t('staff.hire.quick_pick.research_sketch'),
    },
  ];
}

/** Keywords in owner.owner_intro that suggest an Email-Triage default.
 *  Sarah Chen's 6-person Frankfurt-trade-show booth-design firm hits
 *  several of these — so she lands on a sensible default she can keep
 *  or override with one click. */
const EMAIL_TRIAGE_KEYWORDS = [
  'trade show', 'tradeshow', '展会', '展览', 'booth', '展位',
  'marketing', '营销', 'client email', 'customer email', '客户邮件', '邮件',
  'inbox', 'reply', 'reach out',
];

function suggestPickFrom(picks: QuickPick[], ownerIntro: string | undefined | null): QuickPick | null {
  if (!ownerIntro) return null;
  const lc = ownerIntro.toLowerCase();
  for (const k of EMAIL_TRIAGE_KEYWORDS) {
    if (lc.includes(k.toLowerCase())) return picks[0] ?? null;
  }
  return null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onHired: () => void;
  /** Optional — used only to derive a starter suggestion (no logic change
   *  if absent). Pass-through from MembersClient. */
  owner?: OwnerAssistant | null;
}

export function HireDialog({ open, onClose, onHired, owner }: Props) {
  const { t } = useT();
  const [step, setStep] = useState<'sketch' | 'review' | 'saving'>('sketch');
  const [sketch, setSketch] = useState('');
  const [name, setName] = useState('');
  const [roleLabel, setRoleLabel] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const sketchRef = useRef<HTMLTextAreaElement>(null);

  // Quick-pick presets in the active owner language. Recomputed when
  // language flips so chips re-render translated.
  const quickPicks = useMemo(() => buildQuickPicks(t), [t]);
  // Derived suggestion — pure read of owner.owner_intro, no fetch / no state.
  const suggested = useMemo(() => suggestPickFrom(quickPicks, owner?.owner_intro), [quickPicks, owner?.owner_intro]);

  // Reset everything when dialog opens. If we have a suggestion (Sarah-style
  // owner_intro), pre-fill the sketch so first-timers see a sensible default.
  useEffect(() => {
    if (open) {
      setStep('sketch');
      setSketch(suggested?.sketch ?? '');
      setName(''); setRoleLabel('');
      setSystemPrompt(''); setBusy(false); setErr(null);
      setTimeout(() => sketchRef.current?.focus(), 0);
    }
  }, [open, suggested]);

  // ESC closes
  useEffect(() => {
    if (!open) return;
    function onKey(ev: KeyboardEvent) { if (ev.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function generate() {
    if (!sketch.trim()) { setErr(t('staff.hire.err_describe')); return; }
    setBusy(true); setErr(null);
    try {
      // Use the polish endpoint in generate mode (empty text + hint).
      const hintBase = `Generate a full staff profile for the Holon owner's local AI team. Input: "${sketch.trim()}". Return a JSON object with EXACTLY these keys: name (2-15 chars, can be Chinese), role_label (human readable title), system_prompt (100-300 word work-style prompt — describes responsibilities, tone, focus). NO markdown fences, NO commentary, just the raw JSON.`;
      const r = await fetch('/api/v1/admin/polish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: '', hint: hintBase }),
      });
      const j = await r.json();
      if (!r.ok || !j.polished) {
        setErr(j.error ?? t('staff.hire.err_generate_failed'));
        return;
      }
      // Try to parse — LLM sometimes wraps in fences.
      let raw = String(j.polished).trim();
      if (raw.startsWith('```')) raw = raw.replace(/^```\w*\n?/, '').replace(/```$/, '').trim();
      let parsed: { name?: string; role_label?: string; system_prompt?: string } = {};
      try { parsed = JSON.parse(raw); } catch { /* malformed */ }
      setName(parsed.name ?? '');
      setRoleLabel(parsed.role_label ?? '');
      setSystemPrompt(parsed.system_prompt ?? raw);
      setStep('review');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function hire() {
    if (!name.trim() || !roleLabel.trim() || !systemPrompt.trim()) {
      setErr(t('staff.hire.err_required'));
      return;
    }
    setStep('saving'); setBusy(true); setErr(null);
    try {
      const r = await fetch('/api/v1/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, role_label: roleLabel, system_prompt: systemPrompt }),
      });
      const j = await r.json();
      if (!r.ok) {
        setErr(j.error ?? `HTTP ${r.status}`);
        setStep('review');
        return;
      }
      onHired();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setStep('review');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bug-modal-backdrop" onClick={onClose}>
      <div className="bug-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
        <div className="bug-modal-header">
          <h2 style={{ margin: 0, fontSize: 16 }}>{t('staff.hire.title')}</h2>
          <button type="button" className="bug-modal-close" onClick={onClose} aria-label={t('staff.hire.close')}>×</button>
        </div>

        {step === 'sketch' && (
          <>
            <div style={{ fontSize: 12, color: 'var(--ink-mute)', marginBottom: 6 }}>
              {t('staff.hire.sketch_lead')}
            </div>
            {suggested && (
              <div style={{ fontSize: 11, color: 'var(--ink-mute)', marginBottom: 8, fontStyle: 'italic' }}>
                {t('staff.hire.sketch_suggested')}
              </div>
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
              <span style={{ fontSize: 11, color: 'var(--ink-mute)', alignSelf: 'center', marginRight: 2 }}>{t('staff.hire.quick_picks_label')}</span>
              {quickPicks.map((qp) => (
                <button
                  key={qp.label}
                  type="button"
                  className="btn"
                  style={{ fontSize: 11, padding: '3px 8px', lineHeight: 1.3 }}
                  title={qp.blurb}
                  onClick={() => setSketch(qp.sketch)}
                  disabled={busy}
                >
                  {qp.label}
                </button>
              ))}
            </div>
            <textarea
              ref={sketchRef} className="bug-modal-textarea" rows={3}
              value={sketch} onChange={(e) => setSketch(e.target.value)}
              placeholder={t('staff.hire.sketch_placeholder')}
            />
            <div style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 6, lineHeight: 1.5 }}>
              {t('staff.hire.sketch_footer')}
            </div>
            {err && <div style={{ marginTop: 8, fontSize: 12, color: 'var(--red, #c0392b)' }}>{err}</div>}
            <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
              <button type="button" className="btn" onClick={onClose} disabled={busy}>{t('staff.hire.cancel')}</button>
              <button type="button" className="btn btn-primary" onClick={generate} disabled={busy || !sketch.trim()}>
                {busy ? t('staff.hire.generating') : t('staff.hire.generate')}
              </button>
            </div>
          </>
        )}

        {(step === 'review' || step === 'saving') && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 11, color: 'var(--ink-mute)', marginBottom: -4 }}>
              {t('staff.hire.review_lead')}
            </div>
            <label style={{ fontSize: 12, color: 'var(--ink-mute)' }}>
              {t('staff.hire.name_label')} <span style={{ opacity: 0.7 }}>{t('staff.hire.name_hint')}</span>
              <input className="bug-modal-textarea" style={{ height: 36 }} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('staff.hire.name_placeholder')} />
            </label>
            <label style={{ fontSize: 12, color: 'var(--ink-mute)' }}>
              {t('staff.hire.role_label')} <span style={{ opacity: 0.7 }}>{t('staff.hire.role_hint')}</span>
              <input className="bug-modal-textarea" style={{ height: 36 }} value={roleLabel} onChange={(e) => setRoleLabel(e.target.value)} placeholder={t('staff.hire.role_placeholder')} />
            </label>
            <label style={{ fontSize: 12, color: 'var(--ink-mute)' }}>
              {t('staff.hire.system_prompt_label')} <span style={{ opacity: 0.7 }}>{t('staff.hire.system_prompt_hint')}</span>
              <textarea className="bug-modal-textarea" rows={9} value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} />
            </label>
            <div style={{ fontSize: 11, color: 'var(--ink-mute)', lineHeight: 1.5 }}>
              {t('staff.hire.review_footer')}
            </div>
            {err && <div style={{ fontSize: 12, color: 'var(--red, #c0392b)' }}>{err}</div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
              <button type="button" className="btn" onClick={() => setStep('sketch')} disabled={busy}>{t('staff.hire.back')}</button>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn" onClick={onClose} disabled={busy}>{t('staff.hire.cancel')}</button>
                <button type="button" className="btn btn-primary" onClick={hire} disabled={busy}>
                  {step === 'saving' ? t('staff.hire.hiring') : t('staff.hire.hire_button')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';

/* Stable ref to the save handler — captured at render time, called by
 * the document-mousedown listener which only mounts once per editing
 * session. Letting the listener close over the latest `save` function
 * via this ref avoids stale-closure bugs when `draft` changes. */

/**
 * Click-to-edit text field. Mirror of mibusy's InlineField pattern:
 *   - Click the value → switches to input/textarea, focuses
 *   - Blur or Enter (single-line) → saves via onSave
 *   - Escape → cancels
 *   - Multiline fields get an optional ✨ "Polish with LLM" button
 *
 * onSave + onPolish are passed in so this is reusable across all /me
 * fields without knowing which one is being edited.
 */
export function InlineField({
  label,
  value,
  onSave,
  multiline = false,
  placeholder = '',
  polishable = false,
  polishHint = '',
}: {
  label: string;
  value: string;
  onSave: (v: string) => Promise<void>;
  multiline?: boolean;
  placeholder?: string;
  polishable?: boolean;
  /** Extra guidance fed to the LLM polish call, e.g. "this is the desk AI's persona". */
  polishHint?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [polishing, setPolishing] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const saveRef = useRef<() => Promise<void>>(async () => {});
  /* When the outside-click listener triggers save(), the textarea
   * loses focus right after, firing native onBlur which would call
   * save() AGAIN with the same draft. This flag short-circuits the
   * second call. Reset on next edit-start. */
  const suppressBlurRef = useRef(false);

  function startEdit() {
    setDraft(value);
    setHint(null);
    suppressBlurRef.current = false;
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  async function save() {
    if (draft === value) { setEditing(false); setHint(null); return; }
    setSaving(true);
    setHint(null);
    try {
      await onSave(draft);
      // Only close edit-mode on SUCCESS. On error we keep editing open
      // so the user's typed value stays visible — fixes the "I typed it,
      // it went back" bug (BUG A from tester report 2026-05-16).
      setEditing(false);
      setHint('✓ saved');
      setTimeout(() => setHint(null), 1200);
    } catch (e) {
      setHint(`❌ save failed: ${e instanceof Error ? e.message : String(e)}`);
      // editing stays true; draft stays as user typed it; inputRef stays focused
    } finally {
      setSaving(false);
    }
  }

  // Keep saveRef in sync so the document-mousedown listener (mounted
  // once per edit session) always calls the latest save closure (which
  // captures latest `draft`).
  saveRef.current = save;

  // Outside-click handler — fixes BUG B: clicking on non-focusable
  // areas (h2 / padding / body) does NOT trigger native blur on the
  // textarea, so user thinks they "clicked away" but their edit
  // evaporates silently. We bind to mousedown so it fires before
  // anything else steals focus.
  useEffect(() => {
    if (!editing) return;
    function onDocMouseDown(ev: MouseEvent) {
      const t = ev.target as Node;
      // Click inside this field's container → leave it to native handlers.
      if (containerRef.current && containerRef.current.contains(t)) return;
      // Click on something specifically marked as "do not commit" (e.g.
      // the polish button which lives outside our container).
      const el = ev.target as HTMLElement;
      if (el && el.closest && el.closest('[data-polish="true"]')) return;
      // Suppress the textarea/input's native onBlur which fires right
      // after this mousedown (focus leaves) — without this guard each
      // click-outside fires save() twice.
      suppressBlurRef.current = true;
      saveRef.current();
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [editing]);

  // Sync draft to external value changes (e.g. after admin reset). Only
  // when NOT editing — never overwrite the user's in-progress typing.
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  async function polish() {
    if (!draft.trim()) { setHint('Nothing to polish.'); return; }
    setPolishing(true);
    setHint('✨ Polishing…');
    try {
      const r = await fetch('/api/v1/admin/polish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: draft, hint: polishHint }),
      });
      const j = await r.json();
      if (!r.ok || !j.polished) {
        setHint(`❌ ${j.error ?? 'polish failed'}`);
      } else {
        setDraft(j.polished);
        setHint('✓ Polished. Click "Save" or edit further.');
      }
    } catch (e) {
      setHint(`❌ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setPolishing(false);
    }
  }

  const hintIsError = !!hint && hint.startsWith('❌');
  const hintIsOk = !!hint && hint.startsWith('✓');

  return (
    <div ref={containerRef} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ fontSize: 12, color: 'var(--ink-mute)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span>{label}</span>
        {saving && <span style={{ fontStyle: 'italic' }}>saving…</span>}
        {polishing && <span style={{ fontStyle: 'italic' }}>polishing…</span>}
        {hint && (
          <span style={{
            fontSize: 12,
            fontWeight: hintIsError ? 600 : 400,
            color: hintIsError ? 'var(--red, #c0392b)' : hintIsOk ? 'var(--green, #2e7d32)' : 'var(--ink-mute)',
            background: hintIsError ? 'rgba(192, 57, 43, 0.08)' : 'transparent',
            padding: hintIsError ? '2px 6px' : '0',
            borderRadius: 4,
          }}>{hint}</span>
        )}
      </div>
      {editing ? (
        <>
          {multiline ? (
            <textarea
              ref={inputRef}
              value={draft}
              rows={6}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={(e) => {
                // Don't save if user just clicked the polish button.
                if ((e.relatedTarget as HTMLElement | null)?.dataset?.polish) return;
                // Don't double-save: outside-click handler already did it.
                if (suppressBlurRef.current) { suppressBlurRef.current = false; return; }
                save();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') { setEditing(false); setHint(null); }
                // Don't save-on-enter for multiline — let the user newline.
              }}
              style={{
                width: '100%', boxSizing: 'border-box', padding: '10px 12px',
                borderRadius: 10, border: '1px solid var(--ink)', fontSize: 13,
                fontFamily: 'inherit', lineHeight: 1.5, resize: 'vertical', color: 'var(--ink)',
                background: '#fff', outline: 'none',
              }}
            />
          ) : (
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => {
                if (suppressBlurRef.current) { suppressBlurRef.current = false; return; }
                save();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') save();
                if (e.key === 'Escape') { setEditing(false); setHint(null); }
              }}
              style={{
                width: '100%', boxSizing: 'border-box', padding: '8px 12px',
                borderRadius: 10, border: '1px solid var(--ink)', fontSize: 14,
                fontFamily: 'inherit', color: 'var(--ink)', background: '#fff', outline: 'none',
              }}
            />
          )}
          {multiline && polishable && (
            <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
              <button
                type="button"
                data-polish="true"
                onMouseDown={(e) => e.preventDefault() /* keep textarea focused */}
                onClick={polish}
                disabled={polishing}
                className="btn"
                style={{ fontSize: 12, padding: '4px 10px' }}
              >
                ✨ Polish with LLM
              </button>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => save()}
                disabled={saving}
                className="btn btn-primary"
                style={{ fontSize: 12, padding: '4px 10px' }}
              >
                Save
              </button>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { setEditing(false); setHint(null); }}
                className="btn"
                style={{ fontSize: 12, padding: '4px 10px' }}
              >
                Cancel
              </button>
            </div>
          )}
        </>
      ) : (
        <div
          onClick={startEdit}
          style={{
            fontSize: 14, color: value ? 'var(--ink)' : 'var(--ink-mute)',
            lineHeight: 1.55, padding: '6px 2px', cursor: 'text',
            borderBottom: '1px dashed var(--line)',
            whiteSpace: 'pre-wrap', wordBreak: 'break-word', minHeight: 22,
          }}
          title="Click to edit"
        >
          {value || <span style={{ fontStyle: 'italic' }}>{placeholder || 'Click to edit…'}</span>}
        </div>
      )}
    </div>
  );
}

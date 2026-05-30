'use client';

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { ReferenceDescriptor, ReferenceKind } from '@holon/core';
import { useT } from '../../../lib/i18n/useT';

const COLLAPSE_KEY = 'holon-references-collapsed-v1';

interface FsListResult {
  path: string;
  entries: { name: string; isDir: boolean }[];
  crumbs: { name: string; path: string }[];
}

type FileTypeFilter = 'all' | 'word' | 'pdf' | 'markdown' | 'text';
type LocalPickerMode = 'file' | 'folderBatch';

const FILE_TYPE_FILTERS: { value: FileTypeFilter; labelKey: string; extensions: string[] }[] = [
  { value: 'all', labelKey: 'references.file_picker.type.all', extensions: [] },
  { value: 'word', labelKey: 'references.file_picker.type.word', extensions: ['.doc', '.docx'] },
  { value: 'pdf', labelKey: 'references.file_picker.type.pdf', extensions: ['.pdf'] },
  { value: 'markdown', labelKey: 'references.file_picker.type.markdown', extensions: ['.md', '.markdown'] },
  { value: 'text', labelKey: 'references.file_picker.type.text', extensions: ['.txt'] },
];

function joinPath(base: string, name: string): string {
  return `${base}${base.endsWith('/') ? '' : '/'}${name}`;
}

function basename(path: string): string {
  const trimmed = path.replace(/\/+$/, '');
  return trimmed.slice(trimmed.lastIndexOf('/') + 1) || trimmed;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot).toLowerCase();
}

function fileMatchesType(name: string, filter: FileTypeFilter): boolean {
  const option = FILE_TYPE_FILTERS.find((f) => f.value === filter);
  if (!option || option.extensions.length === 0) return true;
  return option.extensions.includes(extensionOf(name));
}

function loadCollapsed(): Set<ReferenceKind> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(COLLAPSE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((x): x is ReferenceKind => typeof x === 'string') as ReferenceKind[]);
  } catch (error) {
    void error;
    return new Set();
  }
}

function saveCollapsed(s: Set<ReferenceKind>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...s]));
  } catch (error) { void error; }
}

const KIND_LABEL: Record<ReferenceKind, string> = {
  'output-format': 'Output Format — Fillable shells (PRD, weekly status, offer…)',
  regulatory: 'Regulatory — Laws & regulations',
  'industry-standard': 'Industry Standard — Protocols & specs',
  accessibility: 'Accessibility — A11y guidelines',
  security: 'Security — Frameworks & ISMS',
  'language-style': 'Language & Style — Code conventions',
  'company-internal': 'Company Internal — Policies & playbooks',
};

const KIND_ORDER: ReferenceKind[] = [
  'output-format',
  'regulatory',
  'security',
  'accessibility',
  'industry-standard',
  'language-style',
  'company-internal',
];

// Kinds available when creating a NEW reference (output-format is reserved
// for the auto-projected templates).
const NEW_KIND_OPTIONS: ReferenceKind[] = [
  'regulatory', 'industry-standard', 'accessibility',
  'security', 'language-style', 'company-internal',
];

// _builtin is now server-authoritative — attached per item in GET /api/v1/references.
// No client-side BUILTIN_REFERENCE_IDS or BUILTIN_TEMPLATE_IDS sets needed.

/** A reference is an "example" if the server flagged it as built-in.
 *  Per user 2026-05-17: user 不想看那种 — examples default to collapsed at the bottom. */
function isExampleReference(r: ReferenceDescriptor & { _builtin?: boolean }): boolean {
  return r._builtin ?? false;
}

/**
 * Hand-written "when to use this" hints for well-known catalog references.
 * Written for Sarah-Chen (SMB owner) persona — plain English, concrete
 * trigger phrase. Refs not in this map fall back to a kind-based generic
 * hint (see KIND_HINT). Mirrors the WHEN_TO_USE pattern from SkillsClient.
 */
const WHEN_TO_USE: Record<string, string> = {
  'wcag-2-2':       'When asked to review or rewrite a page/form for accessibility — keep within WCAG 2.2 AA.',
  'iso-27001-2022': 'When prepping an ISMS audit or answering a vendor security questionnaire.',
  'gdpr':           'When handling EU customer data — consent, data-subject requests, breach notification rules.',
  'pep-8':          'When reviewing or generating Python code — enforces indentation, naming, line length.',
  'oauth-2-1':      'When wiring up auth — picks the right OAuth flow (PKCE, device, client-credentials).',
  'nist-csf-2-0':   'When building a security program from scratch — Govern/Identify/Protect/Detect/Respond/Recover.',
};

const KIND_HINT: Record<ReferenceKind, string> = {
  'output-format':    'When generating a deliverable that needs this exact shape (status update, brief, etc.).',
  regulatory:         'When the request touches a regulated domain (privacy, finance, health) and must cite law.',
  'industry-standard':'When the request involves a protocol or spec (API, file format) and must conform.',
  accessibility:      'When generating UI / copy that must clear an a11y bar.',
  security:           'When the request involves auth, data handling, or vendor security review.',
  'language-style':   'When generating code that must follow a house style guide.',
  'company-internal': 'When the request must match your company\'s own policies or playbooks.',
};

function whenToUseHint(r: ReferenceDescriptor): string {
  return WHEN_TO_USE[r.id] ?? KIND_HINT[r.kind];
}

function buildHref(url: string, anchor: string): string {
  if (!anchor) return url;
  const hashIdx = url.indexOf('#');
  const base = hashIdx === -1 ? url : url.slice(0, hashIdx);
  return `${base}#${anchor}`;
}

function ReferenceCard({ r, onDeleted, isExample = false }: {
  r: ReferenceDescriptor & { _builtin?: boolean };
  onDeleted: (id: string) => void;
  /** Render as a "STORE" (built-in catalog) card — adds badge + subtle tint
   *  so Sarah can tell at-a-glance whether a card is hers vs. a built-in. */
  isExample?: boolean;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const sections = r.key_sections ?? [];

  // Deletable iff it's user-defined AND not an output-format projection.
  const isProjected = r.kind === 'output-format';
  const isBuiltin = r._builtin ?? false;
  const canDelete = !isProjected && !isBuiltin;
  const hint = whenToUseHint(r);

  async function onDelete() {
    if (!window.confirm(`Delete reference "${r.name}"? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      const resp = await fetch(`/api/v1/references/${encodeURIComponent(r.id)}`, { method: 'DELETE' });
      if (resp.ok) {
        onDeleted(r.id);
      } else {
        const j = (await resp.json().catch(() => ({}))) as { error?: string };
        alert(`Delete failed: ${j.error ?? resp.status}`);
      }
    } finally {
      setDeleting(false);
    }
  }

  return (
    <article className={`skill-card${open ? ' is-open' : ''}${isExample ? ' is-example' : ''}`} data-reference-id={r.id}>
      <header className="skill-card-head">
        <span className="skill-card-icon" aria-hidden="true">{r.icon}</span>
        <div className="skill-card-titles">
          <h3 className="skill-card-name">
            {r.name}
            {isExample && <span className="skill-card-badge" title="Built-in Store reference — works out of the box">STORE</span>}
          </h3>
          <p className="skill-card-tagline-prominent">{r.tagline}</p>
        </div>
        <span className="skill-card-status is-ready">● ready</span>
      </header>
      {/* bug-183109: clamp the always-visible hint to 2 lines so cards stay
       *  compact; full text is still in the DOM / accessible via title attr. */}
      <p
        className="skill-card-when-to-use"
        title={hint}
        style={{
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        <span className="skill-card-when-to-use-label">When to use:</span> {hint}
      </p>

      <div className="reference-card-meta">
        {r.pinned && (
          <span className="skill-ref-chip" title={t('references.card.pinned_title')}>
            {t('references.card.pinned_chip')}
          </span>
        )}
        <span className="skill-ref-chip" title="Issuing authority">{r.authority}</span>
        <span className="skill-ref-chip" title="Version / release">{r.version}</span>
      </div>

      <div className="template-card-actions">
        <button
          type="button"
          className="skill-card-toggle"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          {open ? 'Hide details' : 'Show details'}
        </button>
        <a
          className="skill-card-toggle reference-card-open"
          href={r.url}
          target="_blank"
          rel="noreferrer"
          title={`Open ${r.name} on ${r.authority}'s site`}
        >
          Open ↗
        </a>
        {canDelete && (
          <button
            type="button"
            className="skill-card-toggle"
            onClick={onDelete}
            disabled={deleting}
            title="Delete this user-defined reference"
            style={{ marginLeft: 'auto', color: 'var(--ink-danger, #b00)' }}
          >
            {deleting ? 'Deleting…' : '× delete'}
          </button>
        )}
      </div>

      {open && (
        <>
          <p className="skill-card-desc">{r.summary}</p>
          {sections.length > 0 && (
            <ul className="reference-key-sections" aria-label="Key sections">
              {sections.map((s) => (
                <li key={s.id}>
                  <a
                    className="reference-key-section"
                    href={buildHref(r.url, s.anchor)}
                    target="_blank"
                    rel="noreferrer"
                    title={s.anchor ? `Jump to #${s.anchor}` : 'Open source document'}
                  >
                    <span className="reference-key-section-title">{s.title}</span>
                    <span className="skill-card-example-cta">→ open</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </article>
  );
}

/* ── + New modal ─────────────────────────────────────────────────────── */

function LocalFilePicker({
  initialPath,
  mode = 'file',
  selectedPaths = [],
  fileTypeFilter = 'all',
  onPick,
  onPickMany,
  onFileTypeFilterChange,
  onClose,
}: {
  initialPath: string;
  mode?: LocalPickerMode;
  selectedPaths?: string[];
  fileTypeFilter?: FileTypeFilter;
  onPick: (path: string) => void;
  onPickMany?: (paths: string[], folderPath: string) => void;
  onFileTypeFilterChange?: (filter: FileTypeFilter) => void;
  onClose: () => void;
}) {
  const { t } = useT();
  const initialDir = initialPath.includes('/') && !initialPath.endsWith('/')
    ? initialPath.slice(0, initialPath.lastIndexOf('/')) || '/'
    : initialPath;
  const [cwd, setCwd] = useState(initialDir);
  const [data, setData] = useState<FsListResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(selectedPaths));
  const multi = mode === 'folderBatch';
  const visibleEntries = useMemo(() => {
    const entries = data?.entries ?? [];
    if (!multi) return entries;
    return entries.filter((entry) => entry.isDir || fileMatchesType(entry.name, fileTypeFilter));
  }, [data?.entries, fileTypeFilter, multi]);
  const visibleFiles = useMemo(() => visibleEntries.filter((entry) => !entry.isDir), [visibleEntries]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/v1/admin/fs/list?includeFiles=1&path=${encodeURIComponent(cwd)}`)
      .then(async (r) => {
        const j = await r.json();
        if (cancelled) return;
        if (!r.ok) {
          setError(typeof j?.error === 'string' ? j.error : `list failed (${r.status})`);
          return;
        }
        setData(j as FsListResult);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [cwd]);

  function toggleSelected(path: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }

  function addVisibleFiles(): void {
    if (!data) return;
    setSelected((prev) => {
      const next = new Set(prev);
      for (const entry of visibleFiles) next.add(joinPath(data.path, entry.name));
      return next;
    });
  }

  function clearVisibleFiles(): void {
    if (!data) return;
    const visible = new Set(visibleFiles.map((entry) => joinPath(data.path, entry.name)));
    setSelected((prev) => new Set([...prev].filter((path) => !visible.has(path))));
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={multi ? t('references.file_picker.title_multi') : t('references.file_picker.title')}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100,
      }}
    >
      <div
        style={{
          background: 'var(--paper, #fff)', color: 'var(--ink)',
          borderRadius: 8, border: '1px solid var(--line, #ddd)',
          width: 620, maxWidth: '92vw', maxHeight: '80vh',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <strong style={{ fontSize: 14 }}>
            {multi ? t('references.file_picker.title_multi') : t('references.file_picker.title')}
          </strong>
          {multi && (
            <span style={{
              fontSize: 12, color: 'var(--ink-mute)', border: '1px solid var(--line)',
              borderRadius: 999, padding: '2px 8px',
            }}>
              {t('references.file_picker.selected_count').replace('{n}', String(selected.size))}
            </span>
          )}
          <div style={{ flex: 1 }} />
          <button type="button" className="btn" style={{ fontSize: 12, padding: '4px 10px' }} onClick={onClose}>
            {t('references.file_picker.cancel')}
          </button>
        </div>

        <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--line)', fontSize: 12, color: 'var(--ink-mute)', display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
          {(data?.crumbs ?? []).map((c, i) => (
            <span key={c.path} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <button
                type="button"
                onClick={() => setCwd(c.path)}
                style={{
                  background: 'transparent', border: 'none', padding: '2px 4px', cursor: 'pointer',
                  fontFamily: 'monospace', fontSize: 12, color: 'var(--ink)', textDecoration: 'underline',
                }}
              >{c.name}</button>
              {i < (data?.crumbs?.length ?? 0) - 1 && <span>/</span>}
            </span>
          ))}
        </div>

        {multi && (
          <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--line)', display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <label style={{ fontSize: 12, color: 'var(--ink-mute)', display: 'flex', gap: 6, alignItems: 'center' }}>
              {t('references.file_picker.type_label')}
              <select
                value={fileTypeFilter}
                onChange={(e) => onFileTypeFilterChange?.(e.target.value as FileTypeFilter)}
                style={{ ...inputStyle, width: 170, marginTop: 0, padding: '4px 8px' }}
              >
                {FILE_TYPE_FILTERS.map((filter) => (
                  <option key={filter.value} value={filter.value}>{t(filter.labelKey)}</option>
                ))}
              </select>
            </label>
            <button type="button" className="btn" style={{ fontSize: 12, padding: '4px 10px', marginLeft: 'auto' }} onClick={addVisibleFiles} disabled={visibleFiles.length === 0}>
              {t('references.file_picker.select_visible')}
            </button>
            <button type="button" className="btn" style={{ fontSize: 12, padding: '4px 10px' }} onClick={clearVisibleFiles} disabled={selected.size === 0}>
              {t('references.file_picker.clear_visible')}
            </button>
          </div>
        )}

        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
          {loading && <div style={{ padding: '12px 16px', fontSize: 12, color: 'var(--ink-mute)' }}>{t('references.file_picker.loading')}</div>}
          {error && <div style={{ padding: '12px 16px', fontSize: 12, color: 'var(--red, #c0392b)' }}>{error}</div>}
          {!loading && !error && data && visibleEntries.length === 0 && (
            <div style={{ padding: '12px 16px', fontSize: 12, fontStyle: 'italic', color: 'var(--ink-mute)' }}>
              {t('references.file_picker.empty')}
            </div>
          )}
          {!loading && !error && data && visibleEntries.map((e) => {
            const fullPath = joinPath(data.path, e.name);
            if (multi && !e.isDir) {
              const checked = selected.has(fullPath);
              return (
                <label
                  key={`f:${e.name}`}
                  style={{
                    width: '100%', textAlign: 'left', background: checked ? 'var(--bg-alt, #f5f5f5)' : 'transparent',
                    border: 'none', padding: '8px 16px', cursor: 'pointer', fontFamily: 'monospace',
                    fontSize: 13, color: 'var(--ink)', borderBottom: '1px solid var(--bg-alt, #f5f5f5)',
                    display: 'flex', alignItems: 'center', gap: 8, boxSizing: 'border-box',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleSelected(fullPath)}
                    style={{ margin: 0 }}
                  />
                  <span>📄 {e.name}</span>
                </label>
              );
            }
            return (
              <button
                key={`${e.isDir ? 'd' : 'f'}:${e.name}`}
                type="button"
                onClick={() => {
                  if (e.isDir) setCwd(fullPath);
                  else if (multi) toggleSelected(fullPath);
                  else { onPick(fullPath); onClose(); }
                }}
                style={{
                  width: '100%', textAlign: 'left', background: 'transparent', border: 'none',
                  padding: '8px 16px', cursor: 'pointer', fontFamily: 'monospace', fontSize: 13,
                  color: 'var(--ink)', borderBottom: '1px solid var(--bg-alt, #f5f5f5)',
                }}
                onMouseOver={(ev) => (ev.currentTarget.style.background = 'var(--bg-alt, #f5f5f5)')}
                onMouseOut={(ev) => (ev.currentTarget.style.background = 'transparent')}
              >
                {e.isDir ? '📁' : '📄'} {e.name}
              </button>
            );
          })}
        </div>

        <div style={{ padding: '10px 16px', borderTop: '1px solid var(--line)' }}>
          <code style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--ink-mute)', display: 'block', overflowX: 'auto', whiteSpace: 'nowrap' }}>
            {data?.path ?? cwd}
          </code>
          {multi && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
              <button
                type="button"
                className="btn"
                style={{ fontSize: 12, padding: '6px 12px' }}
                onClick={() => setSelected(new Set())}
                disabled={selected.size === 0}
              >
                {t('references.file_picker.clear')}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                style={{ fontSize: 12, padding: '6px 12px' }}
                onClick={() => {
                  onPickMany?.([...selected], data?.path ?? cwd);
                  onClose();
                }}
                disabled={selected.size === 0}
              >
                {t('references.file_picker.confirm')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function NewReferenceModal({
  onClose, onCreated,
}: { onClose: () => void; onCreated: (r: ReferenceDescriptor) => void }) {
  const { t } = useT();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<ReferenceKind>('industry-standard');
  const [authority, setAuthority] = useState('');
  const [version, setVersion] = useState('');
  const [url, setUrl] = useState('');
  // D6: where the canonical content lives. 'url' = public web page
  // (existing default); 'file'/'folder' = local path on the owner's
  // machine (skills branch on source_type to pick retrieval strategy).
  const [sourceType, setSourceType] = useState<'url' | 'file' | 'folder'>('url');
  const [referenceIntent, setReferenceIntent] = useState<'pinned' | 'searchable'>('pinned');
  const [localPath, setLocalPath] = useState('');
  const [selectedLocalFiles, setSelectedLocalFiles] = useState<string[]>([]);
  const [fileTypeFilter, setFileTypeFilter] = useState<FileTypeFilter>('all');
  const [showFilePicker, setShowFilePicker] = useState(false);
  const [tagline, setTagline] = useState('');
  const [summary, setSummary] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [icon, setIcon] = useState('');
  const [keySectionsText, setKeySectionsText] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [batchResults, setBatchResults] = useState<Array<{ path: string; ok: boolean; message: string }>>([]);

  const isLocalSource = sourceType === 'file' || sourceType === 'folder';
  const pinned = isLocalSource && referenceIntent === 'pinned';

  async function createDirectReference(payload: Record<string, unknown>): Promise<ReferenceDescriptor> {
    const r = await fetch('/api/v1/references', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const j = await r.json() as ReferenceDescriptor & { error?: string };
    if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
    return j;
  }

  function buildDirectPayload(localFilePath?: string): Record<string, unknown> {
    const path = localFilePath ?? localPath.trim();
    const referenceName = localFilePath ? basename(localFilePath) : name.trim();
    const local = sourceType === 'folder' && localFilePath ? true : isLocalSource;
    return {
      mode: 'direct',
      name: referenceName,
      kind,
      authority: authority.trim(),
      version: version.trim(),
      url: local ? path : url.trim(),
      source_type: local ? 'file' : sourceType,
      ...(local ? { local_path: path } : {}),
      pinned,
      ...(tagline.trim() ? { tagline: tagline.trim() } : {}),
      ...(summary.trim() ? { summary: summary.trim() } : {}),
      ...(icon.trim() ? { icon: icon.trim() } : {}),
    };
  }

  async function onDirectSubmit() {
    setError(null);
    const isFolderBatch = sourceType === 'folder';
    if ((!isFolderBatch && !name.trim()) || !authority.trim() || !version.trim()) {
      setError(isFolderBatch ? t('references.direct.required_folder') : t('references.direct.required_single'));
      return;
    }
    // url is the canonical "where" for source_type='url'; for local
    // sources the local_path is the canonical location instead.
    if (isLocalSource) {
      if (sourceType === 'folder') {
        if (selectedLocalFiles.length === 0) {
          setError(t('references.direct.folder_files_required'));
          return;
        }
      } else if (!localPath.trim()) {
        setError(t('references.direct.local_path_required'));
        return;
      }
    } else if (!url.trim()) {
      setError(t('references.direct.url_required'));
      return;
    }
    let key_sections: { id: string; title: string; anchor: string }[] | undefined;
    if (keySectionsText.trim()) {
      try {
        const parsed = JSON.parse(keySectionsText) as unknown;
        if (!Array.isArray(parsed)) throw new Error('key_sections must be an array');
        key_sections = parsed as { id: string; title: string; anchor: string }[];
      } catch (e) {
        setError(`key_sections JSON invalid: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
    }
    const tags = tagsText.trim()
      ? tagsText.split(',').map((s) => s.trim()).filter(Boolean)
      : undefined;

    setSubmitting(true);
    setBatchResults([]);
    try {
      if (isFolderBatch) {
        const results: Array<{ path: string; ok: boolean; message: string }> = [];
        for (const filePath of selectedLocalFiles) {
          try {
            const created = await createDirectReference({
              ...buildDirectPayload(filePath),
              ...(tags ? { tags } : {}),
              ...(key_sections ? { key_sections } : {}),
            });
            onCreated(created);
            results.push({ path: filePath, ok: true, message: t('references.direct.batch_created') });
          } catch (batchError) {
            const message = batchError instanceof Error ? batchError.message : String(batchError);
            results.push({ path: filePath, ok: false, message });
          }
        }
        setBatchResults(results);
        const failed = results.filter((result) => !result.ok).length;
        if (failed > 0) {
          setError(t('references.direct.batch_failed').replace('{n}', String(failed)));
        } else {
          setError(null);
        }
      } else {
        const j = await createDirectReference({
          ...buildDirectPayload(),
          ...(tags ? { tags } : {}),
          ...(key_sections ? { key_sections } : {}),
        });
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
      role="dialog" aria-modal="true" aria-label="Create new reference"
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
          <h2 style={{ margin: 0, fontSize: 18 }}>+ New Reference</h2>
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
              {sourceType === 'folder' ? t('references.direct.name_folder_batch') : t('references.direct.name_required')}
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={inputStyle}
                placeholder={sourceType === 'folder' ? t('references.direct.name_folder_placeholder') : 'e.g. HIPAA Privacy Rule'}
                disabled={sourceType === 'folder'}
              />
            </label>
            <div style={{ display: 'flex', gap: 10 }}>
              <label style={{ fontSize: 12, flex: 1 }}>
                Kind *
                <select value={kind} onChange={(e) => setKind(e.target.value as ReferenceKind)} style={inputStyle}>
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
                  placeholder="📚"
                />
              </label>
            </div>
            <label style={{ fontSize: 12 }}>
              Authority *
              <input
                value={authority}
                onChange={(e) => setAuthority(e.target.value)}
                style={inputStyle}
                placeholder="W3C / ISO / IETF / NIST / US-HHS"
              />
            </label>
            <div style={{ display: 'flex', gap: 10 }}>
              <label style={{ fontSize: 12, flex: 1 }}>
                Version *
                <input
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                  style={inputStyle}
                  placeholder="2.1 (June 2018)"
                />
              </label>
              <label style={{ fontSize: 12, width: 140 }}>
                Source *
                <select
                  value={sourceType}
                  onChange={(e) => {
                    const next = e.target.value as 'url' | 'file' | 'folder';
                    setSourceType(next);
                    setSelectedLocalFiles([]);
                    setBatchResults([]);
                    setFileTypeFilter('all');
                  }}
                  style={inputStyle}
                >
                  <option value="url">Public URL</option>
                  <option value="file">Local file</option>
                  <option value="folder">Local folder</option>
                </select>
              </label>
            </div>
            {!isLocalSource ? (
              <label style={{ fontSize: 12 }}>
                URL *
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  style={inputStyle}
                  placeholder="https://…"
                />
              </label>
            ) : (
              <>
                <label style={{ fontSize: 12 }}>
                  Local path * {sourceType === 'folder' ? '(absolute folder path)' : '(absolute file path)'}
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                      value={localPath}
                      onChange={(e) => setLocalPath(e.target.value)}
                      style={inputStyle}
                      placeholder={sourceType === 'folder' ? '/home/me/specs/' : '/home/me/specs/wcag.md'}
                    />
                    {isLocalSource && (
                      <button
                        type="button"
                        onClick={() => setShowFilePicker(true)}
                        style={{
                          marginTop: 4, padding: '6px 10px', border: '1px solid var(--rule, #444)',
                          borderRadius: 4, background: 'transparent', color: 'inherit', cursor: 'pointer',
                          whiteSpace: 'nowrap', fontSize: 12,
                        }}
                      >
                        {sourceType === 'folder' ? t('references.direct.browse_folder_files') : t('references.direct.browse_file')}
                      </button>
                    )}
                  </div>
                </label>
                {sourceType === 'folder' && selectedLocalFiles.length > 0 && (
                  <div style={{ fontSize: 12, color: 'var(--ink-mute)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <strong style={{ color: 'var(--ink)' }}>
                      {t('references.direct.selected_files').replace('{n}', String(selectedLocalFiles.length))}
                    </strong>
                    <div style={{
                      maxHeight: 86, overflowY: 'auto', border: '1px solid var(--line)',
                      borderRadius: 6, padding: 8, fontFamily: 'monospace',
                    }}>
                      {selectedLocalFiles.map((path) => <div key={path}>{path}</div>)}
                    </div>
                  </div>
                )}
                {isLocalSource && (
                  <fieldset style={{
                    border: '1px solid var(--rule, #444)', borderRadius: 6,
                    padding: 10, margin: 0, display: 'flex', flexDirection: 'column', gap: 8,
                  }}>
                    <legend style={{ fontSize: 12, padding: '0 4px', color: 'var(--ink-mute)' }}>
                      {t('references.direct.retrieval_mode')}
                    </legend>
                    <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12 }}>
                      <input
                        type="radio"
                        name="reference-intent"
                        checked={referenceIntent === 'pinned'}
                        onChange={() => setReferenceIntent('pinned')}
                        style={{ marginTop: 2 }}
                      />
                      <span>
                        <strong>{t('references.direct.pin_whole_file')}</strong>
                        <span style={{ display: 'block', color: 'var(--ink-mute)', marginTop: 2 }}>
                          {t('references.direct.pin_whole_file_help')}
                        </span>
                      </span>
                    </label>
                    <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12, opacity: 0.55 }}>
                      <input type="radio" name="reference-intent" disabled style={{ marginTop: 2 }} />
                      <span>
                        <strong>{t('references.direct.searchable_kb')}</strong>
                        <span style={{
                          marginLeft: 6, border: '1px solid var(--rule, #444)',
                          borderRadius: 999, padding: '1px 6px', fontSize: 11,
                        }}>
                          {t('references.direct.coming_soon')}
                        </span>
                      </span>
                    </label>
                  </fieldset>
                )}
              </>
            )}
            {batchResults.length > 0 && (
              <div style={{
                border: '1px solid var(--line)', borderRadius: 6, padding: 10,
                fontSize: 12, display: 'flex', flexDirection: 'column', gap: 6,
              }}>
                <strong>{t('references.direct.batch_results')}</strong>
                {batchResults.map((result) => (
                  <div
                    key={result.path}
                    style={{ color: result.ok ? 'var(--green, #2e7d32)' : 'var(--red, #c0392b)' }}
                  >
                    {result.ok ? '✓' : '×'} {basename(result.path)} — {result.message}
                  </div>
                ))}
              </div>
            )}
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
                placeholder="privacy, us, healthcare"
              />
            </label>
            <label style={{ fontSize: 12 }}>
              Summary
              <textarea
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                rows={4}
                style={inputStyle}
                placeholder="one paragraph: what it covers, when to consult, what audits it enables"
              />
            </label>
            <label style={{ fontSize: 12 }}>
              Key Sections JSON (optional — array of {'{id,title,anchor}'})
              <textarea
                value={keySectionsText}
                onChange={(e) => setKeySectionsText(e.target.value)}
                rows={4}
                style={{ ...inputStyle, fontFamily: 'monospace' }}
                placeholder={'[{"id":"art-5","title":"Article 5 — Principles","anchor":"art-5"}]'}
              />
            </label>
            <button
              type="button"
              onClick={onDirectSubmit}
              disabled={
                submitting ||
                (sourceType !== 'folder' && !name.trim()) ||
                !authority.trim() ||
                !version.trim() ||
                (sourceType === 'url' ? !url.trim() : sourceType === 'file' ? !localPath.trim() : selectedLocalFiles.length === 0)
              }
              style={{
                marginTop: 8, padding: '8px 16px',
                background: 'var(--green)', color: '#fff', border: 'none', borderRadius: 4,
                cursor: submitting ? 'not-allowed' : 'pointer', fontSize: 13,
                opacity: (
                  submitting ||
                  (sourceType !== 'folder' && !name.trim()) ||
                  !authority.trim() ||
                  !version.trim() ||
                  (sourceType === 'url' ? !url.trim() : sourceType === 'file' ? !localPath.trim() : selectedLocalFiles.length === 0)
                ) ? 0.6 : 1,
                alignSelf: 'flex-start',
              }}
            >
              {submitting ? 'Saving…' : 'Save Reference'}
            </button>
        </div>
      </div>
      {showFilePicker && (
        <LocalFilePicker
          initialPath={localPath}
          mode={sourceType === 'folder' ? 'folderBatch' : 'file'}
          selectedPaths={selectedLocalFiles}
          fileTypeFilter={fileTypeFilter}
          onFileTypeFilterChange={setFileTypeFilter}
          onPick={(path) => {
            setLocalPath(path);
            setSelectedLocalFiles([]);
            setBatchResults([]);
          }}
          onPickMany={(paths, folderPath) => {
            setSelectedLocalFiles(paths);
            setLocalPath(folderPath);
            setBatchResults([]);
          }}
          onClose={() => setShowFilePicker(false)}
        />
      )}
    </div>
  );
}

const inputStyle: CSSProperties = {
  display: 'block', width: '100%', marginTop: 4, padding: 6,
  background: 'var(--bg-alt)', color: 'var(--ink)',
  border: '1px solid var(--rule, #444)', borderRadius: 4,
  fontFamily: 'inherit', fontSize: 13, boxSizing: 'border-box',
};

export function ReferencesClient({ references }: { references: (ReferenceDescriptor & { _builtin?: boolean })[] }) {
  const { t } = useT();
  const [items, setItems] = useState<(ReferenceDescriptor & { _builtin?: boolean })[]>(references);
  const [collapsed, setCollapsed] = useState<Set<ReferenceKind>>(() => new Set());
  const [showModal, setShowModal] = useState(false);

  useEffect(() => { setCollapsed(loadCollapsed()); }, []);

  async function refresh() {
    const r = await fetch('/api/v1/references');
    if (r.ok) {
      const j = await r.json() as { items: (ReferenceDescriptor & { _builtin?: boolean })[] };
      setItems(j.items);
    }
  }

  function toggleSection(k: ReferenceKind): void {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      saveCollapsed(next);
      return next;
    });
  }

  // Partition: yours (user-created) vs store (system catalog).
  // Per user 2026-05-17: "user 不想看那种" — store default-hidden.
  // _builtin is server-authoritative per item.
  const { yourItems, exampleItems } = useMemo(() => {
    const y: (ReferenceDescriptor & { _builtin?: boolean })[] = [];
    const e: (ReferenceDescriptor & { _builtin?: boolean })[] = [];
    for (const r of items) (isExampleReference(r) ? e : y).push(r);
    return { yourItems: y, exampleItems: e };
  }, [items]);

  const grouped = useMemo(() => {
    const g: Record<ReferenceKind, (ReferenceDescriptor & { _builtin?: boolean })[]> = {
      'output-format': [],
      regulatory: [],
      'industry-standard': [],
      accessibility: [],
      security: [],
      'language-style': [],
      'company-internal': [],
    };
    for (const r of yourItems) g[r.kind].push(r);
    return g;
  }, [yourItems]);

  // Examples grouped by kind — same shape so the section renders identically.
  const examplesGrouped = useMemo(() => {
    const g: Record<ReferenceKind, (ReferenceDescriptor & { _builtin?: boolean })[]> = {
      'output-format': [],
      regulatory: [],
      'industry-standard': [],
      accessibility: [],
      security: [],
      'language-style': [],
      'company-internal': [],
    };
    for (const r of exampleItems) g[r.kind].push(r);
    return g;
  }, [exampleItems]);

  // Examples block — collapsed by default but rememberable via the same
  // localStorage key as the kind sections.
  const EXAMPLES_KEY = '__examples__' as ReferenceKind;
  const examplesCollapsed = !collapsed.has(EXAMPLES_KEY) || collapsed.has(EXAMPLES_KEY);
  // Default-collapsed: invert default so absent => collapsed.
  const isExamplesOpen = collapsed.has(EXAMPLES_KEY);
  function toggleExamples(): void {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(EXAMPLES_KEY)) next.delete(EXAMPLES_KEY); else next.add(EXAMPLES_KEY);
      saveCollapsed(next);
      return next;
    });
  }
  // unused-suppress
  void examplesCollapsed;

  return (
    <>
      <div className="page-strip">
        <h1 className="page-strip-title">{t('references.page_title')}</h1>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setShowModal(true)}
          style={{ marginRight: 12 }}
        >
          {t('references.new_button')}
        </button>
        <div style={{ fontSize: 12, color: 'var(--ink-mute)' }}>
          {yourItems.length} {t('references.count.yours')} · {exampleItems.length} {t('references.count.examples')}
        </div>
      </div>

      {/* Above-strip explainer panel — lead stays always-visible for context.
       *  bug-183511: helper text moved to a hover tooltip on an info icon
       *  so it doesn't consume vertical space by default. Full text is
       *  accessible on hover (title attr) in both zh and en. */}
      <div className="skills-explainer">
        <p className="skills-explainer-lead" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <strong>{t('references.explainer.lead')}</strong>{t('references.explainer.lead_tail')}
          <span
            aria-label={t('references.explainer.info_tooltip',
              'Enable a reference below to make it available to your staff. Each staff member can be allowed or denied specific references from their card on /members.')}
            title={t('references.explainer.info_tooltip',
              'Enable a reference below to make it available to your staff. Each staff member can be allowed or denied specific references from their card on /members.')}
            role="img"
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 16, height: 16, borderRadius: '50%',
              fontSize: 11, fontWeight: 700, lineHeight: 1,
              background: 'var(--rule, #555)', color: 'var(--ink-mute, #aaa)',
              cursor: 'default', flexShrink: 0,
            }}
          >?</span>
        </p>
      </div>

      {yourItems.length === 0 && (
        <div className="skills-yours-empty">
          <p className="skills-yours-empty-lead">
            <strong>{t('references.yours_empty.lead')}</strong>
          </p>
          <p className="skills-yours-empty-body">
            The <strong>Store</strong> below shows common built-in docs — click any to enable it,
            or use the <strong>+ New</strong> button above to add a custom reference directly.
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
                  {list.map((r) => (
                    <ReferenceCard key={r.id} r={r} onDeleted={() => refresh()} />
                  ))}
                </div>
              )}
            </section>
          );
        })}

        {/* Store block — default collapsed. System catalog (built-in
         * input refs + built-in template projections) lives here so it
         * doesn't clutter the user's working library. */}
        {exampleItems.length > 0 && (
          <section className={`skills-section examples-section${!isExamplesOpen ? ' is-collapsed' : ''}`}>
            <button
              type="button"
              className="skills-section-title"
              aria-expanded={isExamplesOpen}
              onClick={toggleExamples}
            >
              <span className={`skills-section-chevron${!isExamplesOpen ? ' is-collapsed' : ''}`} aria-hidden="true">▾</span>
              <span>Store — built-in references shipped with Holon, use as reference or clone; more shared items later.</span>
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
                        {list.map((r) => (
                          <ReferenceCard key={r.id} r={r} onDeleted={() => refresh()} isExample />
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
        <NewReferenceModal
          onClose={() => { setShowModal(false); refresh(); }}
          onCreated={() => refresh()}
        />
      )}
    </>
  );
}

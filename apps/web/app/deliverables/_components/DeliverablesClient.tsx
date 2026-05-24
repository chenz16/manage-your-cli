'use client';

import { useState, useMemo, useEffect } from 'react';
import type {
  ListDeliverablesResponse,
  Deliverable,
  GetDeliverableResponse,
  DeliverableStatus,
} from '@holon/api-contract';
import { renderDeliverableBody } from './renderBody';
import { DeliverablesEmptyState } from './DeliverablesEmptyState';
import { useT } from '../../../lib/i18n/useT';
import { ProjectSwitcher } from '../../_components/ProjectSwitcher';
import { useProjects } from '../../../lib/hooks/useProjects';

const STATUS_LABEL: Record<DeliverableStatus, string> = {
  draft: 'Draft', final: 'Final', accepted: 'Accepted', rejected: 'Rejected', revised: 'Revised',
};

type OriginKey = 'all' | 'local' | 'remote' | 'submitted';
const ORIGIN_ICON: Record<Exclude<OriginKey, 'all'>, string> = {
  local: '🤖',
  remote: '📥',
  submitted: '📤',
};
const ORIGIN_LABEL: Record<OriginKey, string> = {
  all: 'All',
  local: 'Local AI',
  remote: 'Remote returned',
  submitted: 'Submitted upstream',
};

function excerpt(d: Deliverable): string {
  const src =
    d.body && typeof d.body === 'object' && 'markdown' in d.body
      ? (d.body as { markdown: string }).markdown
      : typeof d.body === 'string' ? d.body : '';
  const s = String(src).split(/\r?\n/)[0]?.trim() ?? '';
  return s.length > 120 ? s.slice(0, 117) + '…' : s;
}

function DeliverableCard({
  d,
  onOpen,
  showProjectBadge,
  projectName,
}: {
  d: Deliverable;
  onOpen: (id: string) => void;
  showProjectBadge?: boolean;
  projectName?: string | undefined;
}) {
  const ts = d.created_at ? d.created_at.slice(0, 10) : '';
  return (
    <button type="button" className="deliv-card" data-deliv-id={d.id} onClick={() => onOpen(d.id)}>
      <div className="deliv-card-top">
        <span className={`deliv-status-chip deliv-status-${d.status}`}>{STATUS_LABEL[d.status]}</span>
        <span
          className={`deliv-origin-chip deliv-origin-${d.origin_label}`}
          title={ORIGIN_LABEL[d.origin_label]}
        >
          {ORIGIN_ICON[d.origin_label]}
        </span>
        {d.body_kind && <span className="deliv-kind-chip">{d.body_kind}</span>}
        {ts && <span className="deliv-ts">{ts}</span>}
        {/* Phase 1: project badge — shown only in "All" view when 2+ projects exist */}
        {showProjectBadge && projectName && (
          <span
            className="deliv-project-badge"
            title={`Project: ${projectName}`}
            style={{
              fontSize: '0.7rem',
              padding: '1px 6px',
              borderRadius: 8,
              background: 'var(--ink-bg-2, #f0f0f0)',
              color: 'var(--ink-mute, #888)',
              marginLeft: 'auto',
            }}
          >
            {projectName}
          </span>
        )}
      </div>
      <div className="deliv-card-title">{d.title}</div>
      {excerpt(d) && <div className="deliv-card-excerpt">{excerpt(d)}</div>}
    </button>
  );
}

function DeliverableDetailInline({ id, onClose }: { id: string; onClose: () => void }) {
  const [detail, setDetail] = useState<GetDeliverableResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/v1/deliverables/${id}`, { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error(`BFF ${r.status}`);
        const j: unknown = await r.json();
        if (!cancelled) setDetail(j as GetDeliverableResponse);
      })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => {
    function onKey(ev: KeyboardEvent) { if (ev.key === 'Escape') onClose(); }
    /* Per bug-20260517-205411: the panel-collapse X in AppShell dispatches
     * `holon:panel-x` before navigating away. We intercept it so X closes
     * the detail instead of routing back to the previous page. */
    function onPanelX(ev: Event) { ev.preventDefault(); onClose(); }
    document.addEventListener('keydown', onKey);
    window.addEventListener('holon:panel-x', onPanelX);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('holon:panel-x', onPanelX);
    };
  }, [onClose]);

  const body = detail?.deliverable.body;
  const bodyText =
    body && typeof body === 'object' && 'markdown' in body
      ? (body as { markdown: string }).markdown
      : body
        ? JSON.stringify(body, null, 2)
        : '(no body)';

  return (
    <div className="inline-detail" role="region" aria-label="Deliverable detail">
      <button type="button" className="inline-detail-back" onClick={onClose}>← Back to list</button>
      {error && <div className="inline-detail-error">BFF error: {error}</div>}
      {!error && (loading || !detail) && <div className="inline-detail-loading">Loading…</div>}
      {!error && !loading && detail && (
        <>
          <div className="drawer-header">
            <div className="drawer-header-avatar" style={{ background: 'var(--bg-alt)', color: 'var(--ink)', fontSize: 18 }}>📄</div>
            <div className="drawer-header-info">
              <div className="drawer-header-name">{detail.deliverable.title}</div>
              <div className="drawer-header-role">
                <span className={`deliv-status-chip deliv-status-${detail.deliverable.status}`}>
                  {STATUS_LABEL[detail.deliverable.status]}
                </span>
                <span className="badge">{detail.deliverable.origin_label}</span>
                {detail.deliverable.created_at && (
                  <span className="badge">{detail.deliverable.created_at.slice(0, 10)}</span>
                )}
              </div>
            </div>
          </div>
          <div className="drawer-body">
            <div className="drawer-section">
              <div className="drawer-section-label">Content</div>
              <div className="deliv-body-rendered">{renderDeliverableBody(bodyText)}</div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function DeliverablesClient({ initial }: { initial: ListDeliverablesResponse }) {
  const { t } = useT();
  const [openId, setOpenId] = useState<string | null>(null);
  const [filter, setFilter] = useState<OriginKey>('all');
  // Phase 1 — project switcher
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const { projects } = useProjects();

  // Localised origin labels — drives chip text + "Submitted upstream"
  // count suffix in the strip. Falls back to English keys via useT.
  const localisedOriginLabel: Record<OriginKey, string> = {
    all: t('deliverables.origin.all'),
    local: t('deliverables.origin.local'),
    remote: t('deliverables.origin.remote'),
    submitted: t('deliverables.origin.submitted'),
  };

  // Phase 1 — project-filtered item set (applied before origin filter)
  const projectFiltered = useMemo(() => {
    if (!activeProjectId) return initial.items;
    return initial.items.filter((d) => d.project_id === activeProjectId);
  }, [initial.items, activeProjectId]);

  // Counts per origin — computed once, drive the chip badges.
  const counts = useMemo(() => {
    const c = { all: projectFiltered.length, local: 0, remote: 0, submitted: 0 };
    for (const d of projectFiltered) c[d.origin_label] += 1;
    return c;
  }, [projectFiltered]);

  // Filtered + time-sorted (newest first). Both All and per-category
  // views use the same sort — per user 2026-05-17: "all 的情况是 全部
  // 是按照时间的排列； category的情况下 也是按照时间".
  const sorted = useMemo(() => {
    const items = filter === 'all'
      ? projectFiltered
      : projectFiltered.filter((d) => d.origin_label === filter);
    return [...items].sort((a, b) => {
      const aTs = a.created_at ?? '';
      const bTs = b.created_at ?? '';
      return bTs.localeCompare(aTs);
    });
  }, [projectFiltered, filter]);

  // Build project name lookup for badges
  const projectNameById = useMemo(
    () => new Map(projects.map((p) => [p.id, p.name])),
    [projects],
  );
  const showProjectBadge = !activeProjectId && projects.length >= 2;

  const chips: OriginKey[] = ['all', 'local', 'remote', 'submitted'];

  /* Show the day-one coaching panel iff the underlying payload is
   * empty (not just the active filter view) — otherwise switching to
   * e.g. "Submitted upstream" with zero would re-show "no deliverables
   * yet" copy on top of a populated page, which reads as wrong. */
  const isPageEmpty = initial.items.length === 0;

  return (
    <>
      <div className="page-strip">
        <h1 className="page-strip-title">{t('deliverables.page_title')}</h1>
        {/* Phase 1: project switcher — hidden when < 2 projects (component handles this) */}
        <ProjectSwitcher
          activeProjectId={activeProjectId}
          onChange={setActiveProjectId}
          className="page-strip-project-switcher"
        />
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 12, color: 'var(--ink-mute)' }}>
          {sorted.length} {sorted.length === 1 ? t('deliverables.item_suffix') : t('deliverables.items_suffix')}
          {filter !== 'all' && <> · {localisedOriginLabel[filter]}</>}
        </div>
      </div>

      {/* Day-one coaching — above the chip bar, only when truly empty */}
      {isPageEmpty && !openId && <DeliverablesEmptyState />}

      {openId ? (
        <DeliverableDetailInline id={openId} onClose={() => setOpenId(null)} />
      ) : (
        <>
          <div className="deliv-chip-bar" role="tablist" aria-label="Filter deliverables by origin">
            {chips.map((k) => {
              const active = filter === k;
              const icon = k === 'all' ? null : ORIGIN_ICON[k];
              return (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={`deliv-chip${active ? ' is-active' : ''} deliv-chip-${k}`}
                  onClick={() => setFilter(k)}
                >
                  {icon && <span className="deliv-chip-icon">{icon}</span>}
                  <span className="deliv-chip-label">{localisedOriginLabel[k]}</span>
                  <span className="deliv-chip-count">{counts[k]}</span>
                </button>
              );
            })}
          </div>

          {sorted.length === 0 ? (
            <div className="deliv-empty">
              <div className="deliv-empty-icon">📭</div>
              <div className="deliv-empty-text">
                {filter === 'all'
                  ? t('deliverables.empty.all')
                  : `No ${localisedOriginLabel[filter].toLowerCase()} deliverables yet.`}
              </div>
            </div>
          ) : (
            <div className="deliv-list-flat">
              {sorted.map((d) => {
                const projName = d.project_id ? (projectNameById.get(d.project_id) ?? undefined) : undefined;
                return (
                  <DeliverableCard
                    key={d.id}
                    d={d}
                    onOpen={setOpenId}
                    showProjectBadge={showProjectBadge && !!d.project_id}
                    projectName={projName}
                  />
                );
              })}
            </div>
          )}
        </>
      )}
    </>
  );
}

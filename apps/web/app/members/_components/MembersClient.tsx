'use client';

import { useState, useEffect, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { useSession } from 'next-auth/react';
import clsx from 'clsx';
import type {
  ListStaffResponse, Staff, GetStaffResponse, OwnerAssistant,
  IntegrationLink,
} from '@holon/api-contract';
import { HireDialog } from './HireDialog';
import { MembersEmptyState } from './MembersEmptyState';
import { useOwner } from '../../../lib/hooks/useOwner';
import { useT } from '../../../lib/i18n/useT';
import type { UseTReturn } from '../../../lib/i18n/useT';

// xterm.js references `self` at module top-level → crashes SSR. Load
// CliTerminal client-only via `next/dynamic` so its xterm import chain
// never evaluates on the server. Per tester report 2026-05-16.
const CliTerminal = dynamic(
  () => import('./CliTerminal').then((m) => m.CliTerminal),
  // Loading copy stays static-English here because next/dynamic's `loading`
  // runs OUTSIDE the React tree (no hook access). The real terminal mounts
  // immediately afterward and its own JSX is fully translated via useT().
  { ssr: false, loading: () => <div style={{ padding: 20, color: 'var(--ink-mute)' }}>Loading terminal…</div> },
);

/* ── Staff kind filter ────────────────────────────────────────────────
 *
 * Two cascade modes + two non-cascading kinds (per user 2026-05-16):
 *
 *   peer     — OWNER-level cascade: me → remote desk (substrate.kind === 'peer').
 *              The "staff" record is a thin handle; real work runs on the
 *              remote desk via the connection.
 *   linked   — AGENT-level cascade: my virtual AI staff holds peer
 *              connection(s) of its own (mentor today per ADR-016;
 *              advisor / collaborator may follow). Work executes locally,
 *              but the agent consults / hands off across its connections.
 *   virtual  — Pure local AI staff, no peer connection attached.
 *   cli      — Local command-line executor.
 *
 * "Linked" picked over "Apprentice" / "Mentored" so future connection
 * kinds slot in without a rename (user: "可能是不同的connection").
 */
type StaffKind = 'all' | 'peer' | 'virtual' | 'linked' | 'cli';

function staffKindOf(s: Staff): Exclude<StaffKind, 'all'> {
  if (s.substrate.kind === 'peer') return 'peer';
  // ADR-029 Phase B: both `'cli'` (legacy) and `'cli_agent'` (canonical) bucket
  // into the same `'cli'` UI category during the alias window. When the `'cli'`
  // literal is dropped in V2, narrow this to `'cli_agent'` only.
  if (s.substrate.kind === 'cli' || s.substrate.kind === 'cli_agent') return 'cli';
  // local_ai — count any attached peer-connection refs (mentors today).
  const hasConnection = (s.substrate.mentors ?? []).length > 0;
  return hasConnection ? 'linked' : 'virtual';
}

const KIND_LABEL: Record<StaffKind, string> = {
  all:     'All',
  peer:    'Peer',
  virtual: 'Virtual',
  linked:  'Linked',
  cli:     'CLI',
};

const KIND_TITLE: Record<StaffKind, string> = {
  all:     'All members',
  peer:    'Peer — owner-level cascade: me ↔ remote desk',
  virtual: 'Virtual — local AI, no peer connection attached',
  linked:  'Linked — virtual AI with its own peer connection(s) (mentor / advisor / …)',
  cli:     'CLI — local command-line executor',
};

const SUBSTRATE_LABELS: Record<string, string> = {
  local_ai: 'Virtual',
  // ADR-029 Phase B: both kinds render the same "CLI executor" label during
  // the alias window. Drop the `cli` row in V2 when the literal is removed.
  cli: 'CLI executor',
  cli_agent: 'CLI executor',
  peer: 'Peer',
};

interface CliStatus {
  running: boolean;
}

function cliLifecycle(s: Staff): 'short' | 'long' | null {
  if (s.substrate.kind !== 'cli_agent') return s.substrate.kind === 'cli' ? 'short' : null;
  return s.substrate.lifecycle ?? 'short';
}

function useCliAlive(s: Staff): boolean | null {
  const [alive, setAlive] = useState<boolean | null>(null);
  useEffect(() => {
    if (s.substrate.kind !== 'cli' && s.substrate.kind !== 'cli_agent') {
      setAlive(null);
      return;
    }
    let cancelled = false;
    setAlive(null);
    fetch(`/api/v1/staff/${s.id}/cli`, { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) return null;
        return (await r.json()) as CliStatus;
      })
      .then((status) => {
        if (!cancelled) setAlive(status ? status.running : false);
      })
      .catch((err: unknown) => {
        console.warn('[members] cli status fetch failed', err instanceof Error ? err.message : String(err));
        if (!cancelled) setAlive(false);
      });
    return () => { cancelled = true; };
  }, [s.id, s.substrate.kind]);
  return alive;
}

/** Translate a `Staff.substrate.kind` to the active owner language. */
function translatedSubstrate(t: UseTReturn['t'], kind: string): string {
  if (kind === 'local_ai') return t('staff.substrate.local_ai');
  if (kind === 'cli' || kind === 'cli_agent') return t('staff.substrate.cli');
  if (kind === 'peer') return t('staff.substrate.peer');
  return SUBSTRATE_LABELS[kind] ?? kind;
}

const INTEGRATION_LABELS: Record<IntegrationLink['kind'], string> = {
  gmail: 'Gmail',
  slack: 'Slack',
  email: 'Email',
  webhook: 'Webhook',
  mcp: 'MCP',
  discord: 'Discord',
  feishu: 'Feishu',
  google_meet: 'Google Meet',
};

function StaffCard({
  s, onOpen, onDismissed,
}: {
  s: Staff;
  onOpen: (id: string) => void;
  onDismissed: () => void;
}) {
  const { t, tFmt } = useT();
  const initial = (s.name || '?').charAt(0).toUpperCase();
  const cult = s.cultivation_maturity ?? 0;
  const canDismiss = s.substrate.kind === 'local_ai';
  const lifecycle = cliLifecycle(s);
  const alive = useCliAlive(s);
  async function dismiss(e: React.MouseEvent) {
    e.stopPropagation(); // don't trigger card-open
    if (!confirm(tFmt('members.card.dismiss_confirm', { name: s.name }))) return;
    try {
      const r = await fetch(`/api/v1/staff/${s.id}`, { method: 'DELETE' });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        alert(tFmt('members.card.dismiss_failed', { error: String((j as { error?: string }).error ?? r.status) }));
        return;
      }
      onDismissed();
    } catch (err) {
      alert(tFmt('members.card.dismiss_failed', { error: err instanceof Error ? err.message : String(err) }));
    }
  }

  return (
    <div
      className="staff-card"
      data-staff-id={s.id}
      onClick={() => onOpen(s.id)}
      style={{ textAlign: 'left', cursor: 'pointer', position: 'relative' }}
    >
      <div className="staff-card-header">
        <div className={clsx('staff-avatar', `substrate-${s.substrate.kind}`)}>{initial}</div>
        <div style={{ flex: 1 }}>
          <div className="staff-name">{s.name}</div>
          <div className="staff-meta">
            {s.role_label || s.role_name} · {translatedSubstrate(t, s.substrate.kind)}
          </div>
        </div>
        {canDismiss && (
          <button
            type="button"
            onClick={dismiss}
            title={tFmt('members.card.dismiss_title', { name: s.name })}
            aria-label={tFmt('members.card.dismiss_aria', { name: s.name })}
            style={{
              border: 'none', background: 'transparent', cursor: 'pointer',
              color: 'var(--ink-mute)', padding: 4, borderRadius: 6,
              fontSize: 16, lineHeight: 1, transition: 'background 0.12s, color 0.12s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(192,57,43,0.10)'; e.currentTarget.style.color = 'var(--red, #c0392b)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--ink-mute)'; }}
          >×</button>
        )}
      </div>
      <div className="staff-status-line">
        <span className={`badge badge-status status-${s.status}`}>{s.status}</span>
        <span className={`badge badge-substrate substrate-${s.substrate.kind}`}>
          {translatedSubstrate(t, s.substrate.kind)}
        </span>
        {lifecycle && <span className="badge">{lifecycle === 'long' ? '常驻 · persistent' : '临时 · transient'}</span>}
        {lifecycle && (
          <span className={`badge badge-status status-${alive ? 'active' : 'paused'}`}>
            {alive === null ? 'checking' : alive ? 'alive' : 'stopped'}
          </span>
        )}
        <span className="badge">{s.autonomy_level}</span>
        {s.current_jobs > 0 && (
          <span className="badge">{tFmt(s.current_jobs === 1 ? 'members.card.jobs_singular' : 'members.card.jobs_plural', { n: s.current_jobs })}</span>
        )}
      </div>
      <div className="cultivation">
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i} className={clsx('cultivation-pip', i < cult && 'filled')} />
        ))}
        <span className="cultivation-label">{cult} / 5</span>
      </div>
      {lifecycle && (
        <div style={{ marginTop: 10 }} onClick={(e) => e.stopPropagation()}>
          <CliTerminalLauncher staffId={s.id} staffName={s.name} />
        </div>
      )}
    </div>
  );
}
;


function MemberDetailInline({ id, onClose }: { id: string; onClose: () => void }) {
  const { t, tFmt } = useT();
  const [detail, setDetail] = useState<GetStaffResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Owner integrations — staff inherit every authorization the CEO holds
  // unless explicitly denied (V1: no per-staff deny field yet). Bug
  // 2026-05-17: owner asked to surface inherited authorizations on the
  // staff detail so it's visible what tools each member can reach.
  // Shared useOwner() cache — sibling components (ChatEmptyState,
  // AppShell, Step2) on the same page reuse the same fetch.
  const { owner } = useOwner();
  // bug-20260519-045432: Gmail moved to NextAuth in iter-013 — it lives in
  // the session, not in owner.integrations. Dual-source the same way
  // AuthorizationsSection on /me does so a CEO-connected Gmail surfaces
  // here as an inherited authorization.
  const { data: session } = useSession();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/v1/staff/${id}`, { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error(`BFF ${r.status}`);
        const j: unknown = await r.json();
        if (!cancelled) setDetail(j as GetStaffResponse);
      })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => {
    function onKey(ev: KeyboardEvent) { if (ev.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="inline-detail" role="region" aria-label={t('members.detail.aria_label')}>
      <button type="button" className="inline-detail-back" onClick={onClose}>{t('members.detail.back')}</button>
      {error && <div className="inline-detail-error">{tFmt('members.detail.bff_error', { error })}</div>}
      {!error && (loading || !detail) && <div className="inline-detail-loading">{t('members.detail.loading')}</div>}
      {!error && !loading && detail && (
        <>
          <div className="drawer-header">
            <div className={clsx('drawer-header-avatar', `substrate-${detail.staff.substrate.kind}`)}
              style={{ fontWeight: 700, fontSize: 17 }}>
              {(detail.staff.name || '?').charAt(0).toUpperCase()}
            </div>
            <div className="drawer-header-info">
              <div className="drawer-header-name">{detail.staff.name}</div>
              <div className="drawer-header-role">
                {detail.staff.role_label || detail.staff.role_name}
                <span>·</span>
                <span className={`badge badge-substrate substrate-${detail.staff.substrate.kind}`}>
                  {translatedSubstrate(t, detail.staff.substrate.kind)}
                </span>
                <span className="badge">{detail.staff.autonomy_level}</span>
              </div>
            </div>
          </div>
          <div className="drawer-body">
            {/* Private chat hoisted to the top of the detail view per
             * bug-20260517-200127-0tntzdd4: Holon is a chat-first work app, so
             * the 1:1 thread with a staff member should be the primary surface
             * — not buried below status/cultivation/config sections. Status +
             * cultivation + tool scope + authorizations are secondary and live
       * below. */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <span className={`badge badge-status status-${detail.staff.status}`}>{detail.staff.status}</span>
              <CliRuntimeBadges staff={detail.staff} />
              {detail.staff.current_jobs > 0 && (
                <span className="badge">{tFmt(detail.staff.current_jobs === 1 ? 'members.detail.jobs_running_singular' : 'members.detail.jobs_running_plural', { n: detail.staff.current_jobs })}</span>
              )}
            </div>
            <div className="drawer-section">
              <div className="drawer-section-label">{t('members.detail.cultivation')}</div>
              <div className="cultivation">
                {[0, 1, 2, 3, 4].map((i) => (
                  <span key={i} className={clsx('cultivation-pip', i < (detail.staff.cultivation_maturity ?? 0) && 'filled')} />
                ))}
                <span className="cultivation-label">{tFmt('members.detail.maturity_suffix', { n: detail.staff.cultivation_maturity ?? 0 })}</span>
              </div>
            </div>
            {detail.staff.substrate.kind === 'local_ai' && detail.staff.substrate.tool_scope && detail.staff.substrate.tool_scope.length > 0 && (
              <div className="drawer-section">
                <div className="drawer-section-label">{t('members.detail.tool_scope')}</div>
                <div className="drawer-section-content">{detail.staff.substrate.tool_scope.join(' · ')}</div>
              </div>
            )}
            {detail.staff.substrate.kind === 'local_ai' && owner && (() => {
              // External authorizations are held at CEO level; staff inherit
              // them through the Desk AI (per data-model decision 2026-05-17).
              // V2+: temporary per-staff grants / deny-list. For now display-only.
              const enabledLinks = (owner.integrations ?? []).filter((g) => g.enabled);
              // bug-20260519-045432: iter-013 Gmail is held in NextAuth, not
              // in owner.integrations — surface it as an inherited badge so
              // staff don't appear unauthorized when the CEO is connected.
              // Skip if a legacy IntegrationLink with kind='gmail' already
              // exists (transitional window — same dedup as AuthorizationsSection).
              const sessionEmail = session?.user?.email ?? null;
              const hasLinkGmail = enabledLinks.some((g) => g.kind === 'gmail');
              const enabled: Array<{ kind: IntegrationLink['kind']; label: string }> =
                sessionEmail && !hasLinkGmail
                  ? [{ kind: 'gmail', label: sessionEmail }, ...enabledLinks]
                  : enabledLinks;
              const denied = detail.staff.denied_skills ?? [];
              return (
                <div className="drawer-section">
                  <div className="drawer-section-label" title={t('members.detail.authorizations_title')}>
                    {t('members.detail.authorizations_label')}
                  </div>
                  {enabled.length === 0 ? (
                    <div className="drawer-section-content" style={{ color: 'var(--ink-mute)' }}>
                      {t('members.detail.authorizations_empty')}
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {enabled.map((g, i) => (
                        <span key={`${g.kind}-${i}`} className="badge" title={g.label}>
                          {INTEGRATION_LABELS[g.kind] ?? g.kind}: {g.label}
                        </span>
                      ))}
                    </div>
                  )}
                  {denied.length > 0 && (
                    <div className="drawer-section-content" style={{ marginTop: 6, fontSize: 11, color: 'var(--ink-mute)' }}>
                      {tFmt('members.detail.denied_skills', { list: denied.join(' · ') })}
                    </div>
                  )}
                </div>
              );
            })()}
            {(detail.staff.substrate.kind === 'cli' || detail.staff.substrate.kind === 'cli_agent') && (
              <>
                <div className="drawer-section">
                  <div className="drawer-section-label">{t('members.detail.cli_binary')}</div>
                  <div className="drawer-section-content" style={{ fontFamily: 'monospace' }}>{detail.staff.substrate.binary}</div>
                </div>
                <div className="drawer-section">
                  <div className="drawer-section-label">{t('members.detail.terminal')}</div>
                  <CliTerminalLauncher staffId={detail.staff.id} staffName={detail.staff.name} />
                </div>
              </>
            )}
            {detail.staff.substrate.kind === 'peer' && (
              <div className="drawer-section">
                <div className="drawer-section-label">{t('members.detail.peer_connection')}</div>
                <div className="drawer-section-content">
                  {tFmt('members.detail.peer_via', { name: detail.staff.substrate.remote_staff_name, id: detail.staff.substrate.connection_id.slice(0, 24) })}
                </div>
              </div>
            )}

          </div>
        </>
      )}
    </div>
  );
}

/* Owner row was here — removed per user "如果在holon那边有配置了 就不需要
 * 在mem下面挂我了吧". Owner-assistant config now lives behind the gear
 * icon in the chat panel → /me. /members is for the flat roster only. */

/** Toggle-able terminal panel — keeps the heavy xterm.js DOM unmounted
 *  until the user actually clicks "Launch", so opening a CLI member
 *  doesn't pay the renderer cost until needed. */
function CliTerminalLauncher({ staffId, staffName }: { staffId: string; staffName: string }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
        {t('staff.cli.launch')}
      </button>
    );
  }
  return <CliTerminal staffId={staffId} staffName={staffName} onClose={() => setOpen(false)} />;
}

function CliRuntimeBadges({ staff }: { staff: Staff }) {
  const lifecycle = cliLifecycle(staff);
  const alive = useCliAlive(staff);
  if (!lifecycle) return null;
  return (
    <>
      <span className="badge">{lifecycle}</span>
      <span className={`badge badge-status status-${alive ? 'active' : 'paused'}`}>
        {alive === null ? 'checking' : alive ? 'alive' : 'stopped'}
      </span>
    </>
  );
}

export function MembersClient({ initial, owner }: { initial: ListStaffResponse; owner: OwnerAssistant }) {
  const { t, tFmt } = useT();
  const [openId, setOpenId] = useState<string | null>(null);
  const [filter, setFilter] = useState<StaffKind>('all');
  const [hireOpen, setHireOpen] = useState(false);

  // Localised chip labels — overlay over the static English KIND_LABEL
  // map so the chip strip respects the owner's language preference.
  // KIND_TITLE (long hover-tooltip strings) stays English in V1.0 —
  // tooltip translation is in scope for Pass #12 part 2.
  const localisedKindLabel: Record<StaffKind, string> = {
    all:     t('members.kind.all'),
    peer:    t('members.kind.peer'),
    virtual: t('members.kind.virtual'),
    linked:  t('members.kind.linked'),
    cli:     t('members.kind.cli'),
  };
  // Live roster — initial from server, then re-fetched after hire / dismiss / reset.
  const [roster, setRoster] = useState<Staff[]>(initial.items);

  // Auto-open from `/members?cli=<staff_id>` deep link (used by the
  // `/cli` slash command). One-shot effect; subsequent nav doesn't
  // re-trigger.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    const cliId = url.searchParams.get('cli');
    if (cliId) {
      setOpenId(cliId);
      url.searchParams.delete('cli');
      window.history.replaceState({}, '', url.toString());
    }
  }, []);

  async function reloadRoster(): Promise<void> {
    try {
      const r = await fetch('/api/v1/staff', { cache: 'no-store' });
      if (!r.ok) return;
      const j = (await r.json()) as ListStaffResponse;
      setRoster(j.items);
    } catch (err) {
      console.warn('[members] roster reload failed', err instanceof Error ? err.message : String(err));
    }
  }

  // Refresh roster on debug-reset event (DebugControls dispatches it).
  // Also refresh on `holon:roster-changed` — dispatched by the chat
  // adapter when the desk-AI invokes create_staff / update_staff /
  // dismiss_staff (bug 2026-05-17: chat-hired staff didn't appear on
  // /members without a manual page reload).
  useEffect(() => {
    function onChange() { void reloadRoster(); }
    void reloadRoster();
    window.addEventListener('holon:reset', onChange);
    window.addEventListener('holon:roster-changed', onChange);
    return () => {
      window.removeEventListener('holon:reset', onChange);
      window.removeEventListener('holon:roster-changed', onChange);
    };
  }, []);

  const counts = useMemo(() => {
    const c: Record<Exclude<StaffKind, 'all'>, number> = { peer: 0, virtual: 0, linked: 0, cli: 0 };
    for (const s of roster) c[staffKindOf(s)] += 1;
    return c;
  }, [roster]);

  const visible = useMemo(() => {
    if (filter === 'all') return roster;
    return roster.filter((s) => staffKindOf(s) === filter);
  }, [roster, filter]);

  const chipOrder: StaffKind[] = ['all', 'peer', 'virtual', 'linked', 'cli'];

  return (
    <>
      {/* No page-strip "Members" title — nav already labels this view.
       * The chip strip IS the page header: clicking Members in the nav
       * lands the user directly on the kind sub-categories. */}
      {!openId && (
        <div className="member-filter-chips" role="tablist" aria-label="Filter members by kind">
          {chipOrder.map((k) => {
            const n = k === 'all' ? roster.length : counts[k];
            const active = filter === k;
            return (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={active}
                title={KIND_TITLE[k]}
                className={clsx('member-filter-chip', active && 'active', `kind-${k}`)}
                onClick={() => setFilter(k)}
                disabled={n === 0 && k !== 'all'}
              >
                {localisedKindLabel[k]}
                <span className="member-filter-chip-count">{n}</span>
              </button>
            );
          })}
          <div style={{ flex: 1 }} />
          <button
            id="hire"
            type="button" className="btn btn-primary"
            onClick={() => setHireOpen(true)}
            style={{ fontSize: 12, padding: '4px 10px' }}
            title={t('members.hire_tooltip')}
          >
            {t('members.hire_button')}
          </button>
          <div style={{ fontSize: 12, color: 'var(--ink-mute)' }}>
            {visible.length === roster.length
              ? `${roster.length} ${t('members.total_suffix')}`
              : `${visible.length} ${t('members.of_suffix')} ${roster.length}`}
          </div>
        </div>
      )}

      {/* Day-one coaching — mounts iff the SERVER-RENDERED roster is empty
       * AND the Desk AI singleton is present (i.e. "no hires yet, but
       * your assistant is here"). Uses the live roster so refreshes after
       * create/retire reflect immediately.
       * Persona-walk P0 #3 (Sarah Chen 2026-05-19). */}
      {!openId && roster.length === 0 && owner && <MembersEmptyState />}

      {openId ? (
        <MemberDetailInline id={openId} onClose={() => setOpenId(null)} />
      ) : visible.length === 0 ? (
        <div className="deliv-empty" style={{ minHeight: 200, background: '#fff', border: '1px solid var(--line)', borderRadius: 14 }}>
          <div className="deliv-empty-text">{tFmt('members.no_kind_empty', { kind: localisedKindLabel[filter].toLowerCase() })}</div>
        </div>
      ) : (
        <div className="staff-grid">
          {visible.map((s) => (
            <StaffCard
              key={s.id}
              s={s}
              onOpen={setOpenId}
              onDismissed={reloadRoster}
            />
          ))}
        </div>
      )}

      <HireDialog open={hireOpen} onClose={() => setHireOpen(false)} onHired={reloadRoster} owner={owner} />
    </>
  );
}

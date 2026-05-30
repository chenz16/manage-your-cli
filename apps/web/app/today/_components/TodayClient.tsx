'use client';

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import type {
  TodayResponse,
  BucketDetailResponse,
  WorkQueueItem,
} from '@holon/api-contract';
import { TodayEmptyState, type BucketLegendEntry } from './TodayEmptyState';
import { useT } from '../../../lib/i18n/useT';

/* ── Helpers ──────────────────────────────────────────────────────────── */

const BUCKET_META: Record<
  string,
  { className: string; label: string; emoji: string; blurb: string }
> = {
  ai_running:   { className: 'bucket-running',   label: 'Local AI running',        emoji: '🤖', blurb: 'jobs your staff are actively working on right now' },
  peer_waiting: { className: 'bucket-waiting',   label: 'Remote peer waiting',     emoji: '⏳', blurb: 'work delegated to another desk, awaiting their reply' },
  pending:      { className: 'bucket-pending',   label: 'Inbound mission pending', emoji: '📬', blurb: 'requests sent to you by peers, awaiting your accept' },
  returned:     { className: 'bucket-returned',  label: 'Deliverable returned',    emoji: '📥', blurb: 'finished work handed back to you for review' },
  blocked:      { className: 'bucket-blocked',   label: 'Blocked',                 emoji: '🚫', blurb: 'jobs that hit an error or need your input to continue' },
  retrying:     { className: 'bucket-retrying',  label: 'Retrying',                emoji: '🔄', blurb: 'transient failures the system is auto-retrying' },
};

const BUCKET_LEGEND: ReadonlyArray<BucketLegendEntry> = Object.entries(BUCKET_META).map(([key, meta]) => ({
  key,
  label: meta.label,
  blurb: meta.blurb,
}));

function priorityLabel(p: number): 'urgent' | 'high' | 'normal' | 'low' {
  if (p >= 80) return 'urgent';
  if (p >= 60) return 'high';
  if (p >= 40) return 'normal';
  return 'low';
}

function formatDeadline(iso?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso).getTime();
  const now = Date.now();
  const diffHr = Math.round((d - now) / 3600000);
  if (diffHr < 0) return 'overdue';
  if (diffHr < 1) return 'due <1h';
  if (diffHr < 24) return `due in ${diffHr}h`;
  return `due in ${Math.round(diffHr / 24)}d`;
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMin = Math.floor((now - then) / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const h = Math.floor(diffMin / 60);
  if (h < 24) return `${h}h ago`;
  return iso.slice(0, 10);
}

const CLOSE_SVG = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

/* ── Hero summary ─────────────────────────────────────────────────────── */

function HeroSummary({ initial }: { initial: TodayResponse }) {
  const { t } = useT();
  const pending = initial.buckets.find((b) => b.key === 'pending')?.count ?? 0;
  const returned = initial.buckets.find((b) => b.key === 'returned')?.count ?? 0;
  const blocked = initial.buckets.find((b) => b.key === 'blocked')?.count ?? 0;
  const personal = initial.my_work_queue.length;

  return (
    <div className="hero-stats">
      <div className={clsx('hero-stat', pending > 0 && 'is-attention')}>
        <div className="hero-stat-num">{pending}</div>
        <div className="hero-stat-label">{t('today.hero.pending_missions')}</div>
      </div>
      <div className={clsx('hero-stat', returned > 0 && 'is-positive')}>
        <div className="hero-stat-num">{returned}</div>
        <div className="hero-stat-label">{t('today.hero.deliverables_returned')}</div>
      </div>
      <div className={clsx('hero-stat', blocked > 0 && 'is-attention')}>
        <div className="hero-stat-num">{blocked}</div>
        <div className="hero-stat-label">{t('today.hero.blocked')}</div>
      </div>
      <div className="hero-stat">
        <div className="hero-stat-num">{personal}</div>
        <div className="hero-stat-label">{t('today.hero.personal_queue')}</div>
      </div>
    </div>
  );
}

/* ── Personal queue card ──────────────────────────────────────────────── */

function PersonalQueueCard({ item, onOpen }: { item: WorkQueueItem; onOpen: (i: WorkQueueItem) => void }) {
  const pri = priorityLabel(item.priority ?? 0);
  const dl = formatDeadline(item.deadline);
  return (
    <button
      type="button"
      className={`card card-hover pq-card pq-priority-${pri}`}
      data-pq-id={item.id}
      aria-label={`Open: ${item.title}`}
      onClick={() => onOpen(item)}
    >
      <div className="pq-card-top">
        <div className="pq-card-title">{item.title}</div>
        <div className="pq-card-tags">
          <span className={`badge pq-badge-source pq-source-${item.source}`}>
            {item.source === 'from_mission' ? 'from mission' : 'own'}
          </span>
          <span className={`badge pq-badge-priority pq-priority-badge-${pri}`}>{pri}</span>
          {dl && (
            <span className={clsx('badge pq-badge-deadline', dl === 'overdue' && 'pq-deadline-urgent')}>
              {dl}
            </span>
          )}
        </div>
      </div>
      {item.body && <div className="pq-card-excerpt">{item.body.slice(0, 110)}{item.body.length > 110 ? '…' : ''}</div>}
    </button>
  );
}

/* ── Bucket card ──────────────────────────────────────────────────────── */

function BucketCard({
  bucket, onOpen,
}: {
  bucket: TodayResponse['buckets'][number];
  onOpen: (key: string) => void;
}) {
  const meta = BUCKET_META[bucket.key];
  const subtitle = bucket.preview_items.length > 0
    ? bucket.preview_items.slice(0, 3).map((p) => p.title).join(' · ')
    : bucket.count === 0 ? 'No items here yet' : '—';
  return (
    <button
      type="button"
      className={clsx('card card-hover bucket-card', meta?.className)}
      onClick={() => onOpen(bucket.key)}
    >
      <div className="card-title">{meta?.label ?? bucket.key}</div>
      <div className="card-count">{bucket.count}</div>
      <div className="card-detail">{subtitle}</div>
    </button>
  );
}

/* ── Activity feed ────────────────────────────────────────────────────── */

function ActivityFeed({ events }: { events: TodayResponse['recent_events'] }) {
  const { t } = useT();
  if (events.length === 0) {
    return (
      <div className="activity-item" style={{ color: 'var(--ink-mute)', fontStyle: 'italic' }}>
        {t('today.empty.activity')}
      </div>
    );
  }
  return (
    <>
      {events.map((ev, i) => (
        <div key={i} className="activity-item">
          <div className="activity-time">{formatRelative(ev.at)}</div>
          <div className="activity-body">
            <span className="activity-kind">{ev.kind}</span>
            <span dangerouslySetInnerHTML={{ __html: ev.text }} />
          </div>
        </div>
      ))}
    </>
  );
}

/* ── Bucket detail (inline; replaces panel content) ──────────────────── */

function BucketDetailInline({
  bucketKey, onClose,
}: { bucketKey: string; onClose: () => void }) {
  const [detail, setDetail] = useState<BucketDetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/v1/desk/today/buckets/${bucketKey}`, { cache: 'no-store' })
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) throw new Error(`BFF returned ${res.status}`);
        const json: unknown = await res.json();
        setDetail(json as BucketDetailResponse);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [bucketKey]);

  useEffect(() => {
    function onKey(ev: KeyboardEvent) { if (ev.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const meta = BUCKET_META[bucketKey];

  return (
    <div className="inline-detail" role="region" aria-label="Bucket detail">
      <button type="button" className="inline-detail-back" onClick={onClose}>
        ← Back to Today
      </button>
      <div className="drawer-header">
        <div
          className="drawer-header-avatar"
          style={{ background: 'var(--bg-alt)', color: 'var(--ink)', fontSize: 20 }}
        >
          {meta?.emoji ?? '📌'}
        </div>
        <div className="drawer-header-info">
          <div className="drawer-header-name">{meta?.label ?? bucketKey}</div>
          <div className="drawer-header-role">
            {loading ? 'loading…' : detail ? `${detail.items.length} item${detail.items.length === 1 ? '' : 's'}` : '—'}
          </div>
        </div>
      </div>
      <div className="drawer-body">
        {error && (
          <div className="drawer-section-content" style={{ color: 'var(--red)' }}>
            BFF error: {error}
          </div>
        )}
        {!error && loading && <div className="drawer-section-content">Loading…</div>}
        {!error && !loading && detail && detail.items.length === 0 && (
          <div className="drawer-section-content" style={{ color: 'var(--ink-mute)', textAlign: 'center', padding: '32px 0' }}>
            Nothing in this bucket right now.
          </div>
        )}
        {!error && !loading && detail && detail.items.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {detail.items.map((item, i) => {
              let title: string;
              let badge: string;
              if (item.type === 'mission') {
                title = item.mission.title;
                badge = `${item.mission.state.replace(/_/g, ' ')} · mission`;
              } else if (item.type === 'deliverable') {
                title = item.deliverable.title;
                badge = `${item.deliverable.status} · deliverable`;
              } else if (item.type === 'staff_job') {
                title = `${item.staff.name} — ${item.job_label}`;
                badge = 'running · staff';
              } else if (item.type === 'peer_member') {
                title = `${item.staff.name} — peer member`;
                badge = 'peer';
              } else {
                title = `${item.connection.display_name} — retrying`;
                badge = `${item.connection.health_state} · connection`;
              }
              return (
                <div key={i} className="assignment-row">
                  <div className={`assignment-row-dot ${item.type === 'deliverable' ? 'completed' : 'running'}`} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="assignment-row-title">{title}</div>
                    <div style={{ fontSize: 11, color: 'var(--ink-mute)' }}>{badge}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Personal queue item detail (inline) ─────────────────────────────── */

function QueueItemDetailInline({
  item, onClose,
}: { item: WorkQueueItem; onClose: () => void }) {
  useEffect(() => {
    function onKey(ev: KeyboardEvent) { if (ev.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const pri = priorityLabel(item.priority ?? 0);
  const dl = formatDeadline(item.deadline);

  return (
    <div className="inline-detail" role="region" aria-label="Queue item">
      <button type="button" className="inline-detail-back" onClick={onClose}>
        ← Back to Today
      </button>
      <div className="drawer-header">
        <div className="drawer-header-avatar"
          style={{ background: pri === 'urgent' ? 'var(--red)' : pri === 'high' ? 'var(--gold)' : 'var(--blue)', color: '#fff', fontSize: 18 }}>
          ✏️
        </div>
        <div className="drawer-header-info">
          <div className="drawer-header-name" style={{ fontSize: 15 }}>{item.title}</div>
          <div className="drawer-header-role">
            <span className="badge">{item.source === 'from_mission' ? 'from mission' : 'own'}</span>
            <span className="badge">{pri}</span>
            {dl && <span className="badge">{dl}</span>}
          </div>
        </div>
      </div>
      <div className="drawer-body">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <span className="badge">Priority: {item.priority ?? '—'}</span>
          {item.deadline && <span className="badge">Due: {item.deadline.slice(0, 10)}</span>}
        </div>
        <div className="drawer-section">
          <div className="drawer-section-label">Details</div>
          <div className="drawer-section-content">{item.body || '(no details)'}</div>
        </div>
      </div>
    </div>
  );
}

/* ── Toasts ───────────────────────────────────────────────────────────── */

interface ToastEntry { id: number; msg: string }
function useToasts(): [ToastEntry[], (msg: string) => void] {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const push = useCallback((msg: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3000);
  }, []);
  return [toasts, push];
}
function Toasts({ toasts }: { toasts: ToastEntry[] }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted) return null;
  return createPortal(
    <div className="holon-toast-container">
      {toasts.map((t) => (<div key={t.id} className="holon-toast">✓ {t.msg}</div>))}
    </div>,
    document.body
  );
}

/* ── Top-level client ─────────────────────────────────────────────────── */

/**
 * Jobs section — polls /api/v1/jobs every 4s and shows the most recent
 * 8 jobs the owner has queued (queued / running / completed / failed).
 * Click a completed job → navigate to /deliverables to see the output.
 *
 * iter-008 Phase 2: this is the "owner sees worker results land" piece.
 * Before this, you'd delegate and have to hunt for the deliverable.
 */
interface JobRow {
  id: string;
  staff_id: string;
  brief: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  created_at: string;
  completed_at?: string;
  deliverable_id?: string;
  error?: string;
}

function JobsSection() {
  const { t } = useT();
  const [items, setItems] = useState<JobRow[]>([]);
  const [dispatcherRunning, setDispatcherRunning] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function pull() {
      try {
        const r = await fetch('/api/v1/jobs', { cache: 'no-store' });
        if (!r.ok) return;
        const j = (await r.json()) as { items: JobRow[]; dispatcher?: { running: boolean } };
        if (cancelled) return;
        setItems(j.items.slice(0, 8));
        setDispatcherRunning(j.dispatcher?.running ?? null);
      } catch (err: unknown) {
        console.warn('[today.jobs] poll failed:', err instanceof Error ? err.message : String(err));
      }
    }
    void pull();
    const h = setInterval(pull, 4000);
    return () => { cancelled = true; clearInterval(h); };
  }, []);

  return (
    <section className="card" style={{ padding: 16, marginTop: 16 }} aria-label="Recent jobs">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
        <h2 className="section-title" style={{ margin: 0 }}>{t('today.section.recent_jobs')}</h2>
        <span style={{ fontSize: 11, color: 'var(--ink-mute)' }}>
          {items.length} · dispatcher {dispatcherRunning === null ? '?' : dispatcherRunning ? '● live' : '○ stopped'}
        </span>
      </div>
      {items.length === 0 && (
        <div style={{ fontSize: 13, color: 'var(--ink-mute)', fontStyle: 'italic', padding: '8px 0' }}>
          {t('today.empty.jobs')}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {items.map((j) => {
          const isDone = j.status === 'completed';
          const isFail = j.status === 'failed';
          const isLive = j.status === 'running';
          const color = isFail ? 'var(--red, #c0392b)' : isDone ? 'var(--green, #2e7d32)' : isLive ? 'var(--gold, #b58c00)' : 'var(--ink-mute)';
          const ts = (j.completed_at ?? j.created_at).slice(11, 19);
          return (
            <div key={j.id} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '6px 10px', border: '1px solid var(--line)', borderRadius: 8,
              fontSize: 13, lineHeight: 1.4,
            }}>
              <span style={{
                fontSize: 10, padding: '2px 6px', borderRadius: 4,
                background: 'var(--bg-alt)', color, fontWeight: 600, minWidth: 64, textAlign: 'center',
              }}>{j.status.toUpperCase()}</span>
              <code style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--ink-mute)' }}>{ts}</code>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {j.brief}
              </span>
              {isDone && j.deliverable_id && (
                <a
                  href={`/deliverables`}
                  style={{ fontSize: 11, color: 'var(--green, #2e7d32)', textDecoration: 'none', fontWeight: 600 }}
                  title={`Open ${j.deliverable_id} in /deliverables`}
                >→ deliverable</a>
              )}
              {isFail && j.error && (
                <span style={{ fontSize: 11, color: 'var(--red, #c0392b)' }} title={j.error}>
                  {j.error.slice(0, 50)}…
                </span>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function TodayClient({ initial }: { initial: TodayResponse }) {
  const { t } = useT();
  const [openBucket, setOpenBucket] = useState<string | null>(null);
  const [openQueueItem, setOpenQueueItem] = useState<WorkQueueItem | null>(null);
  const [toasts, pushToast] = useToasts();

  // Sort queue: priority desc, then deadline asc
  const queue = [...initial.my_work_queue].sort((a, b) => {
    const pa = a.priority ?? 0;
    const pb = b.priority ?? 0;
    if (pb !== pa) return pb - pa;
    const da = a.deadline ? new Date(a.deadline).getTime() : Infinity;
    const db = b.deadline ? new Date(b.deadline).getTime() : Infinity;
    return da - db;
  });

  // Detail mode: a clicked bucket OR a clicked queue item replaces the
  // panel content with an inline detail view (back button → return).
  const inDetail = openBucket !== null || openQueueItem !== null;

  // Day-one coaching trigger: zero queue + every bucket count===0 + zero
  // activity. Side-by-side with the bucket grid so the grid still renders
  // (six "0" cards now read intentionally with the legend above them).
  const isPageEmpty =
    queue.length === 0 &&
    initial.buckets.every((b) => b.count === 0) &&
    initial.recent_events.length === 0;

  return (
    <>
      <div className="page-strip">
        <h1 className="page-strip-title">{t('today.page_title')}</h1>
        <div style={{ flex: 1 }} />
        <button
          className="btn btn-primary"
          aria-label="Compose new handoff"
          onClick={() => {
            /* The dedicated handoff composer modal is deferred (iter-006
             * stub was never ported). Until then, route the user into
             * the chat-AI flow: prefill the composer with a starter
             * prompt so the owner-assistant gathers recipient, form,
             * and brief conversationally. The "holon:prefill-composer"
             * event is observed by ChatSurface. */
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('holon:prefill-composer', {
                detail: { text: 'New handoff — recipient: ', focus: true },
              }));
            }
            pushToast('Use the chat to describe recipient, form, and brief.');
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          {t('today.new_handoff')}
        </button>
      </div>

      {inDetail ? (
        openBucket ? (
          <BucketDetailInline
            bucketKey={openBucket}
            onClose={() => setOpenBucket(null)}
          />
        ) : openQueueItem ? (
          <QueueItemDetailInline
            item={openQueueItem}
            onClose={() => setOpenQueueItem(null)}
          />
        ) : null
      ) : (
        <>
          <HeroSummary initial={initial} />

          {isPageEmpty && <TodayEmptyState legend={BUCKET_LEGEND} />}

          {queue.length > 0 && (
            <section className="personal-queue-section" aria-labelledby="pq-title">
              <h2 className="section-title" id="pq-title">{t('today.section.my_queue')}</h2>
              <div className="personal-queue-grid">
                {queue.map((item) => (
                  <PersonalQueueCard key={item.id} item={item} onOpen={setOpenQueueItem} />
                ))}
              </div>
            </section>
          )}

          {/* Suppress the 6-card "0"-grid on day one — the legend inside
           * TodayEmptyState already names + describes each bucket, so the
           * grid is pure noise. Re-appears as soon as any bucket has work. */}
          {!isPageEmpty && (
            <div className="bucket-grid">
              {initial.buckets.map((b) => (
                <BucketCard key={b.key} bucket={b} onOpen={setOpenBucket} />
              ))}
            </div>
          )}

          <JobsSection />

          <section className="activity" aria-label="Recent activity">
            <h2 className="section-title">{t('today.section.recent_activity')}</h2>
            <ActivityFeed events={initial.recent_events} />
          </section>
        </>
      )}

      <Toasts toasts={toasts} />
    </>
  );
}

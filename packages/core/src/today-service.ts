/**
 * Today service — aggregate domain layer for the Today screen.
 *
 * Single fixture read, derives all 6 buckets + queue + activity in
 * one pass. Per ADR-001: this is exactly the kind of page-aggregate
 * work the BFF exists to do.
 *
 * Bucket derivation matches src/ui-mock/today.js `deriveBuckets()`
 * verbatim so the React Today page renders the same numbers the
 * vanilla version did.
 */

import type {
  TodayResponse,
  BucketDetailResponse,
} from '@holon/api-contract';
import {
  TodayResponse as TodayResponseSchema,
  BucketDetailResponse as BucketDetailResponseSchema,
} from '@holon/api-contract';
import { loadFixtures } from './fixture-store.js';

type BucketKey =
  | 'ai_running'
  | 'peer_waiting'
  | 'pending'
  | 'returned'
  | 'blocked'
  | 'retrying';

type PreviewItem = TodayResponse['buckets'][number]['preview_items'][number];

interface BucketInternal {
  key: BucketKey;
  count: number;
  preview_items: PreviewItem[];
}

function buildBuckets(): BucketInternal[] {
  const fx = loadFixtures();

  // 1. CLI staff running - staff.current_jobs > 0 on the local CLI-backed substrates.
  const aiRunning = fx.staff.filter(
    (s) => (s.substrate.kind === 'local_ai' || s.substrate.kind === 'cli_agent' || s.substrate.kind === 'cli') && s.current_jobs > 0
  );
  const aiRunningCount = aiRunning.reduce((acc, s) => acc + s.current_jobs, 0);
  const aiRunningPreview: PreviewItem[] = aiRunning.slice(0, 5).map((s) => ({
    type: 'staff_job',
    title: `${s.name} — ${s.current_jobs} job${s.current_jobs === 1 ? '' : 's'}`,
    id: s.id,
  }));

  // 2. Remote peer waiting — peer staff + in-progress missions on peer connections.
  const peerStaff = fx.staff.filter((s) => s.substrate.kind === 'peer');
  const peerConnIds = new Set(
    peerStaff
      .map((s) => (s.substrate.kind === 'peer' ? s.substrate.connection_id : undefined))
      .filter((id): id is string => !!id)
  );
  const peerWaitingMissions = fx.missions.filter(
    (m) => m.state === 'in_progress' && peerConnIds.has(m.sender_connection_id)
  );
  const peerWaitingCount = peerWaitingMissions.length || peerConnIds.size;
  const peerWaitingPreview: PreviewItem[] =
    peerWaitingMissions.length > 0
      ? peerWaitingMissions.slice(0, 5).map((m) => ({ type: 'mission', title: m.title, id: m.id }))
      : peerStaff
          .slice(0, 5)
          .map((s) => ({ type: 'peer_member', title: `${s.name} — peer member`, id: s.id }));

  // 3. Pending — missions in queued state
  const pending = fx.missions.filter((m) => m.state === 'queued');
  const pendingPreview: PreviewItem[] = pending
    .slice(0, 5)
    .map((m) => ({ type: 'mission', title: m.title, id: m.id }));

  // 4. Returned — deliverables with origin_label === 'remote'
  const returned = fx.deliverables.filter((d) => d.origin_label === 'remote');
  const returnedPreview: PreviewItem[] = returned
    .slice(0, 5)
    .map((d) => ({ type: 'deliverable', title: d.title, id: d.id }));

  // 5. Blocked — missions in 'blocked' state
  const blocked = fx.missions.filter((m) => m.state === 'blocked');
  const blockedPreview: PreviewItem[] = blocked
    .slice(0, 5)
    .map((m) => ({ type: 'mission', title: m.title, id: m.id }));

  // 6. Retrying — connections in 'retrying' state
  const retrying = fx.connections.filter((c) => c.health_state === 'retrying');
  const retryingPreview: PreviewItem[] = retrying
    .slice(0, 5)
    .map((c) => ({ type: 'connection', title: `${c.display_name} — retrying`, id: c.id }));

  return [
    { key: 'ai_running', count: aiRunningCount, preview_items: aiRunningPreview },
    { key: 'peer_waiting', count: peerWaitingCount, preview_items: peerWaitingPreview },
    { key: 'pending', count: pending.length, preview_items: pendingPreview },
    { key: 'returned', count: returned.length, preview_items: returnedPreview },
    { key: 'blocked', count: blocked.length, preview_items: blockedPreview },
    { key: 'retrying', count: retrying.length, preview_items: retryingPreview },
  ];
}

/**
 * Get the Today aggregate — buckets + personal queue + recent events.
 * Single fixture read; all derivations in memory.
 */
export function getToday(): TodayResponse {
  const fx = loadFixtures();
  const buckets = buildBuckets();
  const recent_events = [...fx.recent_events]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 20);

  return TodayResponseSchema.parse({
    buckets,
    my_work_queue: fx.my_work_queue,
    recent_events,
  });
}

/**
 * Get the full item list for a clicked bucket. Returns null if the key
 * is not one of the 6 known buckets.
 */
export function getBucketDetail(key: string): BucketDetailResponse | null {
  const validKeys: BucketKey[] = [
    'ai_running', 'peer_waiting', 'pending', 'returned', 'blocked', 'retrying',
  ];
  if (!validKeys.includes(key as BucketKey)) return null;
  const k = key as BucketKey;

  const fx = loadFixtures();
  type Item = BucketDetailResponse['items'][number];
  const items: Item[] = [];

  if (k === 'ai_running') {
    for (const s of fx.staff) {
      if ((s.substrate.kind === 'local_ai' || s.substrate.kind === 'cli_agent' || s.substrate.kind === 'cli') && s.current_jobs > 0) {
        for (let j = 0; j < s.current_jobs; j++) {
          items.push({ type: 'staff_job', staff: s, job_label: `job ${j + 1}` });
        }
      }
    }
  } else if (k === 'peer_waiting') {
    const peerStaff = fx.staff.filter((s) => s.substrate.kind === 'peer');
    const peerConnIds = new Set(
      peerStaff
        .map((s) => (s.substrate.kind === 'peer' ? s.substrate.connection_id : undefined))
        .filter((id): id is string => !!id)
    );
    for (const m of fx.missions) {
      if (m.state === 'in_progress' && peerConnIds.has(m.sender_connection_id)) {
        items.push({ type: 'mission', mission: m });
      }
    }
    if (items.length === 0) {
      for (const s of peerStaff) {
        items.push({ type: 'peer_member', staff: s });
      }
    }
  } else if (k === 'pending') {
    for (const m of fx.missions) {
      if (m.state === 'queued') items.push({ type: 'mission', mission: m });
    }
  } else if (k === 'returned') {
    for (const d of fx.deliverables) {
      if (d.origin_label === 'remote') items.push({ type: 'deliverable', deliverable: d });
    }
  } else if (k === 'blocked') {
    for (const m of fx.missions) {
      if (m.state === 'blocked') items.push({ type: 'mission', mission: m });
    }
  } else if (k === 'retrying') {
    for (const c of fx.connections) {
      if (c.health_state === 'retrying') items.push({ type: 'connection', connection: c });
    }
  }

  return BucketDetailResponseSchema.parse({ key: k, items });
}

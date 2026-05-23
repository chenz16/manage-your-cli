import { describe, it, expect } from 'vitest';
import { TodayResponse, BucketDetailResponse } from '@holon/api-contract';
import { getToday, getBucketDetail } from '../src/today-service.js';

// iter-010 Pass #5 triage (TECH-DEBT D9): baseline fixture intentionally
// emptied — fixtures.snapshot.json now has 0 my_work_queue / 0 staff /
// 0 missions / 0 deliverables / 0 connections / 0 recent_events. The
// bucket-count / detail-shape tests below depended on the seeded set
// (Aria=2 jobs, Wang's Researcher peer-member, queued=2, returned=5,
// blocked=1, retrying=1). Skipped per D9 cleanup task; schema parse +
// bucket-order coverage continues to run.

describe('getToday', () => {
  const today = getToday();

  it('parses through TodayResponse schema', () => {
    expect(() => TodayResponse.parse(today)).not.toThrow();
  });

  it('returns 6 buckets in the canonical order', () => {
    expect(today.buckets.map((b) => b.key)).toEqual([
      'ai_running', 'peer_waiting', 'pending', 'returned', 'blocked', 'retrying',
    ]);
  });

  it.skip('returns 5 my_work_queue items (matches fixture)', () => {
    // SKIP: TECH-DEBT D9 — fixture emptied; my_work_queue=[].
    expect(today.my_work_queue).toHaveLength(5);
  });

  it.skip('caps recent_events at 20 (fixture has 15 — returns all)', () => {
    // SKIP: TECH-DEBT D9 — fixture emptied; recent_events=[].
    expect(today.recent_events.length).toBeLessThanOrEqual(20);
    expect(today.recent_events).toHaveLength(15);
  });

  it('recent_events sorted desc by timestamp', () => {
    for (let i = 1; i < today.recent_events.length; i++) {
      const prev = today.recent_events[i - 1]!;
      const cur = today.recent_events[i]!;
      expect(prev.at.localeCompare(cur.at)).toBeGreaterThanOrEqual(0);
    }
  });

  it.skip('ai_running count = Σ current_jobs of local_ai staff with current_jobs>0', () => {
    // SKIP: TECH-DEBT D9 — fixture has 0 staff; bucket count = 0.
    const bucket = today.buckets.find((b) => b.key === 'ai_running')!;
    expect(bucket.count).toBe(3);
  });

  it.skip('pending count = missions with state==queued (2 in fixture)', () => {
    // SKIP: TECH-DEBT D9 — fixture has 0 missions.
    const bucket = today.buckets.find((b) => b.key === 'pending')!;
    expect(bucket.count).toBe(2);
  });

  it.skip('returned count = deliverables with origin_label==remote (5 in fixture)', () => {
    // SKIP: TECH-DEBT D9 — fixture has 0 deliverables.
    const bucket = today.buckets.find((b) => b.key === 'returned')!;
    expect(bucket.count).toBe(5);
  });

  it.skip('blocked count = missions in blocked state (1 in fixture)', () => {
    // SKIP: TECH-DEBT D9 — fixture has 0 missions.
    const bucket = today.buckets.find((b) => b.key === 'blocked')!;
    expect(bucket.count).toBe(1);
  });

  it.skip('retrying count = connections in retrying state (1 in fixture)', () => {
    // SKIP: TECH-DEBT D9 — fixture has 0 connections.
    const bucket = today.buckets.find((b) => b.key === 'retrying')!;
    expect(bucket.count).toBe(1);
  });

  it('every bucket preview_items has at most 5 entries', () => {
    for (const b of today.buckets) {
      expect(b.preview_items.length).toBeLessThanOrEqual(5);
    }
  });
});

describe('getBucketDetail', () => {
  it('returns null for unknown key', () => {
    expect(getBucketDetail('banana')).toBeNull();
  });

  it.skip('pending returns 2 mission items (matches fixture queued count)', () => {
    // SKIP: TECH-DEBT D9 — fixture has 0 queued missions.
    const detail = getBucketDetail('pending');
    expect(detail).not.toBeNull();
    expect(() => BucketDetailResponse.parse(detail)).not.toThrow();
    expect(detail!.items).toHaveLength(2);
    expect(detail!.items.every((i) => i.type === 'mission')).toBe(true);
  });

  it.skip('returned returns 5 deliverable items', () => {
    // SKIP: TECH-DEBT D9 — fixture has 0 deliverables.
    const detail = getBucketDetail('returned');
    expect(detail!.items).toHaveLength(5);
    expect(detail!.items.every((i) => i.type === 'deliverable')).toBe(true);
  });

  it.skip('blocked returns 1 mission item with state==blocked', () => {
    // SKIP: TECH-DEBT D9 — fixture has 0 blocked missions.
    const detail = getBucketDetail('blocked');
    expect(detail!.items).toHaveLength(1);
    const first = detail!.items[0]!;
    expect(first.type).toBe('mission');
    if (first.type === 'mission') expect(first.mission.state).toBe('blocked');
  });

  it.skip('retrying returns 1 connection item', () => {
    // SKIP: TECH-DEBT D9 — fixture has 0 retrying connections.
    const detail = getBucketDetail('retrying');
    expect(detail!.items).toHaveLength(1);
    expect(detail!.items[0]!.type).toBe('connection');
  });

  it.skip('ai_running expands per-job entries (Aria=2 jobs + Drafter=1 = 3 entries)', () => {
    // SKIP: TECH-DEBT D9 — fixture has 0 staff w/ current_jobs>0.
    const detail = getBucketDetail('ai_running');
    expect(detail!.items).toHaveLength(3);
    expect(detail!.items.every((i: { type: string }) => i.type === 'staff_job')).toBe(true);
  });

  it.skip('peer_waiting falls back to peer-member list when no in_progress missions', () => {
    // SKIP: TECH-DEBT D9 — fixture has 0 peer-members.
    const detail = getBucketDetail('peer_waiting');
    expect(detail!.items.length).toBeGreaterThan(0);
    expect(detail!.items.every((i) => i.type === 'peer_member' || i.type === 'mission')).toBe(true);
  });
});

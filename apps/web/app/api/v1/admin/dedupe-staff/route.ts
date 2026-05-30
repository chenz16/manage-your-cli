/**
 * POST /api/v1/admin/dedupe-staff
 *
 * One-shot duplicate-staff cleanup. Team-pack imports with rename-conflict mode
 * create 小研 / 小研 (2) / 小研 (3) etc. — all sharing the same role_name + pack tag.
 * This endpoint identifies groups and keeps only the OLDEST (smallest id, which
 * encodes a timestamp prefix in base36) in each group, retiring the rest.
 *
 * Auth: loopback-only (admin).
 *
 * POST body {} or omitted   → dry-run; returns { kept, removed, dryRun: true }
 * POST body {"confirm":true} → actually retires duplicates; returns { kept, removed, dryRun: false }
 *
 * Algorithm:
 *   1. List all active staff via listStaffMerged().
 *   2. Skip secretary (role_name === 'secretary') and any staff without a pack:X tag.
 *   3. Group by (role_name, pack:X) — the canonical duplicate key.
 *   4. Within each group of >1, sort by id ascending (base36 timestamp prefix →
 *      oldest first). Keep index 0, queue the rest for removal.
 *   5. In confirm mode, call dismissStaffById (substrate=local_ai) or
 *      retireCliAgentStaff (substrate=cli_agent/cli) on each duplicate.
 */

import { NextResponse } from 'next/server';
import {
  listStaffMerged,
  dismissStaffById,
  retireCliAgentStaff,
} from '@holon/core';
import type { Staff } from '@holon/api-contract';
import { requireLoopback } from '@/lib/loopback-guard';

export const dynamic = 'force-dynamic';

// ── helpers ───────────────────────────────────────────────────────────────────

function extractPackTag(tags: string[]): string | null {
  for (const t of tags) {
    if (t.startsWith('pack:')) return t;
  }
  return null;
}

/** The grouping key for deduplication: role_name + pack tag.
 *  Returns null for staff that should never be deduped. */
function dedupeKey(s: Staff): string | null {
  if (s.role_name === 'secretary') return null;
  const pack = extractPackTag(s.tags ?? []);
  if (!pack) return null; // only dedupe pack-imported staff
  return `${s.role_name}||${pack}`;
}

/** Summarise a Staff for the API response (avoid leaking internal fields). */
function summarise(s: Staff) {
  return {
    id: s.id,
    name: s.name,
    role_name: s.role_name,
    tags: s.tags ?? [],
    status: s.status,
    created_at: s.created_at,
  };
}

// ── route handler ─────────────────────────────────────────────────────────────

export async function POST(req: Request): Promise<NextResponse> {
  // Loopback guard — admin-only
  const loop = requireLoopback(req);
  if (!loop.ok) {
    return NextResponse.json(
      { error: 'admin_only', reason: loop.reason },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  let body: unknown;
  try {
    const text = await req.text();
    body = text.trim() ? JSON.parse(text) : {};
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const confirm =
    typeof body === 'object' &&
    body !== null &&
    (body as Record<string, unknown>).confirm === true;

  // 1. Collect all visible active staff
  const allStaff = listStaffMerged().filter((s) => s.status === 'active');

  // 2. Group by dedup key
  const groups = new Map<string, Staff[]>();
  for (const s of allStaff) {
    const key = dedupeKey(s);
    if (!key) continue;
    const g = groups.get(key);
    if (g) {
      g.push(s);
    } else {
      groups.set(key, [s]);
    }
  }

  // 3. Within each group >1 sort by id asc (oldest = smallest base36 ts prefix = kept)
  const kept: ReturnType<typeof summarise>[] = [];
  const toRemove: Staff[] = [];

  for (const [, members] of groups) {
    if (members.length <= 1) continue;
    // Sort ascending — staff_<base36-ts><hex> where ts grows monotonically
    members.sort((a, b) => a.id.localeCompare(b.id));
    const [oldest, ...dupes] = members as [Staff, ...Staff[]];
    kept.push(summarise(oldest));
    for (const d of dupes) toRemove.push(d);
  }

  const removedSummaries = toRemove.map(summarise);

  if (!confirm) {
    return NextResponse.json({
      dryRun: true,
      kept,
      removed: removedSummaries,
      message: `Dry run: ${toRemove.length} duplicates would be retired, ${kept.length} unique pack groups kept.`,
    });
  }

  // 4. Actually retire each duplicate.
  // Strategy: try retireCliAgentStaff first (handles cli_agent/cli substrate).
  // If it fails with substrate_not_cli_agent, fall back to dismissStaffById
  // (handles local_ai). This avoids brittle substrate-kind routing where the
  // in-memory merged view can differ from the persisted DB row.
  const results: Array<{ id: string; ok: boolean; reason?: string }> = [];
  for (const s of toRemove) {
    let res: { ok: boolean; reason?: string };
    const rRes = retireCliAgentStaff(s.id);
    if (!rRes.ok && rRes.reason?.startsWith('substrate_not_cli_agent')) {
      res = dismissStaffById(s.id);
    } else {
      res = rRes;
    }
    const entry: { id: string; ok: boolean; reason?: string } = { id: s.id, ok: res.ok };
    if (res.reason !== undefined) entry.reason = res.reason;
    results.push(entry);
    console.log(JSON.stringify({
      audit: 'dedupe_staff.removed',
      staff_id: s.id,
      name: s.name,
      role_name: s.role_name,
      ok: res.ok,
      reason: res.reason,
      ts: new Date().toISOString(),
    }));
  }

  const failed = results.filter((r) => !r.ok);

  return NextResponse.json({
    dryRun: false,
    kept,
    removed: removedSummaries,
    results,
    failed: failed.length,
    message: `Retired ${results.length - failed.length} duplicates (${failed.length} failed).`,
  });
}

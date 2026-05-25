import { NextResponse } from 'next/server';
import { getStaffMerged, updateStaff, dismissStaffById, retireCliAgentStaff, type StaffPatch } from '@holon/core';

interface Context { params: Promise<{ id: string }> }

const PATCHABLE: Array<keyof StaffPatch> = [
  'name', 'role_label', 'role_name',
  // NOTE: 'status' intentionally excluded — status changes must go through DELETE
  // (retireCliAgentStaff / dismissStaffById) to enforce lifecycle semantics.
  'system_prompt', 'autonomy_level', 'governance_mode',
  'max_concurrent_jobs', 'avatar_data',
  // Legacy local-AI staff config fields kept for persisted records.
  'denied_skills', 'monthly_budget_millicents', 'proxy_staff_id',
];

export async function GET(_req: Request, ctx: Context): Promise<NextResponse> {
  const { id } = await ctx.params;
  const staff = getStaffMerged(id);
  if (!staff) return NextResponse.json({ error: 'staff not found', id }, { status: 404 });
  // GetStaffResponse = { staff }. getStaffMerged returns a bare Staff, so
  // wrap it — the detail/config view reads `detail.staff`.
  return NextResponse.json({ staff });
}

/**
 * PATCH /api/v1/staff/:id — update an existing staff record.
 *
 * iter-007 step 7. Whitelist of patchable fields prevents the LLM
 * from accidentally rewriting `substrate`, `desk_id`, or `id`
 * (structural — would break references). For substrate edits a
 * dedicated tool will land later.
 */
export async function PATCH(req: Request, ctx: Context): Promise<NextResponse> {
  const { id } = await ctx.params;
  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'expected object body' }, { status: 400 });
  }

  const raw = body as Record<string, unknown>;

  // --- Field validation ---
  if ('name' in raw) {
    const v = raw['name'];
    if (typeof v !== 'string' || v.trim().length === 0) {
      return NextResponse.json({ error: 'name must be a non-empty string', code: 'invalid_field' }, { status: 400 });
    }
    if (v.trim().length > 80) {
      return NextResponse.json({ error: 'name must be at most 80 characters', code: 'invalid_field' }, { status: 400 });
    }
    raw['name'] = v.trim();
  }
  if ('role_label' in raw) {
    const v = raw['role_label'];
    if (typeof v !== 'string') {
      return NextResponse.json({ error: 'role_label must be a string', code: 'invalid_field' }, { status: 400 });
    }
    if (v.length > 120) {
      return NextResponse.json({ error: 'role_label must be at most 120 characters', code: 'invalid_field' }, { status: 400 });
    }
  }
  if ('role_name' in raw) {
    const v = raw['role_name'];
    if (typeof v !== 'string') {
      return NextResponse.json({ error: 'role_name must be a string', code: 'invalid_field' }, { status: 400 });
    }
    if (v.length > 120) {
      return NextResponse.json({ error: 'role_name must be at most 120 characters', code: 'invalid_field' }, { status: 400 });
    }
  }
  if ('system_prompt' in raw) {
    const v = raw['system_prompt'];
    if (typeof v !== 'string') {
      return NextResponse.json({ error: 'system_prompt must be a string', code: 'invalid_field' }, { status: 400 });
    }
    if (v.length > 8000) {
      return NextResponse.json({ error: 'system_prompt must be at most 8000 characters', code: 'invalid_field' }, { status: 400 });
    }
  }
  if ('max_concurrent_jobs' in raw) {
    const v = raw['max_concurrent_jobs'];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 10) {
      return NextResponse.json({ error: 'max_concurrent_jobs must be an integer between 1 and 10', code: 'invalid_field' }, { status: 400 });
    }
  }
  if ('avatar_data' in raw) {
    const v = raw['avatar_data'];
    // Custom avatar is a small client-resized data URL; cap to ~256KB.
    if (v !== null && (typeof v !== 'string' || (v.length > 0 && !v.startsWith('data:image/')) || v.length > 256_000)) {
      return NextResponse.json({ error: 'avatar_data must be a data:image/* URL ≤256KB', code: 'invalid_field' }, { status: 400 });
    }
  }
  // --- End field validation ---

  const patch: StaffPatch = {};
  for (const k of PATCHABLE) {
    if (k in raw) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (patch as any)[k] = raw[k];
    }
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'no patchable fields in body' }, { status: 400 });
  }

  const updated = updateStaff(id, patch);
  if (!updated) return NextResponse.json({ error: 'staff not found', id }, { status: 404 });
  return NextResponse.json(updated);
}

/**
 * DELETE /api/v1/staff/:id — kill / retire a staff member.
 *
 * Routes by substrate: CLI agents (cli / cli_agent) are *retired* (tmux
 * stopped, archived; short agents drop off the roster, long agents keep
 * their soul) via retireCliAgentStaff. local_ai virtual staff are
 * dismissed (soft-delete). peer / owner_assistant are structural and
 * rejected. Per owner 2026-05-23: every employee card needs a Kill button.
 */
export async function DELETE(_req: Request, ctx: Context): Promise<NextResponse> {
  const { id } = await ctx.params;
  const s = getStaffMerged(id);
  if (!s) return NextResponse.json({ error: 'not_found_or_dismissed' }, { status: 404 });

  const r =
    s.substrate.kind === 'cli' || s.substrate.kind === 'cli_agent'
      ? retireCliAgentStaff(id)
      : dismissStaffById(id);
  if (!r.ok) {
    return NextResponse.json({ error: r.reason ?? 'dismiss failed' }, {
      status: r.reason === 'not_found_or_dismissed' ? 404 : 400,
    });
  }
  return NextResponse.json({ ok: true, staff_id: id, status: 'dismissed' });
}

export const dynamic = 'force-dynamic';

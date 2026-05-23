import { NextResponse } from 'next/server';
import { getStaffMerged, updateStaff, dismissStaffById, retireCliAgentStaff, type StaffPatch } from '@holon/core';

interface Context { params: Promise<{ id: string }> }

const PATCHABLE: Array<keyof StaffPatch> = [
  'name', 'role_label', 'role_name', 'status',
  'system_prompt', 'autonomy_level', 'governance_mode',
  'max_concurrent_jobs',
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

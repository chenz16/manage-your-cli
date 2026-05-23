import { NextResponse } from 'next/server';
import { getMember, updateStaff, dismissStaffById, type StaffPatch } from '@holon/core';

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
  const payload = getMember(id);
  if (!payload) return NextResponse.json({ error: 'staff not found', id }, { status: 404 });
  return NextResponse.json(payload);
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
 * DELETE /api/v1/staff/:id — dismiss (soft-delete) a virtual staff.
 *
 * iter-007 step 7. Only `substrate.kind === 'local_ai'` rows can be
 * dismissed via this path; peer / cli / owner_assistant are structural
 * and need a different unwind story.
 */
export async function DELETE(_req: Request, ctx: Context): Promise<NextResponse> {
  const { id } = await ctx.params;
  const r = dismissStaffById(id);
  if (!r.ok) {
    return NextResponse.json({ error: r.reason ?? 'dismiss failed' }, {
      status: r.reason === 'not_found_or_dismissed' ? 404 : 400,
    });
  }
  return NextResponse.json({ ok: true, staff_id: id, status: 'dismissed' });
}

export const dynamic = 'force-dynamic';

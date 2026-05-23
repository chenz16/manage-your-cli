import { NextResponse } from 'next/server';
import { readCliStaffMemory, writeCliStaffMemory, getStaffMerged } from '@holon/core';

interface Context { params: Promise<{ id: string }> }

/**
 * GET /api/v1/staff/:id/cli/memory — ADR-040 slice 1.
 * Return the manager-owned memory Holon keeps for a cli_agent staff.
 * Response: { memory: string }
 */
export async function GET(_req: Request, ctx: Context): Promise<NextResponse> {
  const { id } = await ctx.params;
  return NextResponse.json({ memory: readCliStaffMemory(id) });
}

/**
 * PATCH /api/v1/staff/:id/cli/memory — replace the staff's memory blob.
 * Body: { memory: string }
 * Response: { ok: true }
 */
export async function PATCH(req: Request, ctx: Context): Promise<NextResponse> {
  const { id } = await ctx.params;
  const staff = getStaffMerged(id);
  if (!staff) return NextResponse.json({ error: 'staff_not_found' }, { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const memory = typeof (body as Record<string, unknown>)?.memory === 'string'
    ? ((body as Record<string, unknown>).memory as string)
    : null;
  if (memory === null) {
    return NextResponse.json({ error: 'memory (string) required' }, { status: 400 });
  }

  writeCliStaffMemory(id, memory);
  return NextResponse.json({ ok: true });
}

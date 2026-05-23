import { NextResponse } from 'next/server';
import { getCliStatus, killCliSession } from '@holon/core';

interface Context { params: Promise<{ id: string }> }

/** GET /api/v1/staff/:id/cli — current CLI session status. */
export async function GET(_req: Request, ctx: Context): Promise<NextResponse> {
  const { id } = await ctx.params;
  return NextResponse.json(getCliStatus(id));
}

/** DELETE /api/v1/staff/:id/cli — kill the CLI session. */
export async function DELETE(_req: Request, ctx: Context): Promise<NextResponse> {
  const { id } = await ctx.params;
  const r = killCliSession(id);
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 500 });
  return NextResponse.json({ ok: true, staff_id: id });
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

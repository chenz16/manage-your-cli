import { NextResponse } from 'next/server';
import { reprocessBug } from '@holon/core';

interface Context { params: Promise<{ id: string }> }

export async function POST(_req: Request, ctx: Context): Promise<NextResponse> {
  const { id } = await ctx.params;
  const r = reprocessBug(id);
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 400 });
  return NextResponse.json({ ok: true, bug_id: id });
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

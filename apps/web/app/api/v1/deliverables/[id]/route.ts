import { NextResponse } from 'next/server';
import { getDeliverable } from '@holon/core';
import { requireDeviceTokenForRemote } from '@/lib/device-token-auth';

interface Context { params: Promise<{ id: string }> }

export async function GET(req: Request, ctx: Context): Promise<NextResponse> {
  const auth = requireDeviceTokenForRemote(req);
  if (!auth.ok) {
    return NextResponse.json({
      error: 'device authentication required',
      code: auth.code,
    }, { status: auth.status });
  }

  const { id } = await ctx.params;
  const payload = getDeliverable(id);
  if (!payload) return NextResponse.json({ error: 'deliverable not found', id }, { status: 404 });
  return NextResponse.json(payload);
}

export const dynamic = 'force-dynamic';

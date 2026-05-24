import { NextResponse } from 'next/server';
import { getDeliverable, deleteDeliverable } from '@holon/core';
import { requireDeviceTokenForRemote, deviceAuthErrorResponse } from '@/lib/device-token-auth';

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

/** DELETE /api/v1/deliverables/[id] — hard-delete a deliverable (mutable store only). */
export async function DELETE(req: Request, ctx: Context): Promise<NextResponse | Response> {
  const auth = requireDeviceTokenForRemote(req);
  if (!auth.ok) return deviceAuthErrorResponse(auth);

  const { id } = await ctx.params;
  const deleted = deleteDeliverable(id);
  if (!deleted) {
    return NextResponse.json({ error: 'deliverable not found', id }, { status: 404 });
  }
  return new NextResponse(null, { status: 204 });
}

export const dynamic = 'force-dynamic';

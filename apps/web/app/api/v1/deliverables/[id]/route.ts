import { NextResponse } from 'next/server';
import { getDeliverable, deleteDeliverable, setDeliverableStatus } from '@holon/core';
import { requireDeviceTokenForRemote, deviceAuthErrorResponse } from '@/lib/device-token-auth';

interface Context { params: Promise<{ id: string }> }

const REVIEW_STATUSES = ['accepted', 'rejected', 'final', 'draft', 'revised'] as const;
type ReviewStatus = typeof REVIEW_STATUSES[number];

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

/** PATCH /api/v1/deliverables/[id] — owner review action (accept/reject the
 *  human-in-the-loop gate). Body: { status }. Only mutable (worker-produced)
 *  deliverables are editable; fixture rows return 404. */
export async function PATCH(req: Request, ctx: Context): Promise<NextResponse | Response> {
  const auth = requireDeviceTokenForRemote(req);
  if (!auth.ok) return deviceAuthErrorResponse(auth);

  const { id } = await ctx.params;
  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'invalid JSON body', code: 'invalid_json' }, { status: 400 });
  }
  const status = (body as { status?: unknown })?.status;
  if (typeof status !== 'string' || !REVIEW_STATUSES.includes(status as ReviewStatus)) {
    return NextResponse.json(
      { error: `status must be one of: ${REVIEW_STATUSES.join(', ')}`, code: 'invalid_status' },
      { status: 400 },
    );
  }
  const updated = setDeliverableStatus(id, status as ReviewStatus);
  if (!updated) return NextResponse.json({ error: 'deliverable not found or not editable', id }, { status: 404 });
  return NextResponse.json(updated);
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

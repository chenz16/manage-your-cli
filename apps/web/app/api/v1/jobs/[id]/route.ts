import { NextResponse } from 'next/server';
import { deleteJob } from '@holon/core';
import { requireDeviceTokenForRemote, deviceAuthErrorResponse } from '@/lib/device-token-auth';

export const dynamic = 'force-dynamic';

/** DELETE /api/v1/jobs/[id] — hard-delete a job from the in-memory store. */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse | Response> {
  const auth = requireDeviceTokenForRemote(req);
  if (!auth.ok) return deviceAuthErrorResponse(auth);

  const { id } = await params;
  const deleted = deleteJob(id);
  if (!deleted) {
    return NextResponse.json({ error: 'job not found' }, { status: 404 });
  }
  return new NextResponse(null, { status: 204 });
}

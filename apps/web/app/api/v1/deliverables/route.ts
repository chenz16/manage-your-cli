import { NextResponse } from 'next/server';
import { listDeliverables } from '@holon/core';
import { DeliverableOrigin, DeliverableStatus } from '@holon/api-contract';
import { requireDeviceTokenForRemote } from '@/lib/device-token-auth';

export async function GET(req: Request): Promise<NextResponse> {
  const auth = requireDeviceTokenForRemote(req);
  if (!auth.ok) {
    return NextResponse.json({
      error: 'device authentication required',
      code: auth.code,
    }, { status: auth.status });
  }

  const url = new URL(req.url);
  const originParam = url.searchParams.get('origin');
  const statusParam = url.searchParams.get('status');
  const projectIdParam = url.searchParams.get('project_id');
  let origin: ReturnType<typeof DeliverableOrigin.parse> | undefined;
  let status: ReturnType<typeof DeliverableStatus.parse> | undefined;
  if (originParam !== null) {
    const parsed = DeliverableOrigin.safeParse(originParam);
    if (!parsed.success) return NextResponse.json({ error: 'invalid origin', got: originParam }, { status: 400 });
    origin = parsed.data;
  }
  if (statusParam !== null) {
    const parsed = DeliverableStatus.safeParse(statusParam);
    if (!parsed.success) return NextResponse.json({ error: 'invalid status', got: statusParam }, { status: 400 });
    status = parsed.data;
  }
  // Phase 1: project_id filter — null means no filter; string = filter to project.
  const query: Parameters<typeof listDeliverables>[0] = { origin, status };
  if (projectIdParam !== null) query.project_id = projectIdParam;
  return NextResponse.json(listDeliverables(query));
}

export const dynamic = 'force-dynamic';

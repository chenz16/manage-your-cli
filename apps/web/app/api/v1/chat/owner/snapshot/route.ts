import { NextResponse } from 'next/server';
import { getOwner } from '@holon/core';
import { deviceAuthErrorResponse, requireDeviceTokenForRemote } from '@/lib/device-token-auth';

/**
 * GET /api/v1/chat/owner/snapshot — light owner snapshot for the mobile 我 tab
 * (current owner identity). The CLI-only desktop doesn't need the heavy holon
 * roster/missions/connections snapshot — just who the owner is.
 */
export async function GET(req: Request): Promise<Response> {
  const auth = requireDeviceTokenForRemote(req);
  if (!auth.ok) return deviceAuthErrorResponse(auth);
  const o = getOwner();
  return NextResponse.json({
    owner: { name: o.owner_name, role: o.owner_role, intro: o.owner_intro },
  });
}

export const dynamic = 'force-dynamic';

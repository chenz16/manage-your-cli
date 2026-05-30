/**
 * GET /api/v1/team-packs — return all team packs from the catalog.
 *
 * Auth: requireDeviceTokenForRemote (same posture as /api/v1/rooms).
 */

import { NextResponse } from 'next/server';
import { TEAM_PACKS } from '@holon/core';
import { deviceAuthErrorResponse, requireDeviceTokenForRemote } from '@/lib/device-token-auth';

export async function GET(req: Request): Promise<Response> {
  const auth = requireDeviceTokenForRemote(req);
  if (!auth.ok) return deviceAuthErrorResponse(auth);

  return NextResponse.json({ items: TEAM_PACKS });
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

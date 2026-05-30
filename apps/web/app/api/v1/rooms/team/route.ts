/**
 * GET /api/v1/rooms/team — convenience shortcut: returns the default team
 * room (getOrCreateDefaultTeamRoom) + its current member list.
 *
 * Mobile uses this to resolve the singleton room without listing all rooms.
 */

import { NextResponse } from 'next/server';
import { getOrCreateDefaultTeamRoom, listMembers } from '@holon/core';
import { deviceAuthErrorResponse, requireDeviceTokenForRemote } from '@/lib/device-token-auth';

export async function GET(req: Request): Promise<Response> {
  const auth = requireDeviceTokenForRemote(req);
  if (!auth.ok) return deviceAuthErrorResponse(auth);

  const room = getOrCreateDefaultTeamRoom();
  const members = listMembers(room.id);
  return NextResponse.json({ room, members });
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

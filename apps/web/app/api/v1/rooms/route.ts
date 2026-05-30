/**
 * GET  /api/v1/rooms — list all rooms.
 * POST /api/v1/rooms — create a room.
 *
 * POST body: { name: string; member_staff_ids?: string[] }
 */

import { NextResponse } from 'next/server';
import { listRooms, createRoom, type MemberSeed } from '@holon/core';
import { getStaffMerged } from '@holon/core';
import { deviceAuthErrorResponse, requireDeviceTokenForRemote } from '@/lib/device-token-auth';

export async function GET(req: Request): Promise<Response> {
  const auth = requireDeviceTokenForRemote(req);
  if (!auth.ok) return deviceAuthErrorResponse(auth);

  const rooms = listRooms();
  return NextResponse.json({ items: rooms });
}

export async function POST(req: Request): Promise<Response> {
  const auth = requireDeviceTokenForRemote(req);
  if (!auth.ok) return deviceAuthErrorResponse(auth);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body', code: 'invalid_json' }, { status: 400 });
  }

  const b = body as { name?: unknown; member_staff_ids?: unknown };
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  if (!name) {
    return NextResponse.json({ error: 'name is required', code: 'missing_name' }, { status: 400 });
  }

  // Resolve display names for any requested member staff.
  const rawIds = Array.isArray(b.member_staff_ids) ? b.member_staff_ids : [];
  const memberSeeds: MemberSeed[] = [];
  for (const sid of rawIds) {
    if (typeof sid !== 'string') continue;
    const s = getStaffMerged(sid);
    if (!s) continue;
    memberSeeds.push({ staff_id: sid, display_name: s.name });
  }

  const room = createRoom({ name, member_seeds: memberSeeds });

  console.log(JSON.stringify({
    audit: 'rooms.created',
    room_id: room.id,
    name: room.name,
    member_count: memberSeeds.length,
    ts: new Date().toISOString(),
  }));
  return NextResponse.json({ room }, { status: 201 });
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

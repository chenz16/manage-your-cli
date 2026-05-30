/**
 * DELETE /api/v1/rooms/[id]/members/[party_id] — remove a member.
 */

import { NextResponse } from 'next/server';
import { getRoom, removeMember } from '@holon/core';
import { deviceAuthErrorResponse, requireDeviceTokenForRemote } from '@/lib/device-token-auth';

interface Context { params: Promise<{ id: string; party_id: string }> }

export async function DELETE(req: Request, ctx: Context): Promise<Response> {
  const auth = requireDeviceTokenForRemote(req);
  if (!auth.ok) return deviceAuthErrorResponse(auth);

  const { id, party_id } = await ctx.params;
  const room = getRoom(id);
  if (!room) return NextResponse.json({ error: 'room not found', id }, { status: 404 });

  const removed = removeMember(id, party_id);
  if (!removed) {
    return NextResponse.json({ error: 'member not found', party_id }, { status: 404 });
  }
  return NextResponse.json({ ok: true, party_id });
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

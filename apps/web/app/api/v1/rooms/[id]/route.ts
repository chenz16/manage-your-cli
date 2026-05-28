/**
 * GET    /api/v1/rooms/[id] — get room + members.
 * PATCH  /api/v1/rooms/[id] — rename room. Body: { name: string }
 * DELETE /api/v1/rooms/[id] — delete room.
 */

import { NextResponse } from 'next/server';
import { getRoom, renameRoom, deleteRoom, listMembers } from '@holon/core';
import { deviceAuthErrorResponse, requireDeviceTokenForRemote } from '@/lib/device-token-auth';

interface Context { params: Promise<{ id: string }> }

export async function GET(req: Request, ctx: Context): Promise<Response> {
  const auth = requireDeviceTokenForRemote(req);
  if (!auth.ok) return deviceAuthErrorResponse(auth);

  const { id } = await ctx.params;
  const room = getRoom(id);
  if (!room) return NextResponse.json({ error: 'room not found', id }, { status: 404 });
  const members = listMembers(id);
  return NextResponse.json({ room, members });
}

export async function PATCH(req: Request, ctx: Context): Promise<Response> {
  const auth = requireDeviceTokenForRemote(req);
  if (!auth.ok) return deviceAuthErrorResponse(auth);

  const { id } = await ctx.params;
  const room = getRoom(id);
  if (!room) return NextResponse.json({ error: 'room not found', id }, { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body', code: 'invalid_json' }, { status: 400 });
  }

  const b = body as { name?: unknown };
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  if (!name) {
    return NextResponse.json({ error: 'name is required', code: 'missing_name' }, { status: 400 });
  }

  const updated = renameRoom(id, name);
  if (!updated) return NextResponse.json({ error: 'room not found', id }, { status: 404 });
  return NextResponse.json({ room: updated });
}

export async function DELETE(req: Request, ctx: Context): Promise<Response> {
  const auth = requireDeviceTokenForRemote(req);
  if (!auth.ok) return deviceAuthErrorResponse(auth);

  const { id } = await ctx.params;
  const deleted = deleteRoom(id);
  if (!deleted) return NextResponse.json({ error: 'room not found', id }, { status: 404 });
  return NextResponse.json({ ok: true, id });
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

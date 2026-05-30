/**
 * POST /api/v1/rooms/[id]/members — add a staff as ai_agent member.
 * Body: { staff_id: string }
 */

import { NextResponse } from 'next/server';
import { getRoom, addMember, getStaffMerged, listMembers } from '@holon/core';
import { deviceAuthErrorResponse, requireDeviceTokenForRemote } from '@/lib/device-token-auth';

interface Context { params: Promise<{ id: string }> }

export async function POST(req: Request, ctx: Context): Promise<Response> {
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

  const b = body as { staff_id?: unknown };
  const staffId = typeof b.staff_id === 'string' ? b.staff_id.trim() : '';
  if (!staffId) {
    return NextResponse.json({ error: 'staff_id is required', code: 'missing_staff_id' }, { status: 400 });
  }

  const staff = getStaffMerged(staffId);
  if (!staff) {
    return NextResponse.json({ error: 'staff not found', staff_id: staffId }, { status: 404 });
  }

  // Guard: don't add the same staff twice.
  const existing = listMembers(id);
  const alreadyMember = existing.some((m) => m.ref_id === staffId && m.kind === 'ai_agent');
  if (alreadyMember) {
    return NextResponse.json({ error: 'staff already a member', code: 'already_member' }, { status: 409 });
  }

  const member = addMember(id, {
    kind: 'ai_agent',
    ref_id: staffId,
    display_name: staff.name,
  });

  return NextResponse.json({ member }, { status: 201 });
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

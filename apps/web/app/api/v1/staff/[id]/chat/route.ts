import { NextResponse } from 'next/server';
import { getStaffMerged } from '@holon/core';
import { deviceAuthErrorResponse, requireDeviceTokenForRemote } from '@/lib/device-token-auth';

interface Context { params: Promise<{ id: string }> }

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export async function POST(req: Request, ctx: Context): Promise<Response> {
  const auth = requireDeviceTokenForRemote(req);
  if (!auth.ok) return deviceAuthErrorResponse(auth);

  const { id } = await ctx.params;
  const staff = getStaffMerged(id);
  if (!staff) return NextResponse.json({ error: 'staff not found', id }, { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body', code: 'invalid_json' }, { status: 400 });
  }

  const raw = (body as { messages?: unknown })?.messages;
  if (!Array.isArray(raw)) {
    return NextResponse.json({ error: 'messages must be an array', code: 'invalid_messages' }, { status: 400 });
  }

  const messages = raw
    .filter((m): m is ChatMessage =>
      typeof m === 'object' &&
      m !== null &&
      ((m as { role?: unknown }).role === 'user' || (m as { role?: unknown }).role === 'assistant') &&
      typeof (m as { content?: unknown }).content === 'string',
    )
    .slice(-30);

  const latestUser = [...messages].reverse().find((m) => m.role === 'user' && m.content.trim());
  if (!latestUser) {
    return NextResponse.json({ error: 'at least one user message required', code: 'missing_user_message' }, { status: 400 });
  }

  return NextResponse.json({
    reply: `${staff.name} received: ${latestUser.content.trim()}`,
    staff_id: staff.id,
    mode: 'stub',
  });
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

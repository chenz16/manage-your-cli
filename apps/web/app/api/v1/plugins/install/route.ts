import { NextResponse } from 'next/server';
import { installPlugin } from '@holon/core';
import { deviceAuthErrorResponse, requireDeviceTokenForRemote } from '@/lib/device-token-auth';

export async function POST(req: Request): Promise<Response> {
  const auth = requireDeviceTokenForRemote(req);
  if (!auth.ok) return deviceAuthErrorResponse(auth);

  let body: unknown;
  try {
    body = await req.json();
  } catch (error) {
    return NextResponse.json(
      { error: 'invalid JSON body', detail: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: 'expected object body' }, { status: 400 });
  }

  const raw = body as Record<string, unknown>;
  if (typeof raw.id !== 'string' || raw.id.trim().length === 0) {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
  }

  try {
    const installed = installPlugin(raw.id.trim(), raw.config ?? {});
    return NextResponse.json({ installed }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}

export const dynamic = 'force-dynamic';

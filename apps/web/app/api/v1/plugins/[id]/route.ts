import { NextResponse } from 'next/server';
import { setPluginEnabled, uninstallPlugin } from '@holon/core';
import { deviceAuthErrorResponse, requireDeviceTokenForRemote } from '@/lib/device-token-auth';

interface Context { params: Promise<{ id: string }> }

export async function PATCH(req: Request, ctx: Context): Promise<Response> {
  const auth = requireDeviceTokenForRemote(req);
  if (!auth.ok) return deviceAuthErrorResponse(auth);

  const { id } = await ctx.params;
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

  const enabled = (body as Record<string, unknown>).enabled;
  if (typeof enabled !== 'boolean') {
    return NextResponse.json({ error: 'enabled boolean required' }, { status: 400 });
  }

  try {
    return NextResponse.json({ installed: setPluginEnabled(id, enabled) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 404 },
    );
  }
}

export async function DELETE(req: Request, ctx: Context): Promise<Response> {
  const auth = requireDeviceTokenForRemote(req);
  if (!auth.ok) return deviceAuthErrorResponse(auth);

  const { id } = await ctx.params;
  const ok = uninstallPlugin(id);
  if (!ok) return NextResponse.json({ error: 'plugin not installed', id }, { status: 404 });
  return NextResponse.json({ ok: true, id, status: 'deleted' });
}

export const dynamic = 'force-dynamic';

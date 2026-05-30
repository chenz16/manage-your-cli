import { NextResponse } from 'next/server';
import { listInstalled, listRegistry } from '@holon/core';
import { deviceAuthErrorResponse, requireDeviceTokenForRemote } from '@/lib/device-token-auth';

export async function GET(req: Request): Promise<Response> {
  const auth = requireDeviceTokenForRemote(req);
  if (!auth.ok) return deviceAuthErrorResponse(auth);
  return NextResponse.json({
    registry: listRegistry(),
    installed: listInstalled(),
  });
}

export const dynamic = 'force-dynamic';

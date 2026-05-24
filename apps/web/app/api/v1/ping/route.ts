import { NextResponse } from 'next/server';
import { deviceAuthErrorResponse, requireDeviceTokenForRemote } from '@/lib/device-token-auth';

/** Lightweight connection-health probe the mobile thin-client polls to know the
 *  desktop is reachable (online/offline banner). Gated like the other mobile routes. */
export async function GET(req: Request): Promise<Response> {
  const auth = requireDeviceTokenForRemote(req);
  if (!auth.ok) return deviceAuthErrorResponse(auth);
  return NextResponse.json({ ok: true, ts: new Date().toISOString() });
}

export const dynamic = 'force-dynamic';

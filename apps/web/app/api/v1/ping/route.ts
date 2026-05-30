import { NextResponse } from 'next/server';
import { deviceAuthErrorResponse, requireDeviceTokenForRemote } from '@/lib/device-token-auth';
import { selectLanIPv4 } from '@/lib/device-pairing-store';

/** Lightweight connection-health probe the mobile thin-client polls to know the
 *  desktop is reachable (online/offline banner). Gated like the other mobile routes.
 *
 *  Also returns the desk's current network candidates (LAN + Tailscale base URLs)
 *  so the mobile client can refresh its stored failover list WITHOUT re-pairing.
 *  This makes the multi-baseUrl failover work for previously-paired clients. */
export async function GET(req: Request): Promise<Response> {
  const auth = requireDeviceTokenForRemote(req);
  if (!auth.ok) return deviceAuthErrorResponse(auth);
  const hostHeader = req.headers.get('host') ?? 'localhost:3000';
  const port = hostHeader.includes(':') ? hostHeader.split(':').at(-1)! : '3000';
  const { candidates } = selectLanIPv4();
  const lan_candidates = candidates.map((ip) => `http://${ip}:${port}`);
  return NextResponse.json({
    ok: true,
    ts: new Date().toISOString(),
    lan_candidates,
  });
}

export const dynamic = 'force-dynamic';

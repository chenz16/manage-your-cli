import { NextResponse } from 'next/server';
import { selectLanIPv4 } from '@/lib/device-pairing-store';

/** Lightweight connection-health probe.
 *
 *  PUBLIC (no auth). The onboarding-on-first-launch flow (mobile thin client)
 *  hits this before pairing exists, to verify the desk URL the user typed is
 *  reachable. Returns only non-sensitive data:
 *    - status      : "ok" marker
 *    - version     : desk app version (advisory)
 *    - server_time : iso8601, useful for clock-skew diagnostics
 *    - lan_candidates: peer LAN IPv4 URLs (back-compat for the paired-client
 *                     refresh path; same /24 the client is on, not secret).
 *
 *  Other /api/v1/* endpoints stay device-token gated. This is the single
 *  intentional hole, by design (slice 1 of mobile-desk-url onboarding). */
export async function GET(req: Request): Promise<Response> {
  const hostHeader = req.headers.get('host') ?? 'localhost:3000';
  const port = hostHeader.includes(':') ? hostHeader.split(':').at(-1)! : '3000';
  const { candidates } = selectLanIPv4();
  const lan_candidates = candidates.map((ip) => `http://${ip}:${port}`);
  return NextResponse.json({
    status: 'ok',
    ok: true, // back-compat with paired-client polling that asserts `ok === true`
    version: process.env.npm_package_version ?? '0.3.0',
    server_time: new Date().toISOString(),
    ts: new Date().toISOString(), // back-compat field name
    lan_candidates,
  });
}

export const dynamic = 'force-dynamic';

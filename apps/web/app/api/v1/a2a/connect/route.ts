/**
 * POST /api/v1/a2a/connect
 *
 * Server-side A2A peer connection endpoint. Accepts a scanned agent-card URL
 * (base URL or full /.well-known/agent-card.json URL), fetches + validates the
 * remote card, and persists the peer into the desk's A2A peer registry so it
 * shows up on /connectors and is available to mobile clients.
 *
 * Auth: same device-token gating as all other /api/v1 routes. Loopback
 * requests (browser on the same machine) are exempt. Remote callers (mobile
 * 微作) must present a valid x-holon-device-token header.
 *
 * Request body:
 *   { url: string }  — the agent-card base URL or full /.well-known URL
 *
 * Success response (200):
 *   { ok: true, peer: A2APeerRecord }
 *
 * Error responses:
 *   400 — missing or structurally invalid url
 *   401 — missing device token (remote caller)
 *   403 — invalid / expired device token
 *   502 — remote agent card unreachable or returned non-OK HTTP
 *   422 — card fetched but failed structural validation
 */

import { NextResponse } from 'next/server';
import { requireDeviceTokenForRemote, deviceAuthErrorResponse } from '@/lib/device-token-auth';
import { upsertA2APeer } from '@holon/core';
import { fetchAgentCard } from '@/lib/a2a-fetch-card';

export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  // ── Auth: same gating as all other /api/v1 routes ──────────────────────
  const auth = requireDeviceTokenForRemote(req);
  if (!auth.ok) {
    return deviceAuthErrorResponse(auth);
  }

  // ── Parse body ──────────────────────────────────────────────────────────
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'request body must be valid JSON' },
      { status: 400 },
    );
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return NextResponse.json(
      { ok: false, error: 'request body must be a JSON object' },
      { status: 400 },
    );
  }

  const { url } = body as Record<string, unknown>;
  if (typeof url !== 'string' || !url.trim()) {
    return NextResponse.json(
      { ok: false, error: 'body.url (string) is required' },
      { status: 400 },
    );
  }

  // ── Fetch + validate the remote agent card ──────────────────────────────
  const fetchResult = await fetchAgentCard(url);
  if (!fetchResult.ok) {
    return NextResponse.json(
      { ok: false, error: fetchResult.error },
      { status: fetchResult.status },
    );
  }

  const { card, baseUrl } = fetchResult.data;

  // ── Persist (upsert) into the desk's A2A peer registry ─────────────────
  const peer = upsertA2APeer(baseUrl, card);

  console.log(JSON.stringify({
    audit: 'a2a.connect',
    peer_id: peer.id,
    card_name: typeof card.name === 'string' ? card.name : null,
    mode: auth.mode,
    ts: new Date().toISOString(),
  }));

  return NextResponse.json({ ok: true, peer });
}

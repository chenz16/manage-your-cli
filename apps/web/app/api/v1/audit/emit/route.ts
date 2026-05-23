/**
 * iter-011 Pass #6 — BFF audit-emit proxy for the Hermes Python sidecar.
 *
 *   POST /api/v1/audit/emit
 *     header: X-Holon-Plugin-Secret: <env HOLON_PLUGIN_SHARED_SECRET>
 *     body:   { kind: IntegrationKind, event: IntegrationEvent, payload?: object, ts?: string }
 *     → 200 { ok: true }                                  (emitted)
 *     → 400 { error: 'invalid_body' | 'invalid_kind' | 'invalid_event' }
 *     → 401 { error: 'shared_secret_invalid' }            (auth)
 *     → 403 { error: 'remote_origin_blocked' }            (non-local)
 *     → 500 { error: 'server_misconfigured' }             (no secret)
 *
 * Same shared-secret + loopback guards as the /tokens + /refresh routes.
 * Single source of truth: forwards into `emitIntegrationAudit` so the
 * Python sidecar's events land in the same audit collector with the same
 * shape as the BFF's own emits (no second sink, no file-race).
 *
 * Why the indirection: the sidecar can't `import '@holon/core'` (it's a
 * Python process), and we don't want two divergent audit pipelines. The
 * sidecar POSTs here; this route validates + replays.
 */

import { NextResponse } from 'next/server';
import {
  emitIntegrationAudit,
  type IntegrationEvent,
} from '@holon/core';
import { IntegrationKind } from '@holon/api-contract';
import { requireLoopback, safeSecretEqual } from '@/lib/loopback-guard';

// Same closed set the core helper accepts — duplicated here as a runtime
// validator (the type alone can't gate JSON input). If you add a member
// in audit.ts, add it here too.
const INTEGRATION_EVENTS = new Set<IntegrationEvent>([
  'integration.connected',
  'integration.connect_failed',
  'integration.disconnected',
  'integration.disconnect_failed',
  'integration.token_fetched',
  'integration.token_fetch_failed',
  'integration.token_refreshed',
  'integration.token_refresh_failed',
  'integration.api_called',
]);

export async function POST(req: Request): Promise<NextResponse> {
  // 1. Shared-secret + loopback gates (mirror /tokens + /refresh routes).
  const expected = process.env.HOLON_PLUGIN_SHARED_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: 'server_misconfigured', message: 'HOLON_PLUGIN_SHARED_SECRET not set on BFF.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  const presented = req.headers.get('x-holon-plugin-secret');
  // L-035: constant-time comparison (mirrors /tokens + /refresh routes).
  if (!safeSecretEqual(presented, expected)) {
    return NextResponse.json(
      { error: 'shared_secret_invalid' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  // L-030 hardened loopback gate.
  const loop = requireLoopback(req);
  if (!loop.ok) {
    return NextResponse.json(
      { error: 'remote_origin_blocked', reason: loop.reason },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // 2. Body-size cap. L-037: any holder of the shared secret can otherwise
  //    POST unbounded audit lines → unbounded stdout growth → log-disk fill
  //    → BFF crash. 8 KB is ~10× the largest legitimate payload we emit
  //    (api_called with endpoint+status+latency_ms is <200 bytes; even a
  //    100-key payload with 60-char string values fits well under).
  //    Rate-limiting (token bucket) is a separate concern — deferred to
  //    the morning queue (needs in-memory state shared across HMR boundary).
  const contentLength = Number.parseInt(req.headers.get('content-length') ?? '0', 10);
  const MAX_BYTES = 8 * 1024;
  if (Number.isFinite(contentLength) && contentLength > MAX_BYTES) {
    return NextResponse.json(
      { error: 'body_too_large', max_bytes: MAX_BYTES, received: contentLength },
      { status: 413, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // 3. Parse + validate body.
  let body: { kind?: unknown; event?: unknown; payload?: unknown; ts?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch (e) {
    return NextResponse.json(
      { error: 'invalid_body', message: (e as Error).message },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  // Kind via the zod enum — adding `'asana'` to IntegrationKind requires
  // zero edits here (the enum is the single source of truth).
  const kindParse = IntegrationKind.safeParse(body?.kind);
  if (!kindParse.success) {
    return NextResponse.json(
      { error: 'invalid_kind', received: body?.kind },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  const event = body?.event;
  if (typeof event !== 'string' || !INTEGRATION_EVENTS.has(event as IntegrationEvent)) {
    return NextResponse.json(
      { error: 'invalid_event', received: event },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  const payload = (body?.payload && typeof body.payload === 'object' && !Array.isArray(body.payload))
    ? (body.payload as Record<string, unknown>)
    : undefined;
  const ts = typeof body?.ts === 'string' ? body.ts : undefined;

  // 3. Forward to the standard sink. emitIntegrationAudit handles the
  // timestamp default + stdout JSON line. exactOptionalPropertyTypes
  // dictates we only set keys that have a defined value.
  emitIntegrationAudit({
    kind: kindParse.data,
    event: event as IntegrationEvent,
    ...(payload ? { payload } : {}),
    ...(ts ? { ts } : {}),
  });

  return NextResponse.json({ ok: true }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
}

export const dynamic = 'force-dynamic';

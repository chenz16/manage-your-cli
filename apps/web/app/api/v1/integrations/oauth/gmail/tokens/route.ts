/**
 * iter-013 Pass #4 — Deprecation shim (ADR-024 § Implementation Notes step 5).
 *
 * Replaces iter-011 Pass #3's 133-LOC localhost-shared-secret token-fetch
 * route. The Hermes Python sidecar now hits
 * `/api/v1/integrations/auth/session` (Pass #3); this URL stays mounted
 * for one iter as an explicit 410 Gone with an audit emit so we can
 * count + chase any straggler caller (older plugin builds, scripts) before
 * fully unmounting in iter-014+.
 *
 *   POST /api/v1/integrations/oauth/gmail/tokens
 *     → 410 Gone { error: 'endpoint_deprecated', replacement }
 *     emits `integration.deprecated_endpoint_called` (kind=gmail)
 *
 * No auth gate, no body parse — by design. A deprecated URL should be as
 * cheap as possible to reject; the audit line is the only useful side-effect.
 */

import { NextResponse } from 'next/server';
import { emitIntegrationAudit } from '@holon/core';

const REPLACEMENT = '/api/v1/integrations/auth/session';

export async function POST(_req: Request): Promise<NextResponse> {
  emitIntegrationAudit({
    kind: 'gmail',
    event: 'integration.deprecated_endpoint_called',
    payload: { endpoint: '/api/v1/integrations/oauth/gmail/tokens', replacement: REPLACEMENT },
  });
  return NextResponse.json(
    {
      error: 'endpoint_deprecated',
      message: 'iter-011 OAuth route removed (ADR-024). Use the NextAuth-backed session endpoint instead.',
      replacement: REPLACEMENT,
    },
    { status: 410, headers: { 'Cache-Control': 'no-store' } },
  );
}

export const dynamic = 'force-dynamic';

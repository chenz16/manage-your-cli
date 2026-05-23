/**
 * iter-013 Pass #4 — Deprecation shim (ADR-024 § Implementation Notes step 5).
 *
 * Replaces iter-011 Pass #4's 94-LOC owner-initiated Gmail disconnect.
 * Under NextAuth (Pass #3), disconnect is a customer-side action via the
 * `signOut()` React hook (clears the session cookie + invalidates the row
 * in `sessions`). The Hermes Python sidecar never originated a disconnect
 * (only the customer did via /me), so there is no programmatic caller to
 * preserve compatibility for.
 *
 *   POST /api/v1/integrations/oauth/gmail/disconnect
 *     → 410 Gone { error: 'endpoint_deprecated', replacement }
 *     emits `integration.deprecated_endpoint_called` (kind=gmail)
 *
 * The replacement field points at the NextAuth signout handler so any UI
 * straggler doing a hard-fetch to this URL can switch to the proper path
 * (typically replaced upstream by the `signOut({redirect: false})` call
 * already shipped in Pass #3's AuthorizationsSection.tsx).
 *
 * Loopback / CSRF gate intentionally not preserved — a 410 is the same
 * answer regardless of caller origin, and the audit line carries the
 * straggler signal independently.
 */

import { NextResponse } from 'next/server';
import { emitIntegrationAudit } from '@holon/core';

const REPLACEMENT = '/api/auth/signout';

export async function POST(_req: Request): Promise<NextResponse> {
  emitIntegrationAudit({
    kind: 'gmail',
    event: 'integration.deprecated_endpoint_called',
    payload: { endpoint: '/api/v1/integrations/oauth/gmail/disconnect', replacement: REPLACEMENT },
  });
  return NextResponse.json(
    {
      error: 'endpoint_deprecated',
      message:
        'iter-011 OAuth disconnect removed (ADR-024). Use NextAuth signOut() from the UI; programmatic disconnect is not supported.',
      replacement: REPLACEMENT,
    },
    { status: 410, headers: { 'Cache-Control': 'no-store' } },
  );
}

export const dynamic = 'force-dynamic';

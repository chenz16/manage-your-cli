/**
 * iter-013 Pass #3 (ADR-024 § Implementation Notes step 3) — BFF session
 * proxy that hands the Hermes plugin sidecar a decrypted OAuth access_token
 * pulled from the NextAuth session.
 *
 *   POST /api/v1/integrations/auth/session
 *     header: X-Holon-Plugin-Secret: <env HOLON_PLUGIN_SHARED_SECRET>
 *     body:   { provider?: 'google' }              (provider-agnostic; defaults to google)
 *     → 200 { provider, access_token, refresh_token, expires_at, scope, email_address }
 *     → 401 { error: 'not_authenticated' }         (no signed-in session)
 *     → 401 { error: 'shared_secret_invalid' }     (shared-secret gate)
 *     → 403 { error: 'remote_origin_blocked' }     (non-loopback)
 *     → 500 { error: 'server_misconfigured', message }
 *
 * Why this exists: the Python sidecar can't read NextAuth's encrypted
 * account-table directly — different process, different language, doesn't
 * hold HOLON_TOKEN_ENC_KEY. This route is the SINGLE channel through
 * which tokens leave the BFF address space, and it preserves every
 * iter-011 invariant from the legacy /oauth/gmail/tokens path:
 *   - L-030 hardened loopback gate (XFF + Origin + Host, all must be loopback).
 *   - L-033 constant-time shared-secret comparison.
 *   - Cache-Control: no-store so no proxy / CDN persists token material.
 *   - Never logs the token bundle — only audit metadata (provider, email-prefix).
 *
 * Response shape mirrors iter-011's /oauth/gmail/tokens (access_token +
 * refresh_token + expires_at + scope) so the Hermes plugin only needs a
 * URL swap (no body-shape change). Pass #4 deletes the legacy route.
 *
 * Refresh: NextAuth's drizzle adapter rotates the refresh_token internally
 * when the access_token expires (driven by next-auth's account-update path
 * during sign-in / session re-fetch). The sidecar no longer needs its own
 * /refresh round-trip — re-calling this endpoint returns a fresh-or-soon-
 * to-refresh token. The Pass #3 plugin edit collapses _refresh_if_needed
 * into a re-fetch of this same URL.
 */

import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { db } from '@/db';
import { accountsTable } from '@/db/schema';
import { decrypt } from '@holon/auth';
import { emitIntegrationAudit } from '@holon/core';
import { requireLoopback, safeSecretEqual } from '@/lib/loopback-guard';

// L-059 / L-032 production-guard mirror — refuse to boot if the dev-only
// HOLON_OAUTH_TEST_MODE flag accidentally inherited into a production env
// (dev .env copied into container bake, CI export bleed). The TEST_MODE
// short-circuit at line ~99 would otherwise hand canned tokens to any
// caller that passes the shared-secret gate. Defense-in-depth: auth.ts
// holds the symmetric guard; gmail_client.py holds it on the plugin side.
if (
  process.env.NODE_ENV === 'production' &&
  process.env.HOLON_OAUTH_TEST_MODE === 'true'
) {
  throw new Error(
    'session/route.ts: HOLON_OAUTH_TEST_MODE cannot be enabled in production NODE_ENV ' +
      '(would short-circuit the BFF and return canned test-mode-google-* tokens to the plugin).',
  );
}

/** iter-011 Pass #6 audit-sink shim — strip `audit` + `kind`, replay through emitIntegrationAudit. */
function auditLog(payload: Record<string, unknown> & { audit: string; kind?: string }): void {
  const { audit: event, kind, ...rest } = payload;
  emitIntegrationAudit({
    kind: (kind ?? 'gmail') as Parameters<typeof emitIntegrationAudit>[0]['kind'],
    event: event as Parameters<typeof emitIntegrationAudit>[0]['event'],
    payload: rest,
  });
}

export async function POST(req: Request): Promise<NextResponse> {
  // 1. Shared-secret gate (mirrors iter-011 /tokens route).
  const presented = req.headers.get('x-holon-plugin-secret');
  const expected = process.env.HOLON_PLUGIN_SHARED_SECRET;
  if (!expected) {
    auditLog({ audit: 'integration.token_fetch_failed', kind: 'gmail', reason: 'server_misconfigured' });
    return NextResponse.json(
      { error: 'server_misconfigured', message: 'HOLON_PLUGIN_SHARED_SECRET not set on BFF.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  if (!safeSecretEqual(presented, expected)) {
    auditLog({ audit: 'integration.token_fetch_failed', kind: 'gmail', reason: 'shared_secret_invalid' });
    return NextResponse.json(
      { error: 'shared_secret_invalid' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // 2. Localhost-only gate (L-030 hardened).
  const loop = requireLoopback(req);
  if (!loop.ok) {
    auditLog({ audit: 'integration.token_fetch_failed', kind: 'gmail', reason: 'not_loopback', loopback_reason: loop.reason });
    return NextResponse.json(
      { error: 'remote_origin_blocked', reason: loop.reason },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // 3. Parse body — provider is optional (default 'google' for V1). L-062
  //    (Engineering Rule #4): SyntaxError / "Unexpected end of JSON input"
  //    are the benign empty-body or malformed-body case — provider stays
  //    'google' per the iter-013 contract. Any OTHER error class (AbortError
  //    on long-poll cancellation, content-length DoS mid-stream, etc.) we
  //    classify into a structured audit line so the bare catch doesn't
  //    silently swallow operational signal. We still don't surface a 4xx —
  //    the iter-011 L-049 pattern is "classify, then continue with default".
  let provider = 'google';
  try {
    const body = (await req.json()) as { provider?: unknown };
    if (typeof body?.provider === 'string' && body.provider) provider = body.provider;
  } catch (e) {
    const err = e as Error;
    const benign =
      err.name === 'SyntaxError' || (err.message ?? '').includes('Unexpected end');
    if (!benign) {
      auditLog({
        audit: 'integration.token_fetch_failed',
        kind: 'gmail',
        reason: 'body_parse_failed',
        message: err.message,
      });
    }
  }

  // 4. Test-mode short-circuit (L-021 / L-032 mirror) — return canned tokens
  //    so the demo recipe + Playwright smoke can run without a Google round-
  //    trip. The plugin-side guard in gmail_client.py refuses to import in
  //    production with this env set, so the dev surface is the only reach.
  if (process.env.HOLON_OAUTH_TEST_MODE === 'true') {
    auditLog({ audit: 'integration.token_fetched', kind: 'gmail', provider, test_mode: true });
    return NextResponse.json(
      {
        provider,
        access_token: 'test-mode-google-at',
        refresh_token: 'test-mode-google-rt',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        // gmail.compose added (feat: gmail-create-draft). Owner must re-consent to grant the new scope.
        scope: 'openid email profile https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose',
        email_address: 'test@example.com',
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // 5. Resolve identity + token bundle.
  //
  // Two caller contexts converge on this route, and they identify the owner
  // differently:
  //
  //   (a) BROWSER context — the /me page, an authenticated React click.
  //       NextAuth's session cookie rides the request; auth() resolves the
  //       user row + the Pass #2 session callback already decrypted
  //       access_token. Identity-from-cookie. ← original Pass #3 design.
  //
  //   (b) PLUGIN context — the Hermes Python sidecar making a server-to-
  //       server POST. There is NO browser cookie; auth() returns null.
  //       The shared-secret gate at step 1 already proved the caller is
  //       the trusted in-process plugin. Per ADR-022 + ADR-026 § Decision
  //       anchor #1 + § AC-1 (V1 Personal Edition single-owner-per-host),
  //       the accounts table holds at most ONE row per provider — that
  //       sole row IS the owner. We read it directly. Identity-from-
  //       singleton.
  //
  // Pre-fix bug: the original code returned 401 `not_authenticated` for
  // (b) because it required session.accessToken unconditionally. The Python
  // plugin's gmail_client.py then mis-mapped 401 → "bff_shared_secret_
  // rejected", which surfaced to owners as "your Gmail authorization is
  // broken" even though OAuth had completed successfully. Owners hit an
  // infinite "re-authorize" loop with no possible resolution. Closes that
  // gap by adding the plugin-context fallback.
  //
  // V2 multi-user (ADR-026 § Phased delivery) replaces the singleton
  // assumption with a plugin-supplied `owner_id` field in the request
  // body (Hermes will know which owner spawned its job context). For V1
  // the singleton holds.

  const session = await auth();

  let resolvedAccessToken: string | undefined;
  let resolvedScope: string | undefined;
  let resolvedExpiresAt: number | undefined;
  let resolvedEmail: string | undefined;
  let resolvedUserId: string | undefined;

  if (session?.user?.id && session.accessToken) {
    // Path (a) — browser context with valid session.
    resolvedAccessToken = session.accessToken;
    resolvedScope = session.scope;
    resolvedExpiresAt = session.expiresAt;
    resolvedEmail = session.user.email ?? undefined;
    resolvedUserId = session.user.id;
  } else {
    // Path (b) — plugin context (no cookie). Direct singleton lookup.
    const ownerRow = db
      .select({
        userId: accountsTable.userId,
        access_token: accountsTable.access_token,
        expires_at: accountsTable.expires_at,
        scope: accountsTable.scope,
      })
      .from(accountsTable)
      .where(eq(accountsTable.provider, provider))
      .get();
    if (!ownerRow?.access_token) {
      auditLog({
        audit: 'integration.token_fetch_failed',
        kind: 'gmail',
        reason: 'not_connected',
        provider,
      });
      return NextResponse.json(
        { error: 'not_connected', provider },
        { status: 404, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    try {
      resolvedAccessToken = decrypt(ownerRow.access_token);
    } catch (e) {
      auditLog({
        audit: 'integration.token_fetch_failed',
        kind: 'gmail',
        reason: 'token_store_failed',
        message: (e as Error).message,
      });
      return NextResponse.json(
        { error: 'token_store_failed', message: (e as Error).message },
        { status: 500, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    resolvedScope = ownerRow.scope ?? undefined;
    resolvedExpiresAt = ownerRow.expires_at ?? undefined;
    resolvedUserId = ownerRow.userId;
    // email_address: deferred. The user row would need a separate lookup
    // (accounts has no email column). The Python plugin doesn't currently
    // consume email_address on this path, so undefined is fine. If we need
    // it later, query usersTable by userId.
    resolvedEmail = undefined;
  }

  // 6. Decrypt refresh_token at the boundary (same pattern as auth.ts).
  let refresh_token: string | undefined;
  try {
    const row = db
      .select({ refresh_token: accountsTable.refresh_token })
      .from(accountsTable)
      .where(
        and(
          eq(accountsTable.userId, resolvedUserId),
          eq(accountsTable.provider, provider),
        ),
      )
      .get();
    if (row?.refresh_token) refresh_token = decrypt(row.refresh_token);
  } catch (e) {
    // Decrypt drift on the refresh column — rare but Rule #4 classify.
    auditLog({
      audit: 'integration.token_fetch_failed',
      kind: 'gmail',
      reason: 'token_store_failed',
      message: (e as Error).message,
    });
    return NextResponse.json(
      { error: 'token_store_failed', message: (e as Error).message },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // 7. Success — audit metadata only (no token values in the audit line).
  auditLog({
    audit: 'integration.token_fetched',
    kind: 'gmail',
    provider,
    email_prefix: resolvedEmail?.slice(0, 3),
    caller_context: session?.user?.id ? 'browser' : 'plugin',
  });
  return NextResponse.json(
    {
      provider,
      access_token: resolvedAccessToken,
      refresh_token,
      expires_at: resolvedExpiresAt,
      scope: resolvedScope,
      email_address: resolvedEmail,
    },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}

export const dynamic = 'force-dynamic';

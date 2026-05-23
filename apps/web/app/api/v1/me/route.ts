import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getOwner, updateOwner, type OwnerAssistantPatch } from '@holon/core';
import { db } from '@/db';
import { accountsTable } from '@/db/schema';

/**
 * /api/v1/me â€” read + patch the owner assistant config.
 *
 * GET  â†’ full record (fixture baseline + in-memory overrides applied).
 * PATCH â†’ shallow merge a subset of fields. v1 stores in mutable-store;
 *   admin reset wipes overrides.
 *
 * iter-007 step 6. The /me page's InlineField calls PATCH on blur.
 */

const ALLOWED_FIELDS: Array<keyof OwnerAssistantPatch> = [
  'owner_name',
  'owner_role',
  'owner_intro',
  'system_prompt',
  'workspace_dir',
  'monthly_budget_mc',
  'skills',
  'upstream_connection_id',
  'upstream_display_name',
  'integrations',
  'language_preference',
  'hidden_features',
  'stt_provider',
  'stt_server_url',
  'sensevoice_url',
  'stt_openai_api_key',
  'tts_provider',
  'tts_server_url',
  'tts_openai_api_key',
  // Note: `name`, `role_label`, `substrate` deliberately excluded from
  // this surface â€” they're structural and changing them mid-session
  // could break the chat runtime.
];

export async function GET(): Promise<NextResponse> {
  // P0 ship-blocker from 2026-05-19 persona walkthrough v2: /me's Authorizations
  // panel rendered "No connectors" while CEO chat happily read real Gmail via
  // the Hermes plugin. Two stores disagreed: owner-config-service.integrations
  // (TD-011-persisted, mutated by the /integrations UI) vs the NextAuth
  // `account` table (drizzle DB at <repoRoot>/.holon/auth.db â€” populated by
  // the OAuth callback, source of truth for the plugin token-fetch path at
  // /api/v1/integrations/auth/session). MembersClient already dual-sources
  // these two via ea27c65 client-side; we mirror the same merge server-side
  // here so the rendered payload reflects the same reality the chat layer sees.
  //
  // Read-only against accountsTable â€” no decrypt (the token never leaves this
  // route; we only need existence + expiry + scope to synthesize the link).
  const owner = getOwner();

  let synthetic_from_nextauth = false;
  const synthetic: typeof owner.integrations = [];
  try {
    const row = db
      .select({
        access_token: accountsTable.access_token,
        expires_at: accountsTable.expires_at,
        scope: accountsTable.scope,
        userId: accountsTable.userId,
      })
      .from(accountsTable)
      .where(eq(accountsTable.provider, 'google'))
      .get();
    const hasLinkGmail = (owner.integrations ?? []).some((g) => g.kind === 'gmail');
    // Existence-of-row IS the connectedness signal â€” NextAuth's drizzle adapter
    // rotates the refresh_token on demand, so an `expires_at` in the past does
    // NOT mean the user is disconnected (validated empirically 2026-05-19:
    // chat answered Gmail queries with a 53-min-stale `expires_at`). We
    // synthesize whenever a token row is present and unaccompanied by a
    // legacy IntegrationLink. The `expires_at` we forward is the stored
    // value for display; the plugin path resolves fresh tokens itself via
    // /api/v1/integrations/auth/session.
    if (row?.access_token && !hasLinkGmail) {
      // Synthesize a display-only IntegrationLink. The /me Authorizations panel
      // and downstream consumers only inspect `kind` + `label` + `enabled`; the
      // token fields stay as opaque markers (refs point at the NextAuth row,
      // not at the legacy token-store â€” that's why `source` is tagged).
      const expiresAtMs = (row.expires_at ?? Math.floor(Date.now() / 1000) + 3600) * 1000;
      synthetic.push({
        kind: 'gmail',
        label: 'Gmail',
        enabled: true,
        config: {
          access_token_ref: 'nextauth:account',
          refresh_token_ref: 'nextauth:account',
          expires_at: expiresAtMs,
          scope: row.scope ?? 'https://www.googleapis.com/auth/gmail.readonly',
          email_address: 'connected@nextauth.local',
          connected_at: expiresAtMs - 3_600_000,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ...({ source: 'nextauth' } as any),
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      synthetic_from_nextauth = true;
    }
  } catch (err) {
    // Best-effort merge â€” a failed read on the auth DB (corrupt / locked /
    // missing) must not 500 the /me page. Log and fall through with owner-
    // only integrations; UX degrades to "No connectors" which is the
    // pre-fix state, not a regression.
    console.error(JSON.stringify({
      audit: 'owner.fetched.nextauth_read_failed',
      error: err instanceof Error ? err.message : String(err),
      ts: new Date().toISOString(),
    }));
  }

  const merged = { ...owner, integrations: [...synthetic, ...(owner.integrations ?? [])] };
  console.log(JSON.stringify({
    audit: 'owner.fetched',
    integrations_count: merged.integrations.length,
    synthetic_from_nextauth,
    ts: new Date().toISOString(),
  }));
  return NextResponse.json(merged);
}

export async function PATCH(req: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch (err) {
    console.warn(JSON.stringify({
      audit: 'owner.config.patch_invalid_json',
      error: err instanceof Error ? err.message : String(err),
      ts: new Date().toISOString(),
    }));
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'expected object body' }, { status: 400 });
  }

  const raw = body as Record<string, unknown>;
  const patch: OwnerAssistantPatch = {};
  for (const k of ALLOWED_FIELDS) {
    if (k in raw) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (patch as any)[k] = raw[k];
    }
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'no allowed fields in patch' }, { status: 400 });
  }

  const updated = updateOwner(patch);
  console.log(JSON.stringify({
    audit: 'owner.config.patched',
    fields: Object.keys(patch),
    ts: new Date().toISOString(),
  }));

  return NextResponse.json(updated);
}

export const dynamic = 'force-dynamic';

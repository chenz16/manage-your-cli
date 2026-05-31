import { NextResponse } from 'next/server';
import { getOwner, updateOwner, type OwnerAssistantPatch } from '@holon/core';

/**
 * /api/v1/me — read + patch the owner assistant config.
 *
 * GET  → full record (fixture baseline + in-memory overrides applied).
 * PATCH → shallow merge a subset of fields. v1 stores in mutable-store;
 *   admin reset wipes overrides.
 *
 * feat/remove-nextauth: NextAuth removed — the dual-source merge against
 * the deleted NextAuth `account` drizzle row is gone. Owner integrations
 * now live solely in `owner.integrations` (mutated by the connector UI
 * / future standalone OAuth flows).
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
  'slack_webhook_url',
  'discord_webhook_url',
  'telegram_bot_token',
  'telegram_chat_id',
  // Note: `name`, `role_label`, `substrate` deliberately excluded from
  // this surface — they're structural and changing them mid-session
  // could break the chat runtime.
];

export async function GET(): Promise<NextResponse> {
  const owner = getOwner();
  console.log(JSON.stringify({
    audit: 'owner.fetched',
    integrations_count: (owner.integrations ?? []).length,
    ts: new Date().toISOString(),
  }));
  return NextResponse.json(owner);
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

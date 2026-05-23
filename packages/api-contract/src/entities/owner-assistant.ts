import { z } from 'zod';
import { idOf } from '../primitives.js';

/* iter-011 Pass #2 Ã¢â‚¬â€ per-kind config tightening.
 *
 * Gmail's post-OAuth entry MUST carry token refs + scope + email +
 * connected_at (Pass #3/#4 rely on the shape). Other kinds keep the
 * loose shape until each integration actually wires up.
 *
 * Stale fixtures from pre-iter-011 dev envs (empty `config: {}` Gmail
 * rows from the old form-add flow) will now fail validation Ã¢â‚¬â€ clear via
 * `POST /api/v1/admin/reset` before the first OAuth round-trip.
 */
export const GmailConfig = z.object({
  /** Opaque pointer to encrypted token-store entry (packages/auth/token-store). */
  access_token_ref: z.string().min(1),
  refresh_token_ref: z.string().min(1),
  /** Unix epoch ms Ã¢â‚¬â€ access-token expiry; refresh fires when now > expires_at. */
  expires_at: z.number().int().nonnegative(),
  /** Space-delimited OAuth scope string Google granted. */
  scope: z.string().min(1),
  /** The Gmail address authorized Ã¢â‚¬â€ shown in /me as "Connected as <email>". */
  email_address: z.string().email(),
  /** Unix epoch ms Ã¢â‚¬â€ when the OAuth handshake completed. */
  connected_at: z.number().int().nonnegative(),
});
export type GmailConfig = z.infer<typeof GmailConfig>;

const LooseConfig = z.record(z.unknown());

/** Flat kind enum Ã¢â‚¬â€ single source of truth for "what may the owner authorize?". */
export const IntegrationKind = z.enum([
  'gmail', 'slack', 'email', 'webhook', 'mcp', 'discord', 'feishu', 'google_meet',
]);
export type IntegrationKind = z.infer<typeof IntegrationKind>;

const GmailLink = z.object({
  kind: z.literal('gmail'),
  label: z.string().min(1),
  config: GmailConfig,
  enabled: z.boolean().default(true),
});

/** Loose branch factory Ã¢â‚¬â€ each non-Gmail kind gets its own discriminator
 *  literal so `z.discriminatedUnion` narrows on `kind`. Same config shape
 *  across all of them until each integration wires up (iter-012+). */
function looseLink<K extends Exclude<IntegrationKind, 'gmail'>>(k: K) {
  return z.object({
    kind: z.literal(k),
    label: z.string().min(1),
    config: LooseConfig.default({}),
    enabled: z.boolean().default(true),
  });
}

/**
 * External-system link held at the owner (CEO) level. Per user 2026-05-17:
 *  authorization to external tools lives at the CEO layer; staff inherit
 *  every integration unless explicitly denied (Staff.denied_skills, or a
 *  future per-staff `denied_integrations` field). iter-011 Pass #2 turned
 *  this from a flat object into a discriminated union so Gmail's
 *  post-OAuth shape is type-tight (see GmailConfig above).
 */
export const IntegrationLink = z.discriminatedUnion('kind', [
  GmailLink,
  looseLink('slack'),
  looseLink('email'),
  looseLink('webhook'),
  looseLink('mcp'),
  looseLink('discord'),
  looseLink('feishu'),
  looseLink('google_meet'),
]);
export type IntegrationLink = z.infer<typeof IntegrationLink>;

export const OptionalFeature = z.enum([
  'todo',
  'deliverables',
  'skills',
  'references',
  'templates',
  'voice',
]);
export type OptionalFeature = z.infer<typeof OptionalFeature>;

/** Narrow an `IntegrationLink` to the Gmail variant. Use at every read
 *  site that needs `config.email_address` / `config.access_token_ref`
 *  etc. Ã¢â‚¬â€ avoids `as` casts; consumed by Pass #3 + #4. */
export function isGmailLink(
  link: IntegrationLink,
): link is Extract<IntegrationLink, { kind: 'gmail' }> {
  return link.kind === 'gmail';
}

/**
 * Owner assistant Ã¢â‚¬â€ special "Myself (Desk AI)" surface per ADR-013.
 *
 * Not part of the flat roster (no Staff record); a singleton attached to
 * the desk that the chat surface anchors to. The shape mirrors a staff
 * record's substrate.local_ai variant.
 *
 * iter-007 step 6: extended with owner-identity fields (who the human
 * owner is Ã¢â‚¬â€ name, role, self-intro) + assistant persona (system prompt)
 * + skill catalogue + upstream peer link. All extensions optional so old
 * fixtures keep parsing. Mirror of mibusy's CEO sheet pattern, adapted
 * to Holon's data model.
 */
export const OwnerAssistant = z.object({
  id: idOf('staff'), // uses staff_ prefix even though not in the roster
  name: z.string().min(1),
  role_name: z.literal('owner_assistant'),
  role_label: z.string().min(1),
  substrate: z.object({
    kind: z.literal('local_ai'),
    agent_profile_id: z.string().min(1),
    tool_scope: z.array(z.string()),
  }),

  // Ã¢â€â‚¬Ã¢â€â‚¬ Owner identity (the human) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  /** Owner's display name, e.g. "Chen Zhang" or whatever you go by. */
  owner_name: z.string().optional(),
  /** Owner's role/title, e.g. "Director Ã¢â‚¬â€ E2E AV". */
  owner_role: z.string().optional(),
  /** Free-text self-intro / who-you-are. Injected into chat context so
   *  the desk AI talks to you like you (not generic). */
  owner_intro: z.string().optional(),

  // Ã¢â€â‚¬Ã¢â€â‚¬ Assistant persona Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  /** "Soul" of the desk AI Ã¢â‚¬â€ work style, tone, focus areas. Shapes
   *  every reply via the CLI context hook. */
  system_prompt: z.string().optional(),

  // Ã¢â€â‚¬Ã¢â€â‚¬ Workspace + budget Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  /** Absolute path the worker sandbox `cd`s into for file ops. */
  workspace_dir: z.string().optional(),
  /** Monthly budget cap in millicents (1Ã‚Â¢ = 1000 mc). */
  monthly_budget_mc: z.number().int().nonnegative().optional(),

  // Ã¢â€â‚¬Ã¢â€â‚¬ Skills the assistant + all staff inherit Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  skills: z.array(z.object({
    name: z.string().min(1),
    description: z.string().min(1),
    body: z.string().min(1),
  })).optional(),

  // Ã¢â€â‚¬Ã¢â€â‚¬ Upstream peer (owner's own peer link to a higher-level desk) Ã¢â€â‚¬Ã¢â€â‚¬
  upstream_connection_id: idOf('conn').optional(),
  upstream_display_name: z.string().optional(),

  // Ã¢â€â‚¬Ã¢â€â‚¬ iter-017 Phase A: language preference Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  /** Owner's preferred UI language. Unset = auto-detect from
   *  navigator.language at render time (see @holon/core
   *  getEffectiveLanguage). Phase A persists the value only Ã¢â‚¬â€ actual
   *  UI string locale-switching deferred to V1.1 iter-017 Pass (full
   *  i18n framework with t() + locale lazy-loading). */
  language_preference: z.enum(['en', 'zh-CN', 'auto']).optional(),

  /** Optional feature modules hidden by the owner. Missing/empty means
   *  every optional module is visible. Core modules are never toggleable:
   *  chat, members, and connectors. */
  hidden_features: z.array(OptionalFeature).default([]),

  stt_provider: z.enum(['openai', 'sensevoice', 'whisper_cpp', 'faster_whisper']).nullable().optional(),
  stt_server_url: z.string().nullable().optional(),
  sensevoice_url: z.string().nullable().optional(),
  stt_openai_api_key: z.string().nullable().optional(),
  tts_provider: z.enum(['cosyvoice', 'openai']).nullable().optional(),
  tts_server_url: z.string().nullable().optional(),
  tts_openai_api_key: z.string().nullable().optional(),

  // Voice connector config
  /** Optional auxiliary voice connector settings. Chat intelligence stays in the subscribed CLI. */
  // Ã¢â€â‚¬Ã¢â€â‚¬ ADR-038: CEO remote-terminal channel user-ids Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  /** The CEO's own Telegram user id (numeric, stored as string). When set,
   *  any message from this sender to the bot is routed to the Desk AI chat
   *  session (CEO remote-terminal path) rather than the Mission inbox.
   *  Obtain via @userinfobot or from `from.id` in any message the CEO sends.
   *  Leave unset to disable the CEO bridge (all messages Ã¢â€ â€™ Mission inbox). */
  // Ã¢â€â‚¬Ã¢â€â‚¬ Voice STT engine (local open-source connectors) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  /** Which Speech-to-Text backend to use. Legacy 'openai' is retained for
   *  older owner records; the /connectors UI now configures local open-source
   *  engines: whisper_cpp, sensevoice, or faster_whisper. Actual transcription
   *  consumption for the new engines is wired in a later task. */
  // Ã¢â€â‚¬Ã¢â€â‚¬ Voice TTS engine (local open-source + OpenAI cloud) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  /** Which Text-to-Speech backend to use. 'cosyvoice' is the local/private
   *  connector slot; the WSL installer currently uses a Kokoro fallback because
   *  CosyVoice is not a clean no-sudo uv install. */
  // Ã¢â€â‚¬Ã¢â€â‚¬ iter-009: external integrations (CEO-level, staff inherit) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  /** Per user 2026-05-17: all external tool auth is held by the CEO;
   *  staff use them through the Desk AI. To restrict a staff from a
   *  specific integration in V2+, add a `denied_integrations: string[]`
   *  field on Staff (kind:label pair as the id). For V1, no per-staff
   *  denial Ã¢â‚¬â€ staff inherit everything here. */
  integrations: z.array(IntegrationLink).default([]),
});
export type OwnerAssistant = z.infer<typeof OwnerAssistant>;

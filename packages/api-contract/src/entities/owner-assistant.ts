import { z } from 'zod';
import { idOf } from '../primitives.js';

/* iter-011 Pass #2 — per-kind config tightening.
 *
 * Gmail's post-OAuth entry MUST carry token refs + scope + email +
 * connected_at (Pass #3/#4 rely on the shape). Other kinds keep the
 * loose shape until each integration actually wires up.
 *
 * Stale fixtures from pre-iter-011 dev envs (empty `config: {}` Gmail
 * rows from the old form-add flow) will now fail validation — clear via
 * `POST /api/v1/admin/reset` before the first OAuth round-trip.
 */
export const GmailConfig = z.object({
  /** Opaque pointer to encrypted token-store entry (packages/auth/token-store). */
  access_token_ref: z.string().min(1),
  refresh_token_ref: z.string().min(1),
  /** Unix epoch ms — access-token expiry; refresh fires when now > expires_at. */
  expires_at: z.number().int().nonnegative(),
  /** Space-delimited OAuth scope string Google granted. */
  scope: z.string().min(1),
  /** The Gmail address authorized — shown in /me as "Connected as <email>". */
  email_address: z.string().email(),
  /** Unix epoch ms — when the OAuth handshake completed. */
  connected_at: z.number().int().nonnegative(),
});
export type GmailConfig = z.infer<typeof GmailConfig>;

const LooseConfig = z.record(z.unknown());

/** Flat kind enum — single source of truth for "what may the owner authorize?". */
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

/** Loose branch factory — each non-Gmail kind gets its own discriminator
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

/** Narrow an `IntegrationLink` to the Gmail variant. Use at every read
 *  site that needs `config.email_address` / `config.access_token_ref`
 *  etc. — avoids `as` casts; consumed by Pass #3 + #4. */
export function isGmailLink(
  link: IntegrationLink,
): link is Extract<IntegrationLink, { kind: 'gmail' }> {
  return link.kind === 'gmail';
}

/**
 * Owner assistant — special "Myself (Desk AI)" surface per ADR-013.
 *
 * Not part of the flat roster (no Staff record); a singleton attached to
 * the desk that the chat surface anchors to. The shape mirrors a staff
 * record's substrate.local_ai variant.
 *
 * iter-007 step 6: extended with owner-identity fields (who the human
 * owner is — name, role, self-intro) + assistant persona (system prompt)
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

  // ── Owner identity (the human) ────────────────────────────────────
  /** Owner's display name, e.g. "Chen Zhang" or whatever you go by. */
  owner_name: z.string().optional(),
  /** Owner's role/title, e.g. "Director — E2E AV". */
  owner_role: z.string().optional(),
  /** Free-text self-intro / who-you-are. Injected into chat context so
   *  the desk AI talks to you like you (not generic). */
  owner_intro: z.string().optional(),

  // ── Assistant persona ─────────────────────────────────────────────
  /** "Soul" of the desk AI — work style, tone, focus areas. Shapes
   *  every reply via the pre_llm_call hook. */
  system_prompt: z.string().optional(),

  // ── Workspace + budget ────────────────────────────────────────────
  /** Absolute path the worker sandbox `cd`s into for file ops. */
  workspace_dir: z.string().optional(),
  /** Monthly budget cap in millicents (1¢ = 1000 mc). */
  monthly_budget_mc: z.number().int().nonnegative().optional(),

  // ── Skills the assistant + all staff inherit ──────────────────────
  skills: z.array(z.object({
    name: z.string().min(1),
    description: z.string().min(1),
    body: z.string().min(1),
  })).optional(),

  // ── Upstream peer (owner's own peer link to a higher-level desk) ──
  upstream_connection_id: idOf('conn').optional(),
  upstream_display_name: z.string().optional(),

  // ── iter-017 Phase A: language preference ─────────────────────────
  /** Owner's preferred UI language. Unset = auto-detect from
   *  navigator.language at render time (see @holon/core
   *  getEffectiveLanguage). Phase A persists the value only — actual
   *  UI string locale-switching deferred to V1.1 iter-017 Pass (full
   *  i18n framework with t() + locale lazy-loading). */
  language_preference: z.enum(['en', 'zh-CN', 'auto']).optional(),

  stt_provider: z.enum(['openai', 'sensevoice', 'whisper_cpp', 'faster_whisper']).optional(),
  stt_server_url: z.string().optional(),
  sensevoice_url: z.string().optional(),
  tts_provider: z.enum(['cosyvoice', 'openai']).optional(),
  tts_server_url: z.string().optional(),

  // ── iter-018 Phase A: active LLM provider (global single-provider) ─
  /** Which provider the desk + all staff currently route LLM calls
   *  through. Unset ⇒ resolver falls through to `holon-deepseek-trial`
   *  (or legacy DEEPSEEK_API_KEY env per AC-9). Phase A is one global
   *  active provider for the whole desk — per-staff `preferred_provider`
   *  is deferred to Phase B per owner directive 2026-05-19T~19:42Z.
   *  Discriminated against `PROVIDER_CATALOG` IDs in
   *  `packages/api-contract/src/entities/llm-providers.ts`. */
  // ── ADR-038: CEO remote-terminal channel user-ids ─────────────────
  /** The CEO's own Telegram user id (numeric, stored as string). When set,
   *  any message from this sender to the bot is routed to the Desk AI chat
   *  session (CEO remote-terminal path) rather than the Mission inbox.
   *  Obtain via @userinfobot or from `from.id` in any message the CEO sends.
   *  Leave unset to disable the CEO bridge (all messages → Mission inbox). */
  // ── Voice STT engine (local open-source connectors) ───────────────
  /** Which Speech-to-Text backend to use. Legacy 'openai' is retained for
   *  older owner records; the /connectors UI now configures local open-source
   *  engines: whisper_cpp, sensevoice, or faster_whisper. Actual transcription
   *  consumption for the new engines is wired in a later task. */
  // ── Voice TTS engine (local open-source + OpenAI cloud) ───────────
  /** Which Text-to-Speech backend to use. 'cosyvoice' is the local/private
   *  connector slot; the WSL installer currently uses a Kokoro fallback because
   *  CosyVoice is not a clean no-sudo uv install. */
  // ── iter-009: external integrations (CEO-level, staff inherit) ────
  /** Per user 2026-05-17: all external tool auth is held by the CEO;
   *  staff use them through the Desk AI. To restrict a staff from a
   *  specific integration in V2+, add a `denied_integrations: string[]`
   *  field on Staff (kind:label pair as the id). For V1, no per-staff
   *  denial — staff inherit everything here. */
  integrations: z.array(IntegrationLink).default([]),
});
export type OwnerAssistant = z.infer<typeof OwnerAssistant>;

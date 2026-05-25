import { z } from 'zod';
import { idOf, zMillicents, zCultivationMaturity, zIsoDateTimeLoose } from '../primitives.js';
import {
  AutonomyLevel,
  GovernanceMode,
  StaffStatus,
  MentorInvocationPolicy,
} from '../enums.js';

/**
 * Mentor peer — ADR-016. A peer connection attached to a local-AI staff
 * member as an external advisor. Distillation knob is V2+; for V1 the
 * flag exists but enforcement is logging-only.
 */
const Mentor = z.object({
  peer_id: idOf('conn'),
  domain: z.string().min(1),
  invocation_policy: MentorInvocationPolicy,
  distillation_enabled: z.boolean(),
});
export type Mentor = z.infer<typeof Mentor>;

/** Cultivation log entry — record of mentor consultations (V1 logging-only). */
const CultivationLogEntry = z.object({
  kind: z.literal('mentor_consultation'),
  mentor_peer_id: idOf('conn'),
  topic: z.string(),
  consulted_at: zIsoDateTimeLoose,
  summary: z.string(),
  outcome: z.enum(['applied', 'ignored', 'partial']),
});
export type CultivationLogEntry = z.infer<typeof CultivationLogEntry>;

const CultivationProfile = z.object({
  cultivation_log: z.array(CultivationLogEntry).default([]),
});

/** Budget cap on a local-AI substrate. */
const Budget = z.object({
  max_tokens: z.number().int().positive(),
  max_cost_millicents: zMillicents,
});

/** Substrate variants — ADR-015 (`local_ai | cli | peer`) refined by
 *  ADR-029 Option A (introduce `cli_agent`, deprecate `cli`).
 *
 *  Phase A (`60535bf`): added the `'cli_agent'` literal to `SubstrateKind`,
 *  kept `'cli'` as backwards-compat alias, removed the lone `gh-cli`
 *  dumb-utility fixture. Deferred the union-variant flip because
 *  introducing `SubstrateCliAgent` would have broken the MembersClient.tsx
 *  type-narrowing collision while a P0 hotfix was in-flight on the same
 *  file.
 *
 *  Phase B (this commit): adds the `SubstrateCliAgent` variant to the
 *  discriminated union (canonical kind `'cli_agent'`, shape mirrors
 *  `SubstrateCli` 1:1 — binary + args_template + approval_rules) and
 *  migrates the three known consumers (`MembersClient.tsx`,
 *  `owner-adapter.ts`, `cli-session-service.ts` — `today-service.ts`
 *  only narrows on `local_ai` / `peer` so no edit needed) to accept
 *  BOTH `'cli'` and `'cli_agent'` literals during the alias window.
 *
 *  V2 removal (deferred): drop `SubstrateCli` + the `'cli'` literal from
 *  `SubstrateKind` once every persisted fixture / on-disk store / network
 *  payload has been re-written to `'cli_agent'`. See ADR-029 § 8 for the
 *  cutover gate. */
const SubstrateLocalAi = z.object({
  kind: z.literal('local_ai'),
  agent_profile_id: z.string().min(1),
  tool_scope: z.array(z.string()).default([]),
  budget: Budget.optional(),
  mentors: z.array(Mentor).optional(),
});

const CliApprovalRule = z.object({
  operation_pattern: z.string().min(1),
  require_approval: z.boolean(),
});

/**
 * Legacy `cli` substrate — per ADR-015 the original spelling for what
 * ADR-029 Option A renames to `cli_agent` (LLM-driven CLI coding agents:
 * Claude Code, Codex, Aider).
 *
 * @deprecated Per ADR-029 Option A — write `kind: 'cli_agent'` (see
 * `SubstrateCliAgent` below) in new code/fixtures. The `'cli'` literal is
 * retained through V1.x as a backwards-compat alias for any unmigrated
 * persisted fixture / on-disk store rows; full removal lands in V2 once
 * every consumer has been verified to handle `'cli_agent'` end-to-end
 * (ADR-029 § 8 cutover gate).
 *
 * NOTE: The pre-ADR-029 conflated reading of `kind: 'cli'` ("dumb shell
 * wrappers like ffmpeg / gh") is NOT supported on this substrate any
 * more — those records were removed from the fixture set in Phase A
 * (`60535bf`) and defer to the future tool/MCP layer per ADR-030+. The
 * single field shape (binary + args_template + approval_rules) survived
 * only because an LLM coding-agent session ALSO needs a binary path + arg
 * template.
 */
const SubstrateCli = z.object({
  kind: z.literal('cli'),
  binary: z.string().min(1),
  args_template: z.string().min(1),
  approval_rules: z.array(CliApprovalRule).default([]),
});

/**
 * Canonical CLI-agent substrate — ADR-029 Option A § 2 rename of
 * `SubstrateCli`. Same field shape (binary + args_template +
 * approval_rules); the only difference is the discriminator literal.
 * New code, fixtures, and persisted rows should write `kind: 'cli_agent'`;
 * consumers must currently accept BOTH `'cli'` and `'cli_agent'` while
 * the alias window is open (see `SubstrateCli` @deprecated note).
 *
 * `args_template` is optional (defaults to '') — Claude Code / Codex
 * agents can be launched with no extra args; the template can be set
 * later via PATCH. The legacy `SubstrateCli` retains `min(1)` for
 * backwards-compat with existing persisted rows.
 */
const SubstrateCliAgent = z.object({
  kind: z.literal('cli_agent'),
  binary: z.string().min(1),
  args_template: z.string().default(''),
  approval_rules: z.array(CliApprovalRule).default([]),
  /** CLI-only v2 lifecycle. Short agents are ephemeral and disappear from the
   *  active roster on retire; long agents keep their soul/workspace and remain
   *  archived/restorable. Defaults to short for old rows and connector-created
   *  cli_agent staff that predate this field. */
  lifecycle: z.enum(['short', 'long']).default('short'),
  /** ADR-040: working directory the agent runs in — also its de-facto
   *  permission boundary (owner-selected at creation). */
  cwd: z.string().optional(),
  /** ADR-040: auto-launch `binary args_template` in the session on start so the
   *  owner doesn't type it (full automation, e.g. `claude
   *  --dangerously-skip-permissions`). Defaults to ON when a binary is set;
   *  falls back to a bash shell if the binary exits/missing. */
  auto_launch: z.boolean().optional(),
  /** ADR-040 mode B: attach to an EXISTING owner-run tmux session by name
   *  instead of creating one. When set, Holon pipes I/O to that session and
   *  does NOT new-session / auto-launch / kill it. (Requires the session to
   *  already exist; the CLI is whatever the owner is running in it.) */
  external_session: z.string().optional(),
});

const SubstratePeer = z.object({
  kind: z.literal('peer'),
  connection_id: idOf('conn'),
  remote_staff_name: z.string().min(1),
});

const Substrate = z.discriminatedUnion('kind', [
  SubstrateLocalAi,
  SubstrateCli,
  SubstrateCliAgent,
  SubstratePeer,
]);
/** Zod schema for Substrate — exported for runtime validation (e.g. API route
 *  parsing the connectors cli_agent create flow). */
export const SubstrateSchema = Substrate;
export type Substrate = z.infer<typeof Substrate>;

/* iter-009: virt agent config.
 *
 * Authorization model per user 2026-05-17:
 *   "那个授权主要都是在 CEO 那边弄 最多每个 agent 员工有哪些
 *    不授权 不用单独弄授权"
 *
 * The owner (a.k.a. Desk AI / CEO) holds ALL authority by default —
 * every skill, every integration, every connector. Per-staff config
 * is a DENY-LIST, not an allow-list:
 *   - `denied_skills`: skill ids this staff is forbidden to invoke
 *     (empty = inherits everything from the owner)
 *   - integrations live at the desk/owner level (`OwnerAssistant`),
 *     not per-staff. No per-staff `integrations[]` field.
 *
 * Two non-authorization fields are still per-staff:
 *   - `monthly_budget_millicents`: spend cap (not authority — capacity)
 *   - `proxy_staff_id`: offline-proxy fallback */

/**
 * Staff — a member of a desk's flat roster.
 *
 * Per local-agent-management.md § 11 (V1 subset; full schema lands in
 * packages/core1-types later).
 *
 * The owner (a.k.a. "myself") is NOT a staff record per ADR-015 — they
 * live in `my_work_queue` (see work-queue-item.ts) instead.
 */
export const Staff = z.object({
  id: idOf('staff'),
  desk_id: idOf('desk'),
  name: z.string().min(1),
  role_name: z.string().min(1),
  role_label: z.string().min(1),
  substrate: Substrate,
  autonomy_level: AutonomyLevel,
  governance_mode: GovernanceMode,
  status: StaffStatus,
  current_jobs: z.number().int().nonnegative(),
  max_concurrent_jobs: z.number().int().nonnegative(),
  cultivation_maturity: zCultivationMaturity,
  cultivation_profile: CultivationProfile.optional(),
  /** Per-staff persona / work style. Injected into the worker's system
   *  prompt when the dispatcher sends a task to this staff's CLI session.
   *  Added iter-007 step 7 (create/update/dismiss staff from chat).
   *  Optional → backward-compatible with existing fixture rows. */
  system_prompt: z.string().optional(),
  /** Optional custom avatar as a data URL (small, client-resized ~128px). When
   *  absent the UI renders a generated gradient + initial. Capped server-side. */
  avatar_data: z.string().max(300_000).optional(),
  created_at: zIsoDateTimeLoose.optional(),

  /* ── iter-009: virt agent config (deny-list model) ──────────── */

  /** Skill ids from the owner skill catalog this staff is FORBIDDEN
   *  to invoke. Empty array (default) = this staff inherits every
   *  skill the owner has. The dispatcher must check this list before
   *  surfacing a skill option or executing a skill tool call.
   *  Source of truth for skill ids: `packages/core/src/skill-catalog.ts`
   *  SKILL_CATALOG. */
  denied_skills: z.array(z.string()).default([]),

  /** Per-staff per-month spend cap, in millicents. null/undefined =
   *  no cap (inherits desk-level cap if/when that exists). Capacity
   *  control, not authorization. */
  monthly_budget_millicents: zMillicents.nullable().optional(),

  /** Offline proxy — if this staff stalls 30+ min, this other staff
   *  picks up its queue. Mirrors mibusy's `proxy_agent_id`. */
  proxy_staff_id: idOf('staff').nullable().optional(),

  /** iter-012 Pass #4: free-form labels for sorting + UI affordances. The
   *  V1 use case is `'suggested'` — staff seeded by apply-persona that the
   *  owner hasn't explicitly hired yet. The UI may dim / decorate them.
   *  Empty array = no labels (default; preserves backward-compat). */
  tags: z.array(z.string()).default([]),

  /** Phase 1 project tags — IDs of projects this staff primarily works on.
   *  Empty array = shared/cross-project (visible in all project views).
   *  Default `[]` preserves backward-compat: existing rows without this
   *  field parse with an empty set (no project affiliation). */
  project_ids: z.array(idOf('proj')).default([]),
});
export type Staff = z.infer<typeof Staff>;

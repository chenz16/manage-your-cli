import { z } from 'zod';
import { idOf, zPriorityInt } from '../primitives.js';

/**
 * Skill API-contract types — Zod schemas for the Skill entity as it appears
 * in BFF responses. This is the API-contract layer; the runtime catalog
 * (SkillDescriptor) lives in packages/core/src/skill-catalog.ts.
 *
 * Per ADR-032 Decision 1: skills have a `kind` discriminator that splits the
 * union into TaskSkill (existing behavior) and TriageSkill (new in iter-020).
 *
 * Extension point: iter-021 adds `"interview"` to SkillBehaviorKind below.
 * Do NOT collapse this to a non-extensible Zod enum without a follow-on ADR.
 *
 * // Extension point: iter-021 adds "interview" to SkillBehaviorKind.
 */

// ---------------------------------------------------------------------------
// SkillBehaviorKind — the discriminator between task and triage skills.
// Note: "kind" already exists on SkillDescriptor in packages/core as the
// UI category ('office' | 'media' | ...). This field on the API-contract
// Skill is a DIFFERENT axis — it discriminates behavior, not category.
// Named SkillBehaviorKind to avoid confusion.
// ---------------------------------------------------------------------------

/**
 * Discriminates between task-executing skills and triage-rule skills.
 *
 * - `"task"`   — the existing kind; skills that perform work on behalf of the
 *               owner / staff. All pre-iter-020 skills are task skills.
 * - `"triage"` — new in iter-020; skills that evaluate inbound_request Todos
 *               and emit a TriageDecision (auto_accept, auto_decline,
 *               surface_to_owner, or pass).
 *
 * // Extension point: iter-021 adds "interview" here. Additive-only.
 */
export const SkillBehaviorKind = z.enum([
  'task',
  'triage',
  // "interview" — iter-021 extension point; do not add other values here
  //               without a follow-on ADR.
]);
export type SkillBehaviorKind = z.infer<typeof SkillBehaviorKind>;

// ---------------------------------------------------------------------------
// TriagePreFilter — optional synchronous pre-screen before LLM invocation.
// Per ADR-032 Decision 1 § pre_filter and built-in pack table.
// Matching is AND-logic: all present fields must match for the filter to pass.
// ---------------------------------------------------------------------------

/**
 * Synchronous pre-screen run before the LLM skill invocation.
 * All fields are optional; absent field = wildcard (always matches).
 *
 * Matching semantics:
 *   sender         — match sender display name or connection id (exact or glob)
 *   urgency        — match the urgency axis declared on the inbound handoff
 *   subject_contains — at least one of the listed strings must appear in the
 *                     mission title/body (case-insensitive substring)
 *
 * Per ADR-032: pre_filter short-circuits LLM invocation for obvious-match
 * cases (e.g. urgency=urgent → always surface). If the filter does NOT match,
 * this skill is skipped entirely (no LLM call). If the filter matches (or is
 * absent), the LLM system_prompt is invoked.
 */
export const TriagePreFilter = z.object({
  /**
   * Sender name/id to match. Supports exact string, `"*"` wildcard, or a
   * `"trusted_group:<label>"` group reference resolved at dispatch time.
   * Absent = any sender.
   */
  sender: z.string().optional(),
  /**
   * Urgency level on the inbound handoff.
   * Absent = any urgency level.
   */
  urgency: z.enum(['urgent', 'normal', 'low']).optional(),
  /**
   * At least one of these strings must appear in the mission title or body
   * (case-insensitive substring match).
   * Absent = no subject filter.
   */
  subject_contains: z.array(z.string()).optional(),
});
export type TriagePreFilter = z.infer<typeof TriagePreFilter>;

// ---------------------------------------------------------------------------
// TriageDecision — the four outcomes a triage skill may emit.
// Per ADR-032 Decision 1.
// ---------------------------------------------------------------------------

/**
 * `auto_accept` — TriageDispatcher accepts the mission on the owner's behalf.
 *
 * - `assign_to_staff_id`: optional staff member to route the work to
 *   immediately after acceptance. If absent, the mission lands in the inbox
 *   unassigned.
 * - `reasoning`: human-readable explanation (shown in audit log + UI badge).
 */
export const TriageDecisionAutoAccept = z.object({
  kind: z.literal('auto_accept'),
  assign_to_staff_id: idOf('staff').optional(),
  reasoning: z.string().min(1),
});
export type TriageDecisionAutoAccept = z.infer<typeof TriageDecisionAutoAccept>;

/**
 * `auto_decline` — TriageDispatcher sends a polite decline on the owner's
 * behalf. Ships disabled by default per ADR-032 conservative posture.
 *
 * - `decline_template_ref`: optional reference id of the polite-decline
 *   message template to send to the peer. If absent, a generic decline is sent.
 * - `reasoning`: explanation for audit + UI.
 */
export const TriageDecisionAutoDecline = z.object({
  kind: z.literal('auto_decline'),
  decline_template_ref: z.string().optional(),
  reasoning: z.string().min(1),
});
export type TriageDecisionAutoDecline = z.infer<typeof TriageDecisionAutoDecline>;

/**
 * `surface_to_owner` — mission is placed in the owner's inbox for manual
 * triage, optionally at elevated priority. This is the same as the current
 * pre-triage behavior (Rule #6 baseline).
 *
 * - `surface_priority`: `"high"` elevates the mission badge in the inbox;
 *   `"normal"` is default behavior.
 * - `reasoning`: explanation for audit + UI.
 */
export const TriageDecisionSurfaceToOwner = z.object({
  kind: z.literal('surface_to_owner'),
  surface_priority: z.enum(['high', 'normal']).default('normal'),
  reasoning: z.string().min(1),
});
export type TriageDecisionSurfaceToOwner = z.infer<typeof TriageDecisionSurfaceToOwner>;

/**
 * `pass` — this skill does not apply to the current mission; the dispatcher
 * tries the next skill in priority order. If all skills pass, the fallback
 * `surface_to_owner` applies (Rule #6 floor).
 *
 * - `reasoning`: why this skill did not match (aids debugging).
 */
export const TriageDecisionPass = z.object({
  kind: z.literal('pass'),
  reasoning: z.string().min(1),
});
export type TriageDecisionPass = z.infer<typeof TriageDecisionPass>;

/**
 * Union of all four triage outcomes. Discriminated on `kind`.
 * Per ADR-032 Decision 1.
 */
export const TriageDecision = z.discriminatedUnion('kind', [
  TriageDecisionAutoAccept,
  TriageDecisionAutoDecline,
  TriageDecisionSurfaceToOwner,
  TriageDecisionPass,
]);
export type TriageDecision = z.infer<typeof TriageDecision>;

// ---------------------------------------------------------------------------
// TaskSkill — the existing skill shape with the explicit kind discriminant.
// All pre-iter-020 skills are task skills. The `kind` field defaults to
// `"task"` so existing data and fixtures validate without modification.
// ---------------------------------------------------------------------------

/**
 * TaskSkill — an owner capability invoked inline by the Desk AI.
 * This is the api-contract representation; the runtime catalog shape
 * (SkillDescriptor) lives in packages/core/src/skill-catalog.ts.
 *
 * The `kind: "task"` field defaults to `"task"` for backwards-compatibility:
 * existing Skill objects that omit `kind` validate as task skills.
 */
export const TaskSkill = z.object({
  /** Stable kebab-case id. */
  id: z.string().min(1),
  /**
   * Behavior discriminator.
   * Defaults to `"task"` — all pre-iter-020 skills are task skills.
   * Existing fixtures / API responses that omit this field still validate.
   */
  kind: SkillBehaviorKind.default('task'),
  /** Owner-facing name (1-3 words). */
  name: z.string().min(1),
  /** One-line description of what the skill does. */
  tagline: z.string().min(1),
  /** Emoji or single-char glyph for the UI card. */
  icon: z.string().optional(),
  /** UI category ('office' | 'media' | 'engineering' | 'communication' | 'research' | 'ops').
   *  Distinct from `kind` — this is the visual grouping, not the behavior discriminator. */
  category: z.string().optional(),
  /** Fine-grained tags for chip filters / search. */
  tags: z.array(z.string()).default([]),
  /** Longer description shown in the skill detail view. */
  description: z.string().min(1),
  /** Example chat invocations the owner can click to prefill the composer. */
  examples: z.array(z.string()).default([]),
  /** Skill ids this skill invokes during execution (plan-and-execute chains). */
  calls: z.array(z.string()).optional(),
  /** Reference ids this skill consults for output format / content. */
  consults: z.array(z.string()).optional(),
  /** True if the tool backing this skill is wired. */
  implemented: z.boolean().default(false),
});
export type TaskSkill = z.infer<typeof TaskSkill>;

// ---------------------------------------------------------------------------
// TriageSkill — new in iter-020. Triage-specific fields per ADR-032 Decision 1.
// ---------------------------------------------------------------------------

/**
 * TriageSkill — a triage rule implemented as a skill.
 * Per ADR-032 Decision 1: "triage rules are implemented as skills with
 * `kind: 'triage'`".
 *
 * Triage skills are evaluated in priority order (highest first) by the
 * TriageDispatcher on each inbound_request Mission. The first skill that
 * does not emit `pass` terminates the chain.
 */
export const TriageSkill = z.object({
  /** Stable kebab-case id. */
  id: z.string().min(1),
  /** Behavior discriminator — must be `"triage"` for this variant. */
  kind: z.literal('triage'),
  /** Owner-facing name. */
  name: z.string().min(1),
  /** One-line description shown in the /skills Triage Rules section. */
  description: z.string().min(1),
  /**
   * Execution priority: 0–100. Higher = evaluated first by the dispatcher.
   * Built-in pack defaults: urgent-surface=95, untrusted-decline=80,
   * known-peer-accept=60, fallback-surface=0.
   * Owner custom rules typically land 61–79 (below urgency, above fallback).
   */
  priority: zPriorityInt,
  /**
   * Whether the rule is currently active. Toggled without deletion.
   * `triage-from-untrusted-decline` ships disabled by default (ADR-032
   * conservative posture — owner must affirmatively enable auto-decline).
   */
  enabled: z.boolean().default(true),
  /**
   * Optional LLM system prompt for rule invocation. If provided, the
   * TriageDispatcher calls the LLM with this system prompt to determine
   * the TriageDecision. Expected response: TriageDecision JSON.
   * If absent, the `pre_filter` alone determines the decision (if matched,
   * the skill emits `surface_to_owner` as a safe default — no LLM call).
   */
  system_prompt: z.string().optional(),
  /**
   * Optional synchronous pre-screen. Runs BEFORE any LLM invocation.
   * If the pre-filter does NOT match the mission → skill is skipped (pass).
   * If the pre-filter matches (or is absent) → LLM invocation (or safe default).
   * Optimization: avoids LLM calls for obvious-match rules (e.g. urgency=urgent).
   */
  pre_filter: TriagePreFilter.optional(),
  /**
   * Restricts which decisions this skill is allowed to emit.
   * The TriageDispatcher enforces this allowlist — if the LLM returns a
   * decision kind not in this list, it is treated as `pass` (safe degradation).
   * `"pass"` is always implicitly allowed regardless of this list.
   * If empty, all decisions are allowed.
   */
  allowed_decisions: z.array(z.enum(['auto_accept', 'auto_decline', 'surface_to_owner'])).default([]),
});
export type TriageSkill = z.infer<typeof TriageSkill>;

// ---------------------------------------------------------------------------
// Skill — the discriminated union. Used wherever the BFF returns a skill.
// ---------------------------------------------------------------------------

/**
 * Skill — discriminated union of TaskSkill and TriageSkill on the `kind` field.
 *
 * Narrowing pattern:
 *   if (skill.kind === 'triage') { // TriageSkill fields available }
 *   else { // TaskSkill fields available (kind === 'task' or default) }
 *
 * Note: `z.discriminatedUnion` requires each branch to have the discriminant
 * as a required literal. TaskSkill uses `.default('task')` which Zod treats
 * as a required field with a default — discriminated union works correctly.
 */
export const Skill = z.union([TaskSkill, TriageSkill]);
export type Skill = z.infer<typeof Skill>;

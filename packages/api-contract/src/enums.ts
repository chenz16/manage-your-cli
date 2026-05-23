/**
 * Domain enums extracted from the spec set. Source-of-truth references:
 *
 * - substrate kind                → ADR-015 + ADR-029 (`local_ai | cli_agent | peer`;
 *                                   `cli` retained as deprecated alias through V1.x)
 * - autonomy level                → ADR-004 (`Supervised | Bounded | Autonomous`)
 * - staff status                  → local-agent-management.md § 11
 * - mission state                 → data-model.md § 4.8
 * - connection health state       → peer-communication-architecture.md § 12
 * - handoff form                  → handoff-taxonomy.md "The Common Forms"
 * - deliverable status            → deliverable-spec.md § 3 (added in iter-001c)
 * - origin label                  → fixture convention (iter-001a)
 */

import { z } from 'zod';

/**
 * Substrate kind enum.
 *
 * Per ADR-029 Option A (substrate redefinition):
 *   - `cli_agent` — LLM-driven CLI agents (Claude Code, Codex, Aider). This is
 *     the V2 canonical value.
 *   - `cli` — deprecated alias for what `cli_agent` now represents. Retained
 *     through V1.x for backwards-compat with on-disk fixtures and existing
 *     consumers; will be removed in V2. New code should write `cli_agent`.
 *
 * Dumb-utility CLIs (gh wrapper, ffmpeg, build scripts) are NOT a substrate
 * kind any more per ADR-029 § 2 — they defer to the future tool / MCP layer
 * (ADR-030+). The single legacy `kind: 'cli'` fixture (`gh-cli`) was removed
 * in the rename commit; no production data should still hold that value.
 */
export const SubstrateKind = z.enum(['local_ai', 'cli_agent', 'cli', 'peer']);
export type SubstrateKind = z.infer<typeof SubstrateKind>;

export const AutonomyLevel = z.enum(['Supervised', 'Bounded', 'Autonomous']);
export type AutonomyLevel = z.infer<typeof AutonomyLevel>;

export const GovernanceMode = z.enum(['graduated', 'always_supervised']);
export type GovernanceMode = z.infer<typeof GovernanceMode>;

export const StaffStatus = z.enum(['active', 'paused', 'archived']);
export type StaffStatus = z.infer<typeof StaffStatus>;

export const DeskDeviceKind = z.enum(['laptop', 'desktop', 'phone', 'tablet']);
export type DeskDeviceKind = z.infer<typeof DeskDeviceKind>;

export const DeskPresence = z.enum(['online', 'background', 'offline']);
export type DeskPresence = z.infer<typeof DeskPresence>;

export const MissionState = z.enum([
  'queued',
  'accepted',
  'in_progress',
  'blocked',
  'submitted',
  'rejected',
  'expired',
  'returned_to_origin',
]);
export type MissionState = z.infer<typeof MissionState>;

export const ConnectionHealthState = z.enum([
  'healthy',
  'degraded',
  'offline',
  'retrying',
  'revoked',
  'invalid_token',
]);
export type ConnectionHealthState = z.infer<typeof ConnectionHealthState>;

export const HandoffForm = z.enum([
  'direct_order',
  'direct_takeover',
  'approval_chain',
  'dual_authorization',
  'negotiated',
  'advisory',
  'observer_brief',
  'watch_brief',
  'temporary_cover',
  'conditional_engagement',
  'subcontracting',
  'parallel_solicitation',
  'standing_request',
]);
export type HandoffForm = z.infer<typeof HandoffForm>;

export const DeliverableStatus = z.enum(['draft', 'final', 'accepted', 'rejected', 'revised']);
export type DeliverableStatus = z.infer<typeof DeliverableStatus>;

export const DeliverableOrigin = z.enum(['local', 'remote', 'submitted']);
export type DeliverableOrigin = z.infer<typeof DeliverableOrigin>;

export const DeliverableBodyKind = z.enum(['markdown', 'structured']);
export type DeliverableBodyKind = z.infer<typeof DeliverableBodyKind>;

/** Personal work queue item source per ADR-015. */
export const WorkQueueItemSource = z.enum(['own', 'from_mission']);
export type WorkQueueItemSource = z.infer<typeof WorkQueueItemSource>;

/** Chat message role. */
export const ChatMessageRole = z.enum(['user', 'agent']);
export type ChatMessageRole = z.infer<typeof ChatMessageRole>;

/** Recent activity feed event kind (Today screen). */
export const RecentEventKind = z.enum(['submitted', 'connection', 'mission', 'deliverable']);
export type RecentEventKind = z.infer<typeof RecentEventKind>;

/** Mentor invocation policy per ADR-016. */
export const MentorInvocationPolicy = z.enum([
  'owner_picks_per_task',
  'always_consult',
  'never_consult',
]);
export type MentorInvocationPolicy = z.infer<typeof MentorInvocationPolicy>;

/**
 * Triage state for inbound_request Missions (= ADR-035 inbound_request Todos).
 *
 * Per ADR-032 Decision 1 + ADR-036 (Mission IS the V1 inbound_request Todo).
 * Only applies to Missions; absent/undefined on non-inbound entities.
 *
 * - `pending`        — Mission received; TriageDispatcher has not yet run.
 * - `triaging`       — TriageDispatcher is actively evaluating skills.
 * - `triaged`        — TriageDispatcher completed; `triage_decision` is set.
 * - `triage_failed`  — TriageDispatcher encountered an error; mission surfaced
 *                      to owner as a safe fallback (Engineering Rule #4).
 */
export const TriageState = z.enum(['pending', 'triaging', 'triaged', 'triage_failed']);
export type TriageState = z.infer<typeof TriageState>;

/**
 * Mission inbound source — records how a mission entered the desk inbox.
 *
 * - `peer_handoff`   — arrived via a Core 2 typed handoff from a peer desk
 *                      (the default / pre-existing path).
 * - `wechat_paste`   — owner manually pasted WeChat message text into the
 *                      inbox (Phase 1 of iter-022 WeChat integration; per
 *                      ADR-034 § Phase 1 + AC-1.7).
 * - `wechat_live`    — a live WeChat message arrived via the channel-agnostic
 *                      IngressGateway (iter-022 Phase 2; per ADR-037 D3 the
 *                      `channel: 'wechat'` IngressEvent maps to this source).
 *                      Distinct from `wechat_paste` (owner-pasted text):
 *                      `wechat_live` denotes a daemon-delivered message from
 *                      the OpenClaw WeChat adapter. The `_live` suffix is the
 *                      ADR-037 D3 convention for every live-channel source
 *                      (future: `email_live`, …).
 * - `telegram_live`  — a live Telegram message arrived via the
 *                      channel-agnostic IngressGateway (iter-022 Phase 2; per
 *                      ADR-037 D3 the `channel: 'telegram'` IngressEvent maps to
 *                      this source). The Telegram Bot API is public + stable, so
 *                      its adapter is a complete impl
 *                      (no stubbing) — it goes live with just a @BotFather token.
 *                      Distinct from `wechat_live` so the inbox/UI can badge each
 *                      channel separately (the `_live` convention, ADR-037 D3).
 *
 * Additive: new variants may be appended in future iters per ADR-037 D6
 * (each new live channel = one new `<channel>_live` variant here).
 *
 * - `customer_liaison_digest` — a structured digest Mission produced by the
 *   Customer Liaison skill (iter-023 Pass 3). Aggregates multiple `wechat_live`
 *   Missions into 2–5 actionable summary items. Pinned at the top of /inbound.
 *   Not a live-channel source — owner-triggered or scheduled; never per-message.
 */
export const MissionSource = z.enum([
  'peer_handoff',
  'wechat_paste',
  'wechat_live',
  'telegram_live',
  'customer_liaison_digest',
]);
export type MissionSource = z.infer<typeof MissionSource>;

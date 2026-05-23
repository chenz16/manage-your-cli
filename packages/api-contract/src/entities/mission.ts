import { z } from 'zod';
import { idOf, zPriorityInt, zIsoDateTimeLoose } from '../primitives.js';
import { MissionState, HandoffForm, MissionSource, TriageState } from '../enums.js';
import { TriageDecision } from './skill.js';

/**
 * Mission — an inbound handoff that has been accepted (or queued for
 * acceptance) by the receiving desk. Per data-model.md § 4.8.
 */
export const Mission = z.object({
  id: idOf('mission'),
  desk_id: idOf('desk'),
  inbound_handoff_id: idOf('handoff'),
  title: z.string().min(1),
  body: z.string().min(1),
  state: MissionState,
  state_reason: z.string().optional(),
  priority: zPriorityInt,
  sender_display_name: z.string().min(1),
  sender_connection_id: idOf('conn'),
  form: HandoffForm,
  created_at: zIsoDateTimeLoose,

  // Optional lifecycle timestamps — present once the state transition lands.
  accepted_at: zIsoDateTimeLoose.optional(),
  in_progress_at: zIsoDateTimeLoose.optional(),
  blocked_at: zIsoDateTimeLoose.optional(),
  submitted_at: zIsoDateTimeLoose.optional(),
  rejected_at: zIsoDateTimeLoose.optional(),
  expired_at: zIsoDateTimeLoose.optional(),
  returned_to_origin_at: zIsoDateTimeLoose.optional(),

  // Sender-set deadline (handoff axis: timeliness=windowed|scheduled_segment)
  deadline_at: zIsoDateTimeLoose.optional(),

  // Assignment — set once the receiver routes to a staff member.
  // Nullable so fixtures can emit explicit nulls for unassigned rows.
  assigned_staff_id: idOf('staff').nullable().optional(),

  // Inbound source — records how the mission entered the desk inbox.
  // Optional for backwards-compatibility with existing fixtures that
  // pre-date iter-022; absent implies `peer_handoff`.
  source: MissionSource.optional(),

  // ── Triage fields (iter-020 — ADR-032 + ADR-036) ──────────────────
  // All fields are optional for backwards-compatibility: pre-iter-020 missions
  // and fixtures that pre-date triage simply omit these fields.
  //
  // Triage operates on inbound_request Missions only (ADR-036: Mission IS
  // the V1 inbound_request Todo; ADR-032 AQ-1: inbound-routing triage only).
  // For non-inbound missions these fields will always be absent.

  /**
   * Current triage lifecycle state.
   * Absent on pre-iter-020 missions (implies triage has not run).
   */
  triage_state: TriageState.optional(),

  /**
   * ID of the triage skill that determined the outcome.
   * Set after triage completes (`triage_state === "triaged"`).
   *
   * NOTE: TriageSkill ids use kebab-case slugs (e.g. "triage-urgent-surface")
   * per TriageSkill.id schema in skill.ts — NOT the `skill_<base32>` format
   * used by TaskSkill persistent records. Using z.string().min(1) to accept
   * the full id space triage skills actually use (built-in slugs + future
   * user-defined ids). Validated as a TriageSkill id, not a TaskSkill id.
   */
  triage_skill_id: z.string().min(1).optional(),

  /**
   * The TriageDecision that was applied to this mission.
   * Set after triage completes; absent while triaging or if triage_failed.
   */
  triage_decision: TriageDecision.optional(),

  /**
   * ISO-8601 timestamp of when the triage decision was recorded.
   * Used by the undo-window check: undo is valid while
   *   `now - triage_decided_at < undo_window_ms` (default 5 min, per ADR-032).
   */
  triage_decided_at: zIsoDateTimeLoose.optional(),
});
export type Mission = z.infer<typeof Mission>;

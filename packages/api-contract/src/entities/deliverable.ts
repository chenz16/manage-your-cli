import { z } from 'zod';
import { idOf, zIsoDateTimeLoose } from '../primitives.js';
import { DeliverableBodyKind, DeliverableStatus, DeliverableOrigin } from '../enums.js';

/**
 * Deliverable body — discriminated by `body_kind`. Markdown bodies are
 * free-form text; structured bodies are JSON-shaped per the producing
 * tool's convention.
 */
const MarkdownBody = z.object({ markdown: z.string() });
const StructuredBody = z.record(z.string(), z.unknown());

const DeliverableBody = z.union([MarkdownBody, StructuredBody]);
export type DeliverableBody = z.infer<typeof DeliverableBody>;

/**
 * Deliverable — an artifact produced locally, returned by a peer, or
 * submitted upstream. Per deliverable-spec.md § 2.
 */
export const Deliverable = z.object({
  id: idOf('deliv'),
  desk_id: idOf('desk'),
  title: z.string().min(1),
  body_kind: DeliverableBodyKind,
  body: DeliverableBody,
  origin_label: DeliverableOrigin,
  status: DeliverableStatus, // added in iter-001c
  created_at: zIsoDateTimeLoose,

  // Source links — exactly one of these is non-null in a well-formed row
  // (local: source_assignment_id, remote: source_mission_id, submitted:
  //  source_assignment_id + submitted_to_connection_id).
  source_assignment_id: idOf('assign').nullable().optional(),
  source_mission_id: idOf('mission').nullable().optional(),

  // Authorship — exactly one of these is non-null
  author_staff_id: idOf('staff').nullable().optional(),
  author_remote_desk_id: idOf('desk').nullable().optional(),

  // Submission target — present only when origin_label == 'submitted'
  submitted_to_connection_id: idOf('conn').optional(),

  /** Phase 1 — optional project tag. null = untagged/default project.
   *  Existing rows without this field parse as `undefined`, treated as null. */
  project_id: idOf('proj').nullable().optional(),
});
export type Deliverable = z.infer<typeof Deliverable>;

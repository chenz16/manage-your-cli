import { z } from 'zod';
import { idOf, zIsoDateTimeLoose } from '../primitives.js';

/**
 * Project — an optional grouping tag for todos, deliverables, and staff.
 *
 * Phase 1: 7 fields. The single-stream 小老板 with 0 projects sees NO new
 * chrome. The project switcher appears only when `projects.length >= 2`.
 *
 * Per design doc: thin shell — a project is NOT a new engine.
 * It is a named grouping tag (slug + color + archived flag).
 * Memory lives at `MEMORY/projects/<slug>.md` (boss-memory-service,
 * zero new infra).
 *
 * Backward compat: project_id on WorkQueueItem / Deliverable / Staff
 * is nullable/optional. Existing rows parse unchanged.
 */
export const Project = z.object({
  id: idOf('proj'),
  desk_id: idOf('desk'),
  name: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, 'slug must be ^[a-z0-9][a-z0-9-]{0,39}$'),
  color: z.string().optional(),
  archived: z.boolean().default(false),
  created_at: zIsoDateTimeLoose,
});
export type Project = z.infer<typeof Project>;

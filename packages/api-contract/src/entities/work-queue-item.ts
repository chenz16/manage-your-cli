import { z } from 'zod';
import { idOf, zPriorityInt, zIsoDateTimeLoose } from '../primitives.js';
import { WorkQueueItemSource } from '../enums.js';

/**
 * Personal work-queue item — owner's own tasks per ADR-015.
 *
 * Lives in `Today.my_work_queue`, never in the flat staff roster. Created
 * either explicitly by the owner (`source: 'own'`) or by accepting an
 * inbound mission and routing it to themselves rather than to a staff
 * member (`source: 'from_mission'`).
 */
export const WorkQueueItem = z.object({
  id: idOf('pq'),
  title: z.string().min(1),
  body: z.string().min(1),
  source: WorkQueueItemSource,
  priority: zPriorityInt,
  deadline: zIsoDateTimeLoose.optional(),
});
export type WorkQueueItem = z.infer<typeof WorkQueueItem>;

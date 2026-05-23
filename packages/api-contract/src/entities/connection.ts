import { z } from 'zod';
import { idOf, zIsoDateTimeLoose } from '../primitives.js';
import { ConnectionHealthState } from '../enums.js';

/**
 * Connection — a durable peer relationship between two desks.
 *
 * Per peer-communication-architecture.md § 12 (lifecycle + 6 health states)
 * and data-model.md § 4.6.
 */
export const Connection = z.object({
  id: idOf('conn'),
  desk_id: idOf('desk'),
  remote_person_id: idOf('person'),
  display_name: z.string().min(1),
  health_state: ConnectionHealthState,
  last_successful_at: zIsoDateTimeLoose,
  paired_at: zIsoDateTimeLoose,
  remote_desk_capabilities: z.array(z.string()).default([]),

  // Failure tracking — present only when health_state has been non-healthy
  last_failure_at: zIsoDateTimeLoose.optional(),
  last_failure_reason: z.string().optional(),

  // Revocation — present only on health_state == 'revoked'
  revoked_at: zIsoDateTimeLoose.optional(),
  revoked_reason: z.string().optional(),
});
export type Connection = z.infer<typeof Connection>;

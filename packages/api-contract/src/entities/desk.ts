import { z } from 'zod';
import { idOf } from '../primitives.js';
import { DeskDeviceKind, DeskPresence } from '../enums.js';

/** Desk — a device-instance of a person's Holon. Per data-model.md § 4.1. */
export const Desk = z.object({
  id: idOf('desk'),
  person_id: idOf('person'),
  display_name: z.string().min(1),
  device_kind: DeskDeviceKind,
  presence: DeskPresence,
  is_primary: z.boolean(),
  span_of_control_cap: z.number().int().positive(),
});
export type Desk = z.infer<typeof Desk>;

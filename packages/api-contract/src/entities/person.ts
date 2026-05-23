import { z } from 'zod';
import { idOf } from '../primitives.js';

/**
 * Person — the human-or-org identity that owns one or more desks.
 *
 * Per data-model.md § 4.0. In the UI mock fixtures persons are referenced
 * only by ID (not denormalized into their own collection); this schema
 * exists for forward compatibility with the real BFF and to declare the
 * `person_*` ID shape.
 */
export const Person = z.object({
  id: idOf('person'),
  display_name: z.string().min(1),
});
export type Person = z.infer<typeof Person>;

/**
 * Deliverables service — domain layer for the Deliverables screen.
 *
 * Reads fixture data; signatures match what the React client + BFF
 * consume. Real DB-backed listing lands when packages/db arrives.
 */

import type {
  Deliverable,
  ListDeliverablesQuery,
  ListDeliverablesResponse,
  GetDeliverableResponse,
} from '@holon/api-contract';
import {
  ListDeliverablesQuery as ListDeliverablesQuerySchema,
  ListDeliverablesResponse as ListDeliverablesResponseSchema,
  GetDeliverableResponse as GetDeliverableResponseSchema,
} from '@holon/api-contract';
import { z } from 'zod';
import { loadFixtures } from './fixture-store.js';
import { listMutableDeliverables, getMutableDeliverable, deleteMutableDeliverable } from './mutable-store.js';

export type ListDeliverablesQueryInput = z.input<typeof ListDeliverablesQuerySchema>;

export function listDeliverables(query?: ListDeliverablesQueryInput): ListDeliverablesResponse {
  const q = ListDeliverablesQuerySchema.parse(query ?? {});
  const fx = loadFixtures();
  // iter-007 step 5: worker-produced deliverables live in the mutable
  // store; merged here so the /deliverables UI sees them alongside the
  // fixture baseline.
  let items: Deliverable[] = [...listMutableDeliverables(), ...fx.deliverables];
  if (q.origin) items = items.filter((d) => d.origin_label === q.origin);
  if (q.status) items = items.filter((d) => d.status === q.status);
  items.sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''));
  return ListDeliverablesResponseSchema.parse({
    items: items.slice(0, q.limit),
    next_cursor: null,
  });
}

export function getDeliverable(id: string): GetDeliverableResponse | null {
  // Mutable store takes precedence (more recent / worker output).
  const mut = getMutableDeliverable(id);
  if (mut) return GetDeliverableResponseSchema.parse({ deliverable: mut });
  const fx = loadFixtures();
  const d = fx.deliverables.find((x) => x.id === id);
  if (!d) return null;
  return GetDeliverableResponseSchema.parse({ deliverable: d });
}

/**
 * Hard-delete a deliverable. Mutable-store entries are deleted directly.
 * Fixture entries cannot be removed from disk at runtime, so this only
 * operates on the mutable layer; fixture-backed deliverables return false.
 */
export function deleteDeliverable(id: string): boolean {
  return deleteMutableDeliverable(id);
}

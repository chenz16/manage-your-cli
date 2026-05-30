/**
 * Todos service — domain layer for the personal work queue (WorkQueueItem).
 *
 * Phase 1 addition: a dedicated listTodos() that supports project_id
 * filtering (per design doc § 9 item 5). The fixture data comes from
 * `my_work_queue` in the snapshot; a mutable in-memory layer can be
 * added later (same pattern as deliverables-service.ts).
 */

import type { WorkQueueItem } from '@holon/api-contract';
import { loadFixtures } from './fixture-store.js';

export interface ListTodosInput {
  /** When set, return only items tagged to this project.
   *  null / undefined = return all items ("All" view). */
  project_id?: string | null;
}

export function listTodos(input?: ListTodosInput): WorkQueueItem[] {
  const fx = loadFixtures();
  let items: WorkQueueItem[] = [...fx.my_work_queue];

  // Phase 1: project_id filter — strict per-project view.
  // Untagged items (project_id == null/undefined) appear only in the "All"
  // view (project_id filter absent). Per design doc open-Q2 recommendation.
  if (input?.project_id !== undefined && input.project_id !== null) {
    const pid = input.project_id;
    items = items.filter((t) => t.project_id === pid);
  }

  return items.sort((a, b) => {
    // Priority descending (higher = more urgent), then by id for stability
    const pa = a.priority ?? 0;
    const pb = b.priority ?? 0;
    return pb - pa || a.id.localeCompare(b.id);
  });
}

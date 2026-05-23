/**
 * Read-only fixture store. iter-003 reads from
 * src/ui-mock/_shared/fixtures.snapshot.json so the BFF returns the
 * exact same data the UI mock was built against.
 *
 * iter-005+ swaps this module for `packages/db` queries. The service
 * functions in `connections-service.ts` (and future siblings) keep the
 * same signature; only the store implementation changes.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  Desk,
  Staff,
  Connection,
  Mission,
  Deliverable,
  WorkQueueItem,
  ChatThread,
  RecentEvent,
  OwnerAssistant,
} from '@holon/api-contract';

const Fixtures = z.object({
  desks: z.array(Desk),
  primary_desk_id: z.string(),
  staff: z.array(Staff),
  my_work_queue: z.array(WorkQueueItem),
  owner_assistant: OwnerAssistant,
  connections: z.array(Connection),
  missions: z.array(Mission),
  deliverables: z.array(Deliverable),
  recent_events: z.array(RecentEvent),
  chat_threads: z.array(ChatThread),
});

export type Fixtures = z.infer<typeof Fixtures>;

const here = dirname(fileURLToPath(import.meta.url));
// packages/core/src/ → repo root → src/ui-mock/_shared/fixtures.snapshot.json
const SNAPSHOT_PATH = join(here, '..', '..', '..', 'src', 'ui-mock', '_shared', 'fixtures.snapshot.json');

let _cached: Fixtures | null = null;

/**
 * Load + parse the fixture snapshot. Cached for the lifetime of the
 * process (the snapshot is committed; no hot reload needed). Throws if
 * the snapshot violates any schema — that's a contract bug.
 */
export function loadFixtures(): Fixtures {
  if (_cached) return _cached;
  const raw = readFileSync(SNAPSHOT_PATH, 'utf8');
  const json: unknown = JSON.parse(raw);
  _cached = Fixtures.parse(json);
  return _cached;
}

/** For tests — reset the cache so a fresh load happens. */
export function _resetFixtureCacheForTests(): void {
  _cached = null;
}

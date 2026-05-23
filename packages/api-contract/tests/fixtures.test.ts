/**
 * Fixture conformance — proves the BFF contract matches what the UI mock
 * was built against. Every fixture row must validate through its entity
 * schema; failure carries the row index and the Zod issue path so the
 * Dev Agent (or coordinator) can fix it without bisecting.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZodSchema } from 'zod';

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
} from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const snapshotPath = join(here, '..', '..', '..', 'src', 'ui-mock', '_shared', 'fixtures.snapshot.json');
const FIXTURES = JSON.parse(readFileSync(snapshotPath, 'utf8')) as Record<string, unknown>;

interface Counts {
  desks: number;
  staff: number;
  my_work_queue: number;
  connections: number;
  missions: number;
  deliverables: number;
  recent_events: number;
  chat_threads: number;
}

// Expected counts — bump these when fixtures grow on purpose. A
// silent count change is suspicious and should be intentional.
const EXPECTED_COUNTS: Counts = {
  desks: 1,
  staff: 0,
  my_work_queue: 0,
  connections: 0,
  missions: 0,
  deliverables: 0,
  recent_events: 0,
  chat_threads: 0,
};

function validateCollection<T>(
  schema: ZodSchema<T>,
  rows: unknown,
  collectionName: string
): void {
  expect(Array.isArray(rows), `${collectionName} must be an array`).toBe(true);
  const arr = rows as unknown[];
  arr.forEach((row, i) => {
    const result = schema.safeParse(row);
    if (!result.success) {
      const issues = result.error.issues.map((iss) => ({
        path: iss.path.join('.'),
        code: iss.code,
        message: iss.message,
      }));
      throw new Error(
        `${collectionName}[${i}] failed schema:\n` + JSON.stringify(issues, null, 2)
      );
    }
  });
}

describe('fixture conformance', () => {
  it('snapshot counts match expected', () => {
    expect((FIXTURES.desks as unknown[]).length).toBe(EXPECTED_COUNTS.desks);
    expect((FIXTURES.staff as unknown[]).length).toBe(EXPECTED_COUNTS.staff);
    expect((FIXTURES.my_work_queue as unknown[]).length).toBe(EXPECTED_COUNTS.my_work_queue);
    expect((FIXTURES.connections as unknown[]).length).toBe(EXPECTED_COUNTS.connections);
    expect((FIXTURES.missions as unknown[]).length).toBe(EXPECTED_COUNTS.missions);
    expect((FIXTURES.deliverables as unknown[]).length).toBe(EXPECTED_COUNTS.deliverables);
    expect((FIXTURES.recent_events as unknown[]).length).toBe(EXPECTED_COUNTS.recent_events);
    expect((FIXTURES.chat_threads as unknown[]).length).toBe(EXPECTED_COUNTS.chat_threads);
  });

  it('desks validate', () => {
    validateCollection(Desk, FIXTURES.desks, 'desks');
  });

  it('staff validate', () => {
    validateCollection(Staff, FIXTURES.staff, 'staff');
  });

  it('connections validate', () => {
    validateCollection(Connection, FIXTURES.connections, 'connections');
  });

  it('missions validate', () => {
    validateCollection(Mission, FIXTURES.missions, 'missions');
  });

  it('deliverables validate', () => {
    validateCollection(Deliverable, FIXTURES.deliverables, 'deliverables');
  });

  it('my_work_queue validates', () => {
    validateCollection(WorkQueueItem, FIXTURES.my_work_queue, 'my_work_queue');
  });

  it('recent_events validate', () => {
    validateCollection(RecentEvent, FIXTURES.recent_events, 'recent_events');
  });

  it('chat_threads validate', () => {
    validateCollection(ChatThread, FIXTURES.chat_threads, 'chat_threads');
  });

  it('owner_assistant validates', () => {
    const oa = FIXTURES.owner_assistant;
    const result = OwnerAssistant.safeParse(oa);
    if (!result.success) {
      throw new Error(
        'owner_assistant failed schema:\n' + JSON.stringify(result.error.issues, null, 2)
      );
    }
  });

  it('primary_desk_id matches a desk row', () => {
    const ids = (FIXTURES.desks as Array<{ id: string }>).map((d) => d.id);
    expect(ids).toContain(FIXTURES.primary_desk_id);
  });
});

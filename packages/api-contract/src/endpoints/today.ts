import { z } from 'zod';
import { registry } from '../registry.js';
import { WorkQueueItem } from '../entities/work-queue-item.js';
import { RecentEvent } from '../entities/recent-event.js';
import { Mission } from '../entities/mission.js';
import { Deliverable } from '../entities/deliverable.js';
import { Staff } from '../entities/staff.js';
import { Connection } from '../entities/connection.js';

/**
 * GET /api/v1/desk/today — aggregate endpoint.
 *
 * The Today screen reads from many fixtures (staff buckets, personal
 * queue, recent events, connections for retrying bucket). BFF aggregates
 * to one round-trip per page load.
 */

const Bucket = z.object({
  key: z.enum(['ai_running', 'peer_waiting', 'pending', 'returned', 'blocked', 'retrying']),
  count: z.number().int().nonnegative(),
  // Pre-computed item summaries — full lists fetched on bucket-drawer click
  preview_items: z
    .array(
      z.object({
        type: z.enum(['mission', 'deliverable', 'staff_job', 'peer_member', 'connection']),
        title: z.string(),
        id: z.string().optional(),
      })
    )
    .max(5),
});

export const TodayResponse = z.object({
  buckets: z.array(Bucket),
  my_work_queue: z.array(WorkQueueItem),
  recent_events: z.array(RecentEvent).max(20),
});
export type TodayResponse = z.infer<typeof TodayResponse>;

registry.registerPath({
  method: 'get',
  path: '/api/v1/desk/today',
  summary: 'Today screen aggregate (buckets + personal queue + recent events).',
  tags: ['today'],
  responses: {
    200: {
      description: 'Today payload',
      content: { 'application/json': { schema: TodayResponse } },
    },
  },
});

// Bucket detail endpoint — called when the user clicks into a bucket card
const BucketKey = z.enum(['ai_running', 'peer_waiting', 'pending', 'returned', 'blocked', 'retrying']);

export const BucketDetailParams = z.object({ key: BucketKey });
export type BucketDetailParams = z.infer<typeof BucketDetailParams>;
export const BucketDetailResponse = z.object({
  key: BucketKey,
  items: z.array(
    z.union([
      z.object({ type: z.literal('mission'), mission: Mission }),
      z.object({ type: z.literal('deliverable'), deliverable: Deliverable }),
      z.object({ type: z.literal('staff_job'), staff: Staff, job_label: z.string() }),
      z.object({ type: z.literal('peer_member'), staff: Staff }),
      z.object({ type: z.literal('connection'), connection: Connection }),
    ])
  ),
});
export type BucketDetailResponse = z.infer<typeof BucketDetailResponse>;

registry.registerPath({
  method: 'get',
  path: '/api/v1/desk/today/buckets/{key}',
  summary: 'Items inside one Today bucket.',
  tags: ['today'],
  request: { params: BucketDetailParams },
  responses: {
    200: {
      description: 'Bucket items',
      content: { 'application/json': { schema: BucketDetailResponse } },
    },
    404: { description: 'Unknown bucket key' },
  },
});

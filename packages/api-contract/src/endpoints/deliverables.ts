import { z } from 'zod';
import { registry } from '../registry.js';
import { Deliverable } from '../entities/deliverable.js';
import { DeliverableOrigin, DeliverableStatus } from '../enums.js';
import { idOf } from '../primitives.js';

/** GET /api/v1/deliverables — list with origin + status filter. */

export const ListDeliverablesQuery = z.object({
  origin: DeliverableOrigin.optional(),
  status: DeliverableStatus.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
});
export type ListDeliverablesQuery = z.infer<typeof ListDeliverablesQuery>;

export const ListDeliverablesResponse = z.object({
  items: z.array(Deliverable),
  next_cursor: z.string().nullable(),
});
export type ListDeliverablesResponse = z.infer<typeof ListDeliverablesResponse>;

registry.registerPath({
  method: 'get',
  path: '/api/v1/deliverables',
  summary: 'List deliverables (filterable by origin_label and status).',
  tags: ['deliverables'],
  request: { query: ListDeliverablesQuery },
  responses: {
    200: {
      description: 'Deliverable list',
      content: { 'application/json': { schema: ListDeliverablesResponse } },
    },
  },
});

/** GET /api/v1/deliverables/:id — detail. */

export const GetDeliverableParams = z.object({ id: idOf('deliv') });

export const GetDeliverableResponse = z.object({
  deliverable: Deliverable,
});
export type GetDeliverableResponse = z.infer<typeof GetDeliverableResponse>;

registry.registerPath({
  method: 'get',
  path: '/api/v1/deliverables/{id}',
  summary: 'Deliverable detail (full body + attribution).',
  tags: ['deliverables'],
  request: { params: GetDeliverableParams },
  responses: {
    200: {
      description: 'Deliverable detail',
      content: { 'application/json': { schema: GetDeliverableResponse } },
    },
    404: { description: 'Unknown deliverable id' },
  },
});

/** Deliverable action endpoints: Accept / Request revision. iter-003+ impl. */

const EmptyOk = z.object({ ok: z.literal(true) });

export const AcceptDeliverableBody = z.object({ note: z.string().optional() });
registry.registerPath({
  method: 'post',
  path: '/api/v1/deliverables/{id}/accept',
  summary: 'Accept a deliverable (state → accepted).',
  tags: ['deliverables', 'actions'],
  request: {
    params: GetDeliverableParams,
    body: { content: { 'application/json': { schema: AcceptDeliverableBody } } },
  },
  responses: {
    200: { description: 'Accepted', content: { 'application/json': { schema: EmptyOk } } },
  },
});

export const ReviseDeliverableBody = z.object({ reason: z.string().min(1) });
registry.registerPath({
  method: 'post',
  path: '/api/v1/deliverables/{id}/request-revision',
  summary: 'Request a revision of a deliverable.',
  tags: ['deliverables', 'actions'],
  request: {
    params: GetDeliverableParams,
    body: { content: { 'application/json': { schema: ReviseDeliverableBody } } },
  },
  responses: {
    200: { description: 'Revision requested', content: { 'application/json': { schema: EmptyOk } } },
  },
});

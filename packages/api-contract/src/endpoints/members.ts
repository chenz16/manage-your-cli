import { z } from 'zod';
import { registry } from '../registry.js';
import { Staff } from '../entities/staff.js';
import { OwnerAssistant } from '../entities/owner-assistant.js';
import { idOf } from '../primitives.js';

/** GET /api/v1/staff — flat roster.
 *
 * `items` is the flat-roster list per ADR-015 (`owner_assistant` is NOT a
 * Staff record). `owner_assistant` is surfaced as a SEPARATE optional
 * field so a client (e.g. /members day-one empty-state) can tell the
 * difference between "no staff hired AND no desk-AI either" (genuine
 * empty desk) vs. "no hires, but the Desk AI is here" (day-one normal
 * state). Persona-walk P0 #3 — Sarah Chen opened /members and saw an
 * empty roster with no explanation of why her Desk AI wasn't listed.
 */

export const ListStaffResponse = z.object({
  items: z.array(Staff),
  owner_assistant: OwnerAssistant.optional(),
});
export type ListStaffResponse = z.infer<typeof ListStaffResponse>;

registry.registerPath({
  method: 'get',
  path: '/api/v1/staff',
  summary: 'List flat-roster staff for this desk.',
  tags: ['members'],
  responses: {
    200: {
      description: 'Staff list',
      content: { 'application/json': { schema: ListStaffResponse } },
    },
  },
});

/** GET /api/v1/staff/:id — single staff with full profile. */

export const GetStaffParams = z.object({ id: idOf('staff') });
export type GetStaffParams = z.infer<typeof GetStaffParams>;

export const GetStaffResponse = z.object({ staff: Staff });
export type GetStaffResponse = z.infer<typeof GetStaffResponse>;

registry.registerPath({
  method: 'get',
  path: '/api/v1/staff/{id}',
  summary: 'Staff detail.',
  tags: ['members'],
  request: { params: GetStaffParams },
  responses: {
    200: {
      description: 'Staff detail',
      content: { 'application/json': { schema: GetStaffResponse } },
    },
    404: { description: 'Unknown staff id' },
  },
});

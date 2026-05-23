/**
 * Members service — domain layer for the Members screen.
 *
 * iter-007 step 7: now sources from the merged view in
 * staff-management-service so that:
 *   - dynamic staff hired via chat (`create_staff` tool) appear here
 *   - dismissed staff are filtered out
 *   - field overrides (from `update_staff`) are applied on top of the
 *     fixture row
 *
 * Old behaviour was "fixture only" — see git history for context.
 */

import type { ListStaffResponse, GetStaffResponse } from '@holon/api-contract';
import {
  ListStaffResponse as ListStaffResponseSchema,
  GetStaffResponse as GetStaffResponseSchema,
} from '@holon/api-contract';
import { listStaffMerged, getStaffMerged } from './staff-management-service.js';
import { getOwner } from './owner-config-service.js';

export function listMembers(): ListStaffResponse {
  // ADR-015: owner_assistant is NOT a Staff record, so it stays out of
  // `items`. But /members day-one would otherwise read as empty even
  // though the Desk AI is live — persona-walk P0 #3 (Sarah Chen). Expose
  // it as a sibling field so the client can render the "Desk AI is here"
  // empty-state without violating the flat-roster invariant.
  return ListStaffResponseSchema.parse({
    items: listStaffMerged(),
    owner_assistant: getOwner(),
  });
}

export function getMember(id: string): GetStaffResponse | null {
  const staff = getStaffMerged(id);
  if (!staff) return null;
  return GetStaffResponseSchema.parse({ staff });
}

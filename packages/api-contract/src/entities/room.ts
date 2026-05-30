import { z } from 'zod';
import { zIsoDateTimeLoose } from '../primitives.js';

/**
 * Room — a multi-party AI meeting room.
 *
 * v1: host_desk_id is always the local desk; all members are kind:'ai_agent'.
 * Schema + storage include both so v2/v3 (cross-desk peers, real humans) can
 * land without migration.
 */
export const Room = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  host_desk_id: z.string().min(1),
  host_owner_id: z.string().min(1),
  created_at: zIsoDateTimeLoose,
});
export type Room = z.infer<typeof Room>;

/**
 * RoomMember — one party in a meeting room.
 *
 * kind='ai_agent': ref_id = staff_id, desk_id = host desk (v1)
 * kind='human':    ref_id = owner_id, desk_id = that person's desk
 */
export const RoomMemberKind = z.enum(['ai_agent', 'human']);
export type RoomMemberKind = z.infer<typeof RoomMemberKind>;

export const RoomMember = z.object({
  room_id: z.string().min(1),
  party_id: z.string().min(1),
  kind: RoomMemberKind,
  desk_id: z.string().min(1),
  ref_id: z.string().min(1),
  display_name: z.string().min(1),
});
export type RoomMember = z.infer<typeof RoomMember>;

/**
 * RoomMessage — one message in a room thread.
 * Extends the base TranscriptMessage shape with an author annotation.
 */
export const RoomMessageAuthor = z.object({
  kind: RoomMemberKind,
  ref_id: z.string().min(1),
  display_name: z.string().min(1),
});
export type RoomMessageAuthor = z.infer<typeof RoomMessageAuthor>;

export const RoomMessage = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  ts: z.string(),
  author: RoomMessageAuthor.optional(),
});
export type RoomMessage = z.infer<typeof RoomMessage>;

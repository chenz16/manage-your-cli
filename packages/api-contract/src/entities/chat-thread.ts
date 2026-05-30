import { z } from 'zod';
import { idOf } from '../primitives.js';
import { ChatMessageRole } from '../enums.js';

/**
 * Chat thread + message — per ADR-013 (chat surface is a Secretary CLI
 * session, not a separate primitive). The mock represents conversations
 * with owner_assistant, local AI staff, and peer staff.
 */

/** Tool-call sidebar shown next to an agent message. */
const ChatToolCall = z.object({
  icon: z.string(),
  name: z.string(),
  args: z.string(),
});

/** Citation chip — references a deliverable. */
const ChatCitation = z.object({
  id: z.string(),
  label: z.string(),
});

const ChatMessage = z.object({
  role: ChatMessageRole,
  ts: z.string(), // mock uses "HH:MM" format, not full ISO datetime
  body: z.string(),
  tool_call: ChatToolCall.optional(),
  citations: z.array(ChatCitation).optional(),
  streaming: z.boolean().optional(),
});
export type ChatMessage = z.infer<typeof ChatMessage>;

export const ChatThread = z.object({
  id: z.string().min(1),
  participant_name: z.string().min(1),
  participant_role: z.string().min(1),
  staff_id: idOf('staff'),
  messages: z.array(ChatMessage),
});
export type ChatThread = z.infer<typeof ChatThread>;

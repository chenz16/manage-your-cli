import { z } from 'zod';
import { registry } from '../registry.js';
import { ChatThread } from '../entities/chat-thread.js';

/** GET /api/v1/chat/threads — list threads. */

export const ListChatThreadsResponse = z.object({
  items: z.array(ChatThread),
});
export type ListChatThreadsResponse = z.infer<typeof ListChatThreadsResponse>;

registry.registerPath({
  method: 'get',
  path: '/api/v1/chat/threads',
  summary: 'List chat threads (Myself + AI staff + peers).',
  tags: ['chat'],
  responses: {
    200: {
      description: 'Thread list',
      content: { 'application/json': { schema: ListChatThreadsResponse } },
    },
  },
});

/** POST /api/v1/chat/threads/:id/messages — send a message. iter-003+ impl. */

export const PostChatMessageParams = z.object({ id: z.string().min(1) });

export const PostChatMessageBody = z.object({ body: z.string().min(1) });
export const PostChatMessageResponse = z.object({
  // Echo the persisted message (with assigned ts, possibly streaming chunks);
  // streaming chunks land in V2 (SSE), V1 returns full message.
  message: z.object({
    role: z.literal('user'),
    ts: z.string(),
    body: z.string(),
  }),
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/chat/threads/{id}/messages',
  summary: 'Send a message into a chat thread.',
  tags: ['chat', 'actions'],
  request: {
    params: PostChatMessageParams,
    body: { content: { 'application/json': { schema: PostChatMessageBody } } },
  },
  responses: {
    201: {
      description: 'Message accepted',
      content: { 'application/json': { schema: PostChatMessageResponse } },
    },
  },
});

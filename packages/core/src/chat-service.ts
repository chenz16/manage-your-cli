/**
 * Chat service — reads chat thread fixtures.
 *
 * iter-006 ships read-only. Real send-message lands in iter-008+ via the
 * warm Secretary (cli_agent) path.
 */

import type { ChatThread, ListChatThreadsResponse } from '@holon/api-contract';
import { ListChatThreadsResponse as ListChatThreadsResponseSchema } from '@holon/api-contract';
import { loadFixtures } from './fixture-store.js';
import { getDynamicChatThread, listDynamicChatThreads } from './mutable-store.js';

/** iter-012 Pass #4: merge fixture chat threads with runtime-seeded ones
 *  (e.g. apply-persona's starter_greeting). Dynamic thread with same id
 *  overrides fixture thread (lets persona-apply replace its own greeting
 *  on re-pick). */
export function listChatThreads(): ListChatThreadsResponse {
  const fx = loadFixtures();
  const dyn = listDynamicChatThreads();
  const byId = new Map<string, ChatThread>();
  for (const t of fx.chat_threads) byId.set(t.id, t);
  for (const t of dyn) byId.set(t.id, t);
  return ListChatThreadsResponseSchema.parse({ items: Array.from(byId.values()) });
}

export function getChatThread(id: string): ChatThread | null {
  const dyn = getDynamicChatThread(id);
  if (dyn) return dyn;
  const fx = loadFixtures();
  return fx.chat_threads.find((t) => t.id === id) ?? null;
}

'use client';

/**
 * chat-history-cache — module-level in-memory + localStorage cache for chat
 * transcripts. Survives tab switches (in-memory) and app restarts (localStorage).
 *
 * SSR / static-export safe: nothing touches window/localStorage at module load
 * time. All persistence calls happen inside exported functions which callers
 * invoke only from effects (never during render / module init).
 *
 * Keys:
 *   'owner'       — 小秘 owner chat
 *   'staff:<id>'  — per-staff 1:1 chat
 */

export interface CachedMessage {
  role: 'user' | 'assistant';
  content: string;
}

const LS_PREFIX = 'weizo:chat:v1:';
const MAX_MESSAGES = 200; // cap per chat to avoid bloating localStorage

// In-memory map — survives navigation within the SPA but not page reloads.
const memCache = new Map<string, CachedMessage[]>();

function lsKey(chatId: string): string {
  return `${LS_PREFIX}${chatId}`;
}

/** Load messages for a chat. Checks memory first, then localStorage. */
export function loadMessages(chatId: string): CachedMessage[] {
  const mem = memCache.get(chatId);
  if (mem) return mem;

  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(lsKey(chatId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const messages = (parsed as unknown[]).filter(
      (m): m is CachedMessage =>
        typeof m === 'object' &&
        m !== null &&
        ((m as { role?: unknown }).role === 'user' ||
          (m as { role?: unknown }).role === 'assistant') &&
        typeof (m as { content?: unknown }).content === 'string',
    );
    memCache.set(chatId, messages);
    return messages;
  } catch {
    return [];
  }
}

/** Persist the full messages array for a chat (memory + localStorage). */
export function saveMessages(chatId: string, messages: CachedMessage[]): void {
  const capped = messages.slice(-MAX_MESSAGES);
  memCache.set(chatId, capped);

  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(lsKey(chatId), JSON.stringify(capped));
  } catch {
    // localStorage full or unavailable — in-memory cache still works for this session
  }
}

/** Clear the cache for a chat (e.g. explicit clear action). */
export function clearMessages(chatId: string): void {
  memCache.delete(chatId);
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(lsKey(chatId));
  } catch {
    // best-effort
  }
}

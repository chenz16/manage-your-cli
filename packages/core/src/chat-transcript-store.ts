/**
 * chat-transcript-store — append-only chat transcript store.
 *
 * Persists per-thread chat messages to the same SQLite DB used by
 * owner-state-persistence.ts (same ensureDb() singleton, same `owner_state`
 * KV table). This is the desk-shared source of truth for chat history,
 * enabling cross-device sync (desk ↔ mobile).
 *
 * Thread IDs:
 *   'owner'          — 小秘 / Secretary owner chat
 *   'staff:<staffId>' — per-staff 1:1 chat
 *
 * API:
 *   appendChatMessage(threadId, msg) — idempotent append (bounded to last 500)
 *   readChatTranscript(threadId, limit?) — newest-last ordered slice
 *   clearChatTranscript(threadId) — wipe a single thread
 *
 * Storage key schema: `chatTranscript:${threadId}` → JSON array of TranscriptMessage[].
 *
 * Failure posture (matches TD-011): every read/write is try/caught — a SQLite
 * error MUST NEVER throw past the public API surface. Errors are audit-logged
 * and the caller receives an empty array / silent noop. This keeps the SSE
 * streaming response unblocked even if the disk is full.
 */

import { existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, platform } from 'node:os';
import { dirname, join } from 'node:path';

export interface TranscriptMessage {
  role: 'user' | 'assistant';
  content: string;
  /** ISO 8601 timestamp */
  ts: string;
}

/** Maximum messages retained per thread (FIFO eviction of oldest). */
const TRANSCRIPT_MAX = 500;

/* ── Lazy SQLite singleton (mirrors owner-state-persistence pattern) ── */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BetterSqliteDatabase = any;
let _db: BetterSqliteDatabase | null = null;
let _dbInitFailed = false;
const requireFn = createRequire(import.meta.url);

function resolveDbPath(): string {
  if (process.env.HOLON_DB_PATH) return process.env.HOLON_DB_PATH;
  if (platform() === 'win32') {
    const base = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local');
    return join(base, 'Holon', 'owner.sqlite');
  }
  const xdg = process.env.XDG_DATA_HOME;
  const base = xdg ? join(xdg, 'holon') : join(homedir(), '.holon');
  return join(base, 'owner.sqlite');
}

function ensureDb(): BetterSqliteDatabase | null {
  if (_db) return _db;
  if (_dbInitFailed) return null;
  try {
    const dbPath = resolveDbPath();
    const parent = dirname(dbPath);
    if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
    const Database = requireFn('better-sqlite3') as new (path: string) => BetterSqliteDatabase;
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE IF NOT EXISTS owner_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    _db = db;
    return _db;
  } catch (err) {
    _dbInitFailed = true;
    console.error(JSON.stringify({
      audit: 'chat_transcript.db_open_failed',
      error: err instanceof Error ? err.message : String(err),
      ts: new Date().toISOString(),
    }));
    return null;
  }
}

function transcriptKey(threadId: string): string {
  return `chatTranscript:${threadId}`;
}

/* ── Public API ──────────────────────────────────────────────────────── */

/**
 * Append a message to the thread transcript.
 * Bounded to `TRANSCRIPT_MAX` — oldest messages are evicted FIFO.
 * Never throws.
 */
export function appendChatMessage(
  threadId: string,
  msg: Omit<TranscriptMessage, 'ts'> & { ts?: string },
): void {
  const db = ensureDb();
  if (!db) return;
  try {
    const key = transcriptKey(threadId);
    const row = db.prepare('SELECT value FROM owner_state WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    let messages: TranscriptMessage[] = [];
    if (row) {
      try {
        const parsed = JSON.parse(row.value) as unknown;
        if (Array.isArray(parsed)) messages = parsed as TranscriptMessage[];
      } catch {
        // corrupt — start fresh
      }
    }
    const entry: TranscriptMessage = {
      role: msg.role,
      content: msg.content,
      ts: msg.ts ?? new Date().toISOString(),
    };
    messages.push(entry);
    // Evict oldest if over cap
    if (messages.length > TRANSCRIPT_MAX) {
      messages = messages.slice(messages.length - TRANSCRIPT_MAX);
    }
    const json = JSON.stringify(messages);
    db.prepare(
      'INSERT OR REPLACE INTO owner_state (key, value, updated_at) VALUES (?, ?, ?)',
    ).run(key, json, Date.now());
    console.log(JSON.stringify({
      audit: 'chat_transcript.appended',
      threadId,
      role: entry.role,
      ts: entry.ts,
    }));
  } catch (err) {
    console.error(JSON.stringify({
      audit: 'chat_transcript.append_failed',
      threadId,
      error: err instanceof Error ? err.message : String(err),
      ts: new Date().toISOString(),
    }));
  }
}

/**
 * Read the transcript for a thread. Returns messages in oldest-first order.
 * `limit` caps the returned count (last N messages). Defaults to all.
 * Never throws — returns [] on any error.
 */
export function readChatTranscript(threadId: string, limit?: number): TranscriptMessage[] {
  const db = ensureDb();
  if (!db) return [];
  try {
    const key = transcriptKey(threadId);
    const row = db.prepare('SELECT value FROM owner_state WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    if (!row) return [];
    const parsed = JSON.parse(row.value) as unknown;
    if (!Array.isArray(parsed)) return [];
    const messages = (parsed as unknown[]).filter(
      (m): m is TranscriptMessage =>
        typeof m === 'object' &&
        m !== null &&
        ((m as { role?: unknown }).role === 'user' ||
          (m as { role?: unknown }).role === 'assistant') &&
        typeof (m as { content?: unknown }).content === 'string' &&
        typeof (m as { ts?: unknown }).ts === 'string',
    );
    if (typeof limit === 'number' && limit > 0) {
      return messages.slice(-limit);
    }
    return messages;
  } catch (err) {
    console.error(JSON.stringify({
      audit: 'chat_transcript.read_failed',
      threadId,
      error: err instanceof Error ? err.message : String(err),
      ts: new Date().toISOString(),
    }));
    return [];
  }
}

/**
 * Wipe the transcript for a single thread. Never throws.
 */
export function clearChatTranscript(threadId: string): void {
  const db = ensureDb();
  if (!db) return;
  try {
    const key = transcriptKey(threadId);
    db.prepare('DELETE FROM owner_state WHERE key = ?').run(key);
    console.log(JSON.stringify({
      audit: 'chat_transcript.cleared',
      threadId,
      ts: new Date().toISOString(),
    }));
  } catch (err) {
    console.error(JSON.stringify({
      audit: 'chat_transcript.clear_failed',
      threadId,
      error: err instanceof Error ? err.message : String(err),
      ts: new Date().toISOString(),
    }));
  }
}

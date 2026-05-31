/**
 * transcript-reader — read warm-agent JSONL transcripts written by
 * `apps/web/lib/warm-agent.ts`. Used by the HR Path B scorer (and any other
 * consumer that wants to look back at actual recent secretary conversation
 * events instead of just the final dispatch-result string).
 *
 * File layout (mirror of the writer):
 *   <root>/<warmKey>.jsonl
 *   <root>/<warmKey>-YYYY-MM-DD.jsonl   (rotated archives, oldest-first)
 *
 * One JSON object per line. Schema documented in TranscriptEvent below.
 *
 * Test override: pass `root` explicitly. Default = `HOLON_TRANSCRIPT_ROOT`
 * env (set by tests) OR `<HOLON_STATE_ROOT>/transcripts/` OR
 * `~/.holon/transcripts/`. ADR §4.7 (hr-evaluator-and-behavior-correction.md)
 * is the why; it's the "tighten 3 of 5 rubric items" follow-up.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const nodeRequire = eval('require') as (id: string) => any;
const { existsSync, readFileSync, readdirSync } = nodeRequire('fs') as typeof import('fs');
const { homedir } = nodeRequire('os') as typeof import('os');
const { join } = nodeRequire('path') as typeof import('path');

export type TranscriptEvType =
  | 'user_input'
  | 'assistant'
  | 'result'
  | 'tool_use'
  | 'tool_result';

export interface TranscriptEvent {
  ts: string;
  turn_id: string;
  ev_type: TranscriptEvType;
  content: unknown;
  tokens_in?: number;
  tokens_out?: number;
}

/** Resolve the transcripts root: explicit > env > HOLON_STATE_ROOT > ~/.holon. */
export function transcriptsRoot(root?: string): string {
  if (root) return root;
  const envRoot = process.env.HOLON_TRANSCRIPT_ROOT;
  if (envRoot) return envRoot;
  const stateRoot = process.env.HOLON_STATE_ROOT;
  if (stateRoot) return join(stateRoot, 'transcripts');
  return join(process.env.HOME ?? homedir(), '.holon', 'transcripts');
}

/** Sanitize warm key for use as a filename. Keeps `:` -> `_` etc. */
function safeKey(warmKey: string): string {
  return warmKey.replace(/[^A-Za-z0-9._-]/g, '_');
}

/** Read every line in a file as a TranscriptEvent, tolerating bad lines. */
function readEventsFromFile(path: string): TranscriptEvent[] {
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, 'utf8');
  const out: TranscriptEvent[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const ev = JSON.parse(trimmed) as TranscriptEvent;
      if (ev && typeof ev.ts === 'string' && typeof ev.turn_id === 'string' && typeof ev.ev_type === 'string') {
        out.push(ev);
      }
    } catch {
      // Corrupt / partial line — skip silently. Append-only stream, last line
      // may be torn mid-write; we'd rather lose 1 event than poison the read.
    }
  }
  return out;
}

/** All events for a key in order: archives oldest→newest, then live file. */
function readAllEvents(warmKey: string, root?: string): TranscriptEvent[] {
  const dir = transcriptsRoot(root);
  if (!existsSync(dir)) return [];
  const key = safeKey(warmKey);
  const livePath = join(dir, `${key}.jsonl`);
  // Pick up rotated archives `<key>-YYYY-MM-DD.jsonl`, sorted by date suffix.
  const archives: string[] = [];
  try {
    for (const name of readdirSync(dir)) {
      if (!name.startsWith(`${key}-`) || !name.endsWith('.jsonl')) continue;
      // Defensive: don't match a different key that happens to share a prefix.
      const date = name.slice(key.length + 1, -'.jsonl'.length);
      if (/^\d{4}-\d{2}-\d{2}$/.test(date)) archives.push(name);
    }
  } catch { /* readdir failure → no archives */ }
  archives.sort();
  const events: TranscriptEvent[] = [];
  for (const a of archives) events.push(...readEventsFromFile(join(dir, a)));
  events.push(...readEventsFromFile(livePath));
  return events;
}

/**
 * Read the last N turns for a warm key. A "turn" starts at a `user_input`
 * event and ends just before the next `user_input` (or at EOF). Events
 * before the first `user_input` form an implicit leading turn (rare —
 * mostly happens if rotation cut mid-turn or the writer started mid-stream).
 */
export function readRecentTurns(warmKey: string, n: number, root?: string): TranscriptEvent[][] {
  if (n <= 0) return [];
  const events = readAllEvents(warmKey, root);
  if (events.length === 0) return [];
  const turns: TranscriptEvent[][] = [];
  let current: TranscriptEvent[] = [];
  for (const ev of events) {
    if (ev.ev_type === 'user_input') {
      if (current.length > 0) turns.push(current);
      current = [ev];
    } else {
      current.push(ev);
    }
  }
  if (current.length > 0) turns.push(current);
  return turns.slice(-n);
}

/** Read all events at-or-after a given ISO timestamp (lexical compare is
 *  fine for fixed-format ISO strings). */
export function readSince(warmKey: string, sinceIso: string, root?: string): TranscriptEvent[] {
  const events = readAllEvents(warmKey, root);
  return events.filter((e) => e.ts >= sinceIso);
}

/**
 * usage-stats.ts — approximate Claude token-usage reader.
 *
 * Reads ~/.claude/projects/**\/*.jsonl (written by Claude Code),
 * sums token usage by day, returns today/week/total counts.
 * In-memory cache for ~60s so repeated API hits don't re-scan.
 *
 * NO Anthropic API calls. NO credentials. Pure local-log parser.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export interface ClaudeUsage {
  available: boolean;   // false if ~/.claude/projects dir is missing
  today_tokens: number;
  week_tokens: number;
  total_tokens: number;
  since: string;        // ISO date of earliest scanned day (approx)
  last_scan: string;    // ISO timestamp of this scan
}

// ── in-memory cache ─────────────────────────────────────────────────────────
let _cache: ClaudeUsage | null = null;
let _cacheAt = 0;
const CACHE_TTL_MS = 60_000;

// Scan only files modified in the last N days (for performance)
const SCAN_WINDOW_DAYS = 14;

function toLocalDateStr(isoTs: string): string {
  // e.g. "2026-05-24" from an ISO timestamp
  const d = new Date(isoTs);
  if (isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayStr(): string {
  return toLocalDateStr(new Date().toISOString());
}

/** Returns all *.jsonl paths under dir (recursive). */
function collectJsonlFiles(dir: string): string[] {
  const results: string[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        const sub = collectJsonlFiles(full);
        for (const s of sub) results.push(s);
      } else if (e.isFile() && e.name.endsWith('.jsonl')) {
        results.push(full);
      }
    }
  } catch {
    // ignore unreadable dirs
  }
  return results;
}

/** Extract usage tokens from a single parsed JSON event line. */
function extractUsage(line: Record<string, unknown>): { tokens: number; ts: string } | null {
  // assistant events: line.message.usage
  const msg = line.message;
  if (msg && typeof msg === 'object') {
    const usage = (msg as Record<string, unknown>).usage;
    if (usage && typeof usage === 'object') {
      const u = usage as Record<string, unknown>;
      const input = typeof u.input_tokens === 'number' ? u.input_tokens : 0;
      const output = typeof u.output_tokens === 'number' ? u.output_tokens : 0;
      const cacheCreate = typeof u.cache_creation_input_tokens === 'number' ? u.cache_creation_input_tokens : 0;
      const cacheRead = typeof u.cache_read_input_tokens === 'number' ? u.cache_read_input_tokens : 0;
      const tokens = input + output + cacheCreate + cacheRead;
      if (tokens > 0) {
        const ts = typeof line.timestamp === 'string' ? line.timestamp : '';
        return { tokens, ts };
      }
    }
  }
  return null;
}

export function readClaudeUsage(): ClaudeUsage {
  const now = Date.now();
  if (_cache && now - _cacheAt < CACHE_TTL_MS) {
    return _cache;
  }

  const projectsDir = path.join(os.homedir(), '.claude', 'projects');
  const zero: ClaudeUsage = {
    available: false,
    today_tokens: 0,
    week_tokens: 0,
    total_tokens: 0,
    since: todayStr(),
    last_scan: new Date().toISOString(),
  };

  if (!fs.existsSync(projectsDir)) {
    _cache = zero;
    _cacheAt = now;
    return zero;
  }

  const files = collectJsonlFiles(projectsDir);
  if (files.length === 0) {
    _cache = { ...zero, available: true };
    _cacheAt = now;
    return _cache;
  }

  // Only scan files modified in the last SCAN_WINDOW_DAYS (perf guard)
  const cutoff = now - SCAN_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const today = todayStr();
  const weekAgo = toLocalDateStr(new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString());

  let todayTokens = 0;
  let weekTokens = 0;
  let totalTokens = 0;
  let earliestDay = today;

  for (const filePath of files) {
    let stat: fs.Stats | null = null;
    try { stat = fs.statSync(filePath); } catch { continue; }

    const inWindow = stat.mtimeMs >= cutoff;

    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }

    const lines = content.split('\n');
    for (const raw of lines) {
      const trimmed = raw.trim();
      if (!trimmed) continue;
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(trimmed) as Record<string, unknown>;
      } catch {
        continue;
      }
      const u = extractUsage(parsed);
      if (!u) continue;

      const day = u.ts ? toLocalDateStr(u.ts) : '';

      if (inWindow) {
        // accumulate today/week from files in scan window
        if (day && day === today) todayTokens += u.tokens;
        if (day && day >= weekAgo) weekTokens += u.tokens;
      }
      // total always
      totalTokens += u.tokens;
      if (day && day < earliestDay) earliestDay = day;
    }
  }

  const result: ClaudeUsage = {
    available: true,
    today_tokens: todayTokens,
    week_tokens: weekTokens,
    total_tokens: totalTokens,
    since: earliestDay,
    last_scan: new Date().toISOString(),
  };

  _cache = result;
  _cacheAt = now;
  return result;
}

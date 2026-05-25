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
      // Count only real new conversation tokens (input + output). We deliberately
      // EXCLUDE cache_read_input_tokens — the warm process re-reads the same cached
      // context every turn, so counting it inflates totals ~200× (a few K of real
      // chat showed as millions) and misled the owner. cache_creation is likewise
      // caching overhead, not consumption, so it's excluded too.
      const tokens = input + output;
      if (tokens > 0) {
        const ts = typeof line.timestamp === 'string' ? line.timestamp : '';
        return { tokens, ts };
      }
    }
  }
  return null;
}

// ── per-agent cache ──────────────────────────────────────────────────────────
interface AgentUsageEntry {
  id: string;
  name: string;
  total_tokens: number;
  today_tokens: number;
}
let _agentCache: AgentUsageEntry[] | null = null;
let _agentCacheAt = 0;

/**
 * Encode a cwd path to a Claude Code project-dir name.
 *
 * Claude Code derives the project dir by replacing every `/` and `_` in the
 * absolute path with `-`.  E.g.
 *   /home/chenz/holon-agents/staff_ABC → -home-chenz-holon-agents-staff-ABC
 */
function cwdToProjectDirName(cwd: string): string {
  return cwd.replace(/[/_]/g, '-');
}

/**
 * Sum all usage tokens in a single project dir (all JSONL files, all lines).
 * Sub-agent (Task tool) tokens are logged in the SAME project JSONL as the
 * parent, so summing the whole dir automatically includes implicit sub-agents.
 */
function sumProjectDir(dirPath: string, today: string): { total: number; todayTokens: number } {
  const files = collectJsonlFiles(dirPath);
  let total = 0;
  let todayTokens = 0;
  for (const filePath of files) {
    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }
    for (const raw of content.split('\n')) {
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
      total += u.tokens;
      const day = u.ts ? toLocalDateStr(u.ts) : '';
      if (day === today) todayTokens += u.tokens;
    }
  }
  return { total, todayTokens };
}

/**
 * Return per-agent token usage by mapping each agent's cwd to its Claude Code
 * project dir and summing all JSONL usage lines (including implicit sub-agents
 * whose tokens land in the same JSONL as the parent).
 *
 * Agents with no cwd or no matching project dir are silently skipped.
 * Results sorted by total_tokens descending.
 */
export function readClaudeUsageByAgent(
  agents: { id: string; name: string; cwd: string }[],
): AgentUsageEntry[] {
  const now = Date.now();
  if (_agentCache && now - _agentCacheAt < CACHE_TTL_MS) {
    return _agentCache;
  }

  const projectsDir = path.join(os.homedir(), '.claude', 'projects');
  const today = todayStr();
  const results: AgentUsageEntry[] = [];

  for (const agent of agents) {
    if (!agent.cwd) continue;
    const dirName = cwdToProjectDirName(agent.cwd);
    const dirPath = path.join(projectsDir, dirName);
    if (!fs.existsSync(dirPath)) continue;
    const { total, todayTokens } = sumProjectDir(dirPath, today);
    results.push({
      id: agent.id,
      name: agent.name,
      total_tokens: total,
      today_tokens: todayTokens,
    });
  }

  results.sort((a, b) => b.total_tokens - a.total_tokens);
  _agentCache = results;
  _agentCacheAt = now;
  return results;
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

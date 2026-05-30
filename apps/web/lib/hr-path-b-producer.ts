/**
 * hr-path-b-producer — HR's SyntheticProducer (ADR §4.3 Path B).
 *
 * Runs the 5-item rubric on each dispatch-completion and on settle. Per
 * §4.3, HR's nudges land at the NEXT input boundary (non-preemptive), so:
 *
 *   - onDispatchComplete: SCORE + count fires + maybe-promote, return the
 *     synthetic nudge messages. The base producer pipeline enqueues them
 *     via enqueueSyntheticMessages → warm-agent drain on next inbound turn.
 *   - onSettle: returns [] — HR doesn't fire on settle; that channel is
 *     reserved for OTHER producers (event-followup, etc.).
 *
 * The two scoring scopes from §4.1 collapse onto one producer:
 *   - entry.kind === 'warm-secretary'  → owner-HR scope (target = secretary)
 *   - entry.kind === 'tmux-employee'   → secretary-HR scope (target = employee)
 *
 * Other entry kinds (desk, task-subagent, codex-task, tree-child) are
 * skipped — they're either infra or transient.
 *
 * Heuristics (lossy by design per task spec — rubric items are checkable
 * approximations, not perfect detectors):
 *   - dispatched-not-DIY: result text mentions Task/dispatch/sub-agent OR
 *     contains a tool_use for the Task tool / mcp__holon__dispatch.
 *   - respected-north-star: result text does NOT propose RAG/vector/embedding
 *     /abstraction-layer.
 *   - read-INDEX-before-act: result text references INDEX.md OR reads it.
 *   - role-fidelity: result text does NOT contain first-person code-writing
 *     phrases like "I'll write…" / "let me implement…".
 *   - memory-hygiene: any boss-memory write mentions the project_id and a
 *     [[wikilink]]-ish reference (very rough — flagged as best-effort).
 *
 * Persistent state (per-(target × ruleHash) counter): `~/.holon/hr-state.json`,
 * overridable via HOLON_HR_STATE (set by tests).
 *
 * Log scanning: NOT WIRED — warm-agent currently keeps no persisted per-key
 * stream-json log (it's in-process). We score off the dispatch result alone
 * for now; the rubric items that need transcript context are flagged in the
 * heuristic notes above and will tighten when a log channel exists.
 * TODO(hr-log): add warm-agent persistent log → tighten scoring.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  hrStateFilePath,
  maybePromoteToA,
  stableRuleHash,
  type HrCounter,
} from '@holon/core';
import type { SyntheticMessage, SyntheticProducer } from './synthetic-producers';
import type { ProcessEntry } from './process-registry';

interface RubricItem {
  /** Stable id (slug) — used to look up nudge text and as the rule-key
   *  basis. */
  id: 'dispatched-not-DIY' | 'respected-north-star' | 'read-INDEX-before-act'
     | 'role-fidelity' | 'memory-hygiene';
  /** Canonical rule text (what the persistent Path-A correction would say).
   *  Hashed for the per-rule counter + idempotent Path-A write. */
  ruleText: string;
  /** Path-B nudge that lands as a synthetic 'user' message before the next
   *  inbound. Kept short — owner correction tone. */
  nudge: string;
}

const HR_RUBRIC: RubricItem[] = [
  {
    id: 'dispatched-not-DIY',
    ruleText: 'Always dispatch heavy work to a sub-agent; do not execute it yourself.',
    nudge: 'Reminder: you are the manager. Dispatch heavy work — do not do it yourself.',
  },
  {
    id: 'respected-north-star',
    ruleText: 'Do not propose RAG, vector DB, or new abstraction layers — push intelligence into the CLI prompt/memory.',
    nudge: 'Reminder: no RAG / vector DB / bespoke AI layer. Push it into prompt/memory.',
  },
  {
    id: 'read-INDEX-before-act',
    ruleText: 'Read INDEX.md before writing into boss memory.',
    nudge: 'Reminder: read INDEX.md before writing memory — progressive disclosure.',
  },
  {
    id: 'role-fidelity',
    ruleText: 'Maintain the manager persona; you orchestrate, you do not implement.',
    nudge: 'Reminder: stay in manager role. Orchestrate, do not implement.',
  },
  {
    id: 'memory-hygiene',
    ruleText: 'Boss-memory writes must cite the project and use [[wikilinks]] for cross-references.',
    nudge: 'Reminder: memory writes need a project tag and [[wikilinks]] for cross-refs.',
  },
];

/** Lookup by id (used by tests + readability). */
export const HR_NUDGES: Record<RubricItem['id'], string> =
  HR_RUBRIC.reduce((acc, r) => { acc[r.id] = r.nudge; return acc; }, {} as Record<RubricItem['id'], string>);

interface RubricResult {
  /** True = passed, false = drift signal (will be nudged). */
  checks: Record<RubricItem['id'], boolean>;
}

/** Heuristic rubric scorer. Lossy by design — first-pass string-match. */
export function scoreRubric(resultText: string): RubricResult {
  const lower = resultText.toLowerCase();
  const mentionsDispatch = /(dispatched|dispatch|task tool|sub-?agent|mcp__holon__dispatch)/.test(lower);
  const proposesForbidden = /(rag\b|vector db|vector database|embedding|new abstraction layer)/.test(lower);
  const readsIndex = /index\.md/.test(lower);
  const writesFirstPerson = /(i'll write|i will write|let me implement|i'll implement|i'll code|let me code|i'll fix it|let me fix it)/.test(lower);
  const looksLikeMemoryWrite = /(boss-?memory|memory\.md|write_memory)/.test(lower);
  const memoryHasWikilinks = /\[\[[^\]]+\]\]/.test(resultText);
  return {
    checks: {
      'dispatched-not-DIY': mentionsDispatch || !/(implement|coded|wrote the|edited the file)/i.test(lower),
      'respected-north-star': !proposesForbidden,
      'read-INDEX-before-act': !looksLikeMemoryWrite || readsIndex,
      'role-fidelity': !writesFirstPerson,
      'memory-hygiene': !looksLikeMemoryWrite || memoryHasWikilinks,
    },
  };
}

// ---- Persistent counter store -----------------------------------------------

interface HrStateFile {
  /** key = `<targetKey>::<ruleHash>` */
  counters: Record<string, HrCounter>;
}

function readState(): HrStateFile {
  const p = hrStateFilePath();
  if (!existsSync(p)) return { counters: {} };
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as HrStateFile;
    return raw && typeof raw === 'object' && raw.counters ? raw : { counters: {} };
  } catch {
    return { counters: {} };
  }
}

function writeState(state: HrStateFile): void {
  const p = hrStateFilePath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(state, null, 2));
}

function counterKey(targetKey: string, ruleHash: string): string {
  return `${targetKey}::${ruleHash}`;
}

/** Increment a per-(target × rule) counter and return the updated counter. */
export function bumpCounter(targetKey: string, ruleHash: string, nowMs: number = Date.now()): HrCounter {
  const state = readState();
  const key = counterKey(targetKey, ruleHash);
  const existing = state.counters[key] ?? { fires: [] };
  // Keep only last 48h to bound size; counter window is 24h but keep some
  // margin for off-clock checks.
  const cutoff = nowMs - 48 * 60 * 60 * 1000;
  const fires = existing.fires.filter((t) => t >= cutoff);
  fires.push(nowMs);
  const next: HrCounter = { fires };
  state.counters[key] = next;
  writeState(state);
  return next;
}

/** Test-only: clear counters. */
export function _resetHrCountersForTest(): void {
  writeState({ counters: {} });
}

// ---- Producer wiring --------------------------------------------------------

function targetMemoryFileFromEntry(entry: ProcessEntry): string | null {
  // Default: write into <cwd>/CLAUDE.md (claude is the canonical binary in
  // this repo). Other binaries → caller can switch on entry.meta.binary if
  // we ever wire codex/gemini/qwen here. Slice 2 is claude-only.
  if (!entry.cwd) return null;
  return `${entry.cwd}/CLAUDE.md`;
}

function isScorable(entry: ProcessEntry): boolean {
  return entry.kind === 'warm-secretary' || entry.kind === 'tmux-employee';
}

function resultToText(result: unknown): string {
  if (typeof result === 'string') return result;
  if (result && typeof result === 'object') {
    try { return JSON.stringify(result); } catch { return ''; }
  }
  return '';
}

/** Exported for tests: run rubric, update counters, maybe-promote, emit
 *  synthetic nudge messages for failed items. */
export function scoreAndEmitNudges(
  entry: ProcessEntry,
  result: unknown,
  opts: { now?: Date } = {},
): SyntheticMessage[] {
  if (!isScorable(entry)) return [];
  const text = resultToText(result);
  const rubric = scoreRubric(text);
  const now = opts.now ?? new Date();
  const nowMs = now.getTime();
  const messages: SyntheticMessage[] = [];
  const targetMemPath = targetMemoryFileFromEntry(entry);

  for (const item of HR_RUBRIC) {
    if (rubric.checks[item.id]) continue;
    const ruleHash = stableRuleHash(item.ruleText);
    const counter = bumpCounter(entry.key, ruleHash, nowMs);
    messages.push({
      role: 'user',
      content: item.nudge,
      sourceProducer: 'hr-path-b',
      enqueuedAt: nowMs,
    });
    // Promotion attempt (no-op below threshold / vetoed). Wrap so a
    // promotion failure NEVER prevents the nudge being emitted.
    if (targetMemPath) {
      try {
        maybePromoteToA(targetMemPath, ruleHash, item.ruleText, counter,
          { now, agentLabel: entry.key });
      } catch (err) {
        console.warn(JSON.stringify({
          audit: 'hr.promotion_error',
          target: entry.key,
          ruleHash,
          error: err instanceof Error ? err.message : String(err),
        }));
      }
    }
  }
  return messages;
}

export const hrPathBProducer: SyntheticProducer = {
  name: 'hr-path-b',
  // Per ADR §4.3 — HR does NOT push on settle. It runs scoring on dispatch-
  // completion, and the resulting nudges drain on the next inbound. So:
  onSettle(): SyntheticMessage[] { return []; },
  onDispatchComplete(entry, result): SyntheticMessage[] {
    return scoreAndEmitNudges(entry, result);
  },
};

let registered = false;
/** Register the HR producer exactly once. Boot calls this from
 *  instrumentation.ts; tests can re-call after _resetProducersForTest. */
export function registerHrPathBProducerOnce(): void {
  if (registered) return;
  registered = true;
  // Lazy require to avoid a circular import at module-load time.
  // (synthetic-producers depends on process-registry which depends on
  // node: builtins — fine — this is just defensive.)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { registerProducer } = require('./synthetic-producers') as typeof import('./synthetic-producers');
  registerProducer(hrPathBProducer);
}

/** Test-only: clear the registered flag so a fresh re-register works after
 *  _resetProducersForTest(). */
export function _resetHrProducerForTest(): void {
  registered = false;
}

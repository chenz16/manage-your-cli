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
 * Log scanning: wired. warm-agent persists stream-json events per warm key
 * via `appendTranscriptEvent` (apps/web/lib/warm-agent.ts) → JSONL on disk.
 * We read the last 2-3 turns via `@holon/core/transcript-reader` and use
 * the events to TIGHTEN three rubric items (dispatched-not-DIY,
 * read-INDEX-before-act, role-fidelity) against actual tool_use blocks
 * rather than just a string-match on the final result.
 */
// eval('require') keeps Node's CommonJS require in scope; bare module names
// (no node: prefix) keep webpack's loader happy. Same pattern as heartbeat.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const nodeRequire = eval('require') as (id: string) => any;
const { existsSync, mkdirSync, readFileSync, writeFileSync } = nodeRequire('fs') as typeof import('fs');
const { dirname } = nodeRequire('path') as typeof import('path');
import { stableRuleHash } from '@holon/core/hr-path-a';
import { hrStateFilePath } from '@holon/core/hr-paths';
import { maybePromoteToA, type HrCounter } from '@holon/core/hr-promotion';
import { readRecentTurns, type TranscriptEvent } from '@holon/core/transcript-reader';
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

// ---- Transcript-aware rubric refinements ------------------------------------
// Three of the five rubric items now have a CONFIRMING signal from the actual
// stream-json events in `~/.holon/transcripts/<warmKey>.jsonl`. The string-
// match heuristic on `result` text is still the base detector; the transcript
// pass either tightens (forces unchecked when string-match was lenient) or
// corroborates (forces unchecked when both signals agree).

const DISPATCH_TOOL_NAMES = /^(Task|mcp__holon__|mcp__holon-mcp__)/;
const FILE_EDIT_TOOL_NAMES = /^(Edit|Write|MultiEdit|NotebookEdit)$/;

interface ToolUseContent { id?: string; name?: string; input?: Record<string, unknown> }

function flattenToolUses(turns: TranscriptEvent[][]): Array<{ name: string; input: Record<string, unknown> }> {
  const out: Array<{ name: string; input: Record<string, unknown> }> = [];
  for (const turn of turns) {
    for (const ev of turn) {
      if (ev.ev_type !== 'tool_use') continue;
      const c = ev.content as ToolUseContent | null;
      if (!c || typeof c.name !== 'string') continue;
      out.push({ name: c.name, input: (c.input ?? {}) as Record<string, unknown> });
    }
  }
  return out;
}

function flattenAssistantTexts(turns: TranscriptEvent[][]): string {
  const parts: string[] = [];
  for (const turn of turns) {
    for (const ev of turn) {
      if (ev.ev_type === 'assistant' && typeof ev.content === 'string') {
        parts.push(ev.content);
      }
    }
  }
  return parts.join('\n');
}

interface TranscriptSignals {
  hasDispatchToolUse: boolean;
  hasFileEditToolUse: boolean;
  hasIndexReadBeforeMemoryWrite: boolean;
  /** Memory write was attempted at all (Write into anything that looks like
   *  boss memory or CLAUDE.md). Used to gate the read-INDEX-before-act
   *  refinement: no memory write → rule isn't applicable. */
  hasMemoryWrite: boolean;
  assistantFirstPersonDIY: boolean;
}

/** Walk the events in order and derive boolean signals used to refine 3 of 5
 *  rubric items. Exported for unit testing. */
export function deriveTranscriptSignals(turns: TranscriptEvent[][]): TranscriptSignals {
  const tools = flattenToolUses(turns);
  const hasDispatchToolUse = tools.some((t) => DISPATCH_TOOL_NAMES.test(t.name));
  const hasFileEditToolUse = tools.some((t) => FILE_EDIT_TOOL_NAMES.test(t.name));

  // For read-INDEX-before-act we walk events in chronological order across
  // all supplied turns and track whether a Read of an INDEX.md preceded any
  // file-modifying write (Write/Edit) targeting boss memory or CLAUDE.md.
  let sawIndexRead = false;
  let hasMemoryWrite = false;
  let hasIndexReadBeforeMemoryWrite = true; // vacuously true until we see a write
  for (const turn of turns) {
    for (const ev of turn) {
      if (ev.ev_type !== 'tool_use') continue;
      const c = ev.content as ToolUseContent | null;
      if (!c || typeof c.name !== 'string') continue;
      const path = typeof c.input?.['file_path'] === 'string'
        ? (c.input['file_path'] as string)
        : (typeof c.input?.['path'] === 'string' ? (c.input['path'] as string) : '');
      if (c.name === 'Read' && /INDEX\.md$/i.test(path)) {
        sawIndexRead = true;
      }
      const looksLikeBossMemory = /(INDEX\.md|MEMORY\/|CLAUDE\.md|AGENTS\.md|boss-memory)/i.test(path);
      if (FILE_EDIT_TOOL_NAMES.test(c.name) && looksLikeBossMemory) {
        hasMemoryWrite = true;
        if (!sawIndexRead) hasIndexReadBeforeMemoryWrite = false;
      }
    }
  }

  // Role-fidelity corroborator: same first-person DIY phrases the result-text
  // scorer looks for, but applied to assistant text across recent turns.
  const assistantText = flattenAssistantTexts(turns).toLowerCase();
  const assistantFirstPersonDIY =
    /(i'll write|i will write|let me implement|i'll implement|i'll code|let me code|i'll fix it|let me fix it)/.test(assistantText);

  return {
    hasDispatchToolUse,
    hasFileEditToolUse,
    hasIndexReadBeforeMemoryWrite,
    hasMemoryWrite,
    assistantFirstPersonDIY,
  };
}

/** Apply transcript-derived signals on top of the base string-match rubric.
 *  TIGHTENS three items per spec; the other two are pass-through. */
export function refineRubricWithTranscript(base: RubricResult, signals: TranscriptSignals): RubricResult {
  const checks = { ...base.checks };

  // dispatched-not-DIY: if no dispatch tool_use across recent turns AND file-
  // edit tool_use is present, the secretary did the work itself → unchecked.
  if (!signals.hasDispatchToolUse && signals.hasFileEditToolUse) {
    checks['dispatched-not-DIY'] = false;
  }

  // read-INDEX-before-act: if we observed a memory-write tool_use without a
  // prior INDEX.md Read, the rule fails (overrides whatever the string-match
  // thought).
  if (signals.hasMemoryWrite && !signals.hasIndexReadBeforeMemoryWrite) {
    checks['read-INDEX-before-act'] = false;
  }

  // role-fidelity: corroborator. If the assistant text in recent turns
  // contains a first-person DIY phrase, fail even if the dispatch-result
  // string was clean. (Acts as a confirmer; never up-grades a base fail.)
  if (signals.assistantFirstPersonDIY) {
    checks['role-fidelity'] = false;
  }

  return { checks };
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
  opts: { now?: Date; transcriptRoot?: string } = {},
): SyntheticMessage[] {
  if (!isScorable(entry)) return [];
  const text = resultToText(result);
  const baseRubric = scoreRubric(text);
  // Tighten 3 of 5 rubric items against the actual stream-json transcript
  // (warm key matches the registry key sans the `warm:` prefix that
  // process-registry prepends — see warm-agent.ts spawnWarm `key:` field).
  let rubric = baseRubric;
  try {
    const warmKeyForTranscript = entry.key.replace(/^warm:/, '');
    const recentTurns = readRecentTurns(warmKeyForTranscript, 3, opts.transcriptRoot);
    if (recentTurns.length > 0) {
      const signals = deriveTranscriptSignals(recentTurns);
      rubric = refineRubricWithTranscript(baseRubric, signals);
    }
  } catch {
    // Transcript read failure must NEVER block scoring — fall back to the
    // string-match base rubric and continue.
  }
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

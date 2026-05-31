/**
 * hr-path-b-producer — rubric scoring + counter bump + promotion-at-threshold.
 *
 * No real warm processes / no real HOME — HOLON_HR_ROOT + HOLON_HR_STATE
 * point at tmpdirs.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmpRoot: string;
let prevHrRoot: string | undefined;
let prevHrState: string | undefined;

beforeEach(async () => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'hr-pb-'));
  prevHrRoot = process.env.HOLON_HR_ROOT;
  prevHrState = process.env.HOLON_HR_STATE;
  process.env.HOLON_HR_ROOT = join(tmpRoot, 'hr-root');
  process.env.HOLON_HR_STATE = join(tmpRoot, 'hr-state.json');
  const mod = await import('./hr-path-b-producer');
  mod._resetHrCountersForTest();
});

afterEach(() => {
  if (prevHrRoot === undefined) delete process.env.HOLON_HR_ROOT;
  else process.env.HOLON_HR_ROOT = prevHrRoot;
  if (prevHrState === undefined) delete process.env.HOLON_HR_STATE;
  else process.env.HOLON_HR_STATE = prevHrState;
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* noop */ }
});

const ENTRY = {
  key: 'warm:sec_acme',
  pid: 1,
  kind: 'warm-secretary' as const,
  cwd: '', // set per-test to a fresh tmpdir
  lastHeartbeatAt: 0,
  status: 'alive' as const,
  createdAt: 0,
};

describe('scoreRubric', () => {
  it('flags forbidden-abstraction text', async () => {
    const { scoreRubric } = await import('./hr-path-b-producer');
    const r = scoreRubric('I will set up a RAG with a vector DB');
    expect(r.checks['respected-north-star']).toBe(false);
  });
  it('flags first-person DIY text as role-fidelity failure', async () => {
    const { scoreRubric } = await import('./hr-path-b-producer');
    const r = scoreRubric("OK I'll write the code myself.");
    expect(r.checks['role-fidelity']).toBe(false);
  });
  it('passes clean dispatch text', async () => {
    const { scoreRubric } = await import('./hr-path-b-producer');
    const r = scoreRubric('Dispatched to the implementation sub-agent via Task tool.');
    expect(r.checks['dispatched-not-DIY']).toBe(true);
    expect(r.checks['respected-north-star']).toBe(true);
    expect(r.checks['role-fidelity']).toBe(true);
  });
});

describe('scoreAndEmitNudges', () => {
  it('emits nudges only for failed rubric items', async () => {
    const { scoreAndEmitNudges, HR_NUDGES } = await import('./hr-path-b-producer');
    const cwd = mkdtempSync(join(tmpdir(), 'hr-target-'));
    const entry = { ...ENTRY, cwd };
    const msgs = scoreAndEmitNudges(entry, 'I will set up a RAG with vector DB myself');
    expect(msgs.length).toBeGreaterThan(0);
    expect(msgs.every((m) => m.sourceProducer === 'hr-path-b')).toBe(true);
    expect(msgs.every((m) => m.role === 'user')).toBe(true);
    const contents = msgs.map((m) => m.content);
    expect(contents).toContain(HR_NUDGES['respected-north-star']);
  });

  it('returns [] for non-scorable entry kinds', async () => {
    const { scoreAndEmitNudges } = await import('./hr-path-b-producer');
    const entry = { ...ENTRY, kind: 'desk' as const };
    const msgs = scoreAndEmitNudges(entry, 'I will set up a RAG with vector DB myself');
    expect(msgs).toEqual([]);
  });

  it('increments counter per fire and auto-promotes at threshold', async () => {
    const mod = await import('./hr-path-b-producer');
    const cwd = mkdtempSync(join(tmpdir(), 'hr-target-'));
    const entry = { ...ENTRY, cwd };
    const driftText = 'I will set up a RAG with vector DB';
    // 3 fires in quick succession → 3rd one should trigger promotion.
    const t0 = new Date('2026-05-30T00:00:00Z');
    const t1 = new Date('2026-05-30T01:00:00Z');
    const t2 = new Date('2026-05-30T02:00:00Z');
    mod.scoreAndEmitNudges(entry, driftText, { now: t0 });
    mod.scoreAndEmitNudges(entry, driftText, { now: t1 });
    const targetMem = join(cwd, 'CLAUDE.md');
    expect(existsSync(targetMem)).toBe(false); // not promoted yet
    mod.scoreAndEmitNudges(entry, driftText, { now: t2 });
    expect(existsSync(targetMem)).toBe(true);
    const mem = readFileSync(targetMem, 'utf8');
    expect(mem).toContain('HR-Corrections');
    expect(mem).toContain('RAG');
  });
});

describe('hrPathBProducer', () => {
  it('onSettle returns [] (HR does not push at settle)', async () => {
    const { hrPathBProducer } = await import('./hr-path-b-producer');
    const out = await hrPathBProducer.onSettle?.(ENTRY);
    expect(out).toEqual([]);
  });
});

// ---- Transcript-aware rubric tightening -------------------------------------
// The wired-up `scoreAndEmitNudges` now reads the warm-agent JSONL transcript
// and tightens 3 of 5 rubric items. We provide synthetic transcripts on disk
// (via the appendTranscriptEvent helper exported from warm-agent) so the
// tests exercise the real reader → scorer path, not a mock.

describe('scoreAndEmitNudges — transcript-aware refinements', () => {
  it('tightens dispatched-not-DIY when no Task/dispatch tool_use but a file-edit tool_use is observed', async () => {
    const { scoreAndEmitNudges, HR_NUDGES } = await import('./hr-path-b-producer');
    const { appendTranscriptEvent, _resetTranscriptWritersForTest } = await import('./warm-agent');
    const transcriptRoot = mkdtempSync(join(tmpdir(), 'hr-tx-'));
    const prev = process.env.HOLON_TRANSCRIPT_ROOT;
    process.env.HOLON_TRANSCRIPT_ROOT = transcriptRoot;
    try {
      _resetTranscriptWritersForTest();
      // entry.key is 'warm:sec_acme' → reader uses 'sec_acme' as warm key.
      const cwd = mkdtempSync(join(tmpdir(), 'hr-target-'));
      const entry = { ...ENTRY, cwd };
      // Build a synthetic 1-turn transcript: user_input + Edit tool_use (no
      // Task/dispatch). Result-text is BENIGN (would pass the base rubric).
      appendTranscriptEvent('sec_acme', { ev_type: 'user_input', content: 'do thing' });
      appendTranscriptEvent('sec_acme', {
        ev_type: 'tool_use',
        content: { id: 'tu_1', name: 'Edit', input: { file_path: '/tmp/foo.ts' } },
      });
      appendTranscriptEvent('sec_acme', { ev_type: 'result', content: 'all good' });
      await new Promise((r) => setTimeout(r, 15));
      const msgs = scoreAndEmitNudges(entry, 'all good — clean dispatch', { transcriptRoot });
      // Without transcript refinement the result text passes everything,
      // so msgs would be []. With refinement, dispatched-not-DIY fails.
      expect(msgs.map((m) => m.content)).toContain(HR_NUDGES['dispatched-not-DIY']);
    } finally {
      _resetTranscriptWritersForTest();
      if (prev === undefined) delete process.env.HOLON_TRANSCRIPT_ROOT;
      else process.env.HOLON_TRANSCRIPT_ROOT = prev;
      try { rmSync(transcriptRoot, { recursive: true, force: true }); } catch { /* noop */ }
    }
  });

  it('tightens read-INDEX-before-act when a memory Write happens without a preceding INDEX.md Read', async () => {
    const { scoreAndEmitNudges, HR_NUDGES } = await import('./hr-path-b-producer');
    const { appendTranscriptEvent, _resetTranscriptWritersForTest } = await import('./warm-agent');
    const transcriptRoot = mkdtempSync(join(tmpdir(), 'hr-tx-'));
    const prev = process.env.HOLON_TRANSCRIPT_ROOT;
    process.env.HOLON_TRANSCRIPT_ROOT = transcriptRoot;
    try {
      _resetTranscriptWritersForTest();
      const cwd = mkdtempSync(join(tmpdir(), 'hr-target-'));
      const entry = { ...ENTRY, cwd };
      appendTranscriptEvent('sec_acme', { ev_type: 'user_input', content: 'remember this' });
      appendTranscriptEvent('sec_acme', {
        ev_type: 'tool_use',
        content: { id: 'tu_1', name: 'Write', input: { file_path: '/boss/MEMORY/notes.md' } },
      });
      appendTranscriptEvent('sec_acme', { ev_type: 'result', content: 'noted' });
      await new Promise((r) => setTimeout(r, 15));
      const msgs = scoreAndEmitNudges(entry, 'noted', { transcriptRoot });
      expect(msgs.map((m) => m.content)).toContain(HR_NUDGES['read-INDEX-before-act']);
    } finally {
      _resetTranscriptWritersForTest();
      if (prev === undefined) delete process.env.HOLON_TRANSCRIPT_ROOT;
      else process.env.HOLON_TRANSCRIPT_ROOT = prev;
      try { rmSync(transcriptRoot, { recursive: true, force: true }); } catch { /* noop */ }
    }
  });

  it('does NOT tighten read-INDEX when the secretary read INDEX.md first', async () => {
    const { scoreAndEmitNudges, HR_NUDGES } = await import('./hr-path-b-producer');
    const { appendTranscriptEvent, _resetTranscriptWritersForTest } = await import('./warm-agent');
    const transcriptRoot = mkdtempSync(join(tmpdir(), 'hr-tx-'));
    const prev = process.env.HOLON_TRANSCRIPT_ROOT;
    process.env.HOLON_TRANSCRIPT_ROOT = transcriptRoot;
    try {
      _resetTranscriptWritersForTest();
      const cwd = mkdtempSync(join(tmpdir(), 'hr-target-'));
      const entry = { ...ENTRY, cwd };
      appendTranscriptEvent('sec_acme', { ev_type: 'user_input', content: 'remember this' });
      appendTranscriptEvent('sec_acme', {
        ev_type: 'tool_use',
        content: { id: 'tu_0', name: 'Read', input: { file_path: '/boss/INDEX.md' } },
      });
      appendTranscriptEvent('sec_acme', {
        ev_type: 'tool_use',
        content: { id: 'tu_1', name: 'Write', input: { file_path: '/boss/MEMORY/notes.md' } },
      });
      appendTranscriptEvent('sec_acme', { ev_type: 'result', content: 'noted' });
      await new Promise((r) => setTimeout(r, 15));
      const msgs = scoreAndEmitNudges(entry, 'noted', { transcriptRoot });
      expect(msgs.map((m) => m.content)).not.toContain(HR_NUDGES['read-INDEX-before-act']);
    } finally {
      _resetTranscriptWritersForTest();
      if (prev === undefined) delete process.env.HOLON_TRANSCRIPT_ROOT;
      else process.env.HOLON_TRANSCRIPT_ROOT = prev;
      try { rmSync(transcriptRoot, { recursive: true, force: true }); } catch { /* noop */ }
    }
  });

  it('role-fidelity corroborator: assistant DIY text in transcript fails the check even if result string is clean', async () => {
    const { scoreAndEmitNudges, HR_NUDGES } = await import('./hr-path-b-producer');
    const { appendTranscriptEvent, _resetTranscriptWritersForTest } = await import('./warm-agent');
    const transcriptRoot = mkdtempSync(join(tmpdir(), 'hr-tx-'));
    const prev = process.env.HOLON_TRANSCRIPT_ROOT;
    process.env.HOLON_TRANSCRIPT_ROOT = transcriptRoot;
    try {
      _resetTranscriptWritersForTest();
      const cwd = mkdtempSync(join(tmpdir(), 'hr-target-'));
      const entry = { ...ENTRY, cwd };
      appendTranscriptEvent('sec_acme', { ev_type: 'user_input', content: 'do thing' });
      appendTranscriptEvent('sec_acme', { ev_type: 'assistant', content: "OK I'll write the code myself." });
      appendTranscriptEvent('sec_acme', {
        ev_type: 'tool_use',
        content: { id: 'tu_d', name: 'Task', input: { description: 'dispatch' } },
      });
      appendTranscriptEvent('sec_acme', { ev_type: 'result', content: 'all dispatched cleanly' });
      await new Promise((r) => setTimeout(r, 15));
      const msgs = scoreAndEmitNudges(entry, 'all dispatched cleanly', { transcriptRoot });
      expect(msgs.map((m) => m.content)).toContain(HR_NUDGES['role-fidelity']);
    } finally {
      _resetTranscriptWritersForTest();
      if (prev === undefined) delete process.env.HOLON_TRANSCRIPT_ROOT;
      else process.env.HOLON_TRANSCRIPT_ROOT = prev;
      try { rmSync(transcriptRoot, { recursive: true, force: true }); } catch { /* noop */ }
    }
  });

  it('falls back to base rubric when no transcript exists (missing root)', async () => {
    const { scoreAndEmitNudges } = await import('./hr-path-b-producer');
    const cwd = mkdtempSync(join(tmpdir(), 'hr-target-'));
    const entry = { ...ENTRY, cwd };
    const emptyRoot = mkdtempSync(join(tmpdir(), 'hr-tx-empty-'));
    try {
      // Clean result text → base rubric passes everything → no nudges.
      const msgs = scoreAndEmitNudges(entry, 'Dispatched to the implementation sub-agent via Task tool.', { transcriptRoot: emptyRoot });
      expect(msgs).toEqual([]);
    } finally {
      try { rmSync(emptyRoot, { recursive: true, force: true }); } catch { /* noop */ }
    }
  });
});

describe('deriveTranscriptSignals + refineRubricWithTranscript — unit', () => {
  it('deriveTranscriptSignals detects dispatch / file-edit / index-read ordering', async () => {
    const { deriveTranscriptSignals } = await import('./hr-path-b-producer');
    const turns = [
      [
        { ts: 't0', turn_id: 'a', ev_type: 'user_input' as const, content: 'q' },
        { ts: 't1', turn_id: 'a', ev_type: 'tool_use' as const, content: { name: 'Read', input: { file_path: '/boss/INDEX.md' } } },
        { ts: 't2', turn_id: 'a', ev_type: 'tool_use' as const, content: { name: 'Write', input: { file_path: '/boss/MEMORY/x.md' } } },
        { ts: 't3', turn_id: 'a', ev_type: 'tool_use' as const, content: { name: 'mcp__holon__dispatch', input: {} } },
        { ts: 't4', turn_id: 'a', ev_type: 'assistant' as const, content: 'all good' },
      ],
    ];
    const s = deriveTranscriptSignals(turns);
    expect(s.hasDispatchToolUse).toBe(true);
    expect(s.hasFileEditToolUse).toBe(true);
    expect(s.hasMemoryWrite).toBe(true);
    expect(s.hasIndexReadBeforeMemoryWrite).toBe(true);
    expect(s.assistantFirstPersonDIY).toBe(false);
  });

  it('refineRubricWithTranscript never up-grades a base fail', async () => {
    const { refineRubricWithTranscript } = await import('./hr-path-b-producer');
    const baseAllFail = {
      checks: {
        'dispatched-not-DIY': false,
        'respected-north-star': false,
        'read-INDEX-before-act': false,
        'role-fidelity': false,
        'memory-hygiene': false,
      },
    };
    const cleanSignals = {
      hasDispatchToolUse: true,
      hasFileEditToolUse: false,
      hasIndexReadBeforeMemoryWrite: true,
      hasMemoryWrite: false,
      assistantFirstPersonDIY: false,
    };
    const out = refineRubricWithTranscript(baseAllFail, cleanSignals);
    // All still false — refinement only tightens, doesn't loosen.
    for (const v of Object.values(out.checks)) expect(v).toBe(false);
  });
});

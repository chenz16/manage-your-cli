/**
 * transcript-reader — read warm-agent JSONL transcripts (live + rotated).
 *
 * No real HOME / no real warm process: HOLON_TRANSCRIPT_ROOT points at a
 * tmpdir per test. We hand-write synthetic JSONL and verify the reader's
 * turn-grouping, ordering, since-filter, and archive-merge.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readRecentTurns,
  readSince,
  transcriptsRoot,
  type TranscriptEvent,
} from '../src/transcript-reader.js';

let tmpRoot: string;
let prevEnv: string | undefined;

const KEY = 'warm:test-sec';
const SAFE_KEY = 'warm_test-sec'; // ':' → '_' in safeKey()

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'transcript-reader-'));
  prevEnv = process.env.HOLON_TRANSCRIPT_ROOT;
  process.env.HOLON_TRANSCRIPT_ROOT = tmpRoot;
});

afterEach(() => {
  if (prevEnv === undefined) delete process.env.HOLON_TRANSCRIPT_ROOT;
  else process.env.HOLON_TRANSCRIPT_ROOT = prevEnv;
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* noop */ }
});

function ev(ts: string, ev_type: TranscriptEvent['ev_type'], content: unknown, turn_id = `${KEY}-${ts}`): string {
  return JSON.stringify({ ts, turn_id, ev_type, content });
}

function writeLive(lines: string[]): void {
  writeFileSync(join(tmpRoot, `${SAFE_KEY}.jsonl`), lines.join('\n') + '\n');
}

describe('transcriptsRoot', () => {
  it('honors HOLON_TRANSCRIPT_ROOT', () => {
    expect(transcriptsRoot()).toBe(tmpRoot);
  });
  it('respects explicit root arg over env', () => {
    expect(transcriptsRoot('/custom/path')).toBe('/custom/path');
  });
});

describe('readRecentTurns', () => {
  it('returns [] for an empty / missing file', () => {
    expect(readRecentTurns(KEY, 3)).toEqual([]);
  });

  it('groups events into turns at user_input boundaries', () => {
    writeLive([
      ev('2026-05-30T00:00:00Z', 'user_input', 'hi'),
      ev('2026-05-30T00:00:01Z', 'assistant', 'hello'),
      ev('2026-05-30T00:00:02Z', 'result', 'ok'),
      ev('2026-05-30T00:00:10Z', 'user_input', 'do thing'),
      ev('2026-05-30T00:00:11Z', 'tool_use', { name: 'Task' }),
      ev('2026-05-30T00:00:12Z', 'result', 'done'),
    ]);
    const turns = readRecentTurns(KEY, 5);
    expect(turns).toHaveLength(2);
    expect(turns[0]).toHaveLength(3);
    expect(turns[1]).toHaveLength(3);
    expect(turns[0]![0]!.ev_type).toBe('user_input');
    expect(turns[1]![0]!.content).toBe('do thing');
  });

  it('returns only the last N turns', () => {
    writeLive([
      ev('2026-05-30T00:00:00Z', 'user_input', 'q1'),
      ev('2026-05-30T00:00:01Z', 'result', 'r1'),
      ev('2026-05-30T00:00:10Z', 'user_input', 'q2'),
      ev('2026-05-30T00:00:11Z', 'result', 'r2'),
      ev('2026-05-30T00:00:20Z', 'user_input', 'q3'),
      ev('2026-05-30T00:00:21Z', 'result', 'r3'),
    ]);
    const turns = readRecentTurns(KEY, 2);
    expect(turns).toHaveLength(2);
    expect(turns[0]![0]!.content).toBe('q2');
    expect(turns[1]![0]!.content).toBe('q3');
  });

  it('merges rotated archives oldest-first', () => {
    writeFileSync(join(tmpRoot, `${SAFE_KEY}-2026-05-28.jsonl`),
      ev('2026-05-28T00:00:00Z', 'user_input', 'old') + '\n');
    writeFileSync(join(tmpRoot, `${SAFE_KEY}-2026-05-29.jsonl`),
      ev('2026-05-29T00:00:00Z', 'user_input', 'mid') + '\n');
    writeLive([ev('2026-05-30T00:00:00Z', 'user_input', 'new')]);
    const turns = readRecentTurns(KEY, 10);
    expect(turns).toHaveLength(3);
    expect(turns[0]![0]!.content).toBe('old');
    expect(turns[1]![0]!.content).toBe('mid');
    expect(turns[2]![0]!.content).toBe('new');
  });

  it('tolerates corrupt / partial JSONL lines without crashing', () => {
    writeFileSync(join(tmpRoot, `${SAFE_KEY}.jsonl`),
      ev('2026-05-30T00:00:00Z', 'user_input', 'q') + '\n' +
      'this is not json\n' +
      ev('2026-05-30T00:00:01Z', 'result', 'r') + '\n' +
      '{"ts":"truncated' + '\n', // torn last line
    );
    const turns = readRecentTurns(KEY, 5);
    expect(turns).toHaveLength(1);
    expect(turns[0]).toHaveLength(2);
  });
});

describe('readSince', () => {
  it('returns events at-or-after the given ISO ts', () => {
    writeLive([
      ev('2026-05-30T00:00:00Z', 'user_input', 'q1'),
      ev('2026-05-30T01:00:00Z', 'user_input', 'q2'),
      ev('2026-05-30T02:00:00Z', 'user_input', 'q3'),
    ]);
    const out = readSince(KEY, '2026-05-30T01:00:00Z');
    expect(out).toHaveLength(2);
    expect(out[0]?.content).toBe('q2');
  });

  it('uses an explicit root arg over env', () => {
    // Different dir entirely — should see nothing.
    const altRoot = mkdtempSync(join(tmpdir(), 'tr-alt-'));
    try {
      writeLive([ev('2026-05-30T00:00:00Z', 'user_input', 'q1')]);
      expect(readSince(KEY, '2026-01-01T00:00:00Z', altRoot)).toEqual([]);
    } finally {
      rmSync(altRoot, { recursive: true, force: true });
    }
  });
});

describe('directory layout — public schema sanity', () => {
  it('reads the expected `<root>/<safeKey>.jsonl` path', () => {
    // Create a SUB-directory along with the file to make sure the reader
    // doesn't accidentally walk into subdirs.
    mkdirSync(join(tmpRoot, 'sub'), { recursive: true });
    writeLive([ev('2026-05-30T00:00:00Z', 'user_input', 'q')]);
    const turns = readRecentTurns(KEY, 1);
    expect(turns).toHaveLength(1);
  });
});

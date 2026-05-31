/**
 * warm-agent transcript-persistence tests.
 *
 * We test the persistence layer in isolation (no real claude process): drive
 * `appendTranscriptEvent` directly + verify
 *   1. each ev_type writes one valid JSONL line with the expected schema,
 *   2. multiple appends append (no truncation),
 *   3. rotation triggers when the live file crosses 50 MB and the live file
 *      starts fresh while the prior content moves to an archive,
 *   4. HOLON_TRANSCRIPT_ROOT env override is honored (so we never touch ~).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmpRoot: string;
let prevEnv: string | undefined;
const KEY = 'warm:test-sec';
const SAFE_KEY = 'warm_test-sec';

beforeEach(async () => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'warm-transcript-'));
  prevEnv = process.env.HOLON_TRANSCRIPT_ROOT;
  process.env.HOLON_TRANSCRIPT_ROOT = tmpRoot;
  const mod = await import('./warm-agent');
  mod._resetTranscriptWritersForTest();
});

afterEach(async () => {
  const mod = await import('./warm-agent');
  mod._resetTranscriptWritersForTest();
  if (prevEnv === undefined) delete process.env.HOLON_TRANSCRIPT_ROOT;
  else process.env.HOLON_TRANSCRIPT_ROOT = prevEnv;
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* noop */ }
});

/** Wait for buffered writes to flush to disk. createWriteStream is async;
 *  a tick is enough for our tiny test payloads on tmpfs. */
async function flush(): Promise<void> {
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setTimeout(r, 10));
}

function liveFile(): string {
  return join(tmpRoot, `${SAFE_KEY}.jsonl`);
}

function readLiveLines(): string[] {
  return readFileSync(liveFile(), 'utf8').split('\n').filter((l) => l.trim());
}

describe('appendTranscriptEvent — schema + append', () => {
  it('writes each ev_type as a JSONL line with the documented schema', async () => {
    const { appendTranscriptEvent } = await import('./warm-agent');
    appendTranscriptEvent(KEY, { ev_type: 'user_input', content: 'hello' });
    appendTranscriptEvent(KEY, { ev_type: 'assistant', content: 'hi back' });
    appendTranscriptEvent(KEY, { ev_type: 'tool_use', content: { name: 'Task', id: 'tu_1' } });
    appendTranscriptEvent(KEY, { ev_type: 'tool_result', content: { tool_use_id: 'tu_1', content: 'ok' } });
    appendTranscriptEvent(KEY, { ev_type: 'result', content: 'done' });
    await flush();

    const lines = readLiveLines();
    expect(lines).toHaveLength(5);
    for (const line of lines) {
      const obj = JSON.parse(line);
      expect(typeof obj.ts).toBe('string');
      expect(typeof obj.turn_id).toBe('string');
      expect(typeof obj.ev_type).toBe('string');
      expect('content' in obj).toBe(true);
    }
    const types = lines.map((l) => JSON.parse(l).ev_type);
    expect(types).toEqual(['user_input', 'assistant', 'tool_use', 'tool_result', 'result']);
  });

  it('appends across calls (does not truncate)', async () => {
    const { appendTranscriptEvent } = await import('./warm-agent');
    for (let i = 0; i < 50; i++) {
      appendTranscriptEvent(KEY, { ev_type: 'assistant', content: `msg ${i}` });
    }
    await flush();
    expect(readLiveLines()).toHaveLength(50);
  });

  it('uses the HOLON_TRANSCRIPT_ROOT env override (does not touch ~)', async () => {
    const { appendTranscriptEvent } = await import('./warm-agent');
    appendTranscriptEvent(KEY, { ev_type: 'user_input', content: 'hi' });
    await flush();
    expect(existsSync(liveFile())).toBe(true);
    // Sample path used for cleanup grep verification:
    //   <tmpRoot>/warm_test-sec.jsonl
  });
});

describe('appendTranscriptEvent — rotation at 50 MB', () => {
  it('archives the live file once it exceeds 50 MB and starts a fresh one', async () => {
    // Pre-seed the live file just over 50 MB by writing directly (faster
    // than streaming 60 MB through createWriteStream). Then one append
    // should trigger rotation on writer open.
    const { appendTranscriptEvent } = await import('./warm-agent');
    const path = liveFile();
    const filler = 'x'.repeat(50 * 1024 * 1024); // 50 MB-ish
    writeFileSync(path, JSON.stringify({
      ts: '2026-05-30T00:00:00.000Z',
      turn_id: `${KEY}-pre`,
      ev_type: 'assistant',
      content: filler,
    }) + '\n');
    expect(statSync(path).size).toBeGreaterThanOrEqual(50 * 1024 * 1024);

    // Writers were reset in beforeEach → next append re-opens, sees
    // pre-existing >50 MB, rotates to archive, opens fresh live.
    appendTranscriptEvent(KEY, { ev_type: 'user_input', content: 'post-rotate' });
    await flush();

    // Live file should now contain only the new line.
    const liveLines = readLiveLines();
    expect(liveLines).toHaveLength(1);
    expect(JSON.parse(liveLines[0]!).content).toBe('post-rotate');

    // An archive file with date suffix must exist.
    const archives = readdirSync(tmpRoot).filter(
      (n) => n.startsWith(`${SAFE_KEY}-`) && n.endsWith('.jsonl'),
    );
    expect(archives.length).toBeGreaterThanOrEqual(1);
    expect(archives[0]).toMatch(new RegExp(`^${SAFE_KEY}-\\d{4}-\\d{2}-\\d{2}(\\.\\d+)?\\.jsonl$`));
  }, 30_000);
});

describe('appendTranscriptEvent — reader integration', () => {
  it('writes events that the core transcript-reader can turn-group', async () => {
    const { appendTranscriptEvent } = await import('./warm-agent');
    const { readRecentTurns } = await import('@holon/core/transcript-reader');
    appendTranscriptEvent(KEY, { ev_type: 'user_input', content: 'q1' });
    appendTranscriptEvent(KEY, { ev_type: 'assistant', content: 'a1' });
    appendTranscriptEvent(KEY, { ev_type: 'result', content: 'a1' });
    appendTranscriptEvent(KEY, { ev_type: 'user_input', content: 'q2' });
    appendTranscriptEvent(KEY, { ev_type: 'tool_use', content: { name: 'Task' } });
    appendTranscriptEvent(KEY, { ev_type: 'result', content: 'a2' });
    await flush();
    const turns = readRecentTurns(KEY, 5, tmpRoot);
    expect(turns).toHaveLength(2);
    expect(turns[0]![0]!.content).toBe('q1');
    expect(turns[1]![0]!.content).toBe('q2');
    expect(turns[1]!.some((e) => e.ev_type === 'tool_use')).toBe(true);
  });
});

/**
 * consolidator-distill — unit tests for the real LLM-backed distill.
 *
 * We don't actually shell out to `claude` from CI; instead we inject a fake
 * `spawnFn` that mimics the stream-json IPC shape (assistant message events
 * on stdout, close code 0 / non-zero, slow stdout for the timeout path).
 */

import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import { runClaudeDistill, claudeDistill } from './consolidator-distill';

interface FakeProcOptions {
  /** Stream-json events to emit on stdout (one JSON line each). */
  events?: object[];
  /** Process exit code. Defaults to 0. */
  exitCode?: number;
  /** Delay (ms) before emitting events + close. Used to exercise timeout. */
  delayMs?: number;
  /** Throw on spawn (mimics binary-not-found). */
  throwOnSpawn?: boolean;
}

function makeFakeSpawn(opts: FakeProcOptions): (...args: unknown[]) => unknown {
  return ((..._args: unknown[]) => {
    if (opts.throwOnSpawn) throw new Error('spawn ENOENT');

    const proc = new EventEmitter() as EventEmitter & {
      stdout: Readable;
      stderr: Readable;
      stdin: Writable;
      kill: (sig?: string) => void;
    };
    const stdout = new Readable({ read() { /* push externally */ } });
    const stderr = new Readable({ read() { /* push externally */ } });
    const stdin = new Writable({ write(_c, _e, cb) { cb(); } });
    proc.stdout = stdout;
    proc.stderr = stderr;
    proc.stdin = stdin;
    proc.kill = () => { /* no-op for fake */ };

    const fire = (): void => {
      for (const ev of opts.events ?? []) {
        stdout.push(JSON.stringify(ev) + '\n');
      }
      stdout.push(null);
      stderr.push(null);
      proc.emit('close', opts.exitCode ?? 0);
    };
    if (opts.delayMs && opts.delayMs > 0) {
      setTimeout(fire, opts.delayMs);
    } else {
      // Defer one tick so listeners get attached first.
      setImmediate(fire);
    }
    return proc;
  }) as unknown as (...args: unknown[]) => unknown;
}

describe('consolidator-distill — runClaudeDistill', () => {
  it('concatenates assistant text blocks across one or more events', async () => {
    const fakeSpawn = makeFakeSpawn({
      events: [
        // System init — should be ignored.
        { type: 'system', subtype: 'init', session_id: 'fake-sess' },
        // Assistant message with two text blocks (the distill output).
        {
          type: 'assistant',
          message: { content: [
            { type: 'text', text: 'Distilled: keep file paths /etc/foo. ' },
            { type: 'text', text: 'Drop verbose prose.' },
          ] },
        },
        // Result event — ignored.
        { type: 'result', result: { ok: true } },
      ],
      exitCode: 0,
    });

    const out = await runClaudeDistill('Notes', 'original content',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { spawnFn: fakeSpawn as any });
    expect(out).toBe('Distilled: keep file paths /etc/foo. Drop verbose prose.');
  });

  it('returns null on non-zero exit', async () => {
    const fakeSpawn = makeFakeSpawn({
      events: [{
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'partial' }] },
      }],
      exitCode: 2,
    });
    const out = await runClaudeDistill('S', 'c',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { spawnFn: fakeSpawn as any });
    expect(out).toBeNull();
  });

  it('returns null on spawn error (binary missing)', async () => {
    const fakeSpawn = makeFakeSpawn({ throwOnSpawn: true });
    const out = await runClaudeDistill('S', 'c',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { spawnFn: fakeSpawn as any });
    expect(out).toBeNull();
  });

  it('returns null on timeout (stdout never finishes within budget)', async () => {
    const fakeSpawn = makeFakeSpawn({
      events: [{
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'too late' }] },
      }],
      exitCode: 0,
      delayMs: 500, // longer than the 50ms budget below
    });
    const out = await runClaudeDistill('S', 'c', {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      spawnFn: fakeSpawn as any,
      timeoutMs: 50,
    });
    expect(out).toBeNull();
  });

  it('returns null on empty assistant output (no text blocks)', async () => {
    const fakeSpawn = makeFakeSpawn({
      events: [{ type: 'assistant', message: { content: [] } }],
      exitCode: 0,
    });
    const out = await runClaudeDistill('S', 'c',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { spawnFn: fakeSpawn as any });
    expect(out).toBeNull();
  });
});

describe('consolidator-distill — claudeDistill (production wrapper)', () => {
  it('falls back to the STUB_DISTILL marker on real claude failure', async () => {
    // No fakeSpawn injection here — we point HOLON_DISTILL_BINARY at a
    // command that does not exist, so spawn fails synchronously. The
    // production wrapper must then return the stub marker so the
    // consolidator never blocks.
    const prev = process.env.HOLON_DISTILL_BINARY;
    process.env.HOLON_DISTILL_BINARY = '/nonexistent-binary-distill-test';
    try {
      const out = await claudeDistill({ sectionName: 'X', content: 'abc' });
      expect(out).toMatch(/<!-- DISTILLED X: original 3 chars -->/);
    } finally {
      if (prev === undefined) delete process.env.HOLON_DISTILL_BINARY;
      else process.env.HOLON_DISTILL_BINARY = prev;
    }
  });
});

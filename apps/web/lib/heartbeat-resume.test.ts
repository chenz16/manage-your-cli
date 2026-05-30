/**
 * heartbeat.buildResume — per-binary respawn flag matrix.
 *
 * Verifies that a respawned tmux employee gets the right resume fragment for
 * each binary (claude --resume; codex resume <id> subcommand; gemini -r; qwen
 * -r). Unknown binaries / missing session ids fall back to a fresh launch.
 *
 * Source of truth for the flags: each binary's --help, verified 2026-05-30.
 */

import { describe, it, expect } from 'vitest';
import { buildResume } from './heartbeat';

describe('heartbeat.buildResume — per-binary resume flags', () => {
  const sid = 'cafef00d-1234-5678-9abc-def012345678';

  it('claude: --resume <id> appended after interactive args', () => {
    expect(buildResume('claude', sid)).toEqual({ prefix: '', suffix: ` --resume ${sid}` });
  });

  it('codex: `resume <id>` subcommand prepended', () => {
    expect(buildResume('codex', sid)).toEqual({ prefix: `resume ${sid} `, suffix: '' });
  });

  it('gemini: -r <id> prepended', () => {
    expect(buildResume('gemini', sid)).toEqual({ prefix: `-r ${sid} `, suffix: '' });
  });

  it('qwen: -r <id> prepended', () => {
    expect(buildResume('qwen', sid)).toEqual({ prefix: `-r ${sid} `, suffix: '' });
  });

  it('no session id → fresh launch (empty fragment) for every binary', () => {
    for (const b of ['claude', 'codex', 'gemini', 'qwen', 'mystery']) {
      expect(buildResume(b, null)).toEqual({ prefix: '', suffix: '' });
      expect(buildResume(b, undefined)).toEqual({ prefix: '', suffix: '' });
      expect(buildResume(b, '')).toEqual({ prefix: '', suffix: '' });
    }
  });

  it('unknown binary with a session id → no fake flag (fresh launch)', () => {
    // Refuse to invent a flag we can't verify — the launch goes fresh and
    // logs a respawn rather than firing a guess.
    expect(buildResume('hermes', sid)).toEqual({ prefix: '', suffix: '' });
  });
});

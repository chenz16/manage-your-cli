import { describe, it, expect, afterAll } from 'vitest';
import { ensureManagerStaff, runManagerTurn } from '../src/manager-chat-service.js';
import { killCliSession, getCliStatus } from '../src/cli-session-service.js';

// Real integration smoke: launches an actual claude tmux session, sends one turn,
// reads the reply back off the screen. Verifies slice 2 (manager-CLI chat) end-to-end.
// OPT-IN ONLY — needs a logged-in `claude`/`codex` CLI + tmux on the box and spends
// real subscription tokens, so it's skipped in normal/CI runs. Run it with:
//   HOLON_LIVE_CLI=1 pnpm -F @holon/core exec vitest run tests/manager-chat-smoke.test.ts
describe.skipIf(!process.env.HOLON_LIVE_CLI)('runManagerTurn (real claude session)', () => {
  const staff = ensureManagerStaff();
  afterAll(() => { killCliSession(staff.id); });

  it('round-trips a terse reply', async () => {
    const stream: string[] = [];
    const res = await runManagerTurn({
      ownerText: 'Reply with exactly this token and nothing else: READY-HOLON-7',
      timeoutMs: 90_000,
      onText: (r) => { stream.push(r); },
    });
    console.log('=== STOP_REASON:', res.stopReason, 'OK:', res.ok, 'LAUNCHED:', res.launched);
    console.log('=== STREAM_UPDATES:', stream.length);
    console.log('=== REPLY_START >>>');
    console.log(res.reply);
    console.log('=== <<< REPLY_END');
    console.log('=== SESSION_RUNNING_AFTER:', getCliStatus(staff.id).running);
    expect(res.ok).toBe(true);
    expect(res.reply.length).toBeGreaterThan(0);
  }, 120_000);
});

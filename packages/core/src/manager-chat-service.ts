import type { Staff } from '@holon/api-contract';
import { getCliAdapter } from './cli-adapters.js';
import { ensureManagerWorkspace } from './cli-memory-scaffold.js';
import { looksLikeBareShell } from './cli-dispatch-service.js';
import { captureCliOutput, getCliStatus, launchCliSession, sendPrompt } from './cli-session-service.js';
import { createStaff, listStaffMerged } from './staff-management-service.js';

export interface RunManagerTurnInput {
  ownerText: string;
  onText?: (replySoFar: string) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface RunManagerTurnResult {
  ok: boolean;
  reply: string;
  launched: boolean;
  stopReason: 'end_turn' | 'timeout' | 'aborted' | 'agent_not_running';
  reason?: string;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const BOOT_WAIT_MS = 2_500;
const POLL_MS = 800;
// The ONLY reliable "still generating" marker: claude/codex show "esc to interrupt"
// while a turn is in flight; it disappears the instant the turn completes. The
// post-turn summary line ("✻ Cogitated for 1s") and spinner glyphs PERSIST after
// completion, so they can't be used for busy detection — we rely on screen
// stability instead (see the poll loop). Tuned 2026-05-23 vs claude v2.1.150.
const HARD_BUSY_RE = /esc to interrupt/i;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export function ensureManagerStaff(): Staff {
  const existing = listStaffMerged().find((staff) => staff.role_name === 'sr_manager');
  if (existing) return existing;

  const binary = process.env.HOLON_MANAGER_BINARY?.trim() || 'claude';
  return createStaff({
    name: 'Sr Manager',
    role_label: 'Sr Manager',
    role_name: 'sr_manager',
    substrate: {
      kind: 'cli_agent',
      binary,
      lifecycle: 'long',
      cwd: ensureManagerWorkspace(),
      auto_launch: true,
      args_template: getCliAdapter(binary).interactiveArgs,
      approval_rules: [],
    },
  });
}

export async function runManagerTurn(input: RunManagerTurnInput): Promise<RunManagerTurnResult> {
  const staff = ensureManagerStaff();
  const id = staff.id;
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const startedAt = Date.now();
  let launched = false;
  let reply = '';

  const finish = (result: Omit<RunManagerTurnResult, 'reply' | 'launched'> & { reply?: string }): RunManagerTurnResult => {
    const finalReply = result.reply ?? reply;
    console.log(JSON.stringify({
      audit: 'manager.chat_turn',
      staff_id: id,
      launched,
      owner_chars: input.ownerText.length,
      reply_chars: finalReply.length,
      stop_reason: result.stopReason,
      ts: new Date().toISOString(),
    }));
    return { ...result, reply: finalReply, launched };
  };

  if (!getCliStatus(id).running) {
    const launch = launchCliSession(id);
    if (!launch.ok) {
      return finish({ ok: false, reply: '', stopReason: 'agent_not_running', reason: launch.reason });
    }
    launched = !launch.already_running;
    if (launched) await sleep(BOOT_WAIT_MS);
  }

  if (looksLikeBareShell(id)) {
    return finish({
      ok: false,
      reply: '',
      stopReason: 'agent_not_running',
      reason: 'manager CLI is not running in its session',
    });
  }

  const sent = sendPrompt(id, input.ownerText);
  if (!sent.ok) {
    return finish({
      ok: false,
      reply: '',
      stopReason: 'agent_not_running',
      reason: sent.reason ?? 'send_failed',
    });
  }

  let lastEmitted = '';
  let lastScreen: string | null = null;
  let stableReads = 0;

  while (Date.now() - startedAt < timeoutMs) {
    await sleep(POLL_MS);

    if (input.signal?.aborted) {
      return finish({ ok: true, stopReason: 'aborted' });
    }

    const snap = captureCliOutput(id, 400);
    if (!snap.ok) continue;

    const scrollback = snap.output ?? '';
    reply = extractManagerReply(scrollback, input.ownerText);
    if (reply !== lastEmitted) {
      lastEmitted = reply;
      input.onText?.(reply);
    }

    // The turn is settled when the agent is not actively generating
    // (no "esc to interrupt") AND the screen has stopped changing — claude's
    // post-turn summary line persists, so we can't wait for it to vanish; we
    // wait for the screen to go quiet. Require the reply to be non-empty so we
    // never settle on a still-booting / empty screen.
    const generating = HARD_BUSY_RE.test(scrollback);
    if (generating || !reply) {
      stableReads = 0;
      lastScreen = scrollback;
      continue;
    }
    if (scrollback === lastScreen) {
      stableReads += 1;
      if (stableReads >= 2) return finish({ ok: true, stopReason: 'end_turn' });
    } else {
      stableReads = 0;
      lastScreen = scrollback;
    }
  }

  return finish({ ok: true, stopReason: 'timeout' });
}

// Extract the agent's answer from a claude/codex TUI screen capture. Heuristic but
// anchored to the real layout (tuned 2026-05-23 vs claude v2.1.150): the answer sits
// BETWEEN the echoed prompt and the first horizontal separator / empty input box, e.g.
//   ❯ <prompt>
//   ● <answer line 1>
//     <answer line 2>
//   ✻ Cogitated for 1s        ← post-turn summary (dropped)
//   ──────────────────────    ← separator (bounds the answer)
//   ❯                         ← idle input box
export function extractManagerReply(scrollback: string, sentPrompt: string): string {
  const promptTail = sentPrompt.split('\n').map((l) => l.trim()).filter(Boolean).at(-1);
  const start = promptTail ? scrollback.lastIndexOf(promptTail) : -1;
  const after = start >= 0 ? scrollback.slice(start + promptTail!.length) : scrollback;

  const isSeparator = (l: string): boolean => /^\s*[─━]{6,}\s*$/.test(l) || /^[╭╮╰╯│─━\s]*$/.test(l) && /[╭╮╰╯│─━]/.test(l);
  const isInputBox = (l: string): boolean => /^\s*[>❯⏵]/.test(l);
  const isStatus = (l: string): boolean =>
    /^\s*[✻✶✳*]\s/.test(l) || /esc to interrupt|tokens used|bypass permissions|\? for shortcuts|focus-events|focus tracking/i.test(l);

  const out: string[] = [];
  for (const raw of after.split('\n')) {
    // Stop at the boundary that follows the answer: the first separator or the
    // idle input box. (We've already consumed the answer lines before it.)
    if (out.length > 0 && (isSeparator(raw) || isInputBox(raw))) break;
    if (isSeparator(raw) || isInputBox(raw) || isStatus(raw)) continue;
    if (!raw.trim()) { if (out.length) out.push(''); continue; } // keep internal blanks
    out.push(raw.replace(/^\s*[●⏺⎿]\s?/, '').replace(/\s+$/, '')); // strip answer bullet + trailing ws
  }

  while (out[0] === '') out.shift();
  while (out.at(-1) === '') out.pop();
  const cleaned = out.join('\n').trim();
  // Fallback: anchor not found AND nothing parsed → return the raw screen so we
  // never drop a real answer (verification surfaces these to retune the regexes).
  return cleaned || (start < 0 ? scrollback.trim() : '');
}

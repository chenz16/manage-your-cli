/**
 * cli-settle — shared settle-detection loop extracted from adopted-summarizer.
 *
 * Polls the tmux pane for the target staff, waits until the CLI finishes
 * generating (esc-to-interrupt indicator gone for SETTLE_EQUAL_COUNT polls),
 * then returns { settled, finalText, delta }.
 *
 * Used by:
 *   - adopted-summarizer.ts (for summarizing staff-chat turns)
 *   - rooms API (for capturing the raw agent reply in a room thread)
 *
 * The owner verified that GENERATING_RE / statusTail logic works — do NOT
 * reinvent; this file copies the working constants and reuses them verbatim.
 */

import { captureCliOutput } from '@holon/core';

const POLL_MS = 600;
const SETTLE_EQUAL_COUNT = 2;
const DEFAULT_TIMEOUT_MS = 120_000;
const TAIL_LINES = 40;
const STATUS_TAIL_LINES = 8;

/** The live indicator claude shows while generating. Present = still answering. */
export const GENERATING_RE = /esc to interrupt/i;

/** Last N lines of screen — where claude's live status/spinner lives. */
export function statusTail(text: string): string {
  const lines = text.split('\n');
  return lines.slice(-STATUS_TAIL_LINES).join('\n');
}

/**
 * Compute text that appeared after preSend.
 * Strategy: find preSend as suffix-anchor in current text. Fallback = last TAIL_LINES.
 */
export function computeDelta(preSend: string, current: string): string {
  const idx = current.lastIndexOf(preSend);
  if (idx >= 0) {
    const after = current.slice(idx + preSend.length);
    const trimmed = after.trim();
    if (trimmed.length > 0) return trimmed;
  }
  const lines = current.split('\n');
  return lines.slice(-TAIL_LINES).join('\n').trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export interface SettleResult {
  settled: boolean;
  finalText: string;
  delta: string;
}

export interface WaitForCliSettleOptions {
  timeoutMs?: number;
}

/**
 * Wait for the CLI pane for `staffId` to settle after a sendKeys.
 *
 * @param staffId    - staff id whose tmux session to watch
 * @param preSend    - pane text captured BEFORE sendKeys (used to compute delta)
 * @param options    - optional overrides (timeoutMs defaults to 120s)
 */
export async function waitForCliSettle(
  staffId: string,
  preSend: string,
  options: WaitForCliSettleOptions = {},
): Promise<SettleResult> {
  const hardCap = Date.now() + (options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let lastText = preSend;
  let idleCount = 0;
  let settled = false;
  let sawGenerating = false;

  while (Date.now() < hardCap) {
    await sleep(POLL_MS);
    const capture = captureCliOutput(staffId);
    if (!capture.ok || !capture.output) {
      // Session gone — return what we have.
      break;
    }
    const current = capture.output;
    lastText = current;

    if (GENERATING_RE.test(statusTail(current))) {
      sawGenerating = true;
      idleCount = 0;
      continue;
    }
    if (!sawGenerating && current === preSend) continue;
    idleCount++;
    if (idleCount >= SETTLE_EQUAL_COUNT) { settled = true; break; }
  }

  const delta = computeDelta(preSend, lastText);
  return { settled, finalText: lastText, delta };
}

/**
 * hr-promotion — Path B → Path A auto-promotion (§4.4).
 *
 * Threshold: same Path-B nudge fires ≥3 times in a rolling 24h window for
 * the same target → promote to Path A by writing into the target's memory
 * file and surfacing a 🔴 line in the owner-HR promotion log.
 *
 * Vetoes (owner revert) live at `hrVetoPath()`. Format:
 *   { vetoes: [{ ruleHash, ruleText, vetoedAt }] }
 * A ruleHash in this list blocks future promotions for that rule.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const nodeRequire = eval('require') as (id: string) => any;
const { appendFileSync, existsSync, mkdirSync, readFileSync } = nodeRequire('fs') as typeof import('fs');
const { dirname } = nodeRequire('path') as typeof import('path');
import { hrPromotionLogPath, hrVetoPath } from './hr-paths.js';
import { writeHrCorrection, type HrCorrectionRule } from './hr-path-a.js';

export interface HrCounter {
  /** Epoch-ms timestamps of recent fires; only the rolling-24h subset
   *  counts toward the threshold. */
  fires: number[];
}

export interface PromotionVeto {
  ruleHash: string;
  ruleText: string;
  vetoedAt: number;
}

interface VetoFile { vetoes: PromotionVeto[] }

const WINDOW_MS = 24 * 60 * 60 * 1000;
const THRESHOLD = 3;

function readVetoes(): PromotionVeto[] {
  const p = hrVetoPath();
  if (!existsSync(p)) return [];
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as VetoFile;
    return Array.isArray(raw?.vetoes) ? raw.vetoes : [];
  } catch {
    return [];
  }
}

export function isVetoed(ruleHash: string): boolean {
  return readVetoes().some((v) => v.ruleHash === ruleHash);
}

/** Count fires within the last 24h. */
export function firesInWindow(counter: HrCounter, now: number = Date.now()): number {
  const cutoff = now - WINDOW_MS;
  return counter.fires.filter((t) => t >= cutoff).length;
}

export interface PromotionResult {
  promoted: boolean;
  reason?: 'below_threshold' | 'vetoed' | 'wrote';
  ruleHash: string;
}

/**
 * Inspect counter; if ≥3 fires in 24h AND not vetoed, write Path A
 * correction and append a 🔴 line to the promotion log.
 *
 * Caller (Path B producer) updates the counter independently — this fn is
 * pure-read on the counter.
 */
export function maybePromoteToA(
  targetMemoryFilePath: string,
  ruleHash: string,
  ruleText: string,
  counter: HrCounter,
  opts: { now?: Date; agentLabel?: string } = {},
): PromotionResult {
  const nowMs = opts.now?.getTime() ?? Date.now();
  const fires = firesInWindow(counter, nowMs);
  if (fires < THRESHOLD) {
    return { promoted: false, reason: 'below_threshold', ruleHash };
  }
  if (isVetoed(ruleHash)) {
    return { promoted: false, reason: 'vetoed', ruleHash };
  }
  const rule: HrCorrectionRule = {
    text: ruleText,
    source: 'owner-HR',
    promotedFromB: true,
  };
  const opts2: { now?: Date } = {};
  if (opts.now) opts2.now = opts.now;
  writeHrCorrection(targetMemoryFilePath, rule, opts2);
  const logPath = hrPromotionLogPath();
  mkdirSync(dirname(logPath), { recursive: true });
  const agent = opts.agentLabel ?? targetMemoryFilePath;
  const line = `🔴 HR auto-promoted on ${agent}: "${ruleText.replace(/"/g, '\\"')}". Accept / edit / revert.\n`;
  appendFileSync(logPath, line);
  return { promoted: true, reason: 'wrote', ruleHash };
}

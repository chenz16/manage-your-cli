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
const { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync } = nodeRequire('fs') as typeof import('fs');
const { dirname } = nodeRequire('path') as typeof import('path');
import { hrPromotionLogPath, hrVetoPath, legacyHrVetoPath } from './hr-paths.js';
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

/**
 * One-shot migration of the legacy HR-scoped veto file (ADR §4.9).
 *
 * If `legacyHrVetoPath()` exists AND `hrVetoPath()` does not, atomic-rename
 * legacy → new. If the new path already exists, leave the legacy file in
 * place untouched (no overwrite, no delete — preserves owner data while
 * avoiding silent loss; owner can inspect and remove manually). If legacy
 * doesn't exist, no-op.
 *
 * NEVER throws — HR boot must not fail on a migration error. Errors are
 * logged via console.warn + an `hr.veto.migrate.failed` audit line.
 *
 * Returns the action taken so callers (and tests) can verify.
 */
export function migrateLegacyVetoesIfNeeded(): 'migrated' | 'skipped_new_exists' | 'noop' | 'failed' {
  const legacy = legacyHrVetoPath();
  const current = hrVetoPath();
  try {
    if (!existsSync(legacy)) return 'noop';
    if (existsSync(current)) return 'skipped_new_exists';
    mkdirSync(dirname(current), { recursive: true });
    renameSync(legacy, current);
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({
      audit: 'hr.veto.migrated',
      from: legacy,
      to: current,
      at: Date.now(),
    }));
    return 'migrated';
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(JSON.stringify({
      audit: 'hr.veto.migrate.failed',
      from: legacy,
      to: current,
      error: err instanceof Error ? err.message : String(err),
      at: Date.now(),
    }));
    return 'failed';
  }
}

/** Key migration by resolved paths so an env-override change (tests) does
 *  not retain a stale "already migrated" flag. */
const migrationAttemptedFor = new Set<string>();
function ensureMigrationOnce(): void {
  const key = `${legacyHrVetoPath()}|${hrVetoPath()}`;
  if (migrationAttemptedFor.has(key)) return;
  migrationAttemptedFor.add(key);
  migrateLegacyVetoesIfNeeded();
}

function readVetoes(): PromotionVeto[] {
  ensureMigrationOnce();
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

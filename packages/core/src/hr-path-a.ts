/**
 * hr-path-a — Path A writer: persistent memory patch into the target agent's
 * per-CLI memory file (CLAUDE.md / AGENTS.md / GEMINI.md / QWEN.md).
 *
 * Spec: docs/adr/hr-evaluator-and-behavior-correction.md §4.3 Path A + §4.4
 * promotion. Idempotent by stable rule-hash: re-running the same rule
 * refreshes the date in place instead of appending a duplicate.
 *
 * The managed section is bracketed by a sentinel comment so we can detect
 * it AND refuse to clobber a hand-written `## HR-Corrections` heading that
 * the owner created without the sentinel.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface HrCorrectionRule {
  text: string;
  source: 'owner-HR' | 'secretary-HR';
  reason?: string;
  promotedFromB?: boolean;
}

const SECTION_HEADING = '## HR-Corrections';
const SECTION_SENTINEL = '<!-- managed by owner-HR — do not hand-edit; owner can revert via the 🔴 line -->';

/** Normalize a rule for stable hashing: lowercase, collapse whitespace,
 *  strip trailing punctuation. Exported so tests can verify hash inputs. */
export function normalizeRuleText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[\s.,;:!?。，；：！？]+$/u, '')
    .trim();
}

/** Stable 12-char hex hash. SHA-256 truncated — collision space is huge
 *  enough for the few-dozen-rules regime we expect. */
export function stableRuleHash(text: string): string {
  return createHash('sha256').update(normalizeRuleText(text)).digest('hex').slice(0, 12);
}

function todayISO(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

interface SectionLocator {
  /** Index of `## HR-Corrections` heading line, or -1 if absent. */
  headingIdx: number;
  /** Index of the sentinel comment line (must follow heading), or -1. */
  sentinelIdx: number;
  /** Index of the line AFTER the section body ends (i.e. next `## ` or EOF). */
  endIdx: number;
}

function locateSection(lines: string[]): SectionLocator {
  let headingIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if ((lines[i] ?? '').trim() === SECTION_HEADING) { headingIdx = i; break; }
  }
  if (headingIdx < 0) return { headingIdx: -1, sentinelIdx: -1, endIdx: -1 };
  // Sentinel must appear in the next few lines (allow a blank line between).
  let sentinelIdx = -1;
  for (let j = headingIdx + 1; j < Math.min(lines.length, headingIdx + 4); j++) {
    const lj = lines[j] ?? '';
    if (lj.trim() === SECTION_SENTINEL) { sentinelIdx = j; break; }
    if (lj.trim() && !lj.startsWith('<!--')) break;
  }
  // End = next `## ` heading or EOF.
  let endIdx = lines.length;
  for (let k = headingIdx + 1; k < lines.length; k++) {
    const lk = lines[k] ?? '';
    if (lk.startsWith('## ') && lk.trim() !== SECTION_HEADING) { endIdx = k; break; }
  }
  return { headingIdx, sentinelIdx, endIdx };
}

function atomicWrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.hr-tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, content);
  renameSync(tmp, path);
}

/**
 * Write (or refresh) an HR-Corrections rule line into the target memory
 * file. Idempotent by ruleHash. Atomic (tempfile + rename).
 *
 * Throws if a `## HR-Corrections` heading exists WITHOUT the sentinel —
 * that means the owner hand-authored a section and we must not clobber it.
 */
export function writeHrCorrection(
  targetMemoryFilePath: string,
  rule: HrCorrectionRule,
  opts: { now?: Date } = {},
): { added: boolean; replaced: boolean; ruleHash: string } {
  const ruleHash = stableRuleHash(rule.text);
  const date = todayISO(opts.now ?? new Date());
  const entryLine = `- (${date}) [#${ruleHash}] ${rule.text.trim()}`;

  const existing = existsSync(targetMemoryFilePath)
    ? readFileSync(targetMemoryFilePath, 'utf8')
    : '';
  // Normalize line endings to \n for in-memory work; write back \n.
  const lines = existing.split('\n');
  // Drop the synthetic trailing empty element from final newline so we
  // can re-add a single trailing newline at the end.
  const hadTrailingNL = existing.endsWith('\n');
  if (hadTrailingNL) lines.pop();

  const loc = locateSection(lines);
  if (loc.headingIdx >= 0 && loc.sentinelIdx < 0) {
    throw new Error(
      `hr-path-a: ${targetMemoryFilePath} has a '## HR-Corrections' heading ` +
      `without the managed-section sentinel — refusing to overwrite owner content.`,
    );
  }

  let added = false;
  let replaced = false;

  if (loc.headingIdx < 0) {
    // Append a fresh managed section at EOF.
    const block: string[] = [];
    if (lines.length > 0 && lines[lines.length - 1] !== '') block.push('');
    block.push(SECTION_HEADING);
    block.push(SECTION_SENTINEL);
    block.push('');
    block.push(entryLine);
    lines.push(...block);
    added = true;
  } else {
    // Find a prior entry with the same ruleHash inside the section body.
    const tag = `[#${ruleHash}]`;
    let foundLineIdx = -1;
    for (let i = loc.sentinelIdx + 1; i < loc.endIdx; i++) {
      if ((lines[i] ?? '').includes(tag)) { foundLineIdx = i; break; }
    }
    if (foundLineIdx >= 0) {
      lines[foundLineIdx] = entryLine;
      replaced = true;
    } else {
      // Insert before the next `## ` heading (or at endIdx) — keep
      // chronological-append shape.
      // Skip trailing blank lines inside the section.
      let insertAt = loc.endIdx;
      while (insertAt - 1 > loc.sentinelIdx && lines[insertAt - 1] === '') insertAt--;
      lines.splice(insertAt, 0, entryLine);
      added = true;
    }
  }

  const out = lines.join('\n') + '\n';
  atomicWrite(targetMemoryFilePath, out);
  return { added, replaced, ruleHash };
}

/**
 * memory-consolidator — sleep-time per-agent CLAUDE.md distiller.
 *
 * Covers the safety invariants from
 * docs/adr/sleep-time-memory-consolidator.md:
 *   1. Skips when file is under minBytes.
 *   2. Skips when sidecar timestamp is within minIntervalMs.
 *   3. Preserves `## Role-Composition` byte-for-byte.
 *   4. Preserves `## HR-Corrections` byte-for-byte.
 *   5. Preserves owner-edits content (below the `<!-- owner-edits below -->`
 *      sentinel inside Role-Composition).
 *   6. Distill is called ONLY for non-managed sections.
 *   7. Sentinel-managed sections (`<!-- managed by ... -->`) are preserved.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { consolidateMemoryFile, STUB_DISTILL } from '../src/memory-consolidator.js';

let tmpRoot: string;
let memPath: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'memory-consolidator-'));
  memPath = join(tmpRoot, 'CLAUDE.md');
});

afterEach(() => {
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* noop */ }
});

const ROLE_BLOCK = [
  '## Role-Composition',
  '<!-- managed by holon-create-agent — do not hand-edit above the owner-edits sentinel -->',
  '',
  '### Identity',
  'Senior secretary persona for Acme project.',
  '',
  '### Responsibilities',
  '- Dispatch heavy work to employees.',
  '',
  '<!-- owner-edits below -->',
  '',
  'OWNER NOTE: keep this line forever, the consolidator must never touch it.',
].join('\n');

const HR_BLOCK = [
  '## HR-Corrections',
  '<!-- managed by owner-HR — do not hand-edit; owner can revert via the 🔴 line -->',
  '',
  '- (2026-05-30) [#abc123def456] Always dispatch heavy work; do not execute it yourself.',
].join('\n');

function padTo(text: string, atLeastBytes: number): string {
  // Append a long free-form section so the file clears minBytes.
  const filler: string[] = ['', '## Conversation-Digest', ''];
  let i = 0;
  while (text.length + filler.join('\n').length < atLeastBytes) {
    filler.push(`- (digest line ${i}) lorem ipsum dolor sit amet consectetur adipiscing elit.`);
    i++;
  }
  return text + '\n' + filler.join('\n') + '\n';
}

describe('consolidateMemoryFile — guards', () => {
  it('skips when file is under minBytes', async () => {
    writeFileSync(memPath, '## Foo\nshort content\n');
    const r = await consolidateMemoryFile(memPath, {
      minBytes: 50 * 1024,
      distill: STUB_DISTILL,
      now: Date.parse('2026-05-30T00:00:00Z'),
    });
    expect(r.skipped).toBe(true);
    expect(r.reason).toMatch(/under-min-bytes/);
    // File untouched.
    expect(readFileSync(memPath, 'utf8')).toBe('## Foo\nshort content\n');
  });

  it('skips on file-missing', async () => {
    const r = await consolidateMemoryFile(join(tmpRoot, 'nope.md'), {
      distill: STUB_DISTILL, minBytes: 1,
    });
    expect(r.skipped).toBe(true);
    expect(r.reason).toBe('file-missing');
  });

  it('skips when sidecar ts is within minIntervalMs and writes sidecar on first pass', async () => {
    const big = padTo(ROLE_BLOCK + '\n' + HR_BLOCK, 60 * 1024);
    writeFileSync(memPath, big);
    const t0 = Date.parse('2026-05-30T00:00:00Z');
    const calls: string[] = [];
    const distill = async ({ sectionName, content }: { sectionName: string; content: string }) => {
      calls.push(sectionName);
      return STUB_DISTILL({ sectionName, content });
    };
    // First pass: should run, write sidecar.
    const r1 = await consolidateMemoryFile(memPath, { distill, minBytes: 1024, now: t0 });
    expect(r1.skipped).toBe(false);
    expect(calls.length).toBeGreaterThan(0);
    // Second pass: same now → must skip due to cooldown (use minBytes:1
    // so the size-shrunk file doesn't trip under-min-bytes first).
    calls.length = 0;
    const r2 = await consolidateMemoryFile(memPath, { distill, minBytes: 1, now: t0 + 60_000 });
    expect(r2.skipped).toBe(true);
    expect(r2.reason).toMatch(/cooldown/);
    expect(calls.length).toBe(0);
    // Third pass after 24h: cooldown is past, runs again.
    const r3 = await consolidateMemoryFile(memPath, {
      distill, minBytes: 1, now: t0 + 24 * 60 * 60 * 1000 + 1,
    });
    expect(r3.skipped).toBe(false);
  });
});

describe('consolidateMemoryFile — preservation invariants', () => {
  it('preserves Role-Composition, HR-Corrections, and owner-edits content; distills only the rest', async () => {
    const free = [
      '## Conversation-Digest',
      '',
      'Long owner-authored running notes that grow over time.',
      'Line 2. Line 3. Line 4. ' + 'x'.repeat(2000),
      '',
      '## Random-Notes',
      '',
      'More accumulated ad-hoc notes the owner pasted.',
      'y'.repeat(2000),
    ].join('\n');
    const full = [ROLE_BLOCK, HR_BLOCK, free].join('\n\n');
    const padded = padTo(full, 60 * 1024); // cross minBytes
    writeFileSync(memPath, padded);

    const calls: string[] = [];
    const r = await consolidateMemoryFile(memPath, {
      distill: async ({ sectionName, content }) => {
        calls.push(sectionName);
        return `<!-- DISTILLED ${sectionName}: original ${content.length} chars -->\n`;
      },
      minBytes: 1024,
      now: Date.parse('2026-05-30T00:00:00Z'),
    });
    expect(r.skipped).toBe(false);

    const out = readFileSync(memPath, 'utf8');

    // 1. Role-Composition: preserved verbatim, byte-for-byte.
    expect(out).toContain(ROLE_BLOCK);
    // 2. HR-Corrections: preserved verbatim.
    expect(out).toContain(HR_BLOCK);
    // 3. owner-edits content under the sentinel survives untouched.
    expect(out).toContain('OWNER NOTE: keep this line forever, the consolidator must never touch it.');
    // 4. Distill was called on the non-managed sections only.
    expect(calls).toContain('Conversation-Digest');
    expect(calls).toContain('Random-Notes');
    expect(calls).not.toContain('Role-Composition');
    expect(calls).not.toContain('HR-Corrections');
    // 5. result lists match
    expect(r.preservedSections).toEqual(expect.arrayContaining(['Role-Composition', 'HR-Corrections']));
    expect(r.consolidatedSections).toEqual(expect.arrayContaining(['Conversation-Digest', 'Random-Notes']));
    // 6. File shrank.
    expect(r.after.bytes).toBeLessThan(r.before.bytes);
    expect(statSync(memPath).size).toBe(r.after.bytes);
  });

  it('treats any `<!-- managed by ... -->` sentinel section as preserved', async () => {
    const customManaged = [
      '## My-Custom-Managed',
      '<!-- managed by some-other-tool — keep me intact -->',
      '',
      'sentinel-protected body line 1',
      'sentinel-protected body line 2',
    ].join('\n');
    const free = [
      '## Free-Notes',
      'distill me away',
      'really long content '.repeat(500),
    ].join('\n');
    const full = padTo([customManaged, free].join('\n\n'), 60 * 1024);
    writeFileSync(memPath, full);

    const r = await consolidateMemoryFile(memPath, {
      distill: STUB_DISTILL, minBytes: 1024, now: Date.parse('2026-05-30T00:00:00Z'),
    });
    expect(r.skipped).toBe(false);
    expect(r.preservedSections).toContain('My-Custom-Managed');
    expect(r.consolidatedSections).toContain('Free-Notes');
    const out = readFileSync(memPath, 'utf8');
    expect(out).toContain(customManaged);
  });
});

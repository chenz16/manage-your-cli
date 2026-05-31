/**
 * memory-consolidator — sleep-time per-agent CLAUDE.md distiller.
 *
 * Spec: docs/adr/sleep-time-memory-consolidator.md.
 * Companion: docs/architecture/memory-update-flow.md
 *           (Flow 2 is harvest-on-retire at the BOSS-MEMORY layer; this file
 *            distills the PER-AGENT CLAUDE.md while the agent is still live).
 *
 * Invariants:
 *   - NEVER touches managed sections verbatim:
 *       `## Role-Composition`, `## HR-Corrections`,
 *       any section whose first non-blank body line is a `<!-- managed by ... -->`
 *       sentinel.
 *   - NEVER touches owner-edits content (everything inside `## Role-Composition`
 *     below the `<!-- owner-edits below -->` sentinel and through end of that
 *     section).
 *   - Other top-level (`## `) sections are passed through `options.distill()`,
 *     which returns a shorter rewrite.
 *   - Atomic on-disk write (temp + rename).
 *   - Honors a 24h-default per-file cooldown via a sidecar
 *     `<filePath>.consolidated.json`: `{ ts, before_bytes, after_bytes }`.
 *   - Skips when file is under `minBytes` (default 50KB).
 *
 * Slice 1: ships the plumbing + invariants. The `distill` impl is caller-
 * provided; the heartbeat tick wires in a stub that just marks the section
 * length. Real LLM-backed distill lands in a downstream slice.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const nodeRequire = eval('require') as (id: string) => any;
const {
  existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync,
} = nodeRequire('fs') as typeof import('fs');
const { dirname } = nodeRequire('path') as typeof import('path');

/** Managed-section identifiers we will NEVER overwrite. */
const ROLE_COMPOSITION_HEADING = '## Role-Composition';
const HR_CORRECTIONS_HEADING = '## HR-Corrections';
const OWNER_EDITS_SENTINEL = '<!-- owner-edits below -->';
const MANAGED_SENTINEL_RE = /^<!--\s*managed by\s+/i;

export interface ConsolidationResult {
  staffId: string;
  filePath: string;
  before: { bytes: number; sectionCounts: Record<string, number> };
  after:  { bytes: number; sectionCounts: Record<string, number> };
  /** Section headings kept byte-for-byte. */
  preservedSections: string[];
  /** Section headings rewritten by distill. */
  consolidatedSections: string[];
  /** True if no consolidation was warranted (cooldown / too small / no work). */
  skipped: boolean;
  reason?: string;
}

export interface ConsolidatorOptions {
  /** Only consolidate when file is at least this big (bytes). Default 50KB. */
  minBytes?: number;
  /** Min time since last consolidation for the same file (ms). Default 24h. */
  minIntervalMs?: number;
  /** Caller-provided distill. Returns the rewritten content (without heading). */
  distill: (input: { sectionName: string; content: string }) => Promise<string>;
  /** Now override (ms epoch) for tests. */
  now?: number;
  /** Optional staff id for the result payload (does not affect logic). */
  staffId?: string;
}

interface Section {
  /** Heading line as it appears in the file, e.g. "## HR-Corrections". */
  heading: string;
  /** Body lines (NOT including the heading). */
  body: string[];
  /** True if this section must be preserved verbatim. */
  managed: boolean;
}

interface SidecarRecord {
  ts: string;
  before_bytes: number;
  after_bytes: number;
}

const DEFAULT_MIN_BYTES = 50 * 1024;
const DEFAULT_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000;

function sidecarPath(filePath: string): string {
  return `${filePath}.consolidated.json`;
}

function readSidecar(filePath: string): SidecarRecord | null {
  const p = sidecarPath(filePath);
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8'));
    if (typeof raw?.ts === 'string') return raw as SidecarRecord;
    return null;
  } catch { return null; }
}

function writeSidecar(filePath: string, rec: SidecarRecord): void {
  const p = sidecarPath(filePath);
  mkdirSync(dirname(p), { recursive: true });
  const tmp = `${p}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(rec, null, 2) + '\n');
  renameSync(tmp, p);
}

function atomicWrite(filePath: string, content: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tmp = `${filePath}.consolidate-tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, content);
  renameSync(tmp, filePath);
}

/** Split a markdown file into a preamble (before any `## ` heading) + sections. */
function splitSections(text: string): { preamble: string[]; sections: Section[] } {
  const lines = text.split('\n');
  // Drop synthetic trailing empty from final newline so join symmetry holds.
  const hadTrailingNL = text.endsWith('\n');
  if (hadTrailingNL && lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

  const preamble: string[] = [];
  const sections: Section[] = [];
  let i = 0;
  // Preamble = everything before the first `## ` heading.
  while (i < lines.length && !(lines[i] ?? '').startsWith('## ')) {
    preamble.push(lines[i] ?? '');
    i++;
  }
  while (i < lines.length) {
    const heading = lines[i] ?? '';
    const body: string[] = [];
    i++;
    while (i < lines.length && !(lines[i] ?? '').startsWith('## ')) {
      body.push(lines[i] ?? '');
      i++;
    }
    sections.push({ heading, body, managed: false });
  }
  return { preamble, sections };
}

/** Classify each section as managed (preserve verbatim) or distillable. */
function classifyManaged(section: Section): boolean {
  const headingTrim = section.heading.trim();
  if (headingTrim === ROLE_COMPOSITION_HEADING) return true;
  if (headingTrim === HR_CORRECTIONS_HEADING) return true;
  // Sentinel-managed: first non-blank body line is a `<!-- managed by ... -->`.
  for (const ln of section.body) {
    const t = ln.trim();
    if (!t) continue;
    if (MANAGED_SENTINEL_RE.test(t)) return true;
    break;
  }
  return false;
}

/** Render a section back to text (heading + body, joined by \n). */
function renderSection(s: Section): string {
  return [s.heading, ...s.body].join('\n');
}

/** Pretty short key for section counts: heading without the leading `## `. */
function sectionKey(heading: string): string {
  return heading.replace(/^##\s+/, '').trim() || '(untitled)';
}

function tallySections(sections: Section[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of sections) {
    const k = sectionKey(s.heading);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

/**
 * Consolidate (distill) a per-agent CLAUDE.md (or AGENTS.md / etc).
 *
 * No-op (skipped:true) when:
 *  - file does not exist; OR
 *  - file is smaller than `minBytes`; OR
 *  - last consolidation was within `minIntervalMs` (per sidecar).
 *
 * On success:
 *  - preserved sections are kept byte-for-byte;
 *  - the owner-edits tail of `## Role-Composition` is preserved verbatim;
 *  - other sections' bodies are replaced with `await distill(...)`;
 *  - file is written atomically;
 *  - sidecar is updated with the new `ts`/`before_bytes`/`after_bytes`.
 */
export async function consolidateMemoryFile(
  filePath: string,
  options: ConsolidatorOptions,
): Promise<ConsolidationResult> {
  const minBytes = options.minBytes ?? DEFAULT_MIN_BYTES;
  const minIntervalMs = options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
  const now = options.now ?? Date.now();
  const staffId = options.staffId ?? '';

  const empty = { bytes: 0, sectionCounts: {} as Record<string, number> };

  if (!existsSync(filePath)) {
    return {
      staffId, filePath,
      before: empty, after: empty,
      preservedSections: [], consolidatedSections: [],
      skipped: true, reason: 'file-missing',
    };
  }

  const beforeBytes = statSync(filePath).size;
  if (beforeBytes < minBytes) {
    return {
      staffId, filePath,
      before: { bytes: beforeBytes, sectionCounts: {} },
      after:  { bytes: beforeBytes, sectionCounts: {} },
      preservedSections: [], consolidatedSections: [],
      skipped: true, reason: `under-min-bytes(${beforeBytes}<${minBytes})`,
    };
  }

  const sidecar = readSidecar(filePath);
  if (sidecar) {
    const last = Date.parse(sidecar.ts);
    if (Number.isFinite(last) && now - last < minIntervalMs) {
      return {
        staffId, filePath,
        before: { bytes: beforeBytes, sectionCounts: {} },
        after:  { bytes: beforeBytes, sectionCounts: {} },
        preservedSections: [], consolidatedSections: [],
        skipped: true,
        reason: `cooldown(${now - last}ms<${minIntervalMs}ms)`,
      };
    }
  }

  const original = readFileSync(filePath, 'utf8');
  const { preamble, sections } = splitSections(original);
  for (const s of sections) s.managed = classifyManaged(s);

  const beforeCounts = tallySections(sections);
  const preserved: string[] = [];
  const consolidated: string[] = [];

  // Walk sections, distilling non-managed ones. Role-Composition body is
  // always managed; the owner-edits tail is already kept verbatim because
  // we keep the ENTIRE body of a managed section.
  const newSections: Section[] = [];
  for (const s of sections) {
    if (s.managed) {
      preserved.push(sectionKey(s.heading));
      newSections.push(s);
      continue;
    }
    const name = sectionKey(s.heading);
    const content = s.body.join('\n');
    const distilled = await options.distill({ sectionName: name, content });
    consolidated.push(name);
    newSections.push({
      heading: s.heading,
      body: distilled.split('\n'),
      managed: false,
    });
  }

  if (consolidated.length === 0) {
    // Nothing to distill — record the visit so we don't busy-loop, but mark skipped.
    writeSidecar(filePath, { ts: new Date(now).toISOString(), before_bytes: beforeBytes, after_bytes: beforeBytes });
    return {
      staffId, filePath,
      before: { bytes: beforeBytes, sectionCounts: beforeCounts },
      after:  { bytes: beforeBytes, sectionCounts: beforeCounts },
      preservedSections: preserved, consolidatedSections: [],
      skipped: true, reason: 'no-distillable-sections',
    };
  }

  // Reassemble. Keep preamble + sections joined by single blank line between
  // sections to mirror typical markdown shape.
  const out: string[] = [];
  // Preserve preamble byte-for-byte (it's above any `## ` and can include
  // owner notes the consolidator must not touch).
  out.push(...preamble);
  // Trim trailing blank lines on preamble to avoid double-blank.
  while (out.length > 0 && out[out.length - 1] === '') out.pop();
  for (const s of newSections) {
    if (out.length > 0) out.push('');
    out.push(renderSection(s));
  }
  const finalText = out.join('\n') + '\n';

  atomicWrite(filePath, finalText);
  const afterBytes = statSync(filePath).size;
  writeSidecar(filePath, { ts: new Date(now).toISOString(), before_bytes: beforeBytes, after_bytes: afterBytes });

  return {
    staffId, filePath,
    before: { bytes: beforeBytes, sectionCounts: beforeCounts },
    after:  { bytes: afterBytes, sectionCounts: tallySections(newSections) },
    preservedSections: preserved,
    consolidatedSections: consolidated,
    skipped: false,
  };
}

/** Exposed for the heartbeat tick (slice 1: stub distill). */
export const STUB_DISTILL: ConsolidatorOptions['distill'] = async ({ sectionName, content }) => {
  return `<!-- DISTILLED ${sectionName}: original ${content.length} chars -->\n`;
};

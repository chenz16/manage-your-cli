/**
 * role-template-loader — read & parse `role-templates/<id>/ROLE.md`.
 *
 * Spec: `docs/adr/role-templates-and-persona-composition.md` §1.
 *
 * Each `ROLE.md` ships YAML frontmatter (id/name/description/compose_with/
 * tags/source) plus a 5-section markdown body whose heading text the parser
 * keys against:
 *   - `## Identity`
 *   - `## Responsibilities`
 *   - `## Behaviors (do / don't)` (children: `### Do`, `### Don't`)
 *   - `## Voice / Tone`
 *   - `## Knowledge anchors`
 *
 * No `node:` scheme imports (codebase convention — see heartbeat.ts).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const nodeRequire = eval('require') as (id: string) => any;
const { existsSync, readFileSync, readdirSync, statSync } = nodeRequire('fs') as typeof import('fs');
const { dirname, join } = nodeRequire('path') as typeof import('path');
const { fileURLToPath } = nodeRequire('url') as typeof import('url');

export interface RoleTemplate {
  id: string;
  name: string;
  description: string;
  compose_with: string[];
  tags: string[];
  source: string;
  sections: {
    identity: string;
    responsibilities: string[];
    behaviors: { do: string[]; dont: string[] };
    voice: string;
    knowledge: string[];
  };
}

export function findRepoRoot(): string {
  const starts = [process.cwd(), dirname(fileURLToPath(import.meta.url))];
  for (const start of starts) {
    let dir = start;
    for (;;) {
      if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return process.cwd();
}

function defaultRoot(): string {
  return join(findRepoRoot(), 'role-templates');
}

/** Minimal YAML frontmatter parser: handles key: value, lists ([a, b] or
 *  block style), and block-scalar `>` folded values. Covers our schema; not
 *  a general YAML implementation. */
function parseFrontmatter(raw: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const lines = raw.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    i++;
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const m = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1]!;
    let val = (m[2] ?? '').trim();
    // Folded scalar (>): collect indented continuation lines.
    if (val === '>' || val === '>-') {
      const buf: string[] = [];
      while (i < lines.length) {
        const peek = lines[i] ?? '';
        if (peek.length > 0 && /^\s+\S/.test(peek)) {
          buf.push(peek.trim());
          i++;
        } else if (peek.trim() === '') {
          i++; // allow blank inside fold
          buf.push('');
        } else break;
      }
      out[key] = buf.join(' ').replace(/\s+/g, ' ').trim();
      continue;
    }
    // Inline list [a, b, c]
    if (val.startsWith('[') && val.endsWith(']')) {
      const inner = val.slice(1, -1).trim();
      out[key] = inner.length === 0
        ? []
        : inner.split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
      continue;
    }
    // Block list following: `key:` with `- item` lines beneath.
    if (val === '') {
      const items: string[] = [];
      while (i < lines.length) {
        const peek = lines[i] ?? '';
        const lm = peek.match(/^\s*-\s+(.*)$/);
        if (lm) {
          items.push((lm[1] ?? '').trim().replace(/^["']|["']$/g, ''));
          i++;
        } else if (peek.trim() === '') {
          i++;
        } else break;
      }
      if (items.length > 0) {
        out[key] = items;
        continue;
      }
      out[key] = '';
      continue;
    }
    // Strip surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function splitFrontmatter(raw: string): { fm: Record<string, unknown>; body: string } {
  if (!raw.startsWith('---')) return { fm: {}, body: raw };
  const end = raw.indexOf('\n---', 3);
  if (end < 0) return { fm: {}, body: raw };
  const fmText = raw.slice(3, end).replace(/^\n/, '');
  const body = raw.slice(end + 4).replace(/^\n/, '');
  return { fm: parseFrontmatter(fmText), body };
}

/** Returns the body text under a heading (any level), stopping at the next
 *  heading of the same or shallower depth. */
function extractSection(body: string, heading: string, depth: number): string {
  const lines = body.split('\n');
  const headLine = `${'#'.repeat(depth)} ${heading}`;
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if ((lines[i] ?? '').trim() === headLine) { start = i + 1; break; }
  }
  if (start < 0) return '';
  let end = lines.length;
  const stop = new RegExp(`^#{1,${depth}}\\s`);
  for (let i = start; i < lines.length; i++) {
    if (stop.test(lines[i] ?? '')) { end = i; break; }
  }
  return lines.slice(start, end).join('\n').trim();
}

function bulletList(section: string): string[] {
  if (!section) return [];
  const out: string[] = [];
  for (const line of section.split('\n')) {
    const m = line.match(/^\s*[-*]\s+(.*)$/);
    if (m) out.push((m[1] ?? '').trim());
  }
  return out;
}

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
  if (typeof v === 'string' && v.length > 0) return [v];
  return [];
}

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function parseRoleTemplate(id: string, raw: string): RoleTemplate {
  const { fm, body } = splitFrontmatter(raw);
  const identity = extractSection(body, 'Identity', 2);
  const responsibilities = bulletList(extractSection(body, 'Responsibilities', 2));
  const behaviorsBody = extractSection(body, "Behaviors (do / don't)", 2);
  const doSec = bulletList(extractSection(behaviorsBody, 'Do', 3));
  const dontSec = bulletList(extractSection(behaviorsBody, "Don't", 3));
  const voice = extractSection(body, 'Voice / Tone', 2);
  const knowledge = bulletList(extractSection(body, 'Knowledge anchors', 2));

  return {
    id: asString(fm.id, id),
    name: asString(fm.name, id),
    description: asString(fm.description, ''),
    compose_with: asStringArray(fm.compose_with),
    tags: asStringArray(fm.tags),
    source: asString(fm.source, 'unknown'),
    sections: {
      identity,
      responsibilities,
      behaviors: { do: doSec, dont: dontSec },
      voice,
      knowledge,
    },
  };
}

export function loadRoleTemplate(id: string, root: string = defaultRoot()): RoleTemplate | null {
  const path = join(root, id, 'ROLE.md');
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, 'utf8');
  return parseRoleTemplate(id, raw);
}

export function listRoleTemplates(root: string = defaultRoot()): RoleTemplate[] {
  if (!existsSync(root)) return [];
  const out: RoleTemplate[] = [];
  for (const entry of readdirSync(root)) {
    const dir = join(root, entry);
    try {
      const st = statSync(dir);
      if (!st.isDirectory()) continue;
    } catch { continue; }
    const tpl = loadRoleTemplate(entry, root);
    if (tpl) out.push(tpl);
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

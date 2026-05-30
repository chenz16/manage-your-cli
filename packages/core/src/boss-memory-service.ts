import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync as readdirSyncFs, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, normalize, relative, sep } from 'node:path';

/**
 * Default per-scope character budget (bounded markdown memory file).
 * Owner may override on a per-file basis by setting `budget: <n>` in the
 * scope file's YAML frontmatter. Files without frontmatter inherit this
 * default — backward compatible with pre-frontmatter scope files.
 *
 * [Lineage] The bounded-budget pattern is from the sister-repo Hermes
 * runtime; applied here as a memory-hygiene rule, not a runtime dependency.
 */
export const DEFAULT_SCOPE_BUDGET = 8000;

export interface BossMemoryFrontmatter {
  /** Declared scope (must match filename); informational only. */
  scope?: string;
  /** Character budget for this scope file. Defaults to DEFAULT_SCOPE_BUDGET. */
  budget?: number;
  /** ISO timestamp of the most recent write. Maintained by writeBossMemory. */
  updated?: string;
  /** Any other key:value lines we don't interpret yet. */
  [key: string]: string | number | undefined;
}

export interface BossMemoryReadResult {
  ok: true;
  scope: string | null;
  path: string;
  /** Body text with YAML frontmatter (if any) stripped. */
  text: string;
  /** Parsed frontmatter, or {} when the file has none. */
  frontmatter: BossMemoryFrontmatter;
  /** Total characters used by the on-disk body (frontmatter excluded). */
  used: number;
  /** Effective character budget (frontmatter.budget ?? DEFAULT_SCOPE_BUDGET). */
  limit: number;
  /** Other scopes whose body contains [[this-scope]] wikilinks. */
  backlinks: string[];
  project_id?: string;
}

export interface BossMemoryWriteResult {
  ok: true;
  scope: string;
  path: string;
  index_path: string;
  /** Characters used on disk after this write. */
  used: number;
  /** Effective character budget after this write. */
  limit: number;
  project_id?: string;
}

export interface BossMemoryBudgetExceeded {
  ok: false;
  reason: 'budget_exceeded';
  scope: string;
  path: string;
  used: number;
  limit: number;
  /** Characters the write attempted to add (after trimming). */
  attempted_chars: number;
  project_id?: string;
}

export interface BossMemoryError {
  ok: false;
  error: 'invalid_scope' | 'filesystem_error';
  message: string;
}

export type BossMemoryRead = BossMemoryReadResult | BossMemoryError;
export type BossMemoryWrite = BossMemoryWriteResult | BossMemoryBudgetExceeded | BossMemoryError;

function agentsHome(): string {
  return process.env.HOLON_AGENTS_HOME?.trim() || join(homedir(), 'holon-agents');
}

export function bossMemoryRoot(): string {
  return join(agentsHome(), 'boss');
}

/**
 * System 2 (owner层) memory root: <boss>/owner/
 *
 * Owner-global identity, preferences, and accumulated background that
 * persists across all projects. Used whenever a caller does NOT pass
 * project_id (or passes 'default' for back-compat).
 */
export function ownerMemoryRoot(): string {
  return join(bossMemoryRoot(), 'owner');
}

/**
 * Resolve the scope root for a given project_id.
 *
 *   project_id absent / null / 'default'  → System 2 (owner层): <boss>/owner/
 *   project_id is a real id               → System 1 (项目层): <boss>/projects/<id>/
 *
 * The legacy flat layout (<boss>/INDEX.md + <boss>/MEMORY/) is migrated into
 * <boss>/owner/ on first access — see ensureBossStore.
 */
export function projectMemoryRoot(project_id?: string | null): string {
  if (!project_id || project_id === 'default') return ownerMemoryRoot();
  return join(bossMemoryRoot(), 'projects', project_id);
}

function indexPath(project_id?: string | null): string {
  return join(projectMemoryRoot(project_id), 'INDEX.md');
}

function memoryDir(project_id?: string | null): string {
  return join(projectMemoryRoot(project_id), 'MEMORY');
}

/**
 * Project archive root: <boss>/projects/_archived/
 * Project-retire harvest moves the project's memory dir here so owner can
 * still grep historical context.
 */
export function projectArchiveRoot(): string {
  return join(bossMemoryRoot(), 'projects', '_archived');
}

function classifyFs(action: string, err: unknown): BossMemoryError {
  const code = err && typeof err === 'object' && 'code' in err ? ` ${(err as { code?: string }).code}` : '';
  return {
    ok: false,
    error: 'filesystem_error',
    message: `${action} failed${code}: ${err instanceof Error ? err.message : String(err)}`,
  };
}

/**
 * Migrate legacy flat boss-memory (<boss>/INDEX.md + <boss>/MEMORY/) into the
 * new System 2 owner scope at <boss>/owner/. Idempotent — runs only when:
 *   - <boss>/owner/ does NOT yet exist (or is empty of INDEX/MEMORY), AND
 *   - at least one of <boss>/INDEX.md or <boss>/MEMORY/ exists.
 *
 * This is the ONLY direction we auto-migrate now. The earlier flat→project
 * migration was wrong under the System 0/1/2 split: legacy accumulated
 * content is owner-global by historical default (everything written before
 * this split lived in one shared box).
 */
function migrateLegacyFlatToOwner(): void {
  const owner = ownerMemoryRoot();
  const ownerIndex = join(owner, 'INDEX.md');
  const ownerMemory = join(owner, 'MEMORY');
  if (existsSync(ownerIndex) || existsSync(ownerMemory)) return; // already migrated

  const legacyIndex = join(bossMemoryRoot(), 'INDEX.md');
  const legacyMemory = join(bossMemoryRoot(), 'MEMORY');
  if (!existsSync(legacyIndex) && !existsSync(legacyMemory)) return; // nothing to migrate

  try {
    mkdirSync(owner, { recursive: true });
    if (existsSync(legacyIndex)) renameSync(legacyIndex, ownerIndex);
    if (existsSync(legacyMemory)) renameSync(legacyMemory, ownerMemory);
    console.log(JSON.stringify({
      audit: 'boss.memory_migrated_legacy_to_owner',
      from_index: legacyIndex,
      to_index: ownerIndex,
      ts: new Date().toISOString(),
    }));
  } catch (err) {
    // Non-fatal: subsequent ensureBossStore will create fresh owner files
    // alongside whatever legacy artifacts remain.
    console.warn(JSON.stringify({
      audit: 'boss.memory_migration_failed',
      error: err instanceof Error ? err.message : String(err),
      ts: new Date().toISOString(),
    }));
  }
}

function ensureBossStore(project_id?: string | null): BossMemoryError | null {
  const isOwner = !project_id || project_id === 'default';
  if (isOwner) migrateLegacyFlatToOwner();
  const mDir = memoryDir(project_id);
  const iPath = indexPath(project_id);
  try {
    mkdirSync(mDir, { recursive: true });
    if (!existsSync(iPath)) {
      const scopeLines = isOwner
        ? [
            '- decisions -> MEMORY/decisions.md - durable decisions and owner training',
            '- preferences -> MEMORY/preferences.md - owner preferences (System 2 owner-global)',
            '- roster -> MEMORY/roster.md - employee roles, strengths, and tuning notes',
            '- work -> MEMORY/work.md - active work and handoff pointers',
          ]
        : [
            '- decisions -> MEMORY/decisions.md - durable project decisions',
            '- architecture -> MEMORY/architecture.md - project-scoped architecture notes',
            '- roster -> MEMORY/roster.md - project-scoped role notes',
            '- work -> MEMORY/work.md - active work and handoff pointers',
          ];
      writeFileSync(iPath, `# Boss Memory Index\n\nLean pointers only. Read a specific scope for detail.\n\n## Scopes\n${scopeLines.join('\n')}\n`);
    }
    const seedScopes = isOwner
      ? ['decisions', 'roster', 'work', 'preferences']
      : ['decisions', 'roster', 'work'];
    for (const scope of seedScopes) {
      const path = detailPath(scope, project_id);
      if (!existsSync(path)) writeFileSync(path, `# ${scope}\n`);
    }
    return null;
  } catch (err) {
    return classifyFs('ensure boss memory store', err);
  }
}

function cleanScope(scope: string): string | null {
  const trimmed = scope.trim();
  if (!trimmed) return null;
  const normalized = trimmed
    .replace(/\\/g, '/')
    .replace(/^MEMORY\//i, '')
    .replace(/\.md$/i, '')
    .toLowerCase();
  if (!/^[a-z0-9][a-z0-9/_-]{0,120}$/.test(normalized)) return null;
  return normalized;
}

function detailPath(scope: string, project_id?: string | null): string {
  return join(memoryDir(project_id), `${scope}.md`);
}

function isInside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith('..') && !rel.includes(`..${sep}`));
}

function scopedPath(scope: string, project_id?: string | null): { ok: true; scope: string; path: string } | BossMemoryError {
  const clean = cleanScope(scope);
  if (!clean) {
    return { ok: false, error: 'invalid_scope', message: 'scope must be a relative markdown pointer like decisions or roster/training' };
  }
  const mDir = memoryDir(project_id);
  const path = normalize(detailPath(clean, project_id));
  if (!isInside(mDir, path)) {
    return { ok: false, error: 'invalid_scope', message: 'scope must stay inside boss MEMORY/' };
  }
  return { ok: true, scope: clean, path };
}

export function readBossMemory(scope?: string, project_id?: string | null): BossMemoryRead {
  const ensured = ensureBossStore(project_id);
  if (ensured) return ensured;

  const iPath = indexPath(project_id);
  const projectField = project_id ? { project_id } : {};

  if (!scope?.trim()) {
    try {
      const raw = readFileSync(iPath, 'utf8');
      const { frontmatter, body } = parseFrontmatter(raw);
      const limit = effectiveBudget(frontmatter);
      return {
        ok: true,
        scope: null,
        path: iPath,
        text: body,
        frontmatter,
        used: body.length,
        limit,
        // INDEX.md is the entry point; backlinks would be every wikilinked
        // scope mentioning [[INDEX]]. Reserve for future — return [].
        backlinks: [],
        ...projectField,
      };
    } catch (err) {
      return classifyFs('read boss memory index', err);
    }
  }

  const target = scopedPath(scope, project_id);
  if (!target.ok) return target;
  try {
    if (!existsSync(target.path)) {
      const body = `# ${target.scope}\n`;
      return {
        ok: true,
        scope: target.scope,
        path: target.path,
        text: body,
        frontmatter: {},
        used: body.length,
        limit: DEFAULT_SCOPE_BUDGET,
        backlinks: collectBacklinks(target.scope, project_id),
        ...projectField,
      };
    }
    const raw = readFileSync(target.path, 'utf8');
    const { frontmatter, body } = parseFrontmatter(raw);
    return {
      ok: true,
      scope: target.scope,
      path: target.path,
      text: body,
      frontmatter,
      used: body.length,
      limit: effectiveBudget(frontmatter),
      backlinks: collectBacklinks(target.scope, project_id),
      ...projectField,
    };
  } catch (err) {
    return classifyFs(`read boss memory ${target.scope}`, err);
  }
}

function listMarkdownFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSyncFs(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listMarkdownFiles(path));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.md')) out.push(path);
  }
  return out.sort();
}

export function readBossMemoryLog(project_id?: string | null): BossMemoryRead {
  const ensured = ensureBossStore(project_id);
  if (ensured) return ensured;

  const iPath = indexPath(project_id);
  const mDir = memoryDir(project_id);
  try {
    const parts = [
      `# Boss Memory Raw Append Log`,
      '',
      `## INDEX.md`,
      readFileSync(iPath, 'utf8').trimEnd(),
    ];
    for (const path of listMarkdownFiles(mDir)) {
      const scope = relative(mDir, path).replace(/\\/g, '/').replace(/\.md$/i, '');
      parts.push('', `## MEMORY/${scope}.md`, readFileSync(path, 'utf8').trimEnd());
    }
    const body = `${parts.join('\n')}\n`;
    return {
      ok: true,
      scope: '__log',
      path: mDir,
      text: body,
      frontmatter: {},
      used: body.length,
      limit: DEFAULT_SCOPE_BUDGET,
      backlinks: [],
      ...(project_id ? { project_id } : {}),
    };
  } catch (err) {
    return classifyFs('read boss memory raw append log', err);
  }
}

/**
 * Split a markdown file into { frontmatter, body }.
 *
 * Recognizes a YAML-ish frontmatter block at the very top of the file:
 *
 *   ---
 *   key: value
 *   ---
 *
 * Only flat `key: value\n` lines are supported (no nesting, no lists, no
 * multiline strings). Numeric values are coerced when they round-trip cleanly
 * (so `budget: 8000` becomes a number). Anything we don't understand is kept
 * as a string. Files without an opening `---\n` line return empty frontmatter
 * and the full text as body — backward compatible.
 */
export function parseFrontmatter(raw: string): { frontmatter: BossMemoryFrontmatter; body: string } {
  // Tolerate a UTF-8 BOM at start of file.
  const text = raw.startsWith('﻿') ? raw.slice(1) : raw;
  if (!text.startsWith('---\n') && !text.startsWith('---\r\n')) {
    return { frontmatter: {}, body: text };
  }
  const afterOpen = text.replace(/^---\r?\n/, '');
  const closeMatch = afterOpen.match(/^---\r?\n?/m);
  if (!closeMatch || closeMatch.index === undefined) {
    return { frontmatter: {}, body: text };
  }
  const yaml = afterOpen.slice(0, closeMatch.index);
  const body = afterOpen.slice(closeMatch.index + closeMatch[0].length);
  const frontmatter: BossMemoryFrontmatter = {};
  for (const line of yaml.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const colon = trimmed.indexOf(':');
    if (colon <= 0) continue;
    const key = trimmed.slice(0, colon).trim();
    let value: string | number = trimmed.slice(colon + 1).trim();
    // Strip matching surrounding quotes.
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    // Coerce clean integers/floats.
    if (/^-?\d+(\.\d+)?$/.test(value)) {
      const n = Number(value);
      if (Number.isFinite(n) && String(n) === value) value = n;
    }
    frontmatter[key] = value;
  }
  return { frontmatter, body };
}

/**
 * Serialize a frontmatter object back to the leading `---` block.
 * Preserves insertion order; emits one `key: value\n` line per entry.
 */
function serializeFrontmatter(fm: BossMemoryFrontmatter): string {
  const lines: string[] = ['---'];
  for (const [key, value] of Object.entries(fm)) {
    if (value === undefined) continue;
    lines.push(`${key}: ${value}`);
  }
  lines.push('---', '');
  return lines.join('\n');
}

function effectiveBudget(fm: BossMemoryFrontmatter): number {
  const declared = fm.budget;
  if (typeof declared === 'number' && Number.isFinite(declared) && declared > 0) return declared;
  return DEFAULT_SCOPE_BUDGET;
}

/**
 * Scan every other scope file under MEMORY/ for `[[<scope>]]` wikilinks
 * pointing AT the given scope. Returns the list of OTHER scope names
 * (basename without `.md`) whose body contains such a link.
 *
 * Implementation note: cheap full-directory grep. The memory dir is
 * expected to stay small (a few dozen markdown files); if it grows we can
 * cache, but per the research doc the goal is "grep across the boss-memory
 * dir." Reads frontmatter-bearing files transparently — we scan the body
 * (post-strip) so a wikilink that lives inside frontmatter is ignored.
 */
function collectBacklinks(scope: string, project_id?: string | null): string[] {
  const mDir = memoryDir(project_id);
  if (!existsSync(mDir)) return [];
  // Match [[scope]] or [[scope#anchor]] but not [[other-scope]] containing
  // our scope as a substring — anchor with word boundary on both sides.
  const escaped = scope.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\[\\[${escaped}(?:#[^\\]]*)?\\]\\]`);
  const hits: string[] = [];
  let files: string[];
  try {
    files = listMarkdownFiles(mDir);
  } catch {
    return [];
  }
  for (const path of files) {
    const other = relative(mDir, path).replace(/\\/g, '/').replace(/\.md$/i, '');
    if (other === scope) continue;
    let raw: string;
    try {
      raw = readFileSync(path, 'utf8');
    } catch {
      continue;
    }
    const { body } = parseFrontmatter(raw);
    if (re.test(body)) hits.push(other);
  }
  return hits.sort();
}

function summarize(text: string): string {
  const first = text.split(/\r?\n/).map((line) => line.trim()).find((line) => line.length > 0) ?? 'updated';
  return first.length <= 96 ? first : `${first.slice(0, 93)}...`;
}

function upsertIndexLine(scope: string, text: string, project_id?: string | null): BossMemoryError | null {
  const iPath = indexPath(project_id);
  try {
    const index = existsSync(iPath) ? readFileSync(iPath, 'utf8') : '';
    const pointer = `- ${scope} -> MEMORY/${scope}.md - ${summarize(text)}`;
    const escaped = scope.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`^- ${escaped} -> MEMORY/${escaped}\\.md - .*$`, 'm');
    const next = re.test(index)
      ? index.replace(re, pointer)
      : `${index.trimEnd()}\n${pointer}\n`;
    writeFileSync(iPath, next);
    return null;
  } catch (err) {
    return classifyFs('update boss memory index', err);
  }
}

export function writeBossMemory(scope: string, text: string, project_id?: string | null): BossMemoryWrite {
  const ensured = ensureBossStore(project_id);
  if (ensured) return ensured;
  const target = scopedPath(scope, project_id);
  if (!target.ok) return target;

  const mDir = memoryDir(project_id);
  const iPath = indexPath(project_id);
  const ts = new Date().toISOString();
  const trimmed = text.trim();
  const appendBlock = `\n## ${ts}\n${trimmed}\n`;

  // Load current state (frontmatter + body). Default frontmatter for new
  // files: scope + default budget + updated timestamp.
  let existingRaw = '';
  let frontmatter: BossMemoryFrontmatter = { scope: target.scope, budget: DEFAULT_SCOPE_BUDGET };
  let body = `# ${basename(target.scope)}\n`;
  if (existsSync(target.path)) {
    try {
      existingRaw = readFileSync(target.path, 'utf8');
    } catch (err) {
      return classifyFs(`read boss memory ${target.scope}`, err);
    }
    const parsed = parseFrontmatter(existingRaw);
    body = parsed.body;
    // Merge: preserve any owner-overridden fields, fill in defaults for missing.
    frontmatter = {
      scope: target.scope,
      budget: DEFAULT_SCOPE_BUDGET,
      ...parsed.frontmatter,
    };
  }

  const limit = effectiveBudget(frontmatter);
  const projectedUsed = body.length + appendBlock.length;

  if (projectedUsed > limit) {
    // Hard ceiling: do not silently overflow. Surface the
    // signal so the memory-manager can react (compress / split / archive).
    console.log(JSON.stringify({
      audit: 'boss.memory_budget_exceeded',
      scope: target.scope,
      project_id: project_id ?? null,
      used: body.length,
      attempted_chars: appendBlock.length,
      limit,
      ts,
    }));
    return {
      ok: false,
      reason: 'budget_exceeded',
      scope: target.scope,
      path: target.path,
      used: body.length,
      limit,
      attempted_chars: appendBlock.length,
      ...(project_id ? { project_id } : {}),
    };
  }

  const nextBody = `${body}${appendBlock}`;
  frontmatter.updated = ts;
  const nextRaw = `${serializeFrontmatter(frontmatter)}${nextBody}`;

  try {
    mkdirSync(join(mDir, target.scope.split('/').slice(0, -1).join('/')), { recursive: true });
    writeFileSync(target.path, nextRaw);
  } catch (err) {
    return classifyFs(`write boss memory ${target.scope}`, err);
  }

  const indexed = upsertIndexLine(target.scope, trimmed, project_id);
  if (indexed) return indexed;
  console.log(JSON.stringify({
    audit: 'boss.memory_written',
    scope: target.scope,
    project_id: project_id ?? null,
    chars: text.length,
    used: nextBody.length,
    limit,
    ts,
  }));
  return {
    ok: true,
    scope: target.scope,
    path: target.path,
    index_path: iPath,
    used: nextBody.length,
    limit,
    ...(project_id ? { project_id } : {}),
  };
}

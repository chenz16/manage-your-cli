import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync as readdirSyncFs, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, normalize, relative, sep } from 'node:path';

export interface BossMemoryReadResult {
  ok: true;
  scope: string | null;
  path: string;
  text: string;
  project_id?: string;
}

export interface BossMemoryWriteResult {
  ok: true;
  scope: string;
  path: string;
  index_path: string;
  project_id?: string;
}

export interface BossMemoryError {
  ok: false;
  error: 'invalid_scope' | 'filesystem_error';
  message: string;
}

export type BossMemoryRead = BossMemoryReadResult | BossMemoryError;
export type BossMemoryWrite = BossMemoryWriteResult | BossMemoryError;

function agentsHome(): string {
  return process.env.HOLON_AGENTS_HOME?.trim() || join(homedir(), 'holon-agents');
}

export function bossMemoryRoot(): string {
  return join(agentsHome(), 'boss');
}

/**
 * Per-project memory root: <boss>/projects/<project_id>/
 * Falls back to legacy <boss>/ when project_id is not supplied.
 * If project_id is 'default' the legacy path is also used (back-compat alias).
 */
export function projectMemoryRoot(project_id?: string | null): string {
  const base = bossMemoryRoot();
  if (!project_id || project_id === 'default') return base;
  return join(base, 'projects', project_id);
}

function indexPath(project_id?: string | null): string {
  return join(projectMemoryRoot(project_id), 'INDEX.md');
}

function memoryDir(project_id?: string | null): string {
  return join(projectMemoryRoot(project_id), 'MEMORY');
}

function classifyFs(action: string, err: unknown): BossMemoryError {
  const code = err && typeof err === 'object' && 'code' in err ? ` ${(err as { code?: string }).code}` : '';
  return {
    ok: false,
    error: 'filesystem_error',
    message: `${action} failed${code}: ${err instanceof Error ? err.message : String(err)}`,
  };
}

function ensureBossStore(project_id?: string | null): BossMemoryError | null {
  const mDir = memoryDir(project_id);
  const iPath = indexPath(project_id);
  try {
    mkdirSync(mDir, { recursive: true });
    if (!existsSync(iPath)) {
      writeFileSync(iPath, `# Boss Memory Index

Lean pointers only. Read a specific scope for detail.

## Scopes
- decisions -> MEMORY/decisions.md - durable decisions and owner training
- roster -> MEMORY/roster.md - employee roles, strengths, and tuning notes
- work -> MEMORY/work.md - active work and handoff pointers
`);
    }
    for (const scope of ['decisions', 'roster', 'work']) {
      const path = detailPath(scope, project_id);
      if (!existsSync(path)) writeFileSync(path, `# ${scope}\n`);
    }
    return null;
  } catch (err) {
    return classifyFs('ensure boss memory store', err);
  }
}

/**
 * Migration: if the legacy flat boss memory exists (INDEX.md + MEMORY/ at bossMemoryRoot())
 * and the target project dir does NOT yet exist, move the legacy files into
 * projects/<project_id>/ on first access. Idempotent.
 *
 * Only runs when project_id is a real project (not null/default).
 */
function migrateToProjectDir(project_id: string): void {
  // Only migrate if project_id is a real, non-legacy id.
  if (!project_id || project_id === 'default') return;

  const legacyIndex = join(bossMemoryRoot(), 'INDEX.md');
  const legacyMemory = join(bossMemoryRoot(), 'MEMORY');
  const targetRoot = projectMemoryRoot(project_id);
  const targetIndex = join(targetRoot, 'INDEX.md');

  // Target already has data — skip (idempotent).
  if (existsSync(targetIndex)) return;
  // No legacy data to migrate — skip.
  if (!existsSync(legacyIndex) && !existsSync(legacyMemory)) return;

  try {
    mkdirSync(targetRoot, { recursive: true });
    if (existsSync(legacyIndex) && !existsSync(targetIndex)) {
      renameSync(legacyIndex, targetIndex);
    }
    const targetMemory = join(targetRoot, 'MEMORY');
    if (existsSync(legacyMemory) && !existsSync(targetMemory)) {
      renameSync(legacyMemory, targetMemory);
    }
    console.log(JSON.stringify({
      audit: 'boss.memory_migrated_to_project',
      project_id,
      ts: new Date().toISOString(),
    }));
  } catch (err) {
    // Migration failure is non-fatal — new writes will still go to the right place.
    console.warn(JSON.stringify({
      audit: 'boss.memory_migration_failed',
      project_id,
      error: err instanceof Error ? err.message : String(err),
      ts: new Date().toISOString(),
    }));
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
  if (project_id && project_id !== 'default') migrateToProjectDir(project_id);
  const ensured = ensureBossStore(project_id);
  if (ensured) return ensured;

  const iPath = indexPath(project_id);
  if (!scope?.trim()) {
    try {
      return { ok: true, scope: null, path: iPath, text: readFileSync(iPath, 'utf8'), ...(project_id ? { project_id } : {}) };
    } catch (err) {
      return classifyFs('read boss memory index', err);
    }
  }

  const target = scopedPath(scope, project_id);
  if (!target.ok) return target;
  try {
    if (!existsSync(target.path)) {
      return { ok: true, scope: target.scope, path: target.path, text: `# ${target.scope}\n`, ...(project_id ? { project_id } : {}) };
    }
    return { ok: true, scope: target.scope, path: target.path, text: readFileSync(target.path, 'utf8'), ...(project_id ? { project_id } : {}) };
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
  if (project_id && project_id !== 'default') migrateToProjectDir(project_id);
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
    return { ok: true, scope: '__log', path: mDir, text: `${parts.join('\n')}\n`, ...(project_id ? { project_id } : {}) };
  } catch (err) {
    return classifyFs('read boss memory raw append log', err);
  }
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
  if (project_id && project_id !== 'default') migrateToProjectDir(project_id);
  const ensured = ensureBossStore(project_id);
  if (ensured) return ensured;
  const target = scopedPath(scope, project_id);
  if (!target.ok) return target;

  const mDir = memoryDir(project_id);
  const iPath = indexPath(project_id);
  try {
    mkdirSync(join(mDir, target.scope.split('/').slice(0, -1).join('/')), { recursive: true });
    if (!existsSync(target.path)) writeFileSync(target.path, `# ${basename(target.scope)}\n`);
    appendFileSync(target.path, `\n## ${new Date().toISOString()}\n${text.trim()}\n`);
  } catch (err) {
    return classifyFs(`write boss memory ${target.scope}`, err);
  }

  const indexed = upsertIndexLine(target.scope, text, project_id);
  if (indexed) return indexed;
  console.log(JSON.stringify({
    audit: 'boss.memory_written',
    scope: target.scope,
    project_id: project_id ?? null,
    chars: text.length,
    ts: new Date().toISOString(),
  }));
  return { ok: true, scope: target.scope, path: target.path, index_path: iPath, ...(project_id ? { project_id } : {}) };
}

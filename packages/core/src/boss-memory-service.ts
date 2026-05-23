import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, normalize, relative, sep } from 'node:path';

export interface BossMemoryReadResult {
  ok: true;
  scope: string | null;
  path: string;
  text: string;
}

export interface BossMemoryWriteResult {
  ok: true;
  scope: string;
  path: string;
  index_path: string;
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

function indexPath(): string {
  return join(bossMemoryRoot(), 'INDEX.md');
}

function memoryDir(): string {
  return join(bossMemoryRoot(), 'MEMORY');
}

function classifyFs(action: string, err: unknown): BossMemoryError {
  const code = err && typeof err === 'object' && 'code' in err ? ` ${(err as { code?: string }).code}` : '';
  return {
    ok: false,
    error: 'filesystem_error',
    message: `${action} failed${code}: ${err instanceof Error ? err.message : String(err)}`,
  };
}

function ensureBossStore(): BossMemoryError | null {
  try {
    mkdirSync(memoryDir(), { recursive: true });
    if (!existsSync(indexPath())) {
      writeFileSync(indexPath(), `# Boss Memory Index

Lean pointers only. Read a specific scope for detail.

## Scopes
- decisions -> MEMORY/decisions.md - durable decisions and owner training
- roster -> MEMORY/roster.md - employee roles, strengths, and tuning notes
- work -> MEMORY/work.md - active work and handoff pointers
`);
    }
    for (const scope of ['decisions', 'roster', 'work']) {
      const path = detailPath(scope);
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

function detailPath(scope: string): string {
  return join(memoryDir(), `${scope}.md`);
}

function isInside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith('..') && !rel.includes(`..${sep}`));
}

function scopedPath(scope: string): { ok: true; scope: string; path: string } | BossMemoryError {
  const clean = cleanScope(scope);
  if (!clean) {
    return { ok: false, error: 'invalid_scope', message: 'scope must be a relative markdown pointer like decisions or roster/training' };
  }
  const path = normalize(detailPath(clean));
  if (!isInside(memoryDir(), path)) {
    return { ok: false, error: 'invalid_scope', message: 'scope must stay inside boss MEMORY/' };
  }
  return { ok: true, scope: clean, path };
}

export function readBossMemory(scope?: string): BossMemoryRead {
  const ensured = ensureBossStore();
  if (ensured) return ensured;

  if (!scope?.trim()) {
    try {
      return { ok: true, scope: null, path: indexPath(), text: readFileSync(indexPath(), 'utf8') };
    } catch (err) {
      return classifyFs('read boss memory index', err);
    }
  }

  const target = scopedPath(scope);
  if (!target.ok) return target;
  try {
    if (!existsSync(target.path)) {
      return { ok: true, scope: target.scope, path: target.path, text: `# ${target.scope}\n` };
    }
    return { ok: true, scope: target.scope, path: target.path, text: readFileSync(target.path, 'utf8') };
  } catch (err) {
    return classifyFs(`read boss memory ${target.scope}`, err);
  }
}

function listMarkdownFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listMarkdownFiles(path));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.md')) out.push(path);
  }
  return out.sort();
}

export function readBossMemoryLog(): BossMemoryRead {
  const ensured = ensureBossStore();
  if (ensured) return ensured;

  try {
    const parts = [
      `# Boss Memory Raw Append Log`,
      '',
      `## INDEX.md`,
      readFileSync(indexPath(), 'utf8').trimEnd(),
    ];
    for (const path of listMarkdownFiles(memoryDir())) {
      const scope = relative(memoryDir(), path).replace(/\\/g, '/').replace(/\.md$/i, '');
      parts.push('', `## MEMORY/${scope}.md`, readFileSync(path, 'utf8').trimEnd());
    }
    return { ok: true, scope: '__log', path: memoryDir(), text: `${parts.join('\n')}\n` };
  } catch (err) {
    return classifyFs('read boss memory raw append log', err);
  }
}

function summarize(text: string): string {
  const first = text.split(/\r?\n/).map((line) => line.trim()).find((line) => line.length > 0) ?? 'updated';
  return first.length <= 96 ? first : `${first.slice(0, 93)}...`;
}

function upsertIndexLine(scope: string, text: string): BossMemoryError | null {
  try {
    const index = existsSync(indexPath()) ? readFileSync(indexPath(), 'utf8') : '';
    const pointer = `- ${scope} -> MEMORY/${scope}.md - ${summarize(text)}`;
    const escaped = scope.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`^- ${escaped} -> MEMORY/${escaped}\\.md - .*$`, 'm');
    const next = re.test(index)
      ? index.replace(re, pointer)
      : `${index.trimEnd()}\n${pointer}\n`;
    writeFileSync(indexPath(), next);
    return null;
  } catch (err) {
    return classifyFs('update boss memory index', err);
  }
}

export function writeBossMemory(scope: string, text: string): BossMemoryWrite {
  const ensured = ensureBossStore();
  if (ensured) return ensured;
  const target = scopedPath(scope);
  if (!target.ok) return target;

  try {
    mkdirSync(join(memoryDir(), target.scope.split('/').slice(0, -1).join('/')), { recursive: true });
    if (!existsSync(target.path)) writeFileSync(target.path, `# ${basename(target.scope)}\n`);
    appendFileSync(target.path, `\n## ${new Date().toISOString()}\n${text.trim()}\n`);
  } catch (err) {
    return classifyFs(`write boss memory ${target.scope}`, err);
  }

  const indexed = upsertIndexLine(target.scope, text);
  if (indexed) return indexed;
  console.log(JSON.stringify({
    audit: 'boss.memory_written',
    scope: target.scope,
    chars: text.length,
    ts: new Date().toISOString(),
  }));
  return { ok: true, scope: target.scope, path: target.path, index_path: indexPath() };
}

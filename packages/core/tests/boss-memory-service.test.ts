import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_SCOPE_BUDGET,
  parseFrontmatter,
  readBossMemory,
  writeBossMemory,
} from '../src/boss-memory-service.js';

let workDir: string;
let priorEnv: string | undefined;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'boss-memory-test-'));
  priorEnv = process.env.HOLON_AGENTS_HOME;
  process.env.HOLON_AGENTS_HOME = workDir;
});

afterEach(() => {
  if (priorEnv === undefined) delete process.env.HOLON_AGENTS_HOME;
  else process.env.HOLON_AGENTS_HOME = priorEnv;
  rmSync(workDir, { recursive: true, force: true });
});

describe('parseFrontmatter', () => {
  it('returns empty frontmatter and full body when no fence', () => {
    const { frontmatter, body } = parseFrontmatter('# hello\nworld\n');
    expect(frontmatter).toEqual({});
    expect(body).toBe('# hello\nworld\n');
  });

  it('parses key/value lines and coerces ints', () => {
    const raw = '---\nscope: decisions\nbudget: 8000\nupdated: 2026-05-30T00:00:00Z\n---\n# body\n';
    const { frontmatter, body } = parseFrontmatter(raw);
    expect(frontmatter.scope).toBe('decisions');
    expect(frontmatter.budget).toBe(8000);
    expect(frontmatter.updated).toBe('2026-05-30T00:00:00Z');
    expect(body).toBe('# body\n');
  });

  it('tolerates quoted strings', () => {
    const { frontmatter } = parseFrontmatter('---\nscope: "decisions"\nlabel: \'foo\'\n---\nx\n');
    expect(frontmatter.scope).toBe('decisions');
    expect(frontmatter.label).toBe('foo');
  });

  it('returns empty when fence is unterminated', () => {
    const raw = '---\nbudget: 100\n# body never closed\n';
    const { frontmatter, body } = parseFrontmatter(raw);
    expect(frontmatter).toEqual({});
    expect(body).toBe(raw);
  });
});

describe('readBossMemory frontmatter strip', () => {
  it('strips frontmatter from returned text and exposes structured fields', () => {
    const mDir = join(workDir, 'boss', 'owner', 'MEMORY');
    mkdirSync(mDir, { recursive: true });
    writeFileSync(
      join(mDir, 'decisions.md'),
      '---\nscope: decisions\nbudget: 4000\nupdated: 2026-05-30T00:00:00Z\n---\n# decisions\nfact one\n',
    );

    const res = readBossMemory('decisions');
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('expected ok');
    expect(res.text).toBe('# decisions\nfact one\n');
    expect(res.frontmatter.budget).toBe(4000);
    expect(res.frontmatter.scope).toBe('decisions');
    expect(res.limit).toBe(4000);
    expect(res.used).toBe('# decisions\nfact one\n'.length);
  });

  it('treats a legacy file without frontmatter as default budget', () => {
    const mDir = join(workDir, 'boss', 'owner', 'MEMORY');
    mkdirSync(mDir, { recursive: true });
    writeFileSync(join(mDir, 'work.md'), '# work\nlegacy content\n');

    const res = readBossMemory('work');
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('expected ok');
    expect(res.frontmatter).toEqual({});
    expect(res.limit).toBe(DEFAULT_SCOPE_BUDGET);
    expect(res.text).toBe('# work\nlegacy content\n');
  });
});

describe('writeBossMemory budget enforcement', () => {
  it('returns budget_exceeded when projected size would overflow', () => {
    const mDir = join(workDir, 'boss', 'owner', 'MEMORY');
    mkdirSync(mDir, { recursive: true });
    const big = 'x'.repeat(95);
    writeFileSync(
      join(mDir, 'roster.md'),
      `---\nscope: roster\nbudget: 100\n---\n${big}`,
    );

    const res = writeBossMemory('roster', 'this push will overflow the tiny budget');
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('expected fail');
    if (!('reason' in res)) throw new Error('expected budget_exceeded shape');
    expect(res.reason).toBe('budget_exceeded');
    expect(res.limit).toBe(100);
    expect(res.used).toBeGreaterThan(0);
    expect(res.attempted_chars).toBeGreaterThan(0);

    // File body must be unchanged on overflow.
    const after = readFileSync(join(mDir, 'roster.md'), 'utf8');
    expect(after.endsWith(big)).toBe(true);
  });

  it('writes successfully under budget and reports used/limit', () => {
    const res = writeBossMemory('decisions', 'first decision');
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('expected ok');
    expect(res.limit).toBe(DEFAULT_SCOPE_BUDGET);
    expect(res.used).toBeGreaterThan(0);

    // Re-read carries frontmatter back through.
    const back = readBossMemory('decisions');
    if (!back.ok) throw new Error('expected ok');
    expect(back.frontmatter.scope).toBe('decisions');
    expect(back.frontmatter.budget).toBe(DEFAULT_SCOPE_BUDGET);
    expect(typeof back.frontmatter.updated).toBe('string');
    expect(back.text).toContain('first decision');
  });
});

describe('backlinks scan', () => {
  it('lists other scopes that contain [[scope]] wikilinks', () => {
    const mDir = join(workDir, 'boss', 'owner', 'MEMORY');
    mkdirSync(mDir, { recursive: true });
    writeFileSync(join(mDir, 'decisions.md'), '# decisions\nsee [[roster]] for ownership\n');
    writeFileSync(join(mDir, 'work.md'), '# work\nblocked on [[roster#alice]]\n');
    writeFileSync(join(mDir, 'roster.md'), '# roster\nalice owns auth\n');
    writeFileSync(join(mDir, 'unrelated.md'), '# unrelated\nno links\n');

    const res = readBossMemory('roster');
    if (!res.ok) throw new Error('expected ok');
    expect(res.backlinks.sort()).toEqual(['decisions', 'work']);
  });

  it('ignores wikilinks that live inside frontmatter', () => {
    const mDir = join(workDir, 'boss', 'owner', 'MEMORY');
    mkdirSync(mDir, { recursive: true });
    // The link [[roster]] is in the frontmatter region, not the body.
    writeFileSync(
      join(mDir, 'decisions.md'),
      '---\nscope: decisions\nnote: "[[roster]]"\n---\n# decisions\nno body link\n',
    );
    writeFileSync(join(mDir, 'roster.md'), '# roster\n');

    const res = readBossMemory('roster');
    if (!res.ok) throw new Error('expected ok');
    expect(res.backlinks).toEqual([]);
  });

  it('returns empty backlinks for a scope nobody references', () => {
    const mDir = join(workDir, 'boss', 'owner', 'MEMORY');
    mkdirSync(mDir, { recursive: true });
    writeFileSync(join(mDir, 'lonely.md'), '# lonely\n');
    writeFileSync(join(mDir, 'other.md'), '# other\nno refs\n');

    const res = readBossMemory('lonely');
    if (!res.ok) throw new Error('expected ok');
    expect(res.backlinks).toEqual([]);
  });
});

describe('System 0/1/2 owner vs project split', () => {
  it('reads owner scope from <boss>/owner/MEMORY when project_id is absent', () => {
    const mDir = join(workDir, 'boss', 'owner', 'MEMORY');
    mkdirSync(mDir, { recursive: true });
    writeFileSync(join(mDir, 'preferences.md'), '# preferences\nowner prefers zh\n');

    const res = readBossMemory('preferences');
    if (!res.ok) throw new Error('expected ok');
    expect(res.path).toBe(join(mDir, 'preferences.md'));
    expect(res.text).toContain('owner prefers zh');
  });

  it('reads project scope from <boss>/projects/<id>/MEMORY when project_id given', () => {
    const mDir = join(workDir, 'boss', 'projects', 'sproj_abc', 'MEMORY');
    mkdirSync(mDir, { recursive: true });
    writeFileSync(join(mDir, 'architecture.md'), '# architecture\nproject A picked HTTP\n');

    const res = readBossMemory('architecture', 'sproj_abc');
    if (!res.ok) throw new Error('expected ok');
    expect(res.path).toBe(join(mDir, 'architecture.md'));
    expect(res.project_id).toBe('sproj_abc');
    expect(res.text).toContain('project A picked HTTP');
  });

  it('writing with project_id creates the project dir + INDEX.md', () => {
    const res = writeBossMemory('decisions', 'pick redis', 'sproj_new');
    if (!res.ok) throw new Error('expected write ok');
    expect(res.project_id).toBe('sproj_new');

    const indexPath = join(workDir, 'boss', 'projects', 'sproj_new', 'INDEX.md');
    const decisionsPath = join(workDir, 'boss', 'projects', 'sproj_new', 'MEMORY', 'decisions.md');
    expect(readFileSync(indexPath, 'utf8')).toContain('decisions');
    expect(readFileSync(decisionsPath, 'utf8')).toContain('pick redis');

    // Owner scope must not have the project decision leaked into it.
    // Owner scope may or may not have been touched; if it exists, assert
    // the project text is not in it.
    const ownerDecisionsPath = join(workDir, 'boss', 'owner', 'MEMORY', 'decisions.md');
    let ownerHas = '';
    try { ownerHas = readFileSync(ownerDecisionsPath, 'utf8'); } catch { /* owner dir not yet created — fine */ }
    expect(ownerHas).not.toContain('pick redis');
  });

  it('migrates legacy flat layout into owner/ on first read', () => {
    // Seed legacy flat layout.
    const legacyMemory = join(workDir, 'boss', 'MEMORY');
    mkdirSync(legacyMemory, { recursive: true });
    writeFileSync(join(workDir, 'boss', 'INDEX.md'), '# Old Index\n- legacy -> MEMORY/legacy.md\n');
    writeFileSync(join(legacyMemory, 'legacy.md'), '# legacy\nold owner content\n');

    const res = readBossMemory('legacy');
    if (!res.ok) throw new Error('expected ok');
    expect(res.text).toContain('old owner content');

    // Legacy paths should be gone; owner paths should exist.
    expect(() => readFileSync(join(workDir, 'boss', 'INDEX.md'), 'utf8')).toThrow();
    expect(readFileSync(join(workDir, 'boss', 'owner', 'INDEX.md'), 'utf8')).toContain('legacy');
    expect(readFileSync(join(workDir, 'boss', 'owner', 'MEMORY', 'legacy.md'), 'utf8')).toContain('old owner content');
  });

  it('legacy migration is idempotent', () => {
    const legacyMemory = join(workDir, 'boss', 'MEMORY');
    mkdirSync(legacyMemory, { recursive: true });
    writeFileSync(join(workDir, 'boss', 'INDEX.md'), '# Old\n');
    writeFileSync(join(legacyMemory, 'a.md'), '# a\n');

    readBossMemory('a');
    // Second call must not throw or clobber.
    const res2 = readBossMemory('a');
    if (!res2.ok) throw new Error('expected ok');
    expect(res2.text).toContain('# a');
  });

  it('backlinks scan respects scope boundary — project links do not leak into owner', () => {
    // Owner scope has a wikilink target.
    const ownerDir = join(workDir, 'boss', 'owner', 'MEMORY');
    mkdirSync(ownerDir, { recursive: true });
    writeFileSync(join(ownerDir, 'preferences.md'), '# preferences\n');
    writeFileSync(join(ownerDir, 'decisions.md'), '# decisions\nsee [[preferences]]\n');

    // Project scope tries to reference owner's preferences.
    const projDir = join(workDir, 'boss', 'projects', 'sproj_x', 'MEMORY');
    mkdirSync(projDir, { recursive: true });
    writeFileSync(join(projDir, 'architecture.md'), '# arch\nrefs [[preferences]] (should NOT cross over)\n');
    writeFileSync(join(projDir, 'preferences.md'), '# preferences\n'); // same scope name, different layer

    // Owner.preferences backlinks should only list owner.decisions, not project.architecture.
    const ownerRes = readBossMemory('preferences');
    if (!ownerRes.ok) throw new Error('expected ok');
    expect(ownerRes.backlinks).toEqual(['decisions']);

    // Project.preferences backlinks should only list project.architecture.
    const projRes = readBossMemory('preferences', 'sproj_x');
    if (!projRes.ok) throw new Error('expected ok');
    expect(projRes.backlinks).toEqual(['architecture']);
  });
});

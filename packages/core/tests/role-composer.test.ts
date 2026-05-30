/**
 * role-composer — composition + render.
 *
 * Covers:
 *  1. Nominal wins identity + voice.
 *  2. Responsibilities / behaviors / knowledge: union + de-dup via stableRuleHash.
 *  3. Do/Don't collision → conflict entry, no silent winner.
 *  4. 1-hop transitive resolution: A → B → C all pulled in.
 *  5. renderPersona: composition-conflicts comment present + accurate count.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { composeRoles, renderPersona } from '../src/role-composer.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'role-composer-'));
});

afterEach(() => {
  try { rmSync(root, { recursive: true, force: true }); } catch { /* noop */ }
});

function seed(id: string, frontmatter: Record<string, string>, body: string): void {
  const fmLines = ['---'];
  for (const [k, v] of Object.entries(frontmatter)) fmLines.push(`${k}: ${v}`);
  fmLines.push('---');
  mkdirSync(join(root, id), { recursive: true });
  writeFileSync(join(root, id, 'ROLE.md'), `${fmLines.join('\n')}\n\n${body}\n`);
}

const buildBody = (opts: {
  identity?: string;
  responsibilities?: string[];
  do?: string[];
  dont?: string[];
  voice?: string;
  knowledge?: string[];
}) => {
  const parts: string[] = [];
  if (opts.identity !== undefined) parts.push(`## Identity\n\n${opts.identity}\n`);
  if (opts.responsibilities) parts.push(`## Responsibilities\n\n${opts.responsibilities.map((r) => `- ${r}`).join('\n')}\n`);
  if (opts.do || opts.dont) {
    parts.push(`## Behaviors (do / don't)\n`);
    if (opts.do) parts.push(`### Do\n\n${opts.do.map((r) => `- ${r}`).join('\n')}\n`);
    if (opts.dont) parts.push(`### Don't\n\n${opts.dont.map((r) => `- ${r}`).join('\n')}\n`);
  }
  if (opts.voice !== undefined) parts.push(`## Voice / Tone\n\n${opts.voice}\n`);
  if (opts.knowledge) parts.push(`## Knowledge anchors\n\n${opts.knowledge.map((r) => `- ${r}`).join('\n')}\n`);
  return parts.join('\n');
};

describe('composeRoles — basic merge', () => {
  it('nominal wins identity + voice; union + de-dup elsewhere', () => {
    seed('boss', { id: 'boss', name: 'Boss', source: 'test', compose_with: '[helper]' }, buildBody({
      identity: 'I am boss.',
      responsibilities: ['Lead the team.', 'Shared task A.'],
      do: ['Be direct.'],
      dont: ['Avoid micromanaging.'],
      voice: 'Boss voice.',
      knowledge: ['boss.md'],
    }));
    seed('helper', { id: 'helper', name: 'Helper', source: 'test', compose_with: '[]' }, buildBody({
      identity: 'I am helper.',
      responsibilities: ['Help out.', 'Shared task A.'], // dup with boss
      do: ['Be helpful.'],
      dont: ['Avoid blocking.'],
      voice: 'Helper voice.',
      knowledge: ['helper.md', 'boss.md'], // dup with boss
    }));

    const p = composeRoles('boss', [], root);
    expect(p.nominal).toBe('boss');
    expect(p.actualIds).toEqual(['boss', 'helper']);
    expect(p.identity).toBe('I am boss.'); // nominal wins
    expect(p.voice).toBe('Boss voice.');   // nominal wins
    expect(p.responsibilities).toEqual(['Lead the team.', 'Shared task A.', 'Help out.']); // de-dup'd
    expect(p.behaviors.do).toEqual(['Be direct.', 'Be helpful.']);
    expect(p.behaviors.dont).toEqual(['Avoid micromanaging.', 'Avoid blocking.']);
    expect(p.knowledge).toEqual(['boss.md', 'helper.md']); // de-dup'd
    expect(p.conflicts).toEqual([]);
  });
});

describe('composeRoles — do/don\'t collision', () => {
  it('flags as conflict without picking a silent winner', () => {
    seed('a', { id: 'a', name: 'A', source: 't', compose_with: '[b]' }, buildBody({
      identity: 'A.', voice: 'A.',
      do: ['Dispatch heavy work.'],
    }));
    seed('b', { id: 'b', name: 'B', source: 't', compose_with: '[]' }, buildBody({
      identity: 'B.', voice: 'B.',
      dont: ['Dispatch heavy work.'],
    }));
    const p = composeRoles('a', [], root);
    expect(p.behaviors.do).toContain('Dispatch heavy work.');
    expect(p.behaviors.dont).toContain('Dispatch heavy work.');
    expect(p.conflicts.length).toBe(1);
    expect(p.conflicts[0]!.rule).toBe('Dispatch heavy work.');
    expect(p.conflicts[0]!.sources.sort()).toEqual(['a.do', 'b.dont']);
  });
});

describe('composeRoles — 1-hop transitive', () => {
  it('A → B → C: all three merged when actualIds is empty', () => {
    seed('A', { id: 'A', name: 'A', source: 't', compose_with: '[B]' }, buildBody({
      identity: 'A.', voice: 'A.', responsibilities: ['a-task'],
    }));
    seed('B', { id: 'B', name: 'B', source: 't', compose_with: '[C]' }, buildBody({
      identity: 'B.', voice: 'B.', responsibilities: ['b-task'],
    }));
    seed('C', { id: 'C', name: 'C', source: 't', compose_with: '[]' }, buildBody({
      identity: 'C.', voice: 'C.', responsibilities: ['c-task'],
    }));
    const p = composeRoles('A', [], root);
    expect(p.actualIds).toEqual(['A', 'B', 'C']);
    expect(p.responsibilities).toEqual(['a-task', 'b-task', 'c-task']);
  });

  it('explicit actualIds skips transitivity', () => {
    seed('A', { id: 'A', name: 'A', source: 't', compose_with: '[B]' }, buildBody({
      identity: 'A.', voice: 'A.', responsibilities: ['a-task'],
    }));
    seed('B', { id: 'B', name: 'B', source: 't', compose_with: '[C]' }, buildBody({
      identity: 'B.', voice: 'B.', responsibilities: ['b-task'],
    }));
    seed('C', { id: 'C', name: 'C', source: 't', compose_with: '[]' }, buildBody({
      identity: 'C.', voice: 'C.', responsibilities: ['c-task'],
    }));
    // Owner override: pin to [A, B] only.
    const p = composeRoles('A', ['A', 'B'], root);
    expect(p.actualIds).toEqual(['A', 'B']);
    expect(p.responsibilities).toEqual(['a-task', 'b-task']);
  });
});

describe('renderPersona', () => {
  it('emits the composition-conflicts comment with the accurate count', () => {
    seed('a', { id: 'a', name: 'A', source: 't', compose_with: '[b]' }, buildBody({
      identity: 'A.', voice: 'A.',
      do: ['X.'],
    }));
    seed('b', { id: 'b', name: 'B', source: 't', compose_with: '[]' }, buildBody({
      identity: 'B.', voice: 'B.',
      dont: ['X.'],
    }));
    const p = composeRoles('a', [], root);
    const md = renderPersona(p);
    expect(md).toContain('<!-- composition-conflicts: 1 -->');
    expect(md).toContain('<!-- composed-from: a, b -->');
    expect(md).toContain('## Composition-conflicts');
    expect(md).toContain('<!-- owner-edits below -->');
  });

  it('zero conflicts → comment says 0 and no sibling section', () => {
    seed('a', { id: 'a', name: 'A', source: 't', compose_with: '[]' }, buildBody({
      identity: 'A.', voice: 'A.', responsibilities: ['r'],
    }));
    const p = composeRoles('a', [], root);
    const md = renderPersona(p);
    expect(md).toContain('<!-- composition-conflicts: 0 -->');
    expect(md).not.toContain('## Composition-conflicts');
  });
});

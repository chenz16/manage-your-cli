/**
 * role-template-loader — frontmatter + 5-section parser.
 *
 * Covers:
 *  1. Full 5-section ROLE.md parses correctly (frontmatter + bullets).
 *  2. Missing sections degrade gracefully (empty string / empty array).
 *  3. listRoleTemplates reads multiple roles from a temp root.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadRoleTemplate, listRoleTemplates } from '../src/role-template-loader.js';

let root: string;

const FULL_ROLE = `---
id: tester
name: Tester
description: A tester.
compose_with: [a, b]
tags: [qa, manual]
source: owner-authored
---

## Identity

I test things.

## Responsibilities

- Run the test suite.
- Report failures.

## Behaviors (do / don't)

### Do

- Run tests first.

### Don't

- Don't skip flaky tests silently.

## Voice / Tone

Crisp, evidence-based.

## Knowledge anchors

- packages/core/tests/
- vitest docs
`;

const PARTIAL_ROLE = `---
id: partial
name: Partial
description: Minimal role
tags: []
source: owner-authored
---

## Identity

Just me.
`;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'role-loader-'));
});

afterEach(() => {
  try { rmSync(root, { recursive: true, force: true }); } catch { /* noop */ }
});

function seed(id: string, content: string): void {
  mkdirSync(join(root, id), { recursive: true });
  writeFileSync(join(root, id, 'ROLE.md'), content);
}

describe('loadRoleTemplate', () => {
  it('parses a full 5-section ROLE.md', () => {
    seed('tester', FULL_ROLE);
    const t = loadRoleTemplate('tester', root);
    expect(t).not.toBeNull();
    expect(t!.id).toBe('tester');
    expect(t!.name).toBe('Tester');
    expect(t!.description).toBe('A tester.');
    expect(t!.compose_with).toEqual(['a', 'b']);
    expect(t!.tags).toEqual(['qa', 'manual']);
    expect(t!.source).toBe('owner-authored');
    expect(t!.sections.identity).toBe('I test things.');
    expect(t!.sections.responsibilities).toEqual(['Run the test suite.', 'Report failures.']);
    expect(t!.sections.behaviors.do).toEqual(['Run tests first.']);
    expect(t!.sections.behaviors.dont).toEqual(["Don't skip flaky tests silently."]);
    expect(t!.sections.voice).toBe('Crisp, evidence-based.');
    expect(t!.sections.knowledge).toEqual(['packages/core/tests/', 'vitest docs']);
  });

  it('handles missing sections gracefully', () => {
    seed('partial', PARTIAL_ROLE);
    const t = loadRoleTemplate('partial', root);
    expect(t).not.toBeNull();
    expect(t!.sections.identity).toBe('Just me.');
    expect(t!.sections.responsibilities).toEqual([]);
    expect(t!.sections.behaviors.do).toEqual([]);
    expect(t!.sections.behaviors.dont).toEqual([]);
    expect(t!.sections.voice).toBe('');
    expect(t!.sections.knowledge).toEqual([]);
    expect(t!.compose_with).toEqual([]);
  });

  it('returns null for unknown role', () => {
    expect(loadRoleTemplate('nope', root)).toBeNull();
  });
});

describe('listRoleTemplates', () => {
  it('lists all templates under root, sorted by id', () => {
    seed('zebra', FULL_ROLE.replace('id: tester', 'id: zebra'));
    seed('alpha', FULL_ROLE.replace('id: tester', 'id: alpha'));
    const list = listRoleTemplates(root);
    expect(list.map((t) => t.id)).toEqual(['alpha', 'zebra']);
  });

  it('returns [] when root is absent', () => {
    expect(listRoleTemplates(join(root, 'missing'))).toEqual([]);
  });
});

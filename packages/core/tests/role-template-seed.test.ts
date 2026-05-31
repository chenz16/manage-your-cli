/**
 * role-template-seed — sanity tests for the seeded `role-templates/` library.
 *
 * Spec: `docs/adr/role-templates-and-persona-composition.md` (slice 2 seed)
 * + `role-templates/CATALOG.md`.
 *
 * Asserts:
 *   1. Exactly 22 ROLE.md files load via `listRoleTemplates()`.
 *   2. Every role has non-empty identity / responsibilities / behaviors.do /
 *      behaviors.dont / voice / knowledge.
 *   3. Every `compose_with` id resolves to an actual role on disk.
 *   4. Every tag in CATALOG's tag taxonomy has at least one user.
 */
import { describe, it, expect } from 'vitest';
import { listRoleTemplates, findRepoRoot } from '../src/role-template-loader.js';
import { join } from 'node:path';

const ROOT = join(findRepoRoot(), 'role-templates');
const ALL = listRoleTemplates(ROOT);

const TAG_TAXONOMY = [
  'ops', 'communication', 'project-management',
  'engineering', 'frontend', 'backend', 'mobile', 'review', 'security',
  'product', 'design', 'qa',
  'content', 'writing', 'marketing',
  'legal', 'finance', 'support',
];

describe('role-templates seed', () => {
  it('contains exactly 22 ROLE.md files', () => {
    expect(ALL.length).toBe(22);
  });

  it('every role has non-empty required sections', () => {
    for (const r of ALL) {
      expect(r.sections.identity, `${r.id} identity`).not.toBe('');
      expect(r.sections.responsibilities.length, `${r.id} responsibilities`).toBeGreaterThan(0);
      expect(r.sections.behaviors.do.length, `${r.id} do`).toBeGreaterThan(0);
      expect(r.sections.behaviors.dont.length, `${r.id} dont`).toBeGreaterThan(0);
      expect(r.sections.voice, `${r.id} voice`).not.toBe('');
      expect(r.sections.knowledge.length, `${r.id} knowledge`).toBeGreaterThan(0);
    }
  });

  it('every compose_with id resolves to an existing role', () => {
    const ids = new Set(ALL.map((r) => r.id));
    for (const r of ALL) {
      for (const ref of r.compose_with) {
        expect(ids.has(ref), `${r.id} → compose_with: ${ref}`).toBe(true);
      }
    }
  });

  it('every CATALOG tag has at least one user', () => {
    const allTags = new Set<string>();
    for (const r of ALL) for (const t of r.tags) allTags.add(t);
    for (const t of TAG_TAXONOMY) {
      expect(allTags.has(t), `tag "${t}" unused`).toBe(true);
    }
  });
});

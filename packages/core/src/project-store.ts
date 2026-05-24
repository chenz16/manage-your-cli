/**
 * In-memory project store — Phase 1 project organizing dimension.
 *
 * Follows the SAME globalThis pattern as mutable-store.ts so process-level
 * state (HMR, Next.js restarts) survives across module reloads. Keyed by
 * project id.
 *
 * Single instance per process — fine for dev / single-user V1.
 * When we move to multi-tenant SaaS this becomes a per-desk DB table.
 */

import type { Project } from '@holon/api-contract';

// ── Slug → id dedup helpers ────────────────────────────────────────────────

function mintId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Auto-slug from display name: lower-case, replace non-alphanumeric runs
 * with a dash, trim leading/trailing dashes, cap at 40 chars. Guarantees
 * the regex `^[a-z0-9][a-z0-9-]{0,39}$` is satisfied for any non-empty name.
 */
export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return base || 'project';
}

// ── Global store ───────────────────────────────────────────────────────────

interface ProjectStoreState {
  projects: Map<string, Project>;
}

const G = globalThis as unknown as { __holonProjects?: Partial<ProjectStoreState> };
if (!G.__holonProjects) G.__holonProjects = {};
const PS = G.__holonProjects;
if (!PS.projects) PS.projects = new Map();
const S = PS as ProjectStoreState;

// ── CRUD ──────────────────────────────────────────────────────────────────

export type CreateProjectInput = {
  desk_id: string;
  name: string;
  color?: string;
};

export type UpdateProjectInput = {
  name?: string;
  color?: string;
  archived?: boolean;
};

/** Create a new project. Auto-slugifies name; appends a numeric suffix to
 *  avoid slug collisions (same name twice gets `my-project` → `my-project-2`). */
export function createProject(input: CreateProjectInput): Project {
  const baseSlug = slugify(input.name);
  let slug = baseSlug;
  let suffix = 2;
  // Collision-resist: if slug taken, append -2, -3, …
  const existingSlugs = new Set(Array.from(S.projects.values()).map((p) => p.slug));
  while (existingSlugs.has(slug)) {
    slug = `${baseSlug.slice(0, 37)}-${suffix}`;
    suffix++;
  }

  const project: Project = {
    id: mintId('proj'),
    desk_id: input.desk_id,
    name: input.name,
    slug,
    color: input.color,
    archived: false,
    created_at: new Date().toISOString(),
  };

  S.projects.set(project.id, project);

  console.log(JSON.stringify({
    audit: 'project.created',
    project_id: project.id,
    slug: project.slug,
    desk_id: project.desk_id,
    ts: new Date().toISOString(),
  }));

  return project;
}

/** List all projects, optionally including archived ones. */
export function listProjects(opts?: { include_archived?: boolean }): Project[] {
  const all = Array.from(S.projects.values());
  if (!opts?.include_archived) return all.filter((p) => !p.archived);
  return all;
}

/** Get a project by id. Returns null if not found. */
export function getProject(id: string): Project | null {
  return S.projects.get(id) ?? null;
}

/** Update a project (rename / archive). Returns the updated project or null if not found. */
export function updateProject(id: string, patch: UpdateProjectInput): Project | null {
  const existing = S.projects.get(id);
  if (!existing) return null;

  let slug = existing.slug;
  if (patch.name && patch.name !== existing.name) {
    const baseSlug = slugify(patch.name);
    slug = baseSlug;
    let suffix = 2;
    const existingSlugs = new Set(
      Array.from(S.projects.values())
        .filter((p) => p.id !== id)
        .map((p) => p.slug),
    );
    while (existingSlugs.has(slug)) {
      slug = `${baseSlug.slice(0, 37)}-${suffix}`;
      suffix++;
    }
  }

  const updated: Project = {
    ...existing,
    ...(patch.name !== undefined ? { name: patch.name, slug } : {}),
    ...(patch.color !== undefined ? { color: patch.color } : {}),
    ...(patch.archived !== undefined ? { archived: patch.archived } : {}),
  };

  S.projects.set(id, updated);

  console.log(JSON.stringify({
    audit: 'project.updated',
    project_id: id,
    slug: updated.slug,
    archived: updated.archived,
    ts: new Date().toISOString(),
  }));

  return updated;
}

/** Delete a project. Returns true if deleted, false if not found. */
export function deleteProject(id: string): boolean {
  const deleted = S.projects.delete(id);
  if (deleted) {
    console.log(JSON.stringify({
      audit: 'project.deleted',
      project_id: id,
      ts: new Date().toISOString(),
    }));
  }
  return deleted;
}

/** Get project counts — used by reset endpoint. */
export function projectStoreSize(): number {
  return S.projects.size;
}

/** Clear all projects — called by the admin reset endpoint. */
export function clearProjectStore(): number {
  const count = S.projects.size;
  S.projects.clear();
  return count;
}

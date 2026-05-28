/**
 * secretary-projects-service — SQLite-backed secretary-project store.
 *
 * A "secretary project" is a named workspace that owns ONE secretary staff
 * member. The owner's 聊天 tab lists projects instead of embedding a single
 * secretary, enabling multi-project workflows.
 *
 * Entity:
 *   SecretaryProject { id, name, secretary_staff_id, created_at, color? }
 *
 * Thread key: `project:<id>` — each project has independent chat history.
 *
 * Migration: on first call, if no projects exist AND a secretary staff record
 * exists, auto-create a "默认项目" pointing at it.
 *
 * Storage: same SQLite DB as chat-transcript-store (resolveDbPath()).
 * Table: `secretary_projects` (DDL below).
 */

import { existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, platform } from 'node:os';
import { dirname, join } from 'node:path';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SecretaryProject {
  id: string;
  name: string;
  secretary_staff_id: string;
  created_at: string;
  color?: string;
}

export interface CreateSecretaryProjectInput {
  name: string;
  secretary_staff_id: string;
  color?: string;
}

// ── SQLite singleton (same pattern as chat-transcript-store) ──────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BetterSqliteDatabase = any;
let _db: BetterSqliteDatabase | null = null;
let _dbInitFailed = false;
const requireFn = createRequire(import.meta.url);

function resolveDbPath(): string {
  if (process.env.HOLON_DB_PATH) return process.env.HOLON_DB_PATH;
  if (platform() === 'win32') {
    const base = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local');
    return join(base, 'Holon', 'owner.sqlite');
  }
  const xdg = process.env.XDG_DATA_HOME;
  const base = xdg ? join(xdg, 'holon') : join(homedir(), '.holon');
  return join(base, 'owner.sqlite');
}

function ensureDb(): BetterSqliteDatabase | null {
  if (_db) return _db;
  if (_dbInitFailed) return null;
  try {
    const dbPath = resolveDbPath();
    const parent = dirname(dbPath);
    if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
    const Database = requireFn('better-sqlite3') as new (path: string) => BetterSqliteDatabase;
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    // Ensure base owner_state table (idempotent — chat-transcript-store does the same).
    db.exec(`
      CREATE TABLE IF NOT EXISTS owner_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    // Secretary projects table.
    db.exec(`
      CREATE TABLE IF NOT EXISTS secretary_projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        secretary_staff_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        color TEXT
      )
    `);
    _db = db;
    return _db;
  } catch (err) {
    _dbInitFailed = true;
    console.error(JSON.stringify({
      audit: 'secretary_projects.db_open_failed',
      error: err instanceof Error ? err.message : String(err),
      ts: new Date().toISOString(),
    }));
    return null;
  }
}

// ── ID generation ─────────────────────────────────────────────────────────────

function mintProjectId(): string {
  const ts = Date.now().toString(36).padStart(9, '0');
  // 8 random hex bytes → 16 chars; total suffix = 25 chars
  const rnd = Array.from({ length: 8 }, () =>
    Math.floor(Math.random() * 256).toString(16).padStart(2, '0'),
  ).join('');
  return `sproj_${ts}${rnd}`;
}

// ── Migration: auto-create 默认项目 ────────────────────────────────────────────

let _migrationRan = false;

/**
 * If no secretary projects exist yet AND a secretary staff exists in the
 * dynamic staff roster, create "默认项目" pointing at it.
 * Called lazily on first listSecretaryProjects() or createSecretaryProject().
 */
function runMigrationOnce(): void {
  if (_migrationRan) return;
  _migrationRan = true;

  const db = ensureDb();
  if (!db) return;

  try {
    const count = (db.prepare('SELECT COUNT(*) AS n FROM secretary_projects').get() as { n: number }).n;
    if (count > 0) return; // already have projects — skip

    // Look for the default secretary staff via owner-state-persistence.
    // Import lazily to avoid circular deps (secretary-service imports staff-management-service).
    // We directly query the owner_state KV table for dynamic staff JSON.
    const row = db.prepare("SELECT value FROM owner_state WHERE key = 'dynamicStaff'").get() as
      | { value: string }
      | undefined;
    if (!row) return;

    let staffList: Array<{ id: string; role_name?: string; substrate?: { kind: string } }> = [];
    try {
      const parsed = JSON.parse(row.value) as unknown;
      if (Array.isArray(parsed)) staffList = parsed as typeof staffList;
    } catch {
      return;
    }

    const secretary = staffList.find(
      (s) => s.role_name === 'secretary' && s.substrate?.kind === 'cli_agent',
    );
    if (!secretary) return;

    const proj: SecretaryProject = {
      id: mintProjectId(),
      name: '默认项目',
      secretary_staff_id: secretary.id,
      created_at: new Date().toISOString(),
    };

    db.prepare(
      'INSERT INTO secretary_projects (id, name, secretary_staff_id, created_at, color) VALUES (?, ?, ?, ?, ?)',
    ).run(proj.id, proj.name, proj.secretary_staff_id, proj.created_at, proj.color ?? null);

    // Copy owner thread chat history → project:{id} thread, so owner doesn't
    // perceive chat history as "lost" after migration. Chat transcripts live
    // in the owner_state table keyed `chatTranscript:{threadId}` (see
    // chat-transcript-store.ts). Idempotent: skips when target exists.
    try {
      const ownerKey = 'chatTranscript:owner';
      const projKey = `chatTranscript:project:${proj.id}`;
      const ownerMsgs = db.prepare(
        'SELECT value FROM owner_state WHERE key = ?',
      ).get(ownerKey) as { value: string } | undefined;
      const existing = db.prepare(
        'SELECT value FROM owner_state WHERE key = ?',
      ).get(projKey) as { value: string } | undefined;
      if (ownerMsgs?.value && !existing) {
        const now = Date.now();
        db.prepare(
          'INSERT INTO owner_state (key, value, updated_at) VALUES (?, ?, ?)',
        ).run(projKey, ownerMsgs.value, now);
        console.log(JSON.stringify({
          audit: 'secretary_projects.migration.thread_copied',
          from: 'owner',
          to: `project:${proj.id}`,
          ts: new Date().toISOString(),
        }));
      }
    } catch (e) {
      console.warn(JSON.stringify({
        audit: 'secretary_projects.migration.thread_copy_failed',
        error: e instanceof Error ? e.message : String(e),
      }));
    }

    console.log(JSON.stringify({
      audit: 'secretary_projects.migration.default_created',
      project_id: proj.id,
      secretary_staff_id: secretary.id,
      ts: proj.created_at,
    }));

    // Tag all existing staff that have no `project:` tag with `project:{proj.id}`.
    // This is idempotent: re-running only touches staff still missing a project tag.
    try {
      const staffRow = db.prepare("SELECT value FROM owner_state WHERE key = 'dynamicStaff'").get() as
        | { value: string }
        | undefined;
      if (staffRow?.value) {
        let staffList: Array<{ id: string; tags?: string[] }> = [];
        try {
          const parsed = JSON.parse(staffRow.value) as unknown;
          if (Array.isArray(parsed)) staffList = parsed as typeof staffList;
        } catch { /* ignore parse error */ }

        const projectTag = `project:${proj.id}`;
        let taggedCount = 0;
        for (const s of staffList) {
          const tags: string[] = Array.isArray(s.tags) ? s.tags : [];
          if (!tags.some((t) => t.startsWith('project:'))) {
            tags.push(projectTag);
            s.tags = tags;
            taggedCount += 1;
          }
        }
        if (taggedCount > 0) {
          db.prepare(
            'UPDATE owner_state SET value = ?, updated_at = ? WHERE key = ?',
          ).run(JSON.stringify(staffList), Date.now(), 'dynamicStaff');
          console.log(JSON.stringify({
            audit: 'secretary_projects.migration.staff_tagged',
            project_id: proj.id,
            tagged_count: taggedCount,
            ts: new Date().toISOString(),
          }));
        }
      }
    } catch (tagErr) {
      console.warn(JSON.stringify({
        audit: 'secretary_projects.migration.staff_tag_failed',
        error: tagErr instanceof Error ? tagErr.message : String(tagErr),
      }));
    }
  } catch (err) {
    console.error(JSON.stringify({
      audit: 'secretary_projects.migration.failed',
      error: err instanceof Error ? err.message : String(err),
      ts: new Date().toISOString(),
    }));
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/** List all secretary projects. Never throws — returns [] on error. */
export function listSecretaryProjects(): SecretaryProject[] {
  runMigrationOnce();
  const db = ensureDb();
  if (!db) return [];
  try {
    const rows = db.prepare(
      'SELECT id, name, secretary_staff_id, created_at, color FROM secretary_projects ORDER BY created_at ASC',
    ).all() as Array<{ id: string; name: string; secretary_staff_id: string; created_at: string; color: string | null }>;
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      secretary_staff_id: r.secretary_staff_id,
      created_at: r.created_at,
      ...(r.color ? { color: r.color } : {}),
    }));
  } catch (err) {
    console.error(JSON.stringify({
      audit: 'secretary_projects.list_failed',
      error: err instanceof Error ? err.message : String(err),
      ts: new Date().toISOString(),
    }));
    return [];
  }
}

/** Get a single project by id. Returns null if not found. Never throws. */
export function getSecretaryProject(id: string): SecretaryProject | null {
  const db = ensureDb();
  if (!db) return null;
  try {
    const row = db.prepare(
      'SELECT id, name, secretary_staff_id, created_at, color FROM secretary_projects WHERE id = ?',
    ).get(id) as { id: string; name: string; secretary_staff_id: string; created_at: string; color: string | null } | undefined;
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      secretary_staff_id: row.secretary_staff_id,
      created_at: row.created_at,
      ...(row.color ? { color: row.color } : {}),
    };
  } catch (err) {
    console.error(JSON.stringify({
      audit: 'secretary_projects.get_failed',
      id,
      error: err instanceof Error ? err.message : String(err),
      ts: new Date().toISOString(),
    }));
    return null;
  }
}

/** Create a new secretary project. Never throws — returns null on DB error. */
export function createSecretaryProject(input: CreateSecretaryProjectInput): SecretaryProject | null {
  runMigrationOnce();
  const db = ensureDb();
  if (!db) return null;
  try {
    const proj: SecretaryProject = {
      id: mintProjectId(),
      name: input.name.trim(),
      secretary_staff_id: input.secretary_staff_id,
      created_at: new Date().toISOString(),
      ...(input.color ? { color: input.color } : {}),
    };
    db.prepare(
      'INSERT INTO secretary_projects (id, name, secretary_staff_id, created_at, color) VALUES (?, ?, ?, ?, ?)',
    ).run(proj.id, proj.name, proj.secretary_staff_id, proj.created_at, proj.color ?? null);
    console.log(JSON.stringify({
      audit: 'secretary_projects.created',
      project_id: proj.id,
      name: proj.name,
      secretary_staff_id: proj.secretary_staff_id,
      ts: proj.created_at,
    }));
    return proj;
  } catch (err) {
    console.error(JSON.stringify({
      audit: 'secretary_projects.create_failed',
      error: err instanceof Error ? err.message : String(err),
      ts: new Date().toISOString(),
    }));
    return null;
  }
}

/** Rename or recolor a project. Returns updated project or null if not found. Never throws. */
export function updateSecretaryProject(
  id: string,
  patch: { name?: string; color?: string },
): SecretaryProject | null {
  const db = ensureDb();
  if (!db) return null;
  try {
    const existing = getSecretaryProject(id);
    if (!existing) return null;

    const name = patch.name?.trim() ?? existing.name;
    const color = patch.color !== undefined ? patch.color : (existing.color ?? null);

    db.prepare(
      'UPDATE secretary_projects SET name = ?, color = ? WHERE id = ?',
    ).run(name, color || null, id);

    console.log(JSON.stringify({
      audit: 'secretary_projects.updated',
      project_id: id,
      ts: new Date().toISOString(),
    }));

    return getSecretaryProject(id);
  } catch (err) {
    console.error(JSON.stringify({
      audit: 'secretary_projects.update_failed',
      id,
      error: err instanceof Error ? err.message : String(err),
      ts: new Date().toISOString(),
    }));
    return null;
  }
}

/**
 * Delete a project. Returns `{ ok: true }` on success or
 * `{ ok: false, reason }` if the project is not found or is the last one.
 * Never throws.
 */
export function deleteSecretaryProject(id: string): { ok: boolean; reason?: string } {
  const db = ensureDb();
  if (!db) return { ok: false, reason: 'db_unavailable' };
  try {
    const existing = getSecretaryProject(id);
    if (!existing) return { ok: false, reason: 'not_found' };

    // Refuse to delete the last project.
    const count = (db.prepare('SELECT COUNT(*) AS n FROM secretary_projects').get() as { n: number }).n;
    if (count <= 1) return { ok: false, reason: 'last_project' };

    db.prepare('DELETE FROM secretary_projects WHERE id = ?').run(id);
    console.log(JSON.stringify({
      audit: 'secretary_projects.deleted',
      project_id: id,
      ts: new Date().toISOString(),
    }));
    return { ok: true };
  } catch (err) {
    console.error(JSON.stringify({
      audit: 'secretary_projects.delete_failed',
      id,
      error: err instanceof Error ? err.message : String(err),
      ts: new Date().toISOString(),
    }));
    return { ok: false, reason: 'db_error' };
  }
}

/** Chat thread key for a secretary project. */
export function secretaryProjectThreadId(projectId: string): string {
  return `project:${projectId}`;
}

/** Reset migration flag — for tests only. */
export function _resetSecretaryProjectMigrationForTests(): void {
  _migrationRan = false;
  _db = null;
  _dbInitFailed = false;
}

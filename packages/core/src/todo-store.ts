/**
 * Todo store — SQLite-backed boss backlog. Mirrors the owner-state-persistence
 * pattern: separate todos table, same DB file, same WAL + audit-log posture.
 * Failure posture: read errors return [] / null; write errors are audit-logged
 * and swallowed so a disk hiccup NEVER turns into a 500 on the mobile client.
 */

import { existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, platform } from 'node:os';
import { dirname, join } from 'node:path';

import type { Todo, TodoPriority } from '@holon/api-contract';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = any;
let _db: DB | null = null;
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

function ensureDb(): DB | null {
  if (_db) return _db;
  if (_dbInitFailed) return null;
  try {
    const dbPath = resolveDbPath();
    const parent = dirname(dbPath);
    if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
    const Database = requireFn('better-sqlite3') as new (path: string) => DB;
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE IF NOT EXISTS todos (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        priority TEXT NOT NULL DEFAULT 'medium',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    // Graceful migration: add priority column if it doesn't exist yet (existing DB).
    try {
      db.exec(`ALTER TABLE todos ADD COLUMN priority TEXT NOT NULL DEFAULT 'medium'`);
    } catch {
      // Column already exists — ignore.
    }
    _db = db;
    console.log(JSON.stringify({
      audit: 'todo_store.opened',
      path: dbPath,
      ts: new Date().toISOString(),
    }));
    return _db;
  } catch (err) {
    _dbInitFailed = true;
    console.error(JSON.stringify({
      audit: 'todo_store.open_failed',
      error: err instanceof Error ? err.message : String(err),
      ts: new Date().toISOString(),
    }));
    return null;
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function mintId(): string {
  // Simple collision-proof: "todo_" + timestamp base36 + 8 random chars
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `todo_${ts}${rand}`;
}

// Priority sort order: high=0, medium=1, low=2
const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

function normalizePriority(p: unknown): TodoPriority {
  if (p === 'high' || p === 'low') return p;
  return 'medium';
}

function normalizeRow(row: Record<string, unknown>): Todo {
  return {
    id: row.id as string,
    text: row.text as string,
    status: row.status as Todo['status'],
    priority: normalizePriority(row.priority),
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

/** List all todos, sorted by priority (high→low) then newest first. */
export function listTodos(): Todo[] {
  const db = ensureDb();
  if (!db) return [];
  try {
    const rows = db.prepare('SELECT * FROM todos ORDER BY created_at DESC').all() as Record<string, unknown>[];
    const todos = rows.map(normalizeRow);
    todos.sort((a, b) => {
      const pa = PRIORITY_ORDER[a.priority] ?? 1;
      const pb = PRIORITY_ORDER[b.priority] ?? 1;
      if (pa !== pb) return pa - pb;
      // same priority: newest first (already sorted by created_at DESC from DB)
      return 0;
    });
    return todos;
  } catch (err) {
    console.error(JSON.stringify({
      audit: 'todo_store.list_failed',
      error: err instanceof Error ? err.message : String(err),
      ts: new Date().toISOString(),
    }));
    return [];
  }
}

/** Add a new todo with status='pending'. Returns the created todo. */
export function addTodo(text: string, priority: TodoPriority = 'medium'): Todo {
  const db = ensureDb();
  const now = nowIso();
  const todo: Todo = {
    id: mintId(),
    text,
    status: 'pending',
    priority,
    created_at: now,
    updated_at: now,
  };
  if (!db) return todo; // in-memory fallback: return but don't persist
  try {
    db.prepare(
      'INSERT INTO todos (id, text, status, priority, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(todo.id, todo.text, todo.status, todo.priority, todo.created_at, todo.updated_at);
    console.log(JSON.stringify({
      audit: 'todo_store.add',
      id: todo.id,
      ts: now,
    }));
  } catch (err) {
    console.error(JSON.stringify({
      audit: 'todo_store.add_failed',
      error: err instanceof Error ? err.message : String(err),
      ts: now,
    }));
  }
  return todo;
}

/** Update status, text, and/or priority. Returns updated todo, or null if not found. */
export function updateTodo(
  id: string,
  patch: { status?: Todo['status']; text?: string; priority?: TodoPriority },
): Todo | null {
  const db = ensureDb();
  if (!db) return null;
  try {
    const rawRow = db.prepare('SELECT * FROM todos WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!rawRow) return null;
    const row = normalizeRow(rawRow);
    const updated: Todo = {
      ...row,
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.text !== undefined ? { text: patch.text } : {}),
      ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
      updated_at: nowIso(),
    };
    db.prepare(
      'UPDATE todos SET text = ?, status = ?, priority = ?, updated_at = ? WHERE id = ?',
    ).run(updated.text, updated.status, updated.priority, updated.updated_at, id);
    console.log(JSON.stringify({
      audit: 'todo_store.update',
      id,
      patch,
      ts: updated.updated_at,
    }));
    return updated;
  } catch (err) {
    console.error(JSON.stringify({
      audit: 'todo_store.update_failed',
      id,
      error: err instanceof Error ? err.message : String(err),
      ts: new Date().toISOString(),
    }));
    return null;
  }
}

/** Delete a todo. Returns true if deleted, false if not found. */
export function deleteTodo(id: string): boolean {
  const db = ensureDb();
  if (!db) return false;
  try {
    const info = db.prepare('DELETE FROM todos WHERE id = ?').run(id) as { changes: number };
    const deleted = info.changes > 0;
    if (deleted) {
      console.log(JSON.stringify({
        audit: 'todo_store.delete',
        id,
        ts: new Date().toISOString(),
      }));
    }
    return deleted;
  } catch (err) {
    console.error(JSON.stringify({
      audit: 'todo_store.delete_failed',
      id,
      error: err instanceof Error ? err.message : String(err),
      ts: new Date().toISOString(),
    }));
    return false;
  }
}

/** Test helper: reset the DB singleton (mirrors owner-state-persistence._resetForTest). */
export function _resetTodoStoreForTest(): void {
  if (_db) {
    try { _db.close(); } catch { /* ignore */ }
  }
  _db = null;
  _dbInitFailed = false;
}

/**
 * Drizzle better-sqlite3 client pointed at `<repoRoot>/.holon/auth.db`.
 *
 * iter-013 Pass #2 (ADR-024 step 4): SQLite is the V1 local-only storage
 * substrate matching docs/product/mvp-scope.md § 2 (single-user desktop)
 * and ADR-005 (Tauri shell). Upgrade to Postgres = swap the dialect import
 * in this file + adapter choice in `lib/encrypted-token-storage.ts`.
 *
 * The `.holon/` directory sits next to `.env` at the repo root so the
 * runtime layout mirrors the secrets layout (both gitignored, both vendor-
 * private, both never sync'd to remote). `.holon/` is added to .gitignore.
 *
 * Side-effect on import: ensures the parent directory exists. The
 * better-sqlite3 constructor creates the file itself on first open; the
 * `CREATE TABLE IF NOT EXISTS` statements live in `scripts/init-auth-db.ts`
 * which `instrumentation.ts` invokes once at server boot.
 */

import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { schema } from './schema';

function walkUpFor(start: string, marker: string, maxHops = 8): string | null {
  let dir = start;
  for (let i = 0; i < maxHops; i++) {
    if (existsSync(join(dir, marker))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

function findRepoRoot(): string {
  // 1. Operator escape hatch — highest priority.
  if (process.env.HOLON_REPO_ROOT) return process.env.HOLON_REPO_ROOT;

  // 2. Walk up from process.cwd() FIRST. Why: in Next.js dev mode the
  //    webpack-compiled bundle reports a `__dirname` that is unreliable —
  //    sometimes `/`, sometimes a bundler-internal virtual path — which
  //    silently broke the walk and forced a `process.cwd()` fallback that
  //    happened to land on `apps/web/`, producing a second auth.db at
  //    `apps/web/.holon/auth.db`. `process.cwd()` is set by the `pnpm dev`
  //    invocation and reliably points at `apps/web/`, and walking up from
  //    there finds the monorepo root via `pnpm-workspace.yaml`. See
  //    docs/dev-log.md 2026-05-18 for the 7h forensic that motivated this.
  const fromCwd = walkUpFor(process.cwd(), 'pnpm-workspace.yaml');
  if (fromCwd) return fromCwd;

  // 3. Defensive fallback: __dirname walk. Covers exotic runtimes (e.g.
  //    `.next/standalone/...`) where cwd may not be inside the repo. Not
  //    primary because of the webpack instability noted above.
  const fromDirname = walkUpFor(__dirname, 'pnpm-workspace.yaml');
  if (fromDirname) return fromDirname;

  // 4. Hard fail rather than silently fall back to cwd — silent fallback is
  //    exactly what caused today's split-auth-db bug. Tell the operator how
  //    to escape.
  throw new Error(
    '[db] findRepoRoot: could not locate pnpm-workspace.yaml from either ' +
      `process.cwd()=${process.cwd()} or __dirname=${__dirname}. ` +
      'Set HOLON_REPO_ROOT=<abs path to repo root> to override.',
  );
}

/**
 * Resolve the absolute path to `auth.db`. Two regimes:
 *
 *   A. Tauri-bundled production (Windows installer, macOS .app, Linux
 *      AppImage): the Rust shell spawns the Node sidecar with
 *      `HOLON_DATA_DIR` set to the OS-conventional per-app data dir
 *      (`%LOCALAPPDATA%\com.holon.desk\` on Windows etc.). The Next.js
 *      standalone bundle lives at `resources/n/apps/web/` inside the
 *      installer payload — NO ancestor directory contains
 *      `pnpm-workspace.yaml`, so the cwd / __dirname walks in
 *      `findRepoRoot()` would throw, killing the Tauri `setup()`
 *      silently (Engineering Rule #4 violation observed in the
 *      2026-05-19 08:17 Windows install). When `HOLON_DATA_DIR` is set,
 *      we short-circuit to `<HOLON_DATA_DIR>/auth.db` and skip the walk
 *      entirely.
 *
 *   B. Dev (`pnpm dev` in the monorepo): `HOLON_DATA_DIR` is unset so we
 *      fall through to `findRepoRoot()` and the auth.db lands at
 *      `<repoRoot>/.holon/auth.db` (unchanged historical behavior).
 */
function resolveAuthDbPath(): string {
  if (process.env.HOLON_DATA_DIR) {
    return join(process.env.HOLON_DATA_DIR, 'auth.db');
  }
  return join(findRepoRoot(), '.holon', 'auth.db');
}

export const AUTH_DB_PATH = resolveAuthDbPath();

// One-time stderr log on module load so future "wrong db" forensics is a
// `grep '[db] AUTH_DB_PATH'` away instead of a 30-min investigation.
console.log('[db] AUTH_DB_PATH=' + AUTH_DB_PATH);

// Ensure parent dir exists — better-sqlite3 creates the file, not the dir.
const parent = dirname(AUTH_DB_PATH);
if (!existsSync(parent)) mkdirSync(parent, { recursive: true });

export const sqlite = new Database(AUTH_DB_PATH);
sqlite.pragma('journal_mode = WAL');

// Pass #2 hotfix3: init the four NextAuth tables on first import (idempotent
// via `IF NOT EXISTS`). Previously this lived in `scripts/init-auth-db.ts`
// invoked by `instrumentation.ts`, but webpack can't dynamic-import the .ts
// from instrumentation cleanly (eval-require can't resolve .ts; bundler
// pulls in better-sqlite3 native deps). Inlining here makes the init happen
// the first time any route handler imports `db` (via NextAuth adapter), which
// is well before any auth flow attempts a DB query. The DDL matches
// `@auth/drizzle-adapter`'s `defineTables()` for SQLite.
const AUTH_TABLE_DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS "user" (
    "id" text PRIMARY KEY NOT NULL,
    "name" text,
    "email" text UNIQUE,
    "emailVerified" integer,
    "image" text
  )`,
  `CREATE TABLE IF NOT EXISTS "account" (
    "userId" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "type" text NOT NULL,
    "provider" text NOT NULL,
    "providerAccountId" text NOT NULL,
    "refresh_token" text,
    "access_token" text,
    "expires_at" integer,
    "token_type" text,
    "scope" text,
    "id_token" text,
    "session_state" text,
    PRIMARY KEY ("provider", "providerAccountId")
  )`,
  `CREATE TABLE IF NOT EXISTS "session" (
    "sessionToken" text PRIMARY KEY NOT NULL,
    "userId" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "expires" integer NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "verificationToken" (
    "identifier" text NOT NULL,
    "token" text NOT NULL,
    "expires" integer NOT NULL,
    PRIMARY KEY ("identifier", "token")
  )`,
];
for (const stmt of AUTH_TABLE_DDL) sqlite.exec(stmt);

export const db = drizzle(sqlite, { schema });
export type Db = typeof db;

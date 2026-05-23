/**
 * Idempotent `CREATE TABLE IF NOT EXISTS` for the four NextAuth tables.
 *
 * iter-013 Pass #2 (ADR-024 step 4): instead of pulling in drizzle-kit
 * for a 4-table schema we issue the DDL ourselves. Idempotent — re-running
 * is a no-op. instrumentation.ts calls this on every boot (cheap; SQLite
 * IF NOT EXISTS is sub-millisecond when the tables already exist).
 *
 * The schema must stay byte-identical to `@auth/drizzle-adapter`'s
 * `defineTables()` (which `db/schema.ts` re-exports) — column names and
 * types are matched against `node_modules/@auth/drizzle-adapter/lib/sqlite.js`.
 *
 * Encryption-at-rest (L-030): the `access_token`, `refresh_token`, and
 * `id_token` columns store AES-256-GCM ciphertext (`b64(iv).b64(ct).b64(tag)`),
 * not plaintext. The encryption wrapping lives in
 * `apps/web/lib/encrypted-token-storage.ts`; this file just creates the
 * columns as plain TEXT (the ciphertext is itself a UTF-8 string).
 */

import { sqlite } from '../db';

const DDL: string[] = [
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

export function initAuthDb(): void {
  for (const stmt of DDL) sqlite.exec(stmt);
}

// When invoked directly (`node --experimental-loader ... init-auth-db.ts`),
// run + report. When imported (from instrumentation.ts), only the function
// is exposed — caller decides when to run.
const isMain =
  typeof require !== 'undefined' && require.main === module;
if (isMain) {
  initAuthDb();
  // eslint-disable-next-line no-console
  console.log('[init-auth-db] tables ready at', process.env.HOLON_REPO_ROOT ?? '<repo>/.holon/auth.db');
}

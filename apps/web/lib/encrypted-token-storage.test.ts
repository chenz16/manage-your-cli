/**
 * Round-trip test for the encrypted drizzle-adapter wrap.
 *
 * iter-013 Pass #2 (ADR-024 step 7): verifies the L-030 invariant —
 * tokens-at-rest in the SQLite `account` table are AES-256-GCM ciphertext
 * (`b64(iv).b64(ct).b64(tag)` shape), never plaintext. Reads through the
 * adapter return decrypted plaintext to NextAuth.
 *
 * Uses an in-memory better-sqlite3 instance (`:memory:`) so the test
 * doesn't touch `.holon/auth.db` and runs in milliseconds. Schema is the
 * canonical @auth/drizzle-adapter sqlite tables (same as production).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { randomBytes } from 'node:crypto';

// Provision a fresh key BEFORE importing the encrypted adapter (which
// imports @holon/auth/crypto, which caches the key on first read).
process.env.HOLON_TOKEN_ENC_KEY = randomBytes(32).toString('base64');

// Imports are inline so module load happens after the env var is set.
const { encryptedDrizzleAdapter } = await import('./encrypted-token-storage');
const { schema } = await import('@/db/schema');

function freshDb() {
  const sqlite = new Database(':memory:');
  // Identical DDL to scripts/init-auth-db.ts (kept local to the test so
  // a refactor of the production init script can't silently break us).
  sqlite.exec(`
    CREATE TABLE "user" (
      "id" text PRIMARY KEY NOT NULL,
      "name" text,
      "email" text UNIQUE,
      "emailVerified" integer,
      "image" text
    );
    CREATE TABLE "account" (
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
    );
    INSERT INTO "user" ("id", "email") VALUES ('u1', 'test@example.com');
  `);
  return { sqlite, db: drizzle(sqlite, { schema }) };
}

describe('encryptedDrizzleAdapter', () => {
  const plaintextAccess = 'ya29.plaintext-access-token-DO-NOT-PERSIST-RAW';
  const plaintextRefresh = '1//plaintext-refresh-token-DO-NOT-PERSIST-RAW';
  const plaintextId = 'eyJ.fake-id-token.plaintext';
  // L-061: cover the OIDC session_state column too — Google never emits it
  // but the encrypt allowlist must round-trip it for iter-014+ providers.
  const plaintextSessionState = 'oidc-session-state-plaintext-DO-NOT-PERSIST-RAW';

  let sqlite: Database.Database;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let adapter: any;

  beforeAll(async () => {
    const env = freshDb();
    sqlite = env.sqlite;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    adapter = encryptedDrizzleAdapter(env.db as any);
    await adapter.linkAccount({
      userId: 'u1',
      type: 'oauth',
      provider: 'google',
      providerAccountId: 'google-user-123',
      access_token: plaintextAccess,
      refresh_token: plaintextRefresh,
      id_token: plaintextId,
      session_state: plaintextSessionState,
      token_type: 'Bearer',
      scope: 'openid email',
      expires_at: 1_900_000_000,
    });
  });

  it('writes ciphertext (not plaintext) to the account table on linkAccount', () => {
    // Raw SQL bypasses the adapter; what we see here is what's on disk.
    const row = sqlite
      .prepare('SELECT access_token, refresh_token, id_token, session_state FROM account WHERE provider = ?')
      .get('google') as {
        access_token: string;
        refresh_token: string;
        id_token: string;
        session_state: string;
      };

    expect(row.access_token).not.toBe(plaintextAccess);
    expect(row.refresh_token).not.toBe(plaintextRefresh);
    expect(row.id_token).not.toBe(plaintextId);
    expect(row.session_state).not.toBe(plaintextSessionState);

    // crypto.ts envelope shape: three base64-encoded parts joined by dots.
    // Each part decodes cleanly; the iv part is 12 bytes (GCM nonce len).
    const parts = row.access_token.split('.');
    expect(parts).toHaveLength(3);
    expect(Buffer.from(parts[0]!, 'base64').length).toBe(12);

    // L-030 invariant: literal plaintext never appears as a substring.
    expect(row.access_token).not.toContain('ya29');
    expect(row.refresh_token).not.toContain('plaintext');
    expect(row.id_token).not.toContain('fake-id-token');
    // L-061: session_state is encrypted too.
    expect(row.session_state).not.toContain('oidc-session-state-plaintext');
  });

  it('returns plaintext via getAccount (round-trip decrypt)', async () => {
    const decrypted = await adapter.getAccount('google-user-123', 'google');
    expect(decrypted).not.toBeNull();
    expect(decrypted.access_token).toBe(plaintextAccess);
    expect(decrypted.refresh_token).toBe(plaintextRefresh);
    expect(decrypted.id_token).toBe(plaintextId);
    // L-061: session_state round-trips through the encrypt allowlist too.
    expect(decrypted.session_state).toBe(plaintextSessionState);
    // Non-token columns are passed through untouched.
    expect(decrypted.token_type).toBe('Bearer');
    expect(decrypted.scope).toBe('openid email');
    expect(decrypted.expires_at).toBe(1_900_000_000);
  });
});

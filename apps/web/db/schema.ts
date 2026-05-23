/**
 * Drizzle schema for NextAuth v5 (Auth.js) — iter-013 Pass #2 (ADR-024
 * step 7 + step 5 option (b) encrypted-column wrapper).
 *
 * Column shape mirrors `@auth/drizzle-adapter`'s canonical SQLite tables
 * (see node_modules/@auth/drizzle-adapter/lib/sqlite.js → defineTables()).
 * We define them explicitly here (rather than re-export defineTables)
 * because the adapter package only exposes the top-level `DrizzleAdapter`
 * via its `exports` field — the sqlite.js subpath is not in the package
 * exports manifest. Defining them locally also keeps a single source of
 * truth that `scripts/init-auth-db.ts` validates against.
 *
 * Encryption-at-rest (L-030): `access_token`, `refresh_token`, `id_token`
 * are written + read via the encrypted wrapper in
 * `apps/web/lib/encrypted-token-storage.ts`. Column type stays plain `text`
 * because the ciphertext (`b64(iv).b64(ct).b64(tag)`) is itself UTF-8.
 */

import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';
import { randomUUID } from 'node:crypto';

export const usersTable = sqliteTable('user', {
  id: text('id').primaryKey().$defaultFn(() => randomUUID()),
  name: text('name'),
  email: text('email').unique(),
  emailVerified: integer('emailVerified', { mode: 'timestamp_ms' }),
  image: text('image'),
});

export const accountsTable = sqliteTable(
  'account',
  {
    userId: text('userId')
      .notNull()
      .references(() => usersTable.id, { onDelete: 'cascade' }),
    type: text('type').$type<'oauth' | 'oidc' | 'email' | 'webauthn'>().notNull(),
    provider: text('provider').notNull(),
    providerAccountId: text('providerAccountId').notNull(),
    refresh_token: text('refresh_token'),
    access_token: text('access_token'),
    expires_at: integer('expires_at'),
    token_type: text('token_type'),
    scope: text('scope'),
    id_token: text('id_token'),
    session_state: text('session_state'),
  },
  (account) => ({
    compositePk: primaryKey({ columns: [account.provider, account.providerAccountId] }),
  }),
);

export const sessionsTable = sqliteTable('session', {
  sessionToken: text('sessionToken').primaryKey(),
  userId: text('userId')
    .notNull()
    .references(() => usersTable.id, { onDelete: 'cascade' }),
  expires: integer('expires', { mode: 'timestamp_ms' }).notNull(),
});

export const verificationTokensTable = sqliteTable(
  'verificationToken',
  {
    identifier: text('identifier').notNull(),
    token: text('token').notNull(),
    expires: integer('expires', { mode: 'timestamp_ms' }).notNull(),
  },
  (vt) => ({
    compositePk: primaryKey({ columns: [vt.identifier, vt.token] }),
  }),
);

export const schema = {
  usersTable,
  accountsTable,
  sessionsTable,
  verificationTokensTable,
};

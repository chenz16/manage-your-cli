/**
 * Encryption-at-rest wrap around `@auth/drizzle-adapter`. iter-013 Pass #2
 * (ADR-024 § Implementation Notes step 7 + step 5 option (b)).
 *
 * Approach (b) — adapter shim: wrap the adapter object returned by
 * `SQLiteDrizzleAdapter()` and override every method whose argument or
 * return value carries `AdapterAccount` tokens. Encrypt on write, decrypt
 * on read at the adapter boundary. NextAuth never sees ciphertext;
 * `account` rows in `auth.db` never see plaintext.
 *
 * Why (b) over a drizzle custom column type ((a)):
 * - drizzle's custom-column API (v0.45) ships with `customType()`, but its
 *   serialize/parse hooks fire INSIDE drizzle, before NextAuth's adapter
 *   layer sees the row. That's fine functionally, but it couples encryption
 *   to drizzle's column-binding lifecycle which is a less-stable surface
 *   than the @auth/core `Adapter` contract.
 * - (b) is explicit: every adapter method touching tokens has an obvious
 *   en/decrypt call right next to it. Audit-friendly. Easy to grep.
 * - (b) keeps the dep-arrow clean: this file uses `encrypt`/`decrypt` from
 *   `@holon/auth` (already shipped in iter-011 Pass #1 + preserved per
 *   ADR-024). No new crypto code paths.
 *
 * Methods wrapped (all of them that read or write AdapterAccount):
 *   - linkAccount(account)              — write: encrypt before insert
 *   - getAccount(providerAccountId, p)  — read: decrypt on return
 *   - unlinkAccount({provider, providerAccountId}) — no tokens in I/O; passes through
 *
 * The base adapter's other methods (createUser, getSession, etc.) don't
 * carry token columns and pass through untouched.
 *
 * Engineering Rule #4 (no silent failure): encryption errors throw structured
 * Errors from `@holon/auth`'s crypto.ts (missing/wrong-length key,
 * malformed ciphertext, GCM auth-tag mismatch). Callers (NextAuth) surface
 * these to the error route. We do NOT swallow.
 *
 * Privacy invariant: never log raw token values. The crypto helper itself
 * doesn't log; this wrapper doesn't log; the only audit emit lives in
 * `packages/auth/token-store/token-store.ts` and is owner-id-prefix-only.
 */

import { DrizzleAdapter } from '@auth/drizzle-adapter';
import { encrypt, decrypt } from '@holon/auth';
import type { Adapter, AdapterAccount } from 'next-auth/adapters';
import type { Db } from '@/db';
import { schema } from '@/db/schema';

// HOLON_TOKEN_ENC_KEY guard. Previously a throw at module load, which
// broke `next build` on a fresh checkout that doesn't have the env set
// yet (Next collects page data by importing every route module). The
// crypto module itself re-throws on first encrypt() if the key is still
// missing at runtime, so we keep that latent guard but only LOG here
// at build/load. Production deployments that actually use the OAuth
// adapter will fail loudly on first request — the right place.
if (
  process.env.NODE_ENV === 'production' &&
  !process.env.HOLON_TOKEN_ENC_KEY &&
  // Don't even log during the build phase (Next sets this) — pure noise
  // in the user's first `pnpm build` after `git clone`.
  process.env.NEXT_PHASE !== 'phase-production-build'
) {
  // eslint-disable-next-line no-console
  console.warn(
    '[encrypted-token-storage] HOLON_TOKEN_ENC_KEY is unset; OAuth ' +
      'integrations will fail at first token write. Generate via ' +
      '`openssl rand -base64 32` and set in your .env.',
  );
}

/** Token columns we encrypt at the adapter boundary.
 *
 * L-061 (iter-013 SECURITY): `session_state` added defensively. Google's
 * OAuth 2.0 flow leaves it null, but iter-014+ OIDC providers (Microsoft /
 * Okta / Auth0 / Slack) emit it as a session-correlation token used by
 * back-channel logout. Encrypting at rest now means no migration when the
 * first OIDC provider lands.
 */
const TOKEN_FIELDS = ['access_token', 'refresh_token', 'id_token', 'session_state'] as const;
type TokenField = (typeof TOKEN_FIELDS)[number];

/** Encrypt every token field present on an AdapterAccount-shaped object. */
function encryptAccountTokens<T extends Partial<AdapterAccount>>(account: T): T {
  const out = { ...account } as Record<string, unknown>;
  for (const f of TOKEN_FIELDS) {
    const v = out[f];
    if (typeof v === 'string' && v.length > 0) {
      out[f] = encrypt(v);
    }
  }
  return out as T;
}

/** Decrypt every token field present on an AdapterAccount-shaped object. */
function decryptAccountTokens<T extends Partial<AdapterAccount> | null | undefined>(
  account: T,
): T {
  if (!account) return account;
  const out = { ...account } as Record<string, unknown>;
  for (const f of TOKEN_FIELDS) {
    const v = out[f];
    if (typeof v === 'string' && v.length > 0) {
      out[f] = decrypt(v);
    }
  }
  return out as T;
}

/**
 * Build the encrypted drizzle adapter. Pass the same `db` exported from
 * `@/db` (the better-sqlite3-backed instance) + the canonical schema.
 *
 * The returned Adapter is a drop-in for NextAuth's `adapter` config field.
 */
export function encryptedDrizzleAdapter(db: Db): Adapter {
  // DrizzleAdapter dispatches on the runtime DB type (PgDatabase / MySql /
  // SQLite). Our `db` is the better-sqlite3-backed SQLite flavor; the
  // adapter calls `SQLiteDrizzleAdapter` internally + uses the `account`
  // / `user` / `session` / `verificationToken` tables from our `schema`.
  const base = DrizzleAdapter(db, schema);

  return {
    ...base,

    async linkAccount(account: AdapterAccount): Promise<void> {
      if (!base.linkAccount) {
        throw new Error('encrypted-token-storage: base adapter has no linkAccount.');
      }
      // Encrypt before handing to drizzle insert. Auth.js calls linkAccount
      // immediately after Google's token endpoint returns — this is the
      // primary write path for `account.access_token` / `refresh_token`.
      // The drizzle adapter's linkAccount returns Promise<void> (it does an
      // INSERT with no `.returning()`), so the union-return signature in
      // the @auth/core Adapter type collapses cleanly to `Promise<void>`.
      const encrypted = encryptAccountTokens(account);
      await base.linkAccount(encrypted);
    },

    async getAccount(providerAccountId: string, provider: string) {
      if (!base.getAccount) {
        // The drizzle adapter does implement getAccount; defensive guard so
        // TypeScript narrows correctly + structured surface if upstream
        // drops the method in a future release.
        throw new Error('encrypted-token-storage: base adapter has no getAccount.');
      }
      const row = await base.getAccount(providerAccountId, provider);
      return decryptAccountTokens(row);
    },
  };
}

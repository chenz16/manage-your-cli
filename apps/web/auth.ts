// NextAuth v5 (Auth.js) — central config + handlers export.
//
// iter-013 Pass #2 (ADR-024 § Implementation Notes step 4 + step 7):
// wire the encrypted-column drizzle adapter (preserves L-030 token-
// encryption-at-rest invariant) + database session strategy + session
// callback that surfaces `access_token` on the typed Session object.
// Pass #3 rewires the /me UI + Hermes plugin endpoint.
//
// iter-013 post-Pass-#3 (HOLON_OAUTH_TEST_MODE short-circuit): when the env
// var is true (and NODE_ENV !== production), REPLACE the Google OIDC
// provider with a Credentials provider that keeps the SAME id='google' and
// returns a canned user without ever calling Google. UI components keep
// calling signIn('google') unchanged — no client-side env exposure, no
// NEXT_PUBLIC_* mirror, no UI ternary. Single source of truth: this file.
//
// (Prior design used two coexisting providers + UI ternary + NEXT_PUBLIC
// mirror; bundle-baked env value caused stale-browser-cache 401s. The
// provider-swap pattern is the standard NextAuth/Auth.js dev/test pattern.)
//
// Two-strategy split: Auth.js Credentials provider requires JWT session
// (the adapter can't persist a credentials-flow session row), but our
// production Google flow stays on `database` strategy so encrypted
// tokens land in `account` and the existing session-callback decrypt
// path is preserved. We pick the strategy at module load based on the
// env var — the two modes do NOT coexist in a single process boot.

import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import Google from 'next-auth/providers/google';
import { and, eq } from 'drizzle-orm';
import { decrypt } from '@holon/auth';
import { db } from '@/db';
import { accountsTable } from '@/db/schema';
import { encryptedDrizzleAdapter } from '@/lib/encrypted-token-storage';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? '';

// L-032 production-guard mirror — refuse to boot if the dev-only TEST_MODE
// flag accidentally inherited into a production env (e.g. dev .env copied
// into a container bake). The iter-011 oauth-client.ts + gmail_client.py
// hold the same invariant on their side; this guard closes the NextAuth
// side. Failing at module load is preferred over a lazy throw — keeps the
// signed-out routes from briefly serving with a misconfigured auth layer.
if (
  process.env.NODE_ENV === 'production' &&
  process.env.HOLON_OAUTH_TEST_MODE === 'true'
) {
  throw new Error(
    'auth.ts: HOLON_OAUTH_TEST_MODE cannot be enabled in production NODE_ENV ' +
      '(test-mode short-circuits the Google OAuth round-trip and would silently ' +
      'sign every user in as test@example.com).',
  );
}

const TEST_MODE = process.env.HOLON_OAUTH_TEST_MODE === 'true';

// Canned identity returned by the `test-google` Credentials provider. Kept
// in sync with the /api/v1/integrations/auth/session endpoint's TEST_MODE
// branch so the /me UI ("Connected as test@example.com") + the Hermes
// plugin (canned `test-mode-google-at` token) stay coherent end-to-end.
const TEST_USER = {
  id: 'test-user',
  email: 'test@example.com',
  name: 'Test User',
} as const;
const TEST_ACCESS_TOKEN = 'TEST_TOKEN_DO_NOT_USE_IN_PROD';
// gmail.compose added (feat: gmail-create-draft). Owner must re-consent via
// /connectors → Gmail → Reconnect to grant the new scope.
const TEST_SCOPE =
  'openid email profile https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose';

// Pass #2 rotates Pass #1's placeholder. The same HOLON_TOKEN_ENC_KEY that
// keys the AES-256-GCM encryption-at-rest wrap also signs NextAuth's
// session cookie — both are AUTH_SECRET-class secrets; one env var keeps
// the operator onboarding story simple (one `openssl rand -base64 32` to
// run, one .env line to set). In production the HOLON_TOKEN_ENC_KEY guard
// in lib/encrypted-token-storage.ts throws at module load if absent, so
// reaching the `secret:` field below already implies the var is set.
const AUTH_SECRET = process.env.HOLON_TOKEN_ENC_KEY;
// Pre-Release-2: this used to throw at module load when AUTH_SECRET was
// unset in production, which broke `next build` on a fresh clone (Next
// imports every route module during its page-data collection phase).
// The placeholder below covers the build pass; real production deploys
// MUST set HOLON_TOKEN_ENC_KEY or NextAuth requests will fail at runtime.
if (
  process.env.NODE_ENV === 'production' &&
  !AUTH_SECRET &&
  process.env.NEXT_PHASE !== 'phase-production-build'
) {
  // eslint-disable-next-line no-console
  console.warn(
    '[auth] HOLON_TOKEN_ENC_KEY is unset; NextAuth requests will fail. ' +
      'Generate via `openssl rand -base64 32` and set in .env.',
  );
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  // TEST_MODE skips the adapter entirely — JWT session strategy carries the
  // canned user inline (no DB row, no encrypted-token round-trip) so the
  // demo recipe doesn't even need auth.db to be initialised on a clean
  // checkout. Real flow keeps the encrypted drizzle adapter intact.
  ...(TEST_MODE ? {} : { adapter: encryptedDrizzleAdapter(db) }),
  providers: TEST_MODE
    ? [
        // TEST_MODE: Credentials provider keeps id='google' so UI's
        // signIn('google') call is unchanged. Short-circuits the entire
        // OAuth round-trip — no Google authorize endpoint hit, no
        // GOOGLE_CLIENT_ID needed. Strictly dev/test (L-032 guard above
        // refuses NODE_ENV=production with TEST_MODE on).
        Credentials({
          id: 'google',
          name: 'Google (TEST_MODE — canned identity)',
          credentials: {},
          authorize: async () => ({ ...TEST_USER }),
        }),
      ]
    : [
        Google({
          clientId: GOOGLE_CLIENT_ID,
          clientSecret: GOOGLE_CLIENT_SECRET,
          authorization: {
            params: {
              // Same scope set as iter-011 manual OAuth (gmail readonly +
              // email profile for the userinfo fetch that populates
              // session.user).
              scope: TEST_SCOPE,
              // offline + consent → Google issues a refresh_token on first consent.
              access_type: 'offline',
              prompt: 'consent',
            },
          },
        }),
      ],
  // Database sessions (default) keep token material out of the cookie
  // surface — the session cookie carries only the sessionToken row pointer;
  // access_token / refresh_token live in the encrypted `account` table.
  // TEST_MODE forces JWT because the Credentials provider can't persist
  // through the adapter (Auth.js constraint); the canned access_token
  // rides on the JWT itself instead.
  session: { strategy: TEST_MODE ? 'jwt' : 'database' },
  secret: AUTH_SECRET || 'dev-only-placeholder-rotated-in-production',
  callbacks: {
    /**
     * TEST_MODE branch: stamp the canned access_token / scope onto the JWT
     * at sign-in so the session callback can surface them without a DB
     * read. Only fires in JWT mode; database mode never invokes jwt().
     */
    async jwt({ token, user }) {
      if (TEST_MODE && user) {
        token.accessToken = TEST_ACCESS_TOKEN;
        token.scope = TEST_SCOPE;
        token.expiresAt = Math.floor(Date.now() / 1000) + 3600;
      }
      return token;
    },
    /**
     * Surface the Google access_token on `session.accessToken` for the
     * Pass #3 Hermes plugin BFF endpoint (which calls `auth()` server-side
     * and returns `session.accessToken` over the localhost-shared-secret
     * channel).
     *
     * Database mode: receives the user row but NOT the linked account row.
     * We query `account` directly here (one indexed row read per session
     * call; cheap on SQLite) and decrypt the access_token at the boundary.
     *
     * JWT mode (TEST_MODE): receives the token instead of user; the canned
     * access_token / scope / expiresAt were stamped on by the jwt callback
     * above. Also stamp the canned identity onto session.user so the
     * "Connected as <email>" surface in /me renders without a DB user row.
     *
     * Per Engineering Rule #4: no silent failure. If the row is missing
     * (user has a session but no Google account linked yet — possible
     * during the consent round-trip) we leave `accessToken` undefined and
     * the Pass #3 BFF endpoint returns a structured "not connected" error.
     * Decryption failures bubble up to NextAuth's error route.
     */
    async session({ session, user, token }) {
      if (TEST_MODE && token) {
        session.user = { ...session.user, ...TEST_USER };
        if (typeof token.accessToken === 'string') session.accessToken = token.accessToken;
        if (typeof token.scope === 'string') session.scope = token.scope;
        if (typeof token.expiresAt === 'number') session.expiresAt = token.expiresAt;
        return session;
      }
      if (user?.id) {
        const row = db
          .select({
            access_token: accountsTable.access_token,
            expires_at: accountsTable.expires_at,
            scope: accountsTable.scope,
          })
          .from(accountsTable)
          .where(
            and(
              eq(accountsTable.userId, user.id),
              eq(accountsTable.provider, 'google'),
            ),
          )
          .get();
        if (row?.access_token) {
          // Pass #3 (ADR-024 step 3): surface accessToken + the auxiliary
          // fields the /api/v1/integrations/auth/session BFF endpoint hands
          // to the Hermes plugin. expires_at is unix-seconds per the
          // NextAuth account-table convention; scope is the space-joined
          // Google scope string. Both pass through unchanged from the
          // account row (no transform → no encryption invariant impact;
          // only access_token is encrypted on disk).
          session.accessToken = decrypt(row.access_token);
          if (row.expires_at != null) session.expiresAt = row.expires_at;
          if (row.scope) session.scope = row.scope;
        }
      }
      return session;
    },
  }
});

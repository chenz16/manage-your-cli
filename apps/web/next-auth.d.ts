// TypeScript module augmentation for next-auth v5.
// iter-013 Pass #1 (ADR-024): declared the Session shape so callers can
// typecheck access_token reads.
// iter-013 Pass #2 (ADR-024 step 7): the field is now populated by the
// session callback in auth.ts, sourced from the encrypted `account` row
// via a one-row drizzle read + decrypt at the boundary.
// iter-013 post-Pass-#3 (HOLON_OAUTH_TEST_MODE): JWT augmentation added so
// the TEST_MODE jwt callback can stamp the canned access_token/scope/
// expiresAt onto the token shape without `any` casts.
//
// Both Session module declarations are required: `next-auth` re-exports
// `Session` from `@auth/core/types`, and the v5 session-callback parameter
// type is resolved against the @auth/core declaration, not the re-export.
// JWT augmentation lives under `next-auth/jwt` per Auth.js v5 conventions.

import 'next-auth';
import '@auth/core/types';
import 'next-auth/jwt';

declare module 'next-auth' {
  interface Session {
    /** Decrypted Google access_token for the current session's user. */
    accessToken?: string;
    /** Unix-seconds expiry of the Google access_token (account row column). */
    expiresAt?: number;
    /** Space-joined Google OAuth scope string the account was granted. */
    scope?: string;
  }
}

declare module '@auth/core/types' {
  interface Session {
    /** Decrypted Google access_token for the current session's user. */
    accessToken?: string;
    /** Unix-seconds expiry of the Google access_token (account row column). */
    expiresAt?: number;
    /** Space-joined Google OAuth scope string the account was granted. */
    scope?: string;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    /** TEST_MODE only — canned access_token stamped by the jwt callback. */
    accessToken?: string;
    /** TEST_MODE only — canned OAuth scope string. */
    scope?: string;
    /** TEST_MODE only — unix-seconds expiry of the canned access_token. */
    expiresAt?: number;
  }
}

// @holon/auth — auth substrate package.
//
// v2 (iter-013 / ADR-024): third-party OAuth (Google/Gmail today, more
// providers per ~5 LOC each going forward) moved to NextAuth v5 — see
// `apps/web/auth.ts`. This package no longer ships an `OAuthClient` or
// per-provider config; the dynamic-`[kind]` routes + `oauth-client.ts`
// + `oauth/types.ts` are deleted in iter-013 Pass #4.
//
// What still lives here:
//   - `crypto/` — AES-256-GCM `encrypt` / `decrypt` reused by the
//     NextAuth adapter wrap at `apps/web/lib/encrypted-token-storage.ts`
//     to preserve the L-030 token-encryption-at-rest invariant.
//   - `token-store/` — the iter-011 in-memory adapter contract. Dormant
//     under the NextAuth path (no `getTokens/setTokens` callers remain in
//     product code) but retained for the boot-time `registerTokenStorageAdapter`
//     wiring in `packages/core/src/token-storage-adapter.ts` + the existing
//     test coverage. Safe to delete in a follow-up sweep once the boot
//     wiring is unwound.
//   - `identity/` (reserved per ADR-022; not yet populated) — future home
//     for peer Ed25519 / JWT lifecycle.
//
// Per ADR-022 the dep direction stays one-way: `core → auth`. NextAuth
// lives entirely in `apps/web` (Core 1 / BFF); it imports `encrypt`/`decrypt`
// from here, not the reverse.

export {
  getTokens, setTokens, clearTokens, registerTokenStorageAdapter,
  type TokenStorageAdapter,
} from './token-store/token-store.js';

export { encrypt, decrypt } from './crypto/crypto.js';

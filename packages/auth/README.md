# @holon/auth

Auth substrate package.

## v2 (iter-013 / ADR-024) — OAuth moved to NextAuth.js

As of iter-013 Pass #4, third-party OAuth (Google/Gmail today, more providers
incrementally per ~5 LOC each) is owned by **NextAuth v5 (Auth.js)** in
`apps/web/auth.ts`. The handler is mounted at `apps/web/app/api/auth/[...nextauth]/route.ts`;
a sidecar-facing BFF endpoint at `apps/web/app/api/v1/integrations/auth/session/route.ts`
exposes the decrypted access_token to the Hermes Python plugin.

The iter-011 hand-rolled `oauth/` sub-tree (~600 LOC across `oauth-client.ts`,
`oauth/types.ts`, `oauth/providers/gmail.ts`, the dynamic `[kind]/{authorize,callback}`
routes, and the `gmail/{refresh,tokens,disconnect}` routes) is **gone**. See
ADR-024 for rationale (O(N)-per-provider hand-roll → O(1) per provider via
NextAuth's 80+ provider catalog).

## What still lives here

- **`src/crypto/`** — AES-256-GCM `encrypt` / `decrypt`. Reused by the NextAuth
  adapter wrap (`apps/web/lib/encrypted-token-storage.ts`) to preserve the
  L-030 token-encryption-at-rest invariant. Keyed by `HOLON_TOKEN_ENC_KEY`.
- **`src/token-store/`** — Dormant under the NextAuth path (no `getTokens` /
  `setTokens` callers remain in product code after iter-013 Pass #4). Retained
  for the boot-time `registerTokenStorageAdapter` wiring in
  `packages/core/src/token-storage-adapter.ts` + existing test coverage; safe
  to delete in a follow-up sweep once the boot wiring is unwound.
- **`src/identity/`** — Reserved per ADR-022 for peer Ed25519 / JWT lifecycle.
  Not yet populated; out of scope for V1.

## Public surface (post-iter-013)

- `encrypt` / `decrypt` — exposed for the NextAuth adapter wrap + audit-trail
  tests; not for ad-hoc app code.
- `getTokens` / `setTokens` / `clearTokens` / `registerTokenStorageAdapter` /
  `TokenStorageAdapter` — dormant token-store surface (see above).

## Dependency rule (hard, per ADR-022)

`core → auth`. Never the reverse. `packages/auth` must not import from
`packages/core` or `apps/*`. NextAuth lives entirely in `apps/web` (Core 1 /
BFF); it imports `encrypt` / `decrypt` from here, not the reverse.

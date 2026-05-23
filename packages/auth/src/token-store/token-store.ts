/**
 * Encrypted-at-rest token store. Per plan.md iter-011 Pass #1 + ADR-022
 * (one-way dep rule: auth never imports core).
 *
 * Architecture: `@holon/auth` owns crypto + the (kind, owner_id) key
 * scheme. Storage of the opaque encrypted blob is delegated to a thin
 * adapter that `@holon/core` registers at boot. This keeps the dep
 * arrow pointing core→auth: core knows about the mutable-store; auth
 * doesn't. (See ADR-022 § Dependency rule.)
 *
 * Audit posture (Engineering Rule #8 post-emit + Rule #4 no-silent-failure):
 *   on setTokens success      → emit `integration.token_stored`
 *   on clearTokens success    → emit `integration.token_cleared`
 *   getTokens does NOT emit   (reads are not state changes)
 * Never log raw token values — owner_id is truncated to a 6-char prefix.
 */

import { z } from 'zod';
import { decrypt, encrypt } from '../crypto/crypto.js';

/** Decrypted, ready-to-use token bundle. Inlined here in iter-013 Pass #4
 *  after `oauth/types.ts` was deleted with the rest of the iter-011 OAuth
 *  substrate (ADR-024). The shape stays for the dormant token-store test
 *  surface + the boot-time adapter registration; no product caller uses
 *  setTokens/getTokens/clearTokens after the NextAuth cut-over. */
const TokensSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  /** ISO 8601 string of when the access_token expires. */
  expires_at: z.string().min(1),
  scope: z.string().min(1),
});
type Tokens = z.infer<typeof TokensSchema>;

/** Opaque storage adapter. `@holon/core` registers an in-memory map
 *  backed by mutable-store; future DB-backed deployments swap this for
 *  a Postgres-backed implementation without touching this module. */
export interface TokenStorageAdapter {
  get(key: string): string | null;
  set(key: string, value: string): void;
  delete(key: string): boolean;
}

let adapter: TokenStorageAdapter | null = null;

/** Called once at process boot by `@holon/core`. Idempotent — re-register
 *  is allowed (HMR-safe). */
export function registerTokenStorageAdapter(a: TokenStorageAdapter): void {
  adapter = a;
}

function requireAdapter(): TokenStorageAdapter {
  if (!adapter) {
    throw new Error(
      'token-store: no storage adapter registered. ' +
      'Call registerTokenStorageAdapter() at process boot (typically from @holon/core).',
    );
  }
  return adapter;
}

function keyOf(kind: string, owner_id: string): string {
  return `${kind}:${owner_id}`;
}

function ownerPrefix(owner_id: string): string {
  return owner_id.slice(0, 6);
}

function emitAudit(event: string, kind: string, owner_id: string): void {
  // Standard audit sink pattern (matches packages/core/src/cost-service.ts):
  // JSON-line on stdout, structured for downstream collectors. Never carry
  // token material — even kind+owner-prefix is the most we surface.
  console.log(JSON.stringify({
    audit: event,
    kind,
    owner_id_prefix: ownerPrefix(owner_id),
    ts: new Date().toISOString(),
  }));
}

/** Read decrypted tokens for `(kind, owner_id)`, or `null` if none stored.
 *  Throws on decrypt failure (tampered ciphertext, missing key, schema
 *  drift) — caller must classify per Engineering Rule #4. */
export function getTokens(kind: string, owner_id: string): Tokens | null {
  const blob = requireAdapter().get(keyOf(kind, owner_id));
  if (!blob) return null;
  const plain = decrypt(blob);
  const parsed = TokensSchema.safeParse(JSON.parse(plain));
  if (!parsed.success) {
    throw new Error(`token-store.get: schema drift in stored tokens for ${kind}: ${parsed.error.message}`);
  }
  return parsed.data;
}

/** Encrypt + write tokens. Emits `integration.token_stored` audit. */
export function setTokens(kind: string, owner_id: string, tokens: Tokens): void {
  // Validate first so a bad caller can't poison the store with garbage.
  const parsed = TokensSchema.safeParse(tokens);
  if (!parsed.success) {
    throw new Error(`token-store.set: invalid Tokens shape: ${parsed.error.message}`);
  }
  const blob = encrypt(JSON.stringify(parsed.data));
  requireAdapter().set(keyOf(kind, owner_id), blob);
  emitAudit('integration.token_stored', kind, owner_id);
}

/** Remove the encrypted blob. No-op if absent. Returns true if a row was
 *  deleted. Emits `integration.token_cleared` audit on actual deletion. */
export function clearTokens(kind: string, owner_id: string): boolean {
  const removed = requireAdapter().delete(keyOf(kind, owner_id));
  if (removed) emitAudit('integration.token_cleared', kind, owner_id);
  return removed;
}

/**
 * iter-011 Pass #1 — bridge between @holon/auth's TokenStorageAdapter
 * contract and the mutable-store. Per ADR-022 the dep direction is
 * `core → auth`; @holon/auth holds the contract, @holon/core implements
 * it against the in-memory mutable-store.
 *
 * Side-effect import: importing this module registers the adapter
 * eagerly. Picked up via `import './token-storage-adapter.js'` from
 * the core barrel so any code that depends on @holon/core gets a
 * working token store at boot.
 */

import { encrypt, registerTokenStorageAdapter } from '@holon/auth';
import {
  deleteIntegrationTokenBlob,
  getIntegrationTokenBlob,
  setIntegrationTokenBlob,
} from './mutable-store.js';

registerTokenStorageAdapter({
  get: (key) => getIntegrationTokenBlob(key),
  set: (key, value) => setIntegrationTokenBlob(key, value),
  delete: (key) => deleteIntegrationTokenBlob(key),
});

// iter-011 SECURITY L-033 — boot-time key validation. Pre-L-033 the AES
// key was only validated on the FIRST encrypt/decrypt (i.e. the first
// time a customer clicked Connect Gmail). An operator who misconfigured
// HOLON_TOKEN_ENC_KEY (wrong length, non-base64) only learned at that
// click, with a confusing audit row in the customer's face.
//
// Tradeoff: fail-closed-on-misconfig vs the L-015 demo-recipe friction
// (users routinely boot without all env vars set during onboarding).
// Policy: if the env var IS set, validate it now (throw on invalid → boot
// fails loud, the customer can't even reach Connect Gmail with a broken
// key). If it ISN'T set, skip the boot check — the first encrypt op will
// throw the same structured error and the dev can recover the env-var-
// path mistake without re-restarting through partial states. Test-mode
// (HOLON_OAUTH_TEST_MODE=true) skips real encryption anyway, so no boot
// check is meaningful there either.
if (process.env.HOLON_TOKEN_ENC_KEY && process.env.HOLON_OAUTH_TEST_MODE !== 'true') {
  try {
    // Round-trip a fixed marker so a buggy keyFn() that returns a wrong-
    // shape buffer is caught by GCM's auth-tag check, not just the byte-
    // length check inside defaultKeyFn.
    encrypt('holon-token-enc-key-boot-probe-v1');
  } catch (err) {
    // Re-throw with a clear boot-context prefix so operator log-greps
    // distinguish boot-time misconfig from runtime decrypt drift on a
    // pre-existing stored blob (very different remediation paths).
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`[boot] HOLON_TOKEN_ENC_KEY invalid at process start: ${msg}`);
  }
}

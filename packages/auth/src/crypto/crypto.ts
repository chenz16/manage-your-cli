/**
 * AES-256-GCM encryption helpers for token storage.
 *
 * Per ADR-022 + iter-011 Pass #1 plan + dev-questions Q-001 resolution
 * (human 2026-05-18T01:55Z): V1 keys the cipher with the env var
 * `HOLON_TOKEN_ENC_KEY` (32 raw bytes after base64 decode). V2 will swap
 * to an OS keychain — this module accepts an optional `keyFn` parameter
 * so the V2 swap is a one-call-site change.
 *
 * Ciphertext serialization:
 *   `${b64(iv)}.${b64(ciphertext)}.${b64(authTag)}`
 * Three base64-encoded parts joined by dots. Dots are not in the base64
 * alphabet, so the split is unambiguous. (Colons would clash with the
 * key namespace `${kind}:${owner_id}` and standard URL parsing.)
 *
 * Per Engineering Rule #4 (no silent failure): missing / malformed key
 * throws a structured Error; tampered ciphertext throws because GCM auth
 * tag verification fails. Callers must surface these to audit + UI.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const KEY_LEN = 32; // 256 bits
const IV_LEN = 12; // GCM nonce length (NIST SP 800-38D recommendation)

/** Read the AES-256 key from HOLON_TOKEN_ENC_KEY. Throws structured error
 *  on missing / wrong-length. Memoized per process. */
let cachedKey: Buffer | null = null;
function defaultKeyFn(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.HOLON_TOKEN_ENC_KEY;
  if (!raw || raw.length === 0) {
    throw new Error(
      'crypto.config: HOLON_TOKEN_ENC_KEY env var is missing. ' +
      'Generate one via `openssl rand -base64 32` and put it in .env.',
    );
  }
  let buf: Buffer;
  try {
    buf = Buffer.from(raw, 'base64');
  } catch {
    throw new Error('crypto.config: HOLON_TOKEN_ENC_KEY is not valid base64.');
  }
  if (buf.length !== KEY_LEN) {
    throw new Error(
      `crypto.config: HOLON_TOKEN_ENC_KEY decoded to ${buf.length} bytes; expected ${KEY_LEN}.`,
    );
  }
  cachedKey = buf;
  return buf;
}

/** Internal — clear key cache (test helper; not exported from the barrel). */
export function _resetKeyCacheForTests(): void {
  cachedKey = null;
}

/** Encrypt plaintext to `b64(iv).b64(ct).b64(tag)`. Throws if key missing. */
export function encrypt(plaintext: string, keyFn: () => Buffer = defaultKeyFn): string {
  const key = keyFn();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${ct.toString('base64')}.${tag.toString('base64')}`;
}

/** Decrypt `b64(iv).b64(ct).b64(tag)` → plaintext. Throws on tampered
 *  ciphertext (GCM auth-tag mismatch) or malformed input. */
export function decrypt(ciphertext: string, keyFn: () => Buffer = defaultKeyFn): string {
  const key = keyFn();
  const parts = ciphertext.split('.');
  if (parts.length !== 3) {
    throw new Error('crypto.decrypt: malformed ciphertext (expected 3 dot-separated parts).');
  }
  const [ivB64, ctB64, tagB64] = parts as [string, string, string];
  const iv = Buffer.from(ivB64, 'base64');
  const ct = Buffer.from(ctB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  if (iv.length !== IV_LEN) {
    throw new Error(`crypto.decrypt: iv length ${iv.length}, expected ${IV_LEN}.`);
  }
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString('utf8');
}

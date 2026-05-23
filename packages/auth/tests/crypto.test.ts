/**
 * iter-011 Pass #1 acceptance #2 — encrypt/decrypt round-trip, IV
 * uniqueness, tampered-ciphertext rejection.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { decrypt, encrypt, _resetKeyCacheForTests } from '../src/crypto/crypto.js';

describe('crypto (AES-256-GCM)', () => {
  let savedKey: string | undefined;
  beforeEach(() => {
    savedKey = process.env.HOLON_TOKEN_ENC_KEY;
    process.env.HOLON_TOKEN_ENC_KEY = randomBytes(32).toString('base64');
    _resetKeyCacheForTests();
  });
  afterEach(() => {
    if (savedKey === undefined) delete process.env.HOLON_TOKEN_ENC_KEY;
    else process.env.HOLON_TOKEN_ENC_KEY = savedKey;
    _resetKeyCacheForTests();
  });

  it('round-trips arbitrary UTF-8', () => {
    const samples = ['hello', '', 'τόκεν 🔐 中文', 'a'.repeat(10_000)];
    for (const s of samples) {
      expect(decrypt(encrypt(s))).toBe(s);
    }
  });

  it('produces a different ciphertext on each call (random IV)', () => {
    const ct1 = encrypt('same-plaintext');
    const ct2 = encrypt('same-plaintext');
    expect(ct1).not.toBe(ct2);
    expect(decrypt(ct1)).toBe('same-plaintext');
    expect(decrypt(ct2)).toBe('same-plaintext');
  });

  it('rejects tampered ciphertext (GCM auth-tag check)', () => {
    const ct = encrypt('secret');
    const [iv, body, tag] = ct.split('.') as [string, string, string];
    // Flip a byte in the ciphertext body.
    const corruptBytes = Buffer.from(body, 'base64');
    corruptBytes[0] = corruptBytes[0]! ^ 0xff;
    const corrupted = `${iv}.${corruptBytes.toString('base64')}.${tag}`;
    expect(() => decrypt(corrupted)).toThrow();
  });

  it('rejects malformed ciphertext (wrong part count)', () => {
    expect(() => decrypt('not-a-valid-ciphertext')).toThrow(/malformed/);
  });

  it('rejects missing key with a clear message', () => {
    delete process.env.HOLON_TOKEN_ENC_KEY;
    _resetKeyCacheForTests();
    expect(() => encrypt('x')).toThrow(/HOLON_TOKEN_ENC_KEY/);
  });

  it('rejects wrong-length key', () => {
    process.env.HOLON_TOKEN_ENC_KEY = Buffer.from('too-short').toString('base64');
    _resetKeyCacheForTests();
    expect(() => encrypt('x')).toThrow(/bytes/);
  });
});

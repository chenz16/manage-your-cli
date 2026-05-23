/**
 * iter-011 Pass #1 — token-store get/set/clear round-trip + encryption
 * applied at write + adapter-required guard.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  clearTokens, getTokens, registerTokenStorageAdapter, setTokens,
  type TokenStorageAdapter,
} from '../src/index.js';
import { _resetKeyCacheForTests } from '../src/crypto/crypto.js';

function inMemoryAdapter(): TokenStorageAdapter & { _store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    _store: store,
    get: (k) => store.get(k) ?? null,
    set: (k, v) => { store.set(k, v); },
    delete: (k) => store.delete(k),
  };
}

describe('token-store', () => {
  let savedKey: string | undefined;
  let adapter: ReturnType<typeof inMemoryAdapter>;

  beforeEach(() => {
    savedKey = process.env.HOLON_TOKEN_ENC_KEY;
    process.env.HOLON_TOKEN_ENC_KEY = randomBytes(32).toString('base64');
    _resetKeyCacheForTests();
    adapter = inMemoryAdapter();
    registerTokenStorageAdapter(adapter);
  });
  afterEach(() => {
    if (savedKey === undefined) delete process.env.HOLON_TOKEN_ENC_KEY;
    else process.env.HOLON_TOKEN_ENC_KEY = savedKey;
    _resetKeyCacheForTests();
  });

  const sample = {
    access_token: 'ya29.test_at',
    refresh_token: '1//test_rt',
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
    scope: 'https://www.googleapis.com/auth/gmail.readonly',
  };

  it('set then get round-trips and stores ciphertext (not plaintext) at rest', () => {
    setTokens('gmail', 'staff_test_owner', sample);
    const got = getTokens('gmail', 'staff_test_owner');
    expect(got).toEqual(sample);
    // Inspect the raw adapter — the value must NOT contain the plaintext
    // access_token. If we ever accidentally store plaintext, this fails.
    const blob = adapter._store.get('gmail:staff_test_owner');
    expect(blob).toBeDefined();
    expect(blob).not.toContain('ya29.test_at');
    expect(blob).not.toContain('1//test_rt');
    // Format guard: 3 dot-separated base64 parts (iv.ct.tag).
    expect(blob!.split('.').length).toBe(3);
  });

  it('returns null for missing entries', () => {
    expect(getTokens('gmail', 'staff_nobody')).toBeNull();
  });

  it('clearTokens removes the entry and returns true; second call returns false', () => {
    setTokens('gmail', 'staff_test_owner', sample);
    expect(clearTokens('gmail', 'staff_test_owner')).toBe(true);
    expect(getTokens('gmail', 'staff_test_owner')).toBeNull();
    expect(clearTokens('gmail', 'staff_test_owner')).toBe(false);
  });

  it('rejects malformed Tokens shape on setTokens', () => {
    expect(() =>
      // @ts-expect-error — intentional bad shape
      setTokens('gmail', 'staff_test_owner', { access_token: 'a' }),
    ).toThrow(/invalid Tokens shape/);
  });
});

/**
 * SECURITY invariant lock for the L-030/L-033 loopback + shared-secret gate
 * (`lib/loopback-guard.ts`). These three surfaces hand plaintext tokens to the
 * Hermes sidecar (gmail/tokens, gmail/refresh, audit/emit), so the gate is the
 * single thing standing between a LAN/remote attacker and the token endpoints.
 *
 * What this file locks (do NOT weaken without an ADR):
 *   - requireLoopback REJECTS a spoofed / non-loopback Host (0.0.0.0-bind LAN reach).
 *   - requireLoopback REJECTS a present-but-non-loopback X-Forwarded-For hop
 *     (the pre-L-030 bug: absent XFF was wrongly treated as proof-of-loopback).
 *   - requireLoopback REJECTS a non-loopback Origin (CSRF defense).
 *   - requireLoopback ACCEPTS genuine loopback (dev-loopback works in non-prod).
 *   - safeSecretEqual ACCEPTS a correct plugin shared-secret and REJECTS every
 *     wrong / empty / wrong-length variant (constant-time, L-033).
 */
import { describe, expect, it } from 'vitest';
import { requireLoopback, safeSecretEqual } from './loopback-guard';

function reqWith(headers: Record<string, string>): Request {
  // host carries the dial target; the gate keys off it plus origin + xff.
  return new Request('http://localhost:3000/api/v1/audit/emit', { headers });
}

describe('requireLoopback — Host gate (spoofed-Host / 0.0.0.0-bind LAN reach)', () => {
  it('accepts a plain loopback Host (dev-loopback in non-prod)', () => {
    expect(requireLoopback(reqWith({ host: 'localhost:3000' }))).toEqual({ ok: true });
    expect(requireLoopback(reqWith({ host: '127.0.0.1:3000' }))).toEqual({ ok: true });
    expect(requireLoopback(reqWith({ host: '[::1]:3000' }))).toEqual({ ok: true });
  });

  it('REJECTS a LAN/public Host even though it claims to reach the BFF', () => {
    // 0.0.0.0-bind means a LAN host can dial the port; the Host header then
    // carries the dial-IP. This must NOT be treated as loopback.
    expect(requireLoopback(reqWith({ host: '192.168.1.5:3000' }))).toEqual({
      ok: false,
      reason: 'host_not_loopback',
    });
    expect(requireLoopback(reqWith({ host: 'holon.example.com' }))).toEqual({
      ok: false,
      reason: 'host_not_loopback',
    });
  });

  it('REJECTS a missing Host', () => {
    expect(requireLoopback(reqWith({}))).toEqual({ ok: false, reason: 'host_not_loopback' });
  });

  it('REJECTS a Host that only embeds "localhost" as a decoy', () => {
    expect(requireLoopback(reqWith({ host: 'localhost.attacker.com' }))).toEqual({
      ok: false,
      reason: 'host_not_loopback',
    });
  });
});

describe('requireLoopback — X-Forwarded-For gate (pre-L-030 regression lock)', () => {
  it('REJECTS when any XFF hop is non-loopback (checked before Host)', () => {
    // Even with a loopback Host, a non-loopback XFF hop means a proxy forwarded
    // a remote client — reject. This is the exact bug L-030 fixed.
    expect(
      requireLoopback(reqWith({ host: 'localhost:3000', 'x-forwarded-for': '203.0.113.7' })),
    ).toEqual({ ok: false, reason: 'xff_non_loopback' });
    expect(
      requireLoopback(
        reqWith({ host: 'localhost:3000', 'x-forwarded-for': '127.0.0.1, 10.0.0.4' }),
      ),
    ).toEqual({ ok: false, reason: 'xff_non_loopback' });
  });

  it('accepts loopback XFF hops (Next dev injects ::ffff:127.0.0.1)', () => {
    expect(
      requireLoopback(reqWith({ host: 'localhost:3000', 'x-forwarded-for': '::ffff:127.0.0.1' })),
    ).toEqual({ ok: true });
    expect(
      requireLoopback(
        reqWith({ host: '127.0.0.1:3000', 'x-forwarded-for': '127.0.0.1, ::1' }),
      ),
    ).toEqual({ ok: true });
  });
});

describe('requireLoopback — Origin gate (CSRF defense)', () => {
  it('REJECTS a non-loopback Origin', () => {
    expect(
      requireLoopback(reqWith({ host: 'localhost:3000', origin: 'https://evil.example.com' })),
    ).toEqual({ ok: false, reason: 'origin_not_loopback' });
  });

  it('accepts a loopback Origin', () => {
    expect(
      requireLoopback(reqWith({ host: 'localhost:3000', origin: 'http://localhost:3000' })),
    ).toEqual({ ok: true });
  });
});

describe('safeSecretEqual — plugin shared-secret gate (L-033 constant-time)', () => {
  const secret = 'super-secret-shared-value-1234567890';

  it('ACCEPTS an exact match (plugin-secret is received)', () => {
    expect(safeSecretEqual(secret, secret)).toBe(true);
  });

  it('REJECTS a wrong secret of the same length', () => {
    const wrong = 'x'.repeat(secret.length);
    expect(wrong.length).toBe(secret.length);
    expect(safeSecretEqual(wrong, secret)).toBe(false);
  });

  it('REJECTS a correct prefix (no early-return byte leak)', () => {
    expect(safeSecretEqual(secret.slice(0, -1), secret)).toBe(false);
  });

  it('REJECTS wrong-length, empty, null, and undefined presented values', () => {
    expect(safeSecretEqual(`${secret}extra`, secret)).toBe(false);
    expect(safeSecretEqual('', secret)).toBe(false);
    expect(safeSecretEqual(null, secret)).toBe(false);
    expect(safeSecretEqual(undefined, secret)).toBe(false);
  });
});

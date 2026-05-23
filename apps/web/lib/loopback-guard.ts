/**
 * iter-011 SECURITY L-030 — loopback-only request guard for the three
 * BFF→sidecar token-leak surfaces (gmail/tokens, gmail/refresh, audit/emit).
 *
 * Pre-L-030 the gate trusted `x-forwarded-for` and treated ABSENT XFF
 * as proof of loopback — the opposite of safe. If the BFF binds to
 * `0.0.0.0` (Docker default, `next start -H 0.0.0.0`, Next standalone),
 * a direct TCP hit from another LAN host has no XFF, so the old gate
 * concluded "loopback" and handed out plaintext tokens.
 *
 * Belt-and-braces (ALL must pass):
 *   1. XFF, if present, every hop must be a loopback address. Next.js
 *      dev injects `::ffff:127.0.0.1` so we can't require absence.
 *   2. Origin, if present, must be loopback (CSRF defense).
 *   3. Host must be loopback (catches 0.0.0.0-bind LAN reach: the
 *      Host header carries the dial-IP, e.g. `192.168.1.5:3000`).
 *
 * Deployment invariant (belt to these braces): boot the BFF with
 * `HOSTNAME=127.0.0.1 next start` so the kernel won't route non-loopback
 * traffic to the port at all.
 */

import { timingSafeEqual } from 'node:crypto';
import { NextRequest } from 'next/server';

export interface LoopbackCheck {
  ok: boolean;
  reason?: 'xff_non_loopback' | 'origin_not_loopback' | 'host_not_loopback';
}

/**
 * iter-011 SECURITY L-033 — constant-time shared-secret comparison.
 *
 * Pre-L-033 the BFF routes used `presented !== expected` to gate the
 * `X-Holon-Plugin-Secret` header. A naive `!==` returns as soon as the
 * first mismatched byte is found, letting a local attacker (loopback-
 * reachable; e.g. an unrelated localhost service or browser-served
 * malicious page that already cleared the Origin/Host check) iterate the
 * secret byte-by-byte via response-time differential. The shared secret
 * is the one credential standing between such an attacker and the
 * plaintext token endpoint.
 *
 * `crypto.timingSafeEqual` requires equal-length buffers, so we length-
 * gate first (a length mismatch is already a hard reject and timing on
 * the length check itself reveals no useful bit). Returns `false` on
 * absent / empty / wrong-length presented headers.
 */
export function safeSecretEqual(presented: string | null | undefined, expected: string): boolean {
  if (!presented || presented.length !== expected.length) return false;
  const a = Buffer.from(presented, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

const LOOPBACK_HOST_RE = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const LOOPBACK_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

function isLoopbackIp(raw: string): boolean {
  const s = raw.trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  if (s === '127.0.0.1' || s === '::1' || s === 'localhost') return true;
  if (s.startsWith('::ffff:') && s.slice(7) === '127.0.0.1') return true; // IPv4-mapped IPv6
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(s)) return true; // 127.0.0.0/8
  return false;
}

export function requireLoopback(req: Request | NextRequest): LoopbackCheck {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const hops = xff.split(',').map((s) => s.trim()).filter(Boolean);
    if (!hops.every(isLoopbackIp)) return { ok: false, reason: 'xff_non_loopback' };
  }
  const origin = req.headers.get('origin');
  if (origin && !LOOPBACK_ORIGIN_RE.test(origin)) {
    return { ok: false, reason: 'origin_not_loopback' };
  }
  const host = req.headers.get('host') ?? '';
  if (!LOOPBACK_HOST_RE.test(host)) return { ok: false, reason: 'host_not_loopback' };
  return { ok: true };
}

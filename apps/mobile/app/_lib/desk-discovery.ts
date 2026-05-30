'use client';

// LAN auto-discovery — after the first pairing, re-find the paired desk on the
// same local network WITHOUT re-scanning a QR, even if its IP changed.
//
// How: the desk is the only host on the subnet that returns 200 to OUR device
// token (that token was minted by that desk during pairing; any other host /
// service rejects or ignores it). So we probe the /24 with the stored token and
// take the first 200. Pure fetch — intranet-only, no cloud, no native plugin,
// no mDNS (which can't cross WSL2's NAT anyway).

import { normalizeBaseUrl } from './mobile-runtime';

function parseHostPort(baseUrl: string): { host: string; port: string; protocol: string } | null {
  try {
    const u = new URL(baseUrl);
    return {
      host: u.hostname,
      port: u.port || (u.protocol === 'https:' ? '443' : '80'),
      protocol: u.protocol,
    };
  } catch { return null; }
}

function ipv4Octets(host: string): [number, number, number, number] | null {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const a = Number(m[1]), b = Number(m[2]), c = Number(m[3]), d = Number(m[4]);
  if ([a, b, c, d].some((n) => n > 255)) return null;
  return [a, b, c, d];
}

async function probeIsDesk(baseUrl: string, token: string, timeoutMs: number): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${baseUrl}/api/v1/ping`, {
      method: 'GET',
      headers: { 'x-holon-device-token': token },
      cache: 'no-store',
      signal: ctrl.signal,
    });
    return r.ok; // 200 ⇒ this host accepted OUR token ⇒ it's our desk
  } catch {
    return false; // refused / timeout / not-a-desk
  } finally {
    clearTimeout(timer);
  }
}

export interface DiscoverOptions {
  timeoutMs?: number;   // per-host probe timeout
  batchSize?: number;   // concurrent probes
  signal?: AbortSignal; // cancel the whole sweep
}

/**
 * Probe the /24 of `prevBaseUrl` for the paired desk. Tries the last-known IP
 * and its neighbours first (an unchanged or slightly-shifted desk is found in
 * the first batch), then the rest. Returns the desk's normalized base URL, or
 * null if not found on this subnet. Only works when prevBaseUrl host is an IPv4
 * (a hostname can't be subnet-scanned — but LAN pairing always stores an IP).
 */
export async function discoverDeskOnLan(
  prevBaseUrl: string,
  deviceToken: string,
  opts: DiscoverOptions = {},
): Promise<string | null> {
  const hp = parseHostPort(prevBaseUrl);
  if (!hp) return null;
  const octets = ipv4Octets(hp.host);
  if (!octets) return null;
  const timeoutMs = opts.timeoutMs ?? 1200;
  const batchSize = opts.batchSize ?? 24;
  const [a, b, c, lastKnown] = octets;
  const mk = (d: number) => `${hp.protocol}//${a}.${b}.${c}.${d}:${hp.port}`;

  // Search order: last-known IP first, then outward neighbours, then the rest.
  const order: number[] = [];
  const seen = new Set<number>();
  const add = (d: number) => { if (d >= 1 && d <= 254 && !seen.has(d)) { seen.add(d); order.push(d); } };
  add(lastKnown);
  for (let r = 1; r <= 254; r++) { add(lastKnown - r); add(lastKnown + r); }

  for (let i = 0; i < order.length; i += batchSize) {
    if (opts.signal?.aborted) return null;
    const batch = order.slice(i, i + batchSize);
    const hits = await Promise.all(
      batch.map(async (d) => ((await probeIsDesk(mk(d), deviceToken, timeoutMs)) ? d : -1)),
    );
    const found = hits.find((d) => d >= 0);
    if (found !== undefined && found >= 0) return normalizeBaseUrl(mk(found));
  }
  return null;
}

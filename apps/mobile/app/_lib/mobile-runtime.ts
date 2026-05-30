'use client';

// M-L-060 — Thin-client pairing runtime. Stores the desktop connection in
// localStorage and monkeypatches window.fetch so same-origin /api/v1/* calls
// are transparently proxied to the paired desktop BFF.

export interface MobileDesktopConnection {
  baseUrl: string;
  deviceToken: string;
  /** Full base URLs (no trailing slash) for all known reachable addresses.
   *  Used for automatic failover when the primary baseUrl stops responding.
   *  Optional — absent on old paired clients; treated as empty. */
  candidates?: string[];
}

const STORAGE_KEY = 'holon.mobile.desktopConnection.v1';
const FETCH_PROXY_MARK = '__holonMobileFetchProxyInstalled';

type FetchLike = typeof fetch;

function hasWindow(): boolean {
  return typeof window !== 'undefined';
}

export function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error('请输入桌面端地址。');
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new Error('桌面端地址必须是有效的 http(s) URL。');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('桌面端地址必须以 http:// 或 https:// 开头。');
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}

export function readDesktopConnection(): MobileDesktopConnection | null {
  if (!hasWindow()) return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<MobileDesktopConnection>;
    if (typeof parsed.baseUrl !== 'string' || typeof parsed.deviceToken !== 'string') return null;
    if (!parsed.baseUrl || !parsed.deviceToken) return null;
    // candidates is optional — tolerate missing field for back-compat with old paired clients
    const rawCandidates = (parsed as { candidates?: unknown }).candidates;
    const candidates: string[] | undefined = Array.isArray(rawCandidates)
      ? (rawCandidates as unknown[])
          .filter((u): u is string => typeof u === 'string' && u.length > 0)
          .map((u) => normalizeBaseUrl(u))
      : undefined;
    return {
      baseUrl: normalizeBaseUrl(parsed.baseUrl),
      deviceToken: parsed.deviceToken,
      ...(candidates !== undefined ? { candidates } : {}),
    };
  } catch {
    return null;
  }
}

export function writeDesktopConnection(connection: MobileDesktopConnection): void {
  if (!hasWindow()) return;
  const normalized: MobileDesktopConnection = {
    baseUrl: normalizeBaseUrl(connection.baseUrl),
    deviceToken: connection.deviceToken,
    ...(connection.candidates !== undefined
      ? {
          candidates: connection.candidates
            .map((u) => normalizeBaseUrl(u))
            .filter((u, i, a) => a.indexOf(u) === i),
        }
      : {}),
  };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
}

/**
 * Probes a single base URL by fetching /api/v1/ping with the device token.
 * Returns true if the server responds with HTTP 200 within timeoutMs.
 */
export async function probeBaseUrl(url: string, token: string, timeoutMs: number): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${url}/api/v1/ping`, {
      cache: 'no-store',
      signal: ctrl.signal,
      headers: { 'x-holon-device-token': token },
    });
    return r.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Tries [conn.baseUrl, ...conn.candidates] in order (deduped, primary first).
 * Returns the first URL that responds to ping, or null if none does.
 * Sequential — first-hit fast on the common path (primary still alive).
 */
export async function pickLiveBaseUrl(conn: MobileDesktopConnection): Promise<string | null> {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const u of [conn.baseUrl, ...(conn.candidates ?? [])]) {
    if (!seen.has(u)) { seen.add(u); ordered.push(u); }
  }
  for (const url of ordered) {
    const alive = await probeBaseUrl(url, conn.deviceToken, 4000);
    if (alive) return url;
  }
  return null;
}

export function clearDesktopConnection(): void {
  if (!hasWindow()) return;
  window.localStorage.removeItem(STORAGE_KEY);
}

function isApiV1Url(input: RequestInfo | URL): boolean {
  if (typeof input === 'string') return input.startsWith('/api/v1/');
  if (input instanceof URL) return input.pathname.startsWith('/api/v1/');
  return input.url.startsWith('/api/v1/') || new URL(input.url).pathname.startsWith('/api/v1/');
}

function withDeviceTokenHeaders(init: RequestInit | undefined, token: string): RequestInit {
  const headers = new Headers(init?.headers);
  headers.set('x-holon-device-token', token);
  return { ...init, headers };
}

function desktopApiUrl(path: string, connection: MobileDesktopConnection): string {
  const url = new URL(path, `${connection.baseUrl}/`);
  return url.toString();
}

function rewriteMobileApiRequest(
  input: RequestInfo | URL,
  init?: RequestInit,
  connection = readDesktopConnection(),
): { input: RequestInfo | URL; init: RequestInit | undefined } {
  if (!connection || !isApiV1Url(input)) {
    return { input, init };
  }

  if (typeof input === 'string') {
    return {
      input: desktopApiUrl(input, connection),
      init: withDeviceTokenHeaders(init, connection.deviceToken),
    };
  }

  if (input instanceof URL) {
    return {
      input: desktopApiUrl(`${input.pathname}${input.search}`, connection),
      init: withDeviceTokenHeaders(init, connection.deviceToken),
    };
  }

  // Request object
  const source = new URL(input.url, window.location.href);
  const rewritten = new Request(desktopApiUrl(`${source.pathname}${source.search}`, connection), input);
  const headers = new Headers(rewritten.headers);
  if (init?.headers) {
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  }
  headers.set('x-holon-device-token', connection.deviceToken);
  return {
    input: rewritten,
    init: { ...init, headers },
  };
}

export function holonApiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const rewritten = rewriteMobileApiRequest(input, init);
  return fetch(rewritten.input, rewritten.init);
}

export function installMobileApiFetchProxy(): void {
  if (!hasWindow()) return;
  const connection = readDesktopConnection();
  if (!connection) return;
  const w = window as unknown as Window & {
    [FETCH_PROXY_MARK]?: true;
    __holonOriginalFetch?: FetchLike;
  };
  if (w[FETCH_PROXY_MARK]) return;
  // Capture the real WebView fetch at install time. CapacitorHttp is now
  // disabled (see capacitor.config.ts), so window.fetch is the true streaming-
  // capable fetch — no native-bridge buffering. We store it on the window so
  // the proxy closure always resolves the right reference at call time.
  const nativeFetch = window.fetch.bind(window);
  w.__holonOriginalFetch = nativeFetch;
  w[FETCH_PROXY_MARK] = true;
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    // Resolve at call time: prefer the stored native reference so even a
    // late CapacitorHttp patch (hypothetical) would still be picked up.
    const underlying = w.__holonOriginalFetch ?? nativeFetch;
    const rewritten = rewriteMobileApiRequest(input, init);
    return underlying(rewritten.input, rewritten.init);
  }) as FetchLike;
}

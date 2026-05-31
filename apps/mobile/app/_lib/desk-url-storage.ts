'use client';

// desk-url-storage.ts — runtime-configurable desk origin for the mobile thin
// client. Lets the same APK work for any user (no per-owner baked URL): on
// first launch the OnboardingDeskUrl screen writes here, and MeTab's
// "Desk connection" section reads/edits it.
//
// We use localStorage (not @capacitor/preferences) because:
//   1. The dep is not currently installed and Capacitor Preferences requires
//      a native gradle re-sync; keeping zero new native deps for slice 1.
//   2. The existing pairing store (mobile-runtime.ts) already persists the
//      device-token via localStorage, so survival-across-launch parity is
//      already proven in this app.
//   3. Capacitor WebView localStorage IS persistent across app restarts.

// Env-aware namespace so dev preview builds (NEXT_PUBLIC_HOLON_ENV=dev) and
// release APKs (default 'prod') don't collide in the same Capacitor WebView
// localStorage. See docs/adr/test-release-state-isolation.md slice E.
//
// Default = 'prod' preserves the historical key `myc.mobile.deskOrigin.v1`
// so the owner's already-installed release APK keeps reading its existing
// stored origin — zero-migration upgrade.
const ENV_TAG = (process.env.NEXT_PUBLIC_HOLON_ENV ?? 'prod').replace(/[^a-z0-9_-]/gi, '') || 'prod';
const KEY_SUFFIX = ENV_TAG === 'prod' ? '' : `.${ENV_TAG}`;
const KEY_DESK_ORIGIN = `myc.mobile.deskOrigin.v1${KEY_SUFFIX}`;
const KEY_TAILSCALE_URL = `myc.mobile.tailscaleUrl.v1${KEY_SUFFIX}`;
const KEY_TAILSCALE_ENABLED = `myc.mobile.tailscaleEnabled.v1${KEY_SUFFIX}`;

function hasWindow(): boolean {
  return typeof window !== 'undefined';
}

/** Strip trailing slash; tolerate missing scheme by prefixing http://. */
export function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error('URL is empty.');
  // Reject explicit non-http(s) schemes BEFORE normalizing — if the user typed
  // `ws://...` we won't silently rewrite it into `http://ws://...`.
  const hasAnyScheme = /^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//.test(trimmed);
  if (hasAnyScheme && !/^https?:\/\//i.test(trimmed)) {
    throw new Error('URL must start with http:// or https://');
  }
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new Error('Not a valid http(s) URL.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('URL must start with http:// or https://');
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}

export function readDeskOrigin(): string | null {
  if (!hasWindow()) return null;
  try {
    const v = window.localStorage.getItem(KEY_DESK_ORIGIN);
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

export function writeDeskOrigin(url: string): void {
  if (!hasWindow()) return;
  window.localStorage.setItem(KEY_DESK_ORIGIN, normalizeUrl(url));
}

export function clearDeskOrigin(): void {
  if (!hasWindow()) return;
  window.localStorage.removeItem(KEY_DESK_ORIGIN);
}

export function readTailscaleUrl(): string | null {
  if (!hasWindow()) return null;
  try {
    const v = window.localStorage.getItem(KEY_TAILSCALE_URL);
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

export function writeTailscaleUrl(url: string): void {
  if (!hasWindow()) return;
  window.localStorage.setItem(KEY_TAILSCALE_URL, normalizeUrl(url));
}

export function clearTailscaleUrl(): void {
  if (!hasWindow()) return;
  window.localStorage.removeItem(KEY_TAILSCALE_URL);
}

export function readTailscaleEnabled(): boolean {
  if (!hasWindow()) return false;
  try {
    return window.localStorage.getItem(KEY_TAILSCALE_ENABLED) === '1';
  } catch {
    return false;
  }
}

export function writeTailscaleEnabled(on: boolean): void {
  if (!hasWindow()) return;
  window.localStorage.setItem(KEY_TAILSCALE_ENABLED, on ? '1' : '0');
}

/** Ping a candidate URL. 5s default timeout. No auth (relies on the desk's
 *  public /api/v1/ping). Returns {ok, status?, version?, error?} so the
 *  caller can show a nuanced indicator. */
export interface PingResult {
  ok: boolean;
  status?: number;
  version?: string;
  error?: string;
}

export async function pingDesk(url: string, timeoutMs = 5000): Promise<PingResult> {
  let normalized: string;
  try {
    normalized = normalizeUrl(url);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${normalized}/api/v1/ping`, {
      method: 'GET',
      cache: 'no-store',
      signal: ctrl.signal,
    });
    if (!r.ok) return { ok: false, status: r.status, error: `HTTP ${r.status}` };
    const body = (await r.json().catch(() => ({}))) as { status?: string; version?: string };
    const result: PingResult = { ok: true, status: r.status };
    if (typeof body.version === 'string') result.version = body.version;
    return result;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

/** Clear EVERYTHING — used by "Change desk" in settings: drops the stored
 *  URL so onboarding runs again. Does NOT touch the device token / pairing
 *  store (that's the caller's job via clearDesktopConnection). */
export function clearAllDeskUrls(): void {
  clearDeskOrigin();
  clearTailscaleUrl();
  if (!hasWindow()) return;
  window.localStorage.removeItem(KEY_TAILSCALE_ENABLED);
}

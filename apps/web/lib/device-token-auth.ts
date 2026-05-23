import { validateDeviceTokenDetailed } from './device-pairing-store';

const LOOPBACK_HOST_RE = /^(localhost|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|\[::1\])(:\d+)?$/;
const LOOPBACK_ORIGIN_RE = /^https?:\/\/(localhost|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|\[::1\])(:\d+)?$/;

function isLoopbackIp(raw: string): boolean {
  const s = raw.trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  if (s === 'localhost' || s === '::1') return true;
  if (s.startsWith('::ffff:')) return isLoopbackIp(s.slice(7));
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(s);
}

export function isLoopbackRequest(req: Request): boolean {
  const host = req.headers.get('host') ?? '';
  if (!LOOPBACK_HOST_RE.test(host)) return false;

  const origin = req.headers.get('origin');
  if (origin && !LOOPBACK_ORIGIN_RE.test(origin)) {
    // The local HTTPS proxy (scripts/https-proxy.mjs) rewrites Host to the
    // loopback target (passes the check above) and preserves the ORIGINAL host
    // in x-forwarded-host. The WSL web build is served at https://<wsl-ip>:3443,
    // so the browser Origin is non-loopback but is the SAME local UI. Treat it as
    // trusted when Origin matches x-forwarded-host. Real remote/mobile clients hit
    // the backend directly (no loopback Host) and still require a device token.
    const xfh = req.headers.get('x-forwarded-host');
    try {
      if (!xfh || new URL(origin).host !== xfh) return false;
    } catch {
      return false;
    }
  }

  const xff = req.headers.get('x-forwarded-for');
  if (!xff) return true;
  const hops = xff.split(',').map((s) => s.trim()).filter(Boolean);
  return hops.length > 0 && hops.every(isLoopbackIp);
}

export type DeviceAuthResult =
  | { ok: true; mode: 'loopback' | 'device_token' }
  | { ok: false; status: 401 | 403 | 500; code: 'missing_device_token' | 'invalid_device_token' | 'device_store_unavailable' };

export function requireDeviceTokenForRemote(req: Request): DeviceAuthResult {
  // Demo/single-user escape hatch: open access when explicitly enabled (HOLON_OPEN_DEMO=1).
  // Local personal use only — do NOT set this on a shared/cloud deployment.
  if (process.env.HOLON_OPEN_DEMO === '1') return { ok: true, mode: 'loopback' };
  if (isLoopbackRequest(req)) return { ok: true, mode: 'loopback' };
  const token = req.headers.get('x-holon-device-token');
  if (!token) return { ok: false, status: 401, code: 'missing_device_token' };
  const validation = validateDeviceTokenDetailed(token);
  if (!validation.ok) {
    if (validation.reason === 'persistence_failed') {
      return { ok: false, status: 500, code: 'device_store_unavailable' };
    }
    return { ok: false, status: 403, code: 'invalid_device_token' };
  }
  return { ok: true, mode: 'device_token' };
}

export function deviceAuthErrorResponse(result: Extract<DeviceAuthResult, { ok: false }>): Response {
  return new Response(JSON.stringify({
    error: 'device authentication required',
    code: result.code,
  }), {
    status: result.status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

/**
 * GET /api/v1/connectors/wechat/qr
 *
 * Server-side proxy: fetch a WeChat iLink QR code for bot binding.
 * Calls https://ilinkai.weixin.qq.com/ilink/bot/get_bot_qrcode?bot_type=3
 * and returns { qrcode_id, qrcode_url } to the client.
 *
 * Auth: requireDeviceTokenForRemote (loopback or valid device token).
 */

import { requireDeviceTokenForRemote, deviceAuthErrorResponse } from '@/lib/device-token-auth';

const ILINK_QR_URL = 'https://ilinkai.weixin.qq.com/ilink/bot/get_bot_qrcode?bot_type=3';
const FETCH_TIMEOUT_MS = 15_000;

function jsonResp(body: object, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export async function GET(req: Request): Promise<Response> {
  const auth = requireDeviceTokenForRemote(req);
  if (!auth.ok) return deviceAuthErrorResponse(auth);

  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let raw: unknown;
  try {
    const res = await fetch(ILINK_QR_URL, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(tid);
    if (!res.ok) {
      const text = await res.text();
      return jsonResp({ error: `iLink returned HTTP ${res.status}`, detail: text.slice(0, 300) }, 502);
    }
    raw = await res.json();
  } catch (err) {
    clearTimeout(tid);
    const msg = err instanceof Error ? err.message : String(err);
    return jsonResp({ error: 'Failed to reach iLink', detail: msg }, 502);
  }

  // iLink response shape: { errcode, errmsg, qrcode, qrcode_img_content }
  // qrcode = the qrcode_id, qrcode_img_content = base64 PNG of the QR image
  if (typeof raw !== 'object' || raw === null) {
    return jsonResp({ error: 'iLink returned unexpected payload' }, 502);
  }
  const r = raw as Record<string, unknown>;
  if (r['errcode'] !== 0 && r['errcode'] !== undefined) {
    return jsonResp({ error: `iLink error ${String(r['errcode'])}: ${String(r['errmsg'] ?? '')}` }, 502);
  }

  const qrcode_id = r['qrcode'] as string | undefined;
  // qrcode_img_content is a WeChat QR scan page URL (not renderable as img src).
  // We render it via qrserver.com so the browser can display it as a scannable image.
  const qrcode_img_content = r['qrcode_img_content'] as string | undefined;

  if (!qrcode_id) {
    return jsonResp({ error: 'iLink response missing qrcode field', raw: r }, 502);
  }

  // qrcode_url: a QR image the browser can render (<img src=...>).
  // We encode the iLink qrcode_id (the scan payload) as a QR via qrserver.com.
  const qrcode_url = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrcode_id)}`;

  return jsonResp({ qrcode_id, qrcode_url, qrcode_scan_url: qrcode_img_content ?? null }, 200);
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

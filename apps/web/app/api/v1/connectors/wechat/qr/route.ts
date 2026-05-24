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

  // iLink response shape (confirmed by nightsailer/wechat-clawbot, x1ah/wechat-ilink-demo,
  // epiral/weixin-bot protocol spec):
  //   qrcode            → the polling token / id (used for get_qrcode_status; NOT the scan payload)
  //   qrcode_img_content → a weixin.qq.com URL that WeChat recognises when scanned
  //                        (e.g. "https://weixin.qq.com/x/cAbCdEfGhIj")
  //                        This is the CORRECT value to encode as the QR image data.
  //
  // BUG that was here: the code was encoding qrcode_id as the QR data, but qrcode_id is
  // only a poll token — WeChat cannot bind from it.  We must encode qrcode_img_content.
  const qrcode_id = r['qrcode'] as string | undefined;
  const qrcode_scan_url = r['qrcode_img_content'] as string | undefined;

  if (!qrcode_id) {
    return jsonResp({ error: 'iLink response missing qrcode field', raw: r }, 502);
  }
  if (!qrcode_scan_url) {
    return jsonResp({ error: 'iLink response missing qrcode_img_content (scan URL)', raw: r }, 502);
  }

  // qrcode_url: a QR image the browser can render (<img src=...>).
  // We encode the SCAN URL (qrcode_img_content) as the QR data so WeChat can bind.
  const qrcode_url = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(qrcode_scan_url)}`;

  return jsonResp({ qrcode_id, qrcode_url, qrcode_scan_url }, 200);
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

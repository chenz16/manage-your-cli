/**
 * GET /api/v1/connectors/wechat/qr/status?id=<qrcode_id>
 *
 * Server-side proxy: poll WeChat iLink for QR scan status.
 * Calls https://ilinkai.weixin.qq.com/ilink/bot/get_qrcode_status?qrcode=<id>
 *
 * When status == "confirmed":
 *   - persists bot_token + baseurl to ~/.claude/channels/wechat/account.json
 *     in the exact shape the wechat-clawbot library reads (camelCase keys).
 *   - returns { status: "confirmed", account_id, user_id }
 *
 * Auth: requireDeviceTokenForRemote (loopback or valid device token).
 */

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

import { requireDeviceTokenForRemote, deviceAuthErrorResponse } from '@/lib/device-token-auth';

const ILINK_STATUS_BASE = 'https://ilinkai.weixin.qq.com';
const POLL_TIMEOUT_MS = 40_000; // iLink long-poll is ~35 s; give 40 s

function jsonResp(body: object, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

// account.json shape that wechat_clawbot.claude_channel.credentials reads.
// Uses camelCase keys (matching save_credentials() in credentials.py).
interface AccountJson {
  token: string;
  baseUrl: string;
  accountId: string;
  userId: string | null;
  savedAt: string;
}

function persistAccount(data: AccountJson): void {
  const dir = path.join(os.homedir(), '.claude', 'channels', 'wechat');
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, 'account.json');
  const tmp = filePath + '.tmp.' + Date.now();
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { encoding: 'utf-8', mode: 0o600 });
  fs.renameSync(tmp, filePath);
}

export async function GET(req: Request): Promise<Response> {
  const auth = requireDeviceTokenForRemote(req);
  if (!auth.ok) return deviceAuthErrorResponse(auth);

  const url = new URL(req.url);
  const qrcodeId = url.searchParams.get('id');
  if (!qrcodeId) {
    return jsonResp({ error: 'Missing ?id= parameter' }, 400);
  }

  const pollUrl = `${ILINK_STATUS_BASE}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcodeId)}`;

  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), POLL_TIMEOUT_MS);

  let raw: unknown;
  try {
    const res = await fetch(pollUrl, {
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

  if (typeof raw !== 'object' || raw === null) {
    return jsonResp({ error: 'iLink returned unexpected payload' }, 502);
  }

  const r = raw as Record<string, unknown>;
  const status = (r['status'] as string) ?? 'wait';

  // On IDC redirect, pass through the redirect_host so UI can re-poll there
  // (simplified: we expose it but the UI just continues polling this proxy).
  if (status === 'confirmed') {
    const botToken = r['bot_token'] as string | undefined;
    const accountId = r['ilink_bot_id'] as string | undefined;
    const baseUrl = (r['baseurl'] as string | undefined) ?? ILINK_STATUS_BASE;
    const userId = (r['ilink_user_id'] as string | undefined) ?? null;

    if (!botToken || !accountId) {
      return jsonResp({
        status: 'confirmed_incomplete',
        error: 'iLink confirmed but missing bot_token or ilink_bot_id',
        raw: r,
      }, 502);
    }

    // Persist in wechat-clawbot-compatible format
    const account: AccountJson = {
      token: botToken,
      baseUrl,
      accountId,
      userId,
      savedAt: new Date().toISOString(),
    };
    try {
      persistAccount(account);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return jsonResp({ status: 'confirmed', account_id: accountId, persist_error: msg }, 200);
    }

    return jsonResp({ status: 'confirmed', account_id: accountId, user_id: userId }, 200);
  }

  // Pass through other statuses: wait / scaned / scaned_but_redirect / expired
  return jsonResp({ status, redirect_host: r['redirect_host'] ?? null }, 200);
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

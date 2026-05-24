/**
 * GET /api/v1/connectors/wechat/status
 *
 * Returns the WeChat bind identity for the /me page.
 * Reads ~/.claude/channels/wechat/account.json (written by the qr/status
 * route when the user scans the iLink QR code in /connectors).
 *
 * Returns: { connected: boolean, accountId?: string, baseUrl?: string, savedAt?: string }
 * Token is NEVER returned — identity/status display only.
 *
 * Auth: requireDeviceTokenForRemote (loopback or valid device token).
 */

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

import { requireDeviceTokenForRemote, deviceAuthErrorResponse } from '@/lib/device-token-auth';

function jsonResp(body: object, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

interface AccountJson {
  token?: string;
  baseUrl?: string;
  accountId?: string;
  userId?: string | null;
  savedAt?: string;
}

export async function GET(req: Request): Promise<Response> {
  const auth = requireDeviceTokenForRemote(req);
  if (!auth.ok) return deviceAuthErrorResponse(auth);

  const filePath = path.join(os.homedir(), '.claude', 'channels', 'wechat', 'account.json');

  let account: AccountJson;
  try {
    const raw = fs.readFileSync(filePath, { encoding: 'utf-8' });
    account = JSON.parse(raw) as AccountJson;
  } catch {
    // Missing or unreadable file → not connected
    return jsonResp({ connected: false }, 200);
  }

  if (!account.accountId) {
    return jsonResp({ connected: false }, 200);
  }

  // Return identity fields only — never the token
  return jsonResp({
    connected: true,
    accountId: account.accountId,
    baseUrl: account.baseUrl ?? null,
    savedAt: account.savedAt ?? null,
  }, 200);
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

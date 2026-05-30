/**
 * BFF route: POST /api/v1/connectors/voice/tts
 *
 * Mobile-primary Text-to-Speech endpoint using Microsoft Edge neural voices
 * (edge-tts — keyless, no API key required). Called by the mobile hybrid TTS
 * as the PRIMARY path when the device is paired to the desk.
 *
 * Request body:  { text: string, lang?: string }
 *   - text: required, the text to synthesise.
 *   - lang: optional BCP-47 language hint (defaults to "zh-CN" for Chinese).
 *           Pass "en-US" for English (desk UI) or "zh-CN" for 微作 (mobile).
 *
 * Success:       200 { base64: string, mime: "audio/mpeg" }
 * Unreachable:   502 { error: "upstream_error", message: string }
 *   — mobile client should fall back to on-device native TTS on any non-200.
 * Bad body:      400 { error: "bad_request", message: string }
 *
 * Auth: device-token (mobile paired) or same-origin (desk UI).
 * Engine: always edge-tts (keyless Microsoft neural voices via local Python
 * server on http://127.0.0.1:8770). No API key required.
 * If the local server is not running, returns 502 so the mobile client falls
 * back to on-device TTS.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { synthesizeEdgeTts, sanitizeForTts } from '@holon/core';
import { deviceAuthErrorResponse, requireDeviceTokenForRemote } from '@/lib/device-token-auth';

function isSameOriginRequest(req: Request): boolean {
  const origin = req.headers.get('origin');
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch (urlErr) {
    void urlErr;
    return false;
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  const auth = requireDeviceTokenForRemote(req);
  if (!auth.ok && !isSameOriginRequest(req)) {
    return deviceAuthErrorResponse(auth);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch (parseErr) {
    void parseErr;
    return NextResponse.json(
      { error: 'bad_request', message: 'Request body must be valid JSON.' },
      { status: 400 },
    );
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json(
      { error: 'bad_request', message: 'Request body must be a JSON object.' },
      { status: 400 },
    );
  }

  const { text, lang } = body as Record<string, unknown>;

  if (typeof text !== 'string' || text.trim().length === 0) {
    return NextResponse.json(
      { error: 'bad_request', message: '"text" is required and must be a non-empty string.' },
      { status: 400 },
    );
  }

  // Strip markdown / urls / emojis / symbols / file paths before handing
  // text to edge-tts (owner: "TTS 把特殊字符和信号符号也读出来,需要过滤").
  // Shared with mobile through @holon/core so both clients filter the same
  // way — server-posted text (e.g. from desk-side speak) doesn't bypass.
  const cleaned = sanitizeForTts(text);
  if (!cleaned) {
    return NextResponse.json(
      { error: 'bad_request', message: 'text contained no speakable content after sanitization.' },
      { status: 400 },
    );
  }

  const result = await synthesizeEdgeTts({
    text: cleaned,
    ...(typeof lang === 'string' && lang.length > 0 ? { lang } : { lang: 'zh-CN' }),
  });

  if (result.ok) {
    return NextResponse.json({ base64: result.base64, mime: result.mime }, { status: 200 });
  }

  // All failures → 502 so the mobile client falls back to on-device native TTS.
  return NextResponse.json(
    { error: result.error, message: result.message },
    { status: 502 },
  );
}

export const dynamic = 'force-dynamic';

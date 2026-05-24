/**
 * BFF route: POST /api/v1/connectors/voice/transcribe
 *
 * Speech-to-Text endpoint. Accepts a base64-encoded audio payload, calls the
 * voice transcription service (OpenAI gpt-4o-transcribe), and returns the text.
 *
 * Request body:  { base64: string, mime: string, language?: string }
 * Success:       200 { text: string }
 * No key:        200 { error: "no_stt_provider", message: string }
 *                  (200 not 503 — the UI can show "configure an OpenAI key"
 *                   without treating it as a hard failure)
 * Bad body:      400 { error: "bad_request", message: string }
 * Upstream fail: 502 { error: "upstream_error", message: string }
 * Parse fail:    502 { error: "parse_error", message: string }
 *
 * Auth: loopback/local-secret/device-token gated, with same-origin desktop UI
 * allowed. The transcript endpoint may use owner-configured voice engines but never exposes keys. The
 * service resolves it internally and discards it after the HTTP call. (Engineering Rule #4: classify
 * errors; Rule #8: no plaintext key in response or logs.)
 */

import { NextResponse, type NextRequest } from 'next/server';
import { transcribeAudio } from '@holon/core';
import { deviceAuthErrorResponse, requireDeviceTokenForRemote } from '@/lib/device-token-auth';

// True when the request is the Holon UI calling its OWN BFF (Origin host ===
// Host header). Needed for the WSL web build served at https://<wsl-ip>:3443,
// where the browser origin is non-loopback but legitimately same-origin.
// Cross-origin (CSRF) and other-LAN-host requests still have a mismatching /
// absent Origin and are rejected. Transcribe never returns the STT key
// (resolves + discards internally; local engines use
// no key), so same-origin is a safe relaxation.
function isSameOriginRequest(req: Request): boolean {
  const origin = req.headers.get('origin');
  // The HTTPS proxy rewrites Host to the loopback target but preserves the
  // original host in x-forwarded-host — prefer it so the proxied UI matches.
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch (error) {
    void error;
    return false;
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  // Accept loopback/local-secret/device-token via the shared mobile gate.
  // Same-origin keeps the desktop web chat working when served through the
  // local HTTPS/LAN proxy; cross-origin phone requests still need a device token.
  const auth = requireDeviceTokenForRemote(req);
  if (!auth.ok && !isSameOriginRequest(req)) {
    return deviceAuthErrorResponse(auth);
  }

  // Parse body.
  let body: unknown;
  try {
    body = await req.json();
  } catch (error) {
    return NextResponse.json(
      { error: 'bad_request', message: 'Request body must be valid JSON.', detail: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json(
      { error: 'bad_request', message: 'Request body must be a JSON object.' },
      { status: 400 },
    );
  }
  const { base64, mime, language } = body as Record<string, unknown>;

  if (typeof base64 !== 'string' || base64.length === 0) {
    return NextResponse.json(
      { error: 'bad_request', message: '"base64" is required and must be a non-empty string.' },
      { status: 400 },
    );
  }
  if (typeof mime !== 'string' || mime.length === 0) {
    return NextResponse.json(
      { error: 'bad_request', message: '"mime" is required and must be a non-empty string.' },
      { status: 400 },
    );
  }
  const languageStr = typeof language === 'string' && language.length > 0 ? language : undefined;

  // Call the STT service.
  const result = await transcribeAudio({
    base64,
    mime,
    ...(languageStr !== undefined ? { language: languageStr } : {}),
  });

  if (result.ok) {
    return NextResponse.json({ text: result.text }, { status: 200 });
  }

  // Graceful "no key configured" — 200 with error so UI can display a hint
  // rather than treating it as an infrastructure failure.
  if (result.error === 'no_stt_provider') {
    return NextResponse.json(
      { error: result.error, message: result.message },
      { status: 200 },
    );
  }

  // Real upstream / parse failures → 502.
  return NextResponse.json(
    { error: result.error, message: result.message },
    { status: 502 },
  );
}

export const dynamic = 'force-dynamic';

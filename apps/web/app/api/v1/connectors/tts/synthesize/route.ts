/**
 * BFF route: POST /api/v1/connectors/tts/synthesize
 *
 * Text-to-Speech endpoint. Accepts text, calls the configured voice synthesis
 * service, and returns base64 audio plus MIME type.
 *
 * Auth: loopback/local-secret/device-token gated, with same-origin desktop UI
 * allowed so the web chat read-aloud button keeps working.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { synthesizeSpeech } from '@holon/core';
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

  const { text, language, voice, engine, url } = body as Record<string, unknown>;
  if (typeof text !== 'string' || text.trim().length === 0) {
    return NextResponse.json(
      { error: 'bad_request', message: '"text" is required and must be a non-empty string.' },
      { status: 400 },
    );
  }

  const result = await synthesizeSpeech({
    text,
    ...(typeof language === 'string' && language.length > 0 ? { language } : {}),
    ...(typeof voice === 'string' && voice.length > 0 ? { voice } : {}),
    // 试听 override — test the engine SELECTED in the form, not the saved one.
    ...(engine === 'cosyvoice' || engine === 'openai' ? { engine } : {}),
    ...(typeof url === 'string' && url.length > 0 ? { url } : {}),
  });

  if (result.ok) {
    return NextResponse.json({ base64: result.base64, mime: result.mime }, { status: 200 });
  }

  if (result.error === 'no_tts_provider') {
    return NextResponse.json(
      { error: result.error, message: result.message },
      { status: 200 },
    );
  }

  return NextResponse.json(
    { error: result.error, message: result.message },
    { status: 502 },
  );
}

export const dynamic = 'force-dynamic';

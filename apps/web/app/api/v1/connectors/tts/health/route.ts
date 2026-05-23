import { NextResponse } from 'next/server';
import { getOwner } from '@holon/core';

type TtsEngine = 'cosyvoice' | 'openai';

const ENGINE_LABEL: Record<TtsEngine, string> = {
  cosyvoice: 'Local TTS',
  openai: 'OpenAI TTS',
};

function parseEngine(value: string | null): TtsEngine | null {
  if (value === 'cosyvoice' || value === 'openai') return value;
  return null;
}

function resolveHealthUrl(base: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(base);
  } catch (urlErr) {
    void urlErr;
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  return `${parsed.toString().replace(/\/+$/, '')}/health`;
}

function parseMaybeJson(text: string): unknown {
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch (parseErr) {
    void parseErr;
    return { message: text.slice(0, 240) };
  }
}

function summarizeOk(engine: TtsEngine, data: unknown): Record<string, unknown> {
  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>;
    return {
      ok: true,
      engine,
      provider: typeof record.provider === 'string' ? record.provider : undefined,
      model: typeof record.model === 'string' ? record.model : undefined,
      voice: typeof record.voice === 'string' ? record.voice : undefined,
      device: typeof record.device === 'string' ? record.device : undefined,
    };
  }
  return { ok: true, engine };
}

/**
 * GET /api/v1/connectors/tts/health?engine=<engine>&url=<base>
 *
 * Local TTS probes /health. OpenAI cloud checks only whether an owner-configured
 * voice key is present; it never returns the key.
 */
export async function GET(req: Request): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const engine = parseEngine(searchParams.get('engine'));
  const baseUrl = searchParams.get('url');

  if (!engine) {
    return NextResponse.json({ ok: false, error: 'invalid_engine' }, { status: 400 });
  }

  if (engine === 'openai') {
    const owner = getOwner();
    if (owner.tts_openai_api_key?.trim() || owner.stt_openai_api_key?.trim()) {
      return NextResponse.json({ ok: true, engine, provider: 'openai', message: 'OpenAI API key is configured.' });
    }
    return NextResponse.json(
      { ok: false, engine, error: 'missing_api_key', message: 'OpenAI API key is not configured.' },
      { status: 200 },
    );
  }

  if (!baseUrl) {
    return NextResponse.json({ ok: false, error: 'missing_url' }, { status: 400 });
  }

  const healthUrl = resolveHealthUrl(baseUrl);
  if (!healthUrl) {
    return NextResponse.json({ ok: false, error: 'invalid_url' }, { status: 400 });
  }

  let resp: Response;
  try {
    resp = await fetch(healthUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(5_000),
    });
  } catch (fetchErr) {
    return NextResponse.json(
      { ok: false, error: 'upstream_error', message: `Cannot reach ${ENGINE_LABEL[engine]} server at ${healthUrl}: ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}` },
      { status: 502 },
    );
  }

  const text = await resp.text();
  const data = parseMaybeJson(text);
  if (resp.ok) {
    return NextResponse.json({ ...summarizeOk(engine, data), probe: healthUrl });
  }

  const body = data && typeof data === 'object' ? data as { detail?: string; error?: string; message?: string } : {};
  const detail = body.detail ?? body.error ?? body.message;
  return NextResponse.json(
    { ok: false, error: 'upstream_error', message: detail ? `HTTP ${resp.status}: ${detail}` : `HTTP ${resp.status}` },
    { status: 502 },
  );
}

export const dynamic = 'force-dynamic';


import { NextResponse } from 'next/server';
import { getOwner } from '@holon/core';

type SttEngine = 'whisper_cpp' | 'sensevoice' | 'faster_whisper' | 'openai';

const ENGINE_LABEL: Record<SttEngine, string> = {
  whisper_cpp: 'whisper.cpp',
  sensevoice: 'SenseVoice',
  faster_whisper: 'faster-whisper',
  openai: 'OpenAI gpt-4o-transcribe',
};

function parseEngine(value: string | null): SttEngine | null {
  if (value === 'whisper_cpp' || value === 'sensevoice' || value === 'faster_whisper' || value === 'openai') return value;
  return null;
}

function resolveProbeUrls(base: string, engine: SttEngine): string[] | null {
  if (engine === 'openai') return null;
  let parsed: URL;
  try {
    parsed = new URL(base);
  } catch (urlErr) {
    void urlErr;
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  const trimmed = parsed.toString().replace(/\/+$/, '');
  if (engine === 'sensevoice') return [`${trimmed}/health`];
  if (engine === 'whisper_cpp') return [`${trimmed}/health`, `${trimmed}/v1/models`];
  return [`${trimmed}/v1/models`, `${trimmed}/health`];
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

function summarizeOk(engine: SttEngine, data: unknown): Record<string, unknown> {
  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>;
    const firstModel = Array.isArray(record.data) && record.data[0] && typeof record.data[0] === 'object'
      ? (record.data[0] as Record<string, unknown>).id
      : undefined;
    return {
      ok: true,
      engine,
      model: typeof record.model === 'string' ? record.model : firstModel,
      device: typeof record.device === 'string' ? record.device : undefined,
    };
  }
  return { ok: true, engine };
}

/**
 * GET /api/v1/connectors/voice/health?engine=<engine>&url=<base>
 *
 * Server-side proxy for local STT servers. SenseVoice exposes /health; the
 * OpenAI-compatible engines (whisper.cpp whisper-server and Speaches /
 * faster-whisper) are probed through /v1/models. OpenAI cloud STT checks only
 * whether an owner-configured voice key is present; it never returns the key.
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
    if (owner.stt_openai_api_key?.trim()) {
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

  const healthUrls = resolveProbeUrls(baseUrl, engine);
  if (!healthUrls) {
    return NextResponse.json({ ok: false, error: 'invalid_url' }, { status: 400 });
  }

  let lastMessage = '';
  for (const healthUrl of healthUrls) {
    let resp: Response;
    try {
      resp = await fetch(healthUrl, {
        method: 'GET',
        signal: AbortSignal.timeout(5_000),
      });
    } catch (fetchErr) {
      lastMessage = `Cannot reach ${ENGINE_LABEL[engine]} server at ${healthUrl}: ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`;
      continue;
    }

    const text = await resp.text();
    const data = parseMaybeJson(text);
    if (resp.ok) {
      return NextResponse.json({ ...summarizeOk(engine, data), probe: healthUrl });
    }

    const body = data && typeof data === 'object' ? data as { detail?: string; error?: string; message?: string } : {};
    const detail = body.detail ?? body.error ?? body.message;
    lastMessage = detail ? `HTTP ${resp.status}: ${detail}` : `HTTP ${resp.status}`;
  }

  return NextResponse.json(
    { ok: false, error: 'upstream_error', message: lastMessage || `Cannot reach ${ENGINE_LABEL[engine]} server.` },
    { status: 502 },
  );
}

export const dynamic = 'force-dynamic';


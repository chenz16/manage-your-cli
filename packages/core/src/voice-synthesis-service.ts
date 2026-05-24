/**
 * Voice synthesis service — Text-to-Speech connector.
 *
 * Supports configured TTS engines:
 *   - 'edge-tts'  (PRIMARY, keyless): Calls the local edge-tts Python server
 *     (scripts/cosyvoice-server.py on http://127.0.0.1:8770) which uses the
 *     Microsoft Edge neural voice API — no API key, no GPU, internet required.
 *     High-quality Microsoft neural voices (zh-CN-XiaoxiaoNeural for Chinese,
 *     en-US-AriaNeural for English). This is the primary engine for mobile TTS.
 *   - 'cosyvoice' (local/private): POST {tts_server_url}/synthesize.
 *     The WSL installer currently serves a Kokoro fallback under this local
 *     connector slot because CosyVoice is not a clean no-sudo uv install.
 *   - 'openai'    (optional cloud): POST https://api.openai.com/v1/audio/speech
 *     with the owner's voice-only OpenAI key.
 *
 * The `synthesizeEdgeTts` export is a thin wrapper around the edge-tts engine
 * used by the /api/v1/connectors/voice/tts BFF route (mobile primary path).
 */

import { getOwner } from './owner-config-service.js';

export type SynthesizeSpeechResult =
  | { ok: true; base64: string; mime: string }
  | { ok: false; error: 'no_tts_provider' | 'upstream_error' | 'parse_error'; message: string };

export interface SynthesizeSpeechInput {
  text: string;
  language?: string;
  voice?: string;
  /** Override the active engine (used by the connector "试听/Test" button so it
   * tests the engine currently SELECTED in the form, not the saved one). */
  engine?: 'cosyvoice' | 'openai' | 'edge-tts';
  /** Override the local TTS server URL (paired with engine='cosyvoice' or 'edge-tts'). */
  url?: string;
}

/** Input for the mobile-primary edge-tts synthesis path. */
export interface EdgeTtsSynthesisInput {
  /** Text to synthesise. Long texts are chunked automatically (≤1000 chars/chunk). */
  text: string;
  /** BCP-47 language hint. Defaults to 'zh-CN'. */
  lang?: string;
  /** Override the local edge-tts server URL. Defaults to http://127.0.0.1:8770. */
  serverUrl?: string;
}

const OPENAI_SPEECH_ENDPOINT = 'https://api.openai.com/v1/audio/speech';
const OPENAI_SPEECH_MODEL = 'gpt-4o-mini-tts';
const OPENAI_DEFAULT_VOICE = 'alloy';
const DEFAULT_LOCAL_TTS_URL = 'http://127.0.0.1:8770';

/** Maximum characters per synthesis chunk to avoid oversized requests. */
const CHUNK_MAX_CHARS = 1000;

type TtsProvider = 'cosyvoice' | 'openai' | 'edge-tts';

export async function synthesizeSpeech(input: SynthesizeSpeechInput): Promise<SynthesizeSpeechResult> {
  const text = input.text.trim();
  if (!text) {
    return { ok: false, error: 'parse_error', message: 'Text is required for speech synthesis.' };
  }

  const owner = getOwner();
  // Prefer an explicit engine override (the 试听 button) over the saved provider.
  const engine = input.engine ?? owner.tts_provider;
  const language = normalizeLanguageHint(input.language);
  const voice = normalizeVoice(input.voice);

  if (engine === 'edge-tts' || engine === 'cosyvoice') {
    return synthesizeViaLocalServer({
      text,
      url: resolveLocalTtsUrl(input.url ?? owner.tts_server_url ?? undefined),
      ...(language !== undefined ? { language } : {}),
      ...(voice !== undefined ? { voice } : {}),
    });
  }

  if (engine !== 'openai') {
    return {
      ok: false,
      error: 'no_tts_provider',
      message: 'No text-to-speech provider configured. Choose a local TTS engine or OpenAI in Connectors.',
    };
  }

  const apiKey = owner.tts_openai_api_key?.trim() || owner.stt_openai_api_key?.trim();
  if (!apiKey) {
    return {
      ok: false,
      error: 'no_tts_provider',
      message: 'No OpenAI voice API key configured. Add one in Connectors or switch to local TTS.',
    };
  }

  return synthesizeViaOpenAI({
    text,
    apiKey,
    ...(voice !== undefined ? { voice } : {}),
  });
}

async function synthesizeViaLocalServer(input: {
  text: string;
  url: string;
  language?: string;
  voice?: string;
}): Promise<SynthesizeSpeechResult> {
  const endpoint = `${input.url.replace(/\/+$/, '')}/synthesize`;
  const body: Record<string, string> = { text: input.text };
  if (input.language) body.language = input.language;
  if (input.voice) body.voice = input.voice;

  return postAudioJson({
    endpoint,
    providerName: 'local TTS server',
    body,
  });
}

async function synthesizeViaOpenAI(input: {
  text: string;
  apiKey: string;
  voice?: string;
}): Promise<SynthesizeSpeechResult> {
  return postAudioJson({
    endpoint: OPENAI_SPEECH_ENDPOINT,
    providerName: 'OpenAI TTS',
    headers: { Authorization: `Bearer ${input.apiKey}` },
    body: {
      model: OPENAI_SPEECH_MODEL,
      input: input.text,
      voice: input.voice || OPENAI_DEFAULT_VOICE,
      response_format: 'mp3',
    },
  });
}

async function postAudioJson(input: {
  endpoint: string;
  providerName: string;
  body: Record<string, unknown>;
  headers?: Record<string, string>;
}): Promise<SynthesizeSpeechResult> {
  let resp: Response;
  try {
    resp = await fetch(input.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(input.headers ?? {}),
      },
      body: JSON.stringify(input.body),
    });
  } catch (fetchErr) {
    return {
      ok: false,
      error: 'upstream_error',
      message: `Network error reaching ${input.providerName} at ${input.endpoint}: ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`,
    };
  }

  if (!resp.ok) {
    return {
      ok: false,
      error: 'upstream_error',
      message: `${input.providerName} returned error: ${await summarizeErrorResponse(resp)}`,
    };
  }

  let audio: ArrayBuffer;
  try {
    audio = await resp.arrayBuffer();
  } catch (parseErr) {
    return {
      ok: false,
      error: 'parse_error',
      message: `Failed to read ${input.providerName} audio response: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
    };
  }

  if (audio.byteLength === 0) {
    return {
      ok: false,
      error: 'parse_error',
      message: `${input.providerName} returned an empty audio response.`,
    };
  }

  const mime = normalizeAudioMime(resp.headers.get('content-type'));
  return {
    ok: true,
    base64: Buffer.from(audio).toString('base64'),
    mime,
  };
}

async function summarizeErrorResponse(resp: Response): Promise<string> {
  let text = '';
  try {
    text = await resp.text();
  } catch (readErr) {
    return `HTTP ${resp.status}: ${readErr instanceof Error ? readErr.message : String(readErr)}`;
  }
  if (!text.trim()) return `HTTP ${resp.status}`;
  try {
    const data = JSON.parse(text) as { detail?: string; error?: string | { message?: string }; message?: string };
    const message = typeof data.error === 'object' ? data.error.message : (data.detail ?? data.error ?? data.message);
    return message ? `HTTP ${resp.status}: ${message}` : `HTTP ${resp.status}`;
  } catch (parseErr) {
    void parseErr;
    return `HTTP ${resp.status}: ${text.slice(0, 240)}`;
  }
}

function resolveLocalTtsUrl(ttsServerUrl?: string): string {
  return normalizeLocalBaseUrl(ttsServerUrl?.trim() || DEFAULT_LOCAL_TTS_URL);
}

function normalizeLanguageHint(language: string | undefined): string | undefined {
  if (!language) return undefined;
  const normalized = language.trim().toLowerCase();
  if (!normalized) return undefined;
  return normalized.split('-')[0];
}

function normalizeVoice(voice: string | undefined): string | undefined {
  if (!voice) return undefined;
  const normalized = voice.trim();
  return normalized || undefined;
}

function normalizeLocalBaseUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return `http://${url}`;
}

function normalizeAudioMime(contentType: string | null): string {
  const mime = contentType?.split(';')[0]?.trim().toLowerCase();
  if (mime?.startsWith('audio/')) return mime;
  return 'audio/mpeg';
}

/**
 * Split text into chunks of at most CHUNK_MAX_CHARS characters, breaking on
 * sentence boundaries (。！？.!?) where possible so the TTS server does not
 * receive mid-sentence cuts.
 */
function chunkText(text: string, maxChars = CHUNK_MAX_CHARS): string[] {
  if (text.length <= maxChars) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > maxChars) {
    // Find the last sentence boundary within the limit.
    const slice = remaining.slice(0, maxChars);
    const boundary = Math.max(
      slice.lastIndexOf('。'),
      slice.lastIndexOf('！'),
      slice.lastIndexOf('？'),
      slice.lastIndexOf('.'),
      slice.lastIndexOf('!'),
      slice.lastIndexOf('?'),
    );
    const cutAt = boundary > 0 ? boundary + 1 : maxChars;
    chunks.push(remaining.slice(0, cutAt));
    remaining = remaining.slice(cutAt).trimStart();
  }
  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}

/**
 * Primary mobile TTS path: synthesise text via the local edge-tts Python server
 * (scripts/cosyvoice-server.py on port 8770).  Long texts are chunked and the
 * resulting MP3 buffers are concatenated before base64-encoding.
 *
 * Returns the same `SynthesizeSpeechResult` shape so the route handler can be
 * identical to the existing synthesize route.
 *
 * If the local server is unreachable the caller (BFF route) returns a clear 502
 * so the mobile client can fall back to the on-device native TTS.
 */
export async function synthesizeEdgeTts(input: EdgeTtsSynthesisInput): Promise<SynthesizeSpeechResult> {
  const text = input.text.trim();
  if (!text) {
    return { ok: false, error: 'parse_error', message: 'Text is required for speech synthesis.' };
  }

  const serverUrl = resolveLocalTtsUrl(input.serverUrl);
  const endpoint = `${serverUrl.replace(/\/+$/, '')}/synthesize`;
  // Convert BCP-47 lang (e.g. 'zh-CN') to language prefix expected by the server.
  const language = (input.lang ? (input.lang.split('-')[0] ?? 'zh') : 'zh');

  const chunks = chunkText(text);

  // Synthesise all chunks, collecting ArrayBuffers.
  const parts: ArrayBuffer[] = [];
  for (const chunk of chunks) {
    const body: Record<string, string> = { text: chunk, language };
    let resp: Response;
    try {
      resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (fetchErr) {
      return {
        ok: false,
        error: 'upstream_error',
        message: `edge-tts server unreachable at ${endpoint}: ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`,
      };
    }

    if (!resp.ok) {
      return {
        ok: false,
        error: 'upstream_error',
        message: `edge-tts server error: ${await summarizeErrorResponse(resp)}`,
      };
    }

    let audio: ArrayBuffer;
    try {
      audio = await resp.arrayBuffer();
    } catch (parseErr) {
      return {
        ok: false,
        error: 'parse_error',
        message: `Failed to read edge-tts audio response: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
      };
    }

    if (audio.byteLength === 0) {
      return {
        ok: false,
        error: 'parse_error',
        message: 'edge-tts server returned an empty audio response.',
      };
    }

    parts.push(audio);
  }

  // Concatenate all MP3 chunks into one buffer.
  const totalLength = parts.reduce((sum, p) => sum + p.byteLength, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    combined.set(new Uint8Array(part), offset);
    offset += part.byteLength;
  }

  return {
    ok: true,
    base64: Buffer.from(combined).toString('base64'),
    mime: 'audio/mpeg',
  };
}

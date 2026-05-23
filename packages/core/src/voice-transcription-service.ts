/**
 * Voice transcription service — Speech-to-Text connector.
 *
 * Supports configured STT engines:
 *   - 'whisper_cpp'    (local/private): OpenAI-compatible
 *                      POST {stt_server_url}/v1/audio/transcriptions, with a
 *                      native POST {stt_server_url}/inference fallback.
 *   - 'faster_whisper' (local/private): OpenAI-compatible
 *                      POST {stt_server_url}/v1/audio/transcriptions.
 *   - 'sensevoice'     (local/private): POST {sensevoice_url}/transcribe.
 *   - 'openai'         (optional): cloud transcription via OpenAI audio
 *                      endpoint (model gpt-4o-transcribe).
 *
 * Provider selection:
 *   1. Read owner config (getOwner()) → stt_provider + local URL fields.
 *   2. Route explicitly by configured engine; local engines use safe defaults.
 *   3. If neither provider is usable → { error: 'no_stt_provider' }.
 *
 * Design decisions:
 *   - STT is a distinct auxiliary modality. Chat intelligence still comes from
 *     the subscribed CLI; STT calls the selected audio endpoint directly.
 *   - No bare catch: every error path is classified and surfaced (Rule #4).
 *   - Errors are returned as typed values, not thrown.
 *
 * Public surface (reexported from packages/core/src/index.ts):
 *   transcribeAudio({ base64, mime, language? }): Promise<TranscribeResult>
 */

import { getOwner } from './owner-config-service.js';

export type TranscribeResult =
  | { ok: true; text: string }
  | { ok: false; error: 'no_stt_provider' | 'upstream_error' | 'parse_error'; message: string };

export interface TranscribeAudioInput {
  /** Base64-encoded audio bytes. */
  base64: string;
  /** MIME type, e.g. "audio/mp3" or "audio/mpeg". */
  mime: string;
  /** BCP-47 language hint, e.g. "zh". Optional — model auto-detects if absent. */
  language?: string;
}

const OPENAI_TRANSCRIBE_ENDPOINT = 'https://api.openai.com/v1/audio/transcriptions';
const OPENAI_TRANSCRIBE_MODEL = 'gpt-4o-transcribe';
const OPENAI_COMPAT_TRANSCRIBE_MODEL = 'whisper-1';

type SttProvider = 'openai' | 'sensevoice' | 'whisper_cpp' | 'faster_whisper';

const DEFAULT_STT_URL: Record<Exclude<SttProvider, 'openai'>, string> = {
  whisper_cpp: 'http://127.0.0.1:8080',
  sensevoice: 'http://127.0.0.1:8769',
  faster_whisper: 'http://127.0.0.1:8000',
};

/**
 * Transcribe base64-encoded audio to text.
 *
 * Routes by owner-configured STT engine. Returns
 * `{ ok: false, error: 'no_stt_provider' }` when no engine is configured.
 */
export async function transcribeAudio(input: TranscribeAudioInput): Promise<TranscribeResult> {
  const owner = getOwner();
  const engine = owner.stt_provider;
  const language = normalizeLanguageHint(input.language);

  if (engine === 'sensevoice') {
    const svInput: { base64: string; mime: string; url: string; language?: string } = {
      base64: input.base64,
      mime: input.mime,
      url: resolveLocalSttUrl(engine, owner.stt_server_url ?? undefined, owner.sensevoice_url ?? undefined),
    };
    if (language !== undefined) svInput.language = language;
    return transcribeViaSenseVoice(svInput);
  }

  if (engine === 'whisper_cpp') {
    const localInput: { base64: string; mime: string; url: string; language?: string; fallbackToNativeInference: true } = {
      base64: input.base64,
      mime: input.mime,
      url: resolveLocalSttUrl(engine, owner.stt_server_url ?? undefined),
      fallbackToNativeInference: true,
    };
    if (language !== undefined) localInput.language = language;
    return transcribeViaOpenAICompatible(localInput);
  }

  if (engine === 'faster_whisper') {
    const localInput: { base64: string; mime: string; url: string; language?: string; fallbackToNativeInference?: boolean } = {
      base64: input.base64,
      mime: input.mime,
      url: resolveLocalSttUrl(engine, owner.stt_server_url ?? undefined),
    };
    if (language !== undefined) localInput.language = language;
    return transcribeViaOpenAICompatible(localInput);
  }

  if (engine !== 'openai') {
    return {
      ok: false,
      error: 'no_stt_provider',
      message: 'No speech-to-text provider configured. Choose a local STT engine in Connectors to enable voice transcription.',
    };
  }

  const apiKey = owner.stt_openai_api_key?.trim();
  if (!apiKey) {
    return {
      ok: false,
      error: 'no_stt_provider',
      message: 'No OpenAI voice API key configured. Add one in Connectors or switch to a local STT engine.',
    };
  }

  const openAiInput: { base64: string; mime: string; apiKey: string; language?: string } = {
    base64: input.base64,
    mime: input.mime,
    apiKey,
  };
  if (language !== undefined) openAiInput.language = language;
  return transcribeViaOpenAICloud(openAiInput);
}

async function transcribeViaOpenAICloud(input: {
  base64: string;
  mime: string;
  apiKey: string;
  language?: string;
}): Promise<TranscribeResult> {
  const formResult = buildAudioForm(input, OPENAI_TRANSCRIBE_MODEL);
  if (!formResult.ok) return formResult.result;

  return postTranscriptionForm({
    endpoint: OPENAI_TRANSCRIBE_ENDPOINT,
    form: formResult.form,
    providerName: 'OpenAI',
    headers: { Authorization: `Bearer ${input.apiKey}` },
  });
}

async function transcribeViaOpenAICompatible(input: {
  base64: string;
  mime: string;
  language?: string;
  url: string;
  fallbackToNativeInference?: boolean;
}): Promise<TranscribeResult> {
  const baseUrl = input.url.replace(/\/+$/, '');
  const formResult = buildAudioForm(input, OPENAI_COMPAT_TRANSCRIBE_MODEL);
  if (!formResult.ok) return formResult.result;

  const compatEndpoint = `${baseUrl}/v1/audio/transcriptions`;
  const compatResult = await postTranscriptionForm({
    endpoint: compatEndpoint,
    form: formResult.form,
    providerName: 'OpenAI-compatible STT server',
  });

  if (!input.fallbackToNativeInference || compatResult.ok || compatResult.status !== 404) {
    return compatResultToPublicResult(compatResult);
  }

  const nativeFormResult = buildAudioForm(input);
  if (!nativeFormResult.ok) return nativeFormResult.result;

  const nativeResult = await postTranscriptionForm({
    endpoint: `${baseUrl}/inference`,
    form: nativeFormResult.form,
    providerName: 'whisper.cpp inference server',
  });
  return compatResultToPublicResult(nativeResult);
}

/**
 * Transcribe via a local SenseVoice server.
 *
 * Contract: POST {url}/transcribe multipart/form-data
 *   file     — audio blob named voice.<ext>
 *   language — optional BCP-47 hint
 * Response: { "text": "..." }
 *
 * Error classification (same taxonomy as OpenAI path):
 *   upstream_error — network failure, unreachable server, non-2xx HTTP
 *   parse_error    — malformed JSON or missing 'text' field
 */
async function transcribeViaSenseVoice(input: {
  base64: string;
  mime: string;
  language?: string;
  url: string;
}): Promise<TranscribeResult> {
  // Decode base64 → binary buffer.
  let audioBuffer: Buffer;
  try {
    audioBuffer = Buffer.from(input.base64, 'base64');
  } catch (decodeErr) {
    return {
      ok: false,
      error: 'parse_error',
      message: `Failed to decode base64 audio for SenseVoice: ${decodeErr instanceof Error ? decodeErr.message : String(decodeErr)}`,
    };
  }

  const ext = mimeToExt(input.mime);
  const fileName = `voice.${ext}`;
  const blob = new Blob([audioBuffer], { type: input.mime });
  const form = new FormData();
  form.append('file', blob, fileName);
  if (input.language) {
    form.append('language', input.language);
  }

  const endpoint = `${input.url.replace(/\/+$/, '')}/transcribe`;

  const result = await postTranscriptionForm({
    endpoint,
    form,
    providerName: 'SenseVoice transcription server',
  });
  return compatResultToPublicResult(result);
}

type FormBuildResult =
  | { ok: true; form: FormData }
  | { ok: false; result: TranscribeResult };

type PostTranscriptionResult =
  | { ok: true; text: string }
  | { ok: false; error: 'upstream_error' | 'parse_error'; message: string; status?: number };

function buildAudioForm(
  input: { base64: string; mime: string; language?: string },
  model?: string,
): FormBuildResult {
  let audioBuffer: Buffer;
  try {
    audioBuffer = Buffer.from(input.base64, 'base64');
  } catch (decodeErr) {
    return {
      ok: false,
      result: {
        ok: false,
        error: 'parse_error',
        message: `Failed to decode base64 audio: ${decodeErr instanceof Error ? decodeErr.message : String(decodeErr)}`,
      },
    };
  }

  const ext = mimeToExt(input.mime);
  const fileName = `voice.${ext}`;
  const blob = new Blob([audioBuffer], { type: input.mime });
  const form = new FormData();
  form.append('file', blob, fileName);
  if (model) {
    form.append('model', model);
  }
  if (input.language) {
    form.append('language', input.language);
  }
  return { ok: true, form };
}

async function postTranscriptionForm(input: {
  endpoint: string;
  form: FormData;
  providerName: string;
  headers?: Record<string, string>;
}): Promise<PostTranscriptionResult> {
  let resp: Response;
  try {
    resp = await fetch(input.endpoint, {
      method: 'POST',
      ...(input.headers ? { headers: input.headers } : {}),
      body: input.form,
    });
  } catch (fetchErr) {
    return {
      ok: false,
      error: 'upstream_error',
      message: `Network error reaching ${input.providerName} at ${input.endpoint}: ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`,
    };
  }

  if (!resp.ok) {
    let detail = `HTTP ${resp.status}`;
    try {
      const errBody = (await resp.json()) as { detail?: string; error?: string | { message?: string } };
      const msg = typeof errBody?.error === 'object' ? errBody.error.message : (errBody?.detail ?? errBody?.error);
      if (msg) detail = `HTTP ${resp.status}: ${msg}`;
    } catch (parseErr) {
      void parseErr;
      // ignore JSON parse failure on error body
    }
    return {
      ok: false,
      error: 'upstream_error',
      message: `${input.providerName} returned error: ${detail}`,
      status: resp.status,
    };
  }

  let data: unknown;
  try {
    data = await resp.json();
  } catch (parseErr) {
    return {
      ok: false,
      error: 'parse_error',
      message: `Failed to parse ${input.providerName} transcription response: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
    };
  }

  if (!data || typeof data !== 'object' || typeof (data as Record<string, unknown>).text !== 'string') {
    return {
      ok: false,
      error: 'parse_error',
      message: `Unexpected ${input.providerName} transcription response shape — missing 'text' field.`,
    };
  }

  const text = cleanTranscript((data as Record<string, unknown>).text as string);
  return { ok: true, text };
}

/** Normalize a raw transcript for display. SenseVoice's
 * rich_transcription_postprocess injects emotion emoji (😊 etc.) and
 * <|EVENT|> tags which are noise in a text transcript — strip them.
 * Chinese has no inter-word spaces, so we don't touch spacing; just
 * collapse any doubled whitespace introduced by removals + trim. */
function cleanTranscript(raw: string): string {
  return raw
    .replace(/<\|[^|]*\|>/g, '')                       // <|HAPPY|> / <|zh|> style tags
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{FE00}-\u{FE0F}\u{1F1E6}-\u{1F1FF}]/gu, '') // emoji / dingbats / variation selectors
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function compatResultToPublicResult(result: PostTranscriptionResult): TranscribeResult {
  if (result.ok) return { ok: true, text: result.text };
  return { ok: false, error: result.error, message: result.message };
}

function resolveLocalSttUrl(
  engine: Exclude<SttProvider, 'openai'>,
  sttServerUrl?: string,
  legacySenseVoiceUrl?: string,
): string {
  const configured =
    engine === 'sensevoice'
      ? (sttServerUrl?.trim() || legacySenseVoiceUrl?.trim())
      : sttServerUrl?.trim();
  return normalizeLocalBaseUrl(configured || DEFAULT_STT_URL[engine]);
}

function normalizeLanguageHint(language: string | undefined): string | undefined {
  if (!language) return undefined;
  const normalized = language.trim().toLowerCase();
  if (!normalized) return undefined;
  return normalized.split('-')[0];
}

function normalizeLocalBaseUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return `http://${url}`;
}

/** Map MIME type to file extension for the multipart filename hint. */
function mimeToExt(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes('mp3') || m.includes('mpeg')) return 'mp3';
  if (m.includes('mp4')) return 'mp4';
  if (m.includes('wav')) return 'wav';
  if (m.includes('webm')) return 'webm';
  if (m.includes('ogg')) return 'ogg';
  if (m.includes('flac')) return 'flac';
  if (m.includes('m4a')) return 'm4a';
  return 'mp3'; // safe default for WeChat voice (always MP3 after Silk decode)
}

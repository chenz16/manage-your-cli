/**
 * tts.ts — Hybrid TTS for 微作.
 *
 * PRIMARY path (when paired with desk):
 *   POST /api/v1/connectors/voice/tts to the desk BFF, which uses Microsoft
 *   Edge neural voices (edge-tts, keyless). Gets base64 MP3, plays via
 *   HTMLAudioElement.
 *
 * FALLBACK path (unpaired, desk unreachable, or edge-tts server down):
 *   @capacitor-community/text-to-speech — on-device native TTS engine.
 *   On web preview: window.speechSynthesis Web Speech API (supported in
 *   WKWebView / Android WebView; no native plugin needed).
 *
 * NOTE ON PLUGIN VERSION:
 *   @capacitor-community/text-to-speech@^5.1.0 is pinned (Cap 6 compat,
 *   peerDep @capacitor/core ^6.0.0). v8+ requires Cap >=8.
 *
 * SSR/static-export safe:
 *   - HTMLAudioElement is only created client-side (no top-level window access).
 *   - Capacitor plugin is dynamically imported (avoids SSR "window is not
 *     defined" crash — the plugin touches window at module-load time).
 *
 * Both speak() and stop() are exported with the same signature as device-tts.ts
 * so WeizoApp.tsx only needs to update its import path.
 */

'use client';

import { holonApiFetch, readDesktopConnection } from './mobile-runtime';

// ---------------------------------------------------------------------------
// Public options type — threaded from per-staff config in WeizoApp.tsx.
// ---------------------------------------------------------------------------

export interface TtsOpts {
  /** BCP 47 language tag, e.g. 'zh-CN', 'en-US'. Default 'zh-CN'. */
  lang?: string;
  /** Speech rate: 0.7 (slow) | 1.0 (normal) | 1.3 (fast). Default 1.0. */
  rate?: number;
}

// ---------------------------------------------------------------------------
// Active playback state — one audio element at a time.
// ---------------------------------------------------------------------------

let activeAudio: HTMLAudioElement | null = null;
let nativeTtsActive = false;
/** Track Web Speech API utterance for stop(). */
let activeSpeechUtterance: SpeechSynthesisUtterance | null = null;

/**
 * iOS WKWebView blocks audio.play() unless the FIRST one starts inside a real
 * user-gesture handler. After that initial unlock, the session can autoplay.
 * primeAudio() MUST be called from a touch/click handler (e.g. voice button
 * pointerdown). Subsequent calls are no-ops.
 */
let audioUnlocked = false;
export function primeAudio(): void {
  if (audioUnlocked) return;
  if (typeof window === 'undefined') return;
  try {
    // 0.1s of silent base64 wav — inaudible, satisfies iOS gesture rule.
    const silentWav =
      'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
    const a = new Audio(silentWav);
    a.muted = true;
    a.play().then(() => { audioUnlocked = true; }).catch(() => { /* still locked */ });
  } catch { /* noop */ }
}

// ---------------------------------------------------------------------------
// Capacitor plugin lazy-loader (dynamic import, SSR-safe)
// ---------------------------------------------------------------------------

async function getTextToSpeech() {
  const mod = await import('@capacitor-community/text-to-speech');
  return mod.TextToSpeech;
}

// ---------------------------------------------------------------------------
// Desk edge-tts path
// ---------------------------------------------------------------------------

async function speakViaDesk(text: string, opts: TtsOpts): Promise<void> {
  const response = await holonApiFetch('/api/v1/connectors/voice/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, lang: opts.lang ?? 'zh-CN' }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { message?: string };
    throw new Error(body.message ?? `桌面语音服务错误 (HTTP ${response.status})`);
  }

  const data = await response.json() as { base64?: string; mime?: string; error?: string; message?: string };

  // The desk route may return 200 with an error field if edge-tts is not configured.
  if (data.error) {
    throw new Error(data.message ?? data.error);
  }

  if (!data.base64 || !data.mime) {
    throw new Error('桌面语音服务返回了无效的音频数据。');
  }

  // Decode base64 to a Blob and play via HTMLAudioElement.
  const binary = atob(data.base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: data.mime });
  const url = URL.createObjectURL(blob);

  return new Promise<void>((resolve, reject) => {
    const audio = new Audio(url);
    activeAudio = audio;

    audio.onended = () => {
      activeAudio = null;
      URL.revokeObjectURL(url);
      resolve();
    };

    audio.onerror = (_ev) => {
      activeAudio = null;
      URL.revokeObjectURL(url);
      reject(new Error('音频播放失败。'));
    };

    audio.play().catch((playErr: unknown) => {
      activeAudio = null;
      URL.revokeObjectURL(url);
      reject(playErr instanceof Error ? playErr : new Error(String(playErr)));
    });
  });
}

// ---------------------------------------------------------------------------
// On-device native TTS (Capacitor plugin — iOS + Android native)
// ---------------------------------------------------------------------------

async function speakViaDevice(text: string, opts: TtsOpts): Promise<void> {
  const TextToSpeech = await getTextToSpeech();
  nativeTtsActive = true;
  try {
    await TextToSpeech.speak({
      text,
      lang: opts.lang ?? 'zh-CN',
      rate: opts.rate ?? 1.0,
      pitch: 1.0,
      volume: 1.0,
      category: 'playback',
    });
  } finally {
    nativeTtsActive = false;
  }
}

// ---------------------------------------------------------------------------
// Web Speech Synthesis fallback (WKWebView + Android WebView both support it)
// ---------------------------------------------------------------------------

function speakViaSpeechSynthesis(text: string, opts: TtsOpts): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const synth = window.speechSynthesis;
    synth.cancel(); // stop any previous utterance
    const u = new SpeechSynthesisUtterance(text);
    activeSpeechUtterance = u;
    u.lang = opts.lang ?? 'zh-CN';
    u.rate = opts.rate ?? 1.0;
    u.onend = () => { activeSpeechUtterance = null; resolve(); };
    u.onerror = (ev) => {
      activeSpeechUtterance = null;
      reject(new Error(`Web Speech 朗读失败：${ev.error}`));
    };
    synth.speak(u);
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Speak text using hybrid TTS.
 *
 * Priority order:
 * 1. Desk edge-tts BFF (if paired) — best voice quality.
 * 2. @capacitor-community/text-to-speech native engine (iOS / Android).
 *    Falls back automatically to Web Speech API in the plugin itself on web.
 * 3. window.speechSynthesis Web Speech API — last resort (browser preview).
 *
 * @param text   Text to speak.
 * @param opts   Optional per-staff lang (BCP 47) and rate (0.7/1.0/1.3).
 * @throws Error if all paths fail.
 */
// Shared TTS preprocessor (covers markdown, urls, emojis, file paths,
// symbol blocks, etc.). Mobile imports the file directly (not via the
// @holon/core index) because the index transitively pulls in
// staff-management-service which has `node:os` — fine on the desk
// (Node runtime), fatal on the Capacitor static-export bundle.
// Desk endpoint (/api/v1/connectors/voice/tts) and mobile speak()
// still share THIS file → no drift. Owner asked twice ("再试一遍优化方案") —
// see packages/core/src/sanitize-for-tts.ts for the full spec.
import { sanitizeForTts } from '@holon/core/src/sanitize-for-tts';

export async function speak(text: string, opts: TtsOpts = {}): Promise<void> {
  text = sanitizeForTts(text);
  if (!text) return; // nothing speakable left after stripping
  const connection = readDesktopConnection();
  if (connection) {
    try {
      await speakViaDesk(text, opts);
      return;
    } catch (deskErr) {
      // Desk failed — fall through to on-device TTS.
      process.stderr?.write?.(JSON.stringify({
        warn: 'tts.desk_path_failed',
        msg: deskErr instanceof Error ? deskErr.message : String(deskErr),
        ts: new Date().toISOString(),
      }) + '\n');
    }
  }

  // On-device TTS (native plugin).
  try {
    await speakViaDevice(text, opts);
    return;
  } catch (deviceErr) {
    const deviceMsg = deviceErr instanceof Error ? deviceErr.message : String(deviceErr);
    // If the native plugin is unavailable (e.g. browser preview), fall through.
    if (!/not implemented|not available|unsupported/i.test(deviceMsg)) {
      // Real device error — surface it and fall through to Web Speech.
      process.stderr?.write?.(JSON.stringify({
        warn: 'tts.native_plugin_failed',
        msg: deviceMsg,
        ts: new Date().toISOString(),
      }) + '\n');
    }
  }

  // Web Speech API fallback — works in WKWebView (iOS) and Android WebView.
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      await speakViaSpeechSynthesis(text, opts);
      return;
    } catch (webErr) {
      const deskMsg = connection ? '桌面语音不可用' : '未连接桌面';
      const webMsg = webErr instanceof Error ? webErr.message : String(webErr);
      throw new Error(`朗读失败：${deskMsg}，本机朗读也失败（${webMsg}）`);
    }
  }

  const deskMsg = connection ? '桌面语音不可用' : '未连接桌面';
  throw new Error(`朗读失败：${deskMsg}，且本机不支持朗读`);
}

/**
 * Stop any ongoing TTS playback on whichever path is active.
 * Best-effort: does not throw on failure.
 */
export async function stop(): Promise<void> {
  // Stop HTMLAudioElement (desk edge-tts path).
  if (activeAudio) {
    activeAudio.pause();
    activeAudio.currentTime = 0;
    activeAudio = null;
  }

  // Stop Web Speech Synthesis if active.
  if (activeSpeechUtterance && typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    activeSpeechUtterance = null;
  }

  // Stop on-device native TTS if active.
  if (nativeTtsActive) {
    try {
      const TextToSpeech = await getTextToSpeech();
      await TextToSpeech.stop();
    } catch {
      // best-effort
    }
    nativeTtsActive = false;
  }
}

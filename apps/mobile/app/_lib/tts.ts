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
 *   Speaks with lang='zh-CN' on Android/iOS; Web Speech API in browser.
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
// Active playback state — one audio element at a time.
// ---------------------------------------------------------------------------

let activeAudio: HTMLAudioElement | null = null;
let nativeTtsActive = false;

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

async function speakViaDesk(text: string): Promise<void> {
  const response = await holonApiFetch('/api/v1/connectors/voice/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, lang: 'zh-CN' }),
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
// On-device native TTS fallback
// ---------------------------------------------------------------------------

async function speakViaDevice(text: string): Promise<void> {
  const TextToSpeech = await getTextToSpeech();
  nativeTtsActive = true;
  try {
    await TextToSpeech.speak({
      text,
      lang: 'zh-CN',
      rate: 1.0,
      pitch: 1.0,
      volume: 1.0,
      category: 'playback',
    });
  } finally {
    nativeTtsActive = false;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Speak text using hybrid TTS.
 *
 * 1. If the device is paired to the desk, calls the desk edge-tts BFF (PRIMARY).
 * 2. On any failure (unpaired / desk unreachable / edge-tts server down) falls
 *    back to the on-device @capacitor-community/text-to-speech plugin.
 * 3. If BOTH paths fail, throws an Error with a clear Chinese hint.
 *
 * @throws Error if both paths fail.
 */
export async function speak(text: string): Promise<void> {
  const connection = readDesktopConnection();
  if (connection) {
    try {
      await speakViaDesk(text);
      return;
    } catch (deskErr) {
      // Desk failed — fall through to on-device TTS.
      void deskErr;
    }
  }

  // On-device fallback.
  try {
    await speakViaDevice(text);
  } catch (deviceErr) {
    const deskMsg = connection ? '桌面语音不可用' : '未连接桌面';
    const deviceMsg = deviceErr instanceof Error ? deviceErr.message : String(deviceErr);
    if (/not implemented|not available|unsupported/i.test(deviceMsg)) {
      throw new Error(`朗读失败：${deskMsg}，且本机不支持朗读`);
    }
    throw new Error(`朗读失败：${deskMsg}，本机朗读也失败（${deviceMsg}）`);
  }
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

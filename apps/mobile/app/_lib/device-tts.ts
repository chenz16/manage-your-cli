/**
 * device-tts.ts — On-device TTS via @capacitor-community/text-to-speech.
 *
 * Native Android impl in the built APK; Web Speech API fallback in browser preview.
 * hybrid edge-tts deferred — no desk dependency here.
 */

import { TextToSpeech } from '@capacitor-community/text-to-speech';

/**
 * Speak text using the on-device TTS engine.
 * @throws Error with a clear message if the plugin is unsupported or fails.
 */
export async function speak(text: string): Promise<void> {
  try {
    await TextToSpeech.speak({
      text,
      lang: 'zh-CN',
      rate: 1.0,
      pitch: 1.0,
      volume: 1.0,
      category: 'playback',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Surface "not implemented" / unsupported clearly so the UI can show a hint.
    if (/not implemented|not available|unsupported/i.test(msg)) {
      throw new Error('设备不支持朗读功能。请在 Android 设备或支持 Web Speech 的浏览器上使用。');
    }
    throw new Error(`朗读失败：${msg}`);
  }
}

/**
 * Stop any ongoing TTS playback.
 * @throws Error with a clear message on failure.
 */
export async function stop(): Promise<void> {
  try {
    await TextToSpeech.stop();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`停止朗读失败：${msg}`);
  }
}

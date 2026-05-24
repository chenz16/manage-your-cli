/**
 * native-stt.ts — 设备原生语音识别包装层 (微作).
 *
 * 使用 @capacitor-community/speech-recognition（设备内置识别器，Android=Google/Samsung，
 * iOS=Siri，均免费、无需联网、无需 API key）。
 *
 * 接口：
 *   isAvailable()        → 检查设备是否支持原生 STT
 *   requestPermission()  → 请求麦克风 / 语音识别权限，返回是否被授予
 *   listen(opts)         → 开始识别；resolves 到最终识别文本
 *   stop()               → 停止当前识别（如正在进行）
 *
 * SSR/静态导出安全：
 *   - 插件通过 dynamic import 懒加载，不在模块顶层 import
 *   - 所有 window/navigator 访问均在函数内部（不在模块加载时执行）
 *   - server context 下所有函数返回 null/false 或静默 no-op
 *
 * 使用方式（WeizoApp.tsx）：
 *   if (await isAvailable()) {
 *     const text = await listen({ language: 'zh-CN', onPartial: (t) => setHint(t) });
 *   }
 */

'use client';

import type { SpeechRecognitionPlugin } from '@capacitor-community/speech-recognition';

// ── Plugin 懒加载（SSR 安全）────────────────────────────────────────────────

async function getSpeechRecognitionPlugin(): Promise<SpeechRecognitionPlugin | null> {
  if (typeof window === 'undefined') return null;
  try {
    const mod = await import('@capacitor-community/speech-recognition');
    return mod.SpeechRecognition;
  } catch {
    return null;
  }
}

// ── 公开 API ─────────────────────────────────────────────────────────────────

/**
 * 检查设备是否支持原生语音识别。
 * 在浏览器预览环境（Capacitor 插件不可用）下返回 false。
 */
export async function isAvailable(): Promise<boolean> {
  const plugin = await getSpeechRecognitionPlugin();
  if (!plugin) return false;
  try {
    const result = await plugin.available();
    return result.available === true;
  } catch {
    return false;
  }
}

/**
 * 请求语音识别权限（RECORD_AUDIO on Android；speech+mic on iOS）。
 * 返回 'granted' 表示已授权，'denied' 表示被拒绝。
 */
export async function requestPermission(): Promise<'granted' | 'denied'> {
  const plugin = await getSpeechRecognitionPlugin();
  if (!plugin) return 'denied';
  try {
    const result = await plugin.requestPermissions();
    return result.speechRecognition === 'granted' ? 'granted' : 'denied';
  } catch {
    return 'denied';
  }
}

export interface ListenOptions {
  /** 识别语言（BCP-47）。默认 'zh-CN'。*/
  language?: string;
  /** 是否启用部分结果回调（边说边出字）。*/
  partialResults?: boolean;
  /** 部分结果回调（每次有中间结果时调用）。*/
  onPartial?: (text: string) => void;
}

/**
 * 开始原生语音识别，返回最终识别文本的 Promise。
 *
 * 识别过程：
 *   1. 调用 plugin.start()，设置 partialResults=true（如果 onPartial 已提供）
 *   2. 通过 plugin.addListener('partialResults') 接收中间结果 → 调用 onPartial
 *   3. plugin.start() resolves 时包含最终 matches 数组
 *   4. resolve 最终文本（trim 后）
 *
 * @throws Error  如果权限被拒（message='PERMISSION_DENIED'）或识别器启动失败
 */
export async function listen(opts: ListenOptions = {}): Promise<string> {
  const plugin = await getSpeechRecognitionPlugin();
  if (!plugin) throw new Error('设备不支持原生语音识别。');

  const lang = opts.language ?? 'zh-CN';
  const wantPartial = typeof opts.onPartial === 'function';
  const cb = opts.onPartial;

  return new Promise<string>((resolve, reject) => {
    let partialHandle: { remove: () => void } | null = null;
    let settled = false;

    function cleanup() {
      partialHandle?.remove();
      partialHandle = null;
    }

    function settle(result: string | Error) {
      if (settled) return;
      settled = true;
      cleanup();
      if (result instanceof Error) reject(result);
      else resolve(result);
    }

    // ── 监听部分结果 ─────────────────────────────────────────────────────────
    if (wantPartial && cb) {
      void plugin.addListener('partialResults', (data: { matches: string[] }) => {
        const partial = data.matches?.[0] ?? '';
        if (partial) cb(partial);
      }).then((h) => { partialHandle = h; });
    }

    // ── 启动识别，start() resolves 时包含最终 matches ─────────────────────────
    void plugin.start({
      language: lang,
      maxResults: 1,
      prompt: '请说话…',
      partialResults: wantPartial,
      popup: false,
    }).then((result: { matches?: string[] }) => {
      const text = result.matches?.[0] ?? '';
      settle(text.trim());
    }).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      if (/permission|denied|not.*allow/i.test(msg)) {
        settle(new Error('PERMISSION_DENIED'));
      } else {
        settle(new Error(msg || '语音识别失败。'));
      }
    });
  });
}

/**
 * 停止当前正在进行的语音识别（如有）。
 * best-effort：不抛出异常。
 */
export async function stop(): Promise<void> {
  const plugin = await getSpeechRecognitionPlugin();
  if (!plugin) return;
  try {
    await plugin.stop();
  } catch {
    // best-effort
  }
}

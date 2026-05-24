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

// ── Plugin 懒加载（SSR 安全）────────────────────────────────────────────────
// 不在模块顶层 import 该包 —— 连 `import type` 都会让 Next 静态导出 build 解析
// 失败（typecheck 过、next build 不过）。改用本地最小接口 + 运行时 dynamic
// import + 强制转型。

type SpeechRecognitionPlugin = {
  available(): Promise<{ available: boolean }>;
  requestPermissions(): Promise<{ speechRecognition: string }>;
  start(opts: {
    language?: string;
    maxResults?: number;
    prompt?: string;
    partialResults?: boolean;
    popup?: boolean;
  }): Promise<{ matches?: string[] }>;
  stop(): Promise<void>;
  addListener(
    event: 'partialResults',
    cb: (data: { matches: string[] }) => void,
  ): Promise<{ remove: () => void }>;
};

// 关键:必须把插件**包在普通对象里**返回 —— 绝不能让 Capacitor 插件 proxy
// 直接穿过 async/await 边界返回。proxy 是 "thenable"(带 .then 陷阱),
// `await getSpeechRecognitionPlugin()` 会触发 `SpeechRecognition.then()` →
// Capacitor 抛 `"SpeechRecognition.then()" is not implemented on android`。
// 包一层后 await 到的是普通对象(非 thenable),就不会触发 .then。
async function getSpeechRecognitionPlugin(): Promise<{ plugin: SpeechRecognitionPlugin } | null> {
  if (typeof window === 'undefined') return null;
  try {
    const mod = await import('@capacitor-community/speech-recognition');
    return { plugin: mod.SpeechRecognition as unknown as SpeechRecognitionPlugin };
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
  const wrapped = await getSpeechRecognitionPlugin();
  if (!wrapped) return false;
  const plugin = wrapped.plugin;
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
  const wrapped = await getSpeechRecognitionPlugin();
  if (!wrapped) return 'denied';
  const plugin = wrapped.plugin;
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
 * @throws Error  如果权限被拒（message='PERMISSION_DENIED'）
 * @throws Error  如果识别器不存在（message='NO_RECOGNIZER'）
 * @throws Error  其他原生错误（message = 实际错误信息）
 */
export async function listen(opts: ListenOptions = {}): Promise<string> {
  const wrapped = await getSpeechRecognitionPlugin();
  if (!wrapped) throw new Error('NO_RECOGNIZER');
  const plugin = wrapped.plugin;

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
      popup: false,               // 保持紧凑按钮，不弹系统弹窗
    }).then((result: { matches?: string[] }) => {
      const text = result.matches?.[0] ?? '';
      settle(text.trim());
    }).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      if (/permission|denied|not.*allow/i.test(msg)) {
        settle(new Error('PERMISSION_DENIED'));
      } else if (/not.*available|no.*recogni[sz]|unavailable|recognition.*not.*support/i.test(msg)) {
        // Samsung / AOSP 设备在 available()=false 时 start() 抛此类错误
        settle(new Error('NO_RECOGNIZER'));
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
  const wrapped = await getSpeechRecognitionPlugin();
  if (!wrapped) return;
  const plugin = wrapped.plugin;
  try {
    await plugin.stop();
  } catch {
    // best-effort
  }
}

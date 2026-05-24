'use client';

/**
 * VoiceBugReport — 语音报bug component for 微作 (mobile).
 *
 * Flow:
 *   1. User taps "语音报bug" button.
 *   2. BEFORE the modal opens, capture a screenshot of the current view
 *      via html2canvas (dynamic import — SSR/static-export safe).
 *   3. Holds microphone button to record.
 *   4. Audio blob → base64 → POST /api/v1/connectors/voice/transcribe.
 *   5. Keyword scan: if transcribed text contains screenshot intent
 *      (截图/截屏/带图/screenshot), the captured PNG data-URI is included
 *      in the bug payload as `screenshot_data_url`; otherwise null.
 *   6. POST /api/v1/admin/bugs (existing desk endpoint) with description
 *      = "[mobile-voice] <text>", route, viewport, ts, and the PNG.
 *   7. Confirm to user: "已记录：<short summary>（含截图）" when screenshot
 *      attached, else "已记录：<short summary>".
 *
 * Screenshot capture:
 *   - html2canvas is dynamically imported inside captureScreenshot()
 *     so it never runs at module load (SSR/static-export safe).
 *   - Target element: document.body (full viewport). Capture is initiated
 *     before setOpen(true) so the modal does NOT appear in the screenshot.
 *   - Best-effort: if html2canvas throws, we proceed with screenshotDataUrl=null
 *     and tag the description with "(截图失败)".
 *
 * Secretary visibility: the bug lands in the `bugs/<id>/` disk store that
 * `listBugsWithStatus()` already reads. No new integration needed — the desk
 * BugQueue on /me surfaces it, and the Secretary sees it the next time the
 * owner says "扫一下 bug" in chat.
 *
 * SSR-safe: all MediaRecorder / window / navigator access is gated behind
 * useEffect / event handlers (never at module load). html2canvas is
 * dynamic-import only. No top-level Capacitor plugin import. No API keys.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { deskApi } from '../_lib/desk-api';
import * as nativeStt from '../_lib/native-stt';

// ── Screenshot-intent keyword detection ───────────────────────────────────
// Returns true when the user's words express screenshot intent.
function hasScreenshotIntent(text: string): boolean {
  return /截图|截屏|带图|with.*screenshot|screenshot/i.test(text);
}

// ── DOM screenshot via html2canvas (dynamic import — SSR safe) ────────────
/**
 * Capture the current visible app UI as a PNG data-URI.
 * Dynamic-imports html2canvas so it is never executed at module load time
 * (SSR / static-export safe: html2canvas uses document/window internally
 * and would crash in a server context if imported at the top level).
 *
 * @returns PNG data-URI string, or null on failure.
 */
async function captureScreenshot(): Promise<string | null> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return null; // server context — skip silently
  }
  try {
    // Dynamic import keeps this module SSR-safe.
    const html2canvas = (await import('html2canvas')).default;
    const canvas = await html2canvas(document.body, {
      // useCORS: allow cross-origin images in the capture (best-effort).
      useCORS: true,
      // scale: 1 keeps the PNG small enough for the bug payload.
      scale: 1,
      // logging: false suppresses noisy console output.
      logging: false,
    });
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}

// ── Audio helpers (mirrors desk ChatSurface recorderMimeType + blobToBase64) ──
function recorderMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return 'audio/webm';
  for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return 'audio/webm';
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') { reject(new Error('FileReader result is not a string')); return; }
      // Strip the data-URL header "data:<mime>;base64," → keep only base64 payload.
      const idx = result.indexOf(',');
      resolve(idx === -1 ? result : result.slice(idx + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// ── Phase state ────────────────────────────────────────────────────────────
type Phase =
  | 'idle'
  | 'recording'
  | 'transcribing'
  | 'filing'
  | 'done'
  | 'error';

interface DoneState {
  summary: string;
  screenshotAttached: boolean;
}

// ── Component ──────────────────────────────────────────────────────────────
export function VoiceBugReport() {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [statusMsg, setStatusMsg] = useState('');
  const [done, setDone] = useState<DoneState | null>(null);

  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  // Screenshot captured before the modal opens, held until bug is filed.
  const screenshotRef = useRef<string | null>(null);
  const screenshotFailedRef = useRef(false);

  // Cleanup media resources when sheet closes.
  const cleanup = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.onstop = null;
      try { recorderRef.current.stop(); } catch { /* ignore */ }
    }
    recorderRef.current = null;
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    chunksRef.current = [];
    screenshotRef.current = null;
    screenshotFailedRef.current = false;
  }, []);

  function close() {
    cleanup();
    setOpen(false);
    setPhase('idle');
    setStatusMsg('');
    setDone(null);
  }

  // Esc key closes sheet.
  useEffect(() => {
    if (!open) return;
    function onKey(ev: KeyboardEvent) {
      if (ev.key === 'Escape') close();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Auto-close after done.
  useEffect(() => {
    if (phase !== 'done') return;
    const t = setTimeout(() => close(), 2800);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // ── Open: capture screenshot BEFORE showing the modal ───────────────────
  async function openModal() {
    // Capture BEFORE setOpen(true) so the modal is not in the screenshot.
    const dataUrl = await captureScreenshot();
    if (dataUrl) {
      screenshotRef.current = dataUrl;
      screenshotFailedRef.current = false;
    } else {
      screenshotRef.current = null;
      screenshotFailedRef.current = true;
    }
    setOpen(true);
  }

  // ── Start recording — native STT primary, desk-transcribe fallback ────────
  async function startRecording() {
    const nativeAvail = await nativeStt.isAvailable();
    if (nativeAvail) {
      await startNativeRecording();
    } else {
      await startDeskRecording();
    }
  }

  // ── Native STT path ──────────────────────────────────────────────────────
  async function startNativeRecording() {
    const perm = await nativeStt.requestPermission();
    if (perm !== 'granted') {
      setPhase('error');
      setStatusMsg('语音识别权限被拒绝，请在系统设置中允许麦克风权限。');
      return;
    }
    setPhase('recording');
    setStatusMsg('正在聆听… 点击停止');
    try {
      const text = await nativeStt.listen({
        language: 'zh-CN',
        partialResults: true,
        onPartial: (p) => setStatusMsg(p || '正在聆听…'),
      });
      if (!text) {
        setPhase('error');
        setStatusMsg('没有识别到文字，请重试');
        return;
      }
      const wantsScreenshot = hasScreenshotIntent(text);
      setPhase('filing');
      setStatusMsg('提交中…');
      await fileBug(text, wantsScreenshot);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === 'PERMISSION_DENIED') {
        setPhase('error');
        setStatusMsg('语音识别权限被拒绝，请在系统设置中允许麦克风权限。');
      } else {
        // Native failed — try desk-transcribe fallback silently.
        await startDeskRecording();
      }
    }
  }

  // ── Stop native STT (tap-to-stop) ────────────────────────────────────────
  function stopNativeRecording() {
    void nativeStt.stop();
    // The listen() promise will resolve with whatever was captured so far.
  }

  // ── Desk-transcribe fallback path ────────────────────────────────────────
  async function startDeskRecording() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setPhase('error');
      setStatusMsg('此设备不支持麦克风录制');
      return;
    }
    setPhase('recording');
    setStatusMsg('录音中… 点击停止');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      chunksRef.current = [];
      const mime = recorderMimeType();
      const recorder = new MediaRecorder(stream, { mimeType: mime });
      recorderRef.current = recorder;
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        void handleDeskRecordingDone(mime);
      };
      recorder.start();
    } catch (err) {
      setPhase('error');
      setStatusMsg(`无法访问麦克风：${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── Stop desk recording ──────────────────────────────────────────────────
  function stopDeskRecording() {
    const rec = recorderRef.current;
    if (!rec || rec.state === 'inactive') return;
    setPhase('transcribing');
    setStatusMsg('转录中…');
    rec.stop();
  }

  // ── Unified stop (called by UI stop button) ───────────────────────────────
  function stopRecording() {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      stopDeskRecording();
    } else {
      stopNativeRecording();
    }
  }

  // ── Desk transcribe + file ────────────────────────────────────────────────
  async function handleDeskRecordingDone(mime: string) {
    const chunks = chunksRef.current;
    if (chunks.length === 0) {
      setPhase('error');
      setStatusMsg('没有录到音频，请重试');
      return;
    }
    const blob = new Blob(chunks, { type: mime });
    chunksRef.current = [];

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }

    let text = '';
    try {
      const base64 = await blobToBase64(blob);
      const res = await fetch(deskApi('/api/v1/connectors/voice/transcribe'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ base64, mime, language: 'zh' }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { text?: string; error?: string; message?: string };
      if (data.error === 'no_stt_provider') {
        setPhase('error');
        setStatusMsg('未配置语音转文字服务（请在桌面端配置 OpenAI key）');
        return;
      }
      if (data.error) throw new Error(data.message ?? data.error);
      text = (typeof data.text === 'string' ? data.text : '').trim();
    } catch (err) {
      setPhase('error');
      setStatusMsg(`转录失败：${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    if (!text) {
      setPhase('error');
      setStatusMsg('没有识别到文字，请重试');
      return;
    }

    const wantsScreenshot = hasScreenshotIntent(text);
    setPhase('filing');
    setStatusMsg('提交中…');
    await fileBug(text, wantsScreenshot);
  }

  // ── File the bug via /api/v1/admin/bugs ──────────────────────────────────
  async function fileBug(transcribedText: string, screenshotIntent: boolean) {
    // Determine the screenshot to attach:
    //   - Only attach when the user expressed screenshot intent.
    //   - If capture succeeded (screenshotRef is non-null), use it.
    //   - If capture failed (screenshotFailedRef), note it in the description.
    const capturedDataUrl = screenshotRef.current;
    const captureFailed = screenshotFailedRef.current;

    let screenshotDataUrl: string | null = null;
    let screenshotTag = '';

    if (screenshotIntent) {
      if (capturedDataUrl) {
        screenshotDataUrl = capturedDataUrl;
        // No extra tag needed — screenshot is attached.
      } else if (captureFailed) {
        screenshotTag = '\n\n(截图失败) 用户在语音中提到截图，但 html2canvas 截图时出错。';
      } else {
        screenshotTag = '\n\n[有截图意图] 用户在语音中提到截图。';
      }
    }

    const description = `[mobile-voice] ${transcribedText.trim()}${screenshotTag}`;

    const payload = {
      description,
      url: typeof window !== 'undefined' ? window.location.href : '',
      route: typeof window !== 'undefined' ? window.location.pathname : '/me',
      viewport: typeof window !== 'undefined' ? { w: window.innerWidth, h: window.innerHeight } : { w: 0, h: 0 },
      user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      ts: new Date().toISOString(),
      screenshot_data_url: screenshotDataUrl,
      screenshot_filename: screenshotDataUrl ? 'screenshot.png' : null,
      screenshots: screenshotDataUrl
        ? [{ data_url: screenshotDataUrl, filename: 'screenshot.png' }]
        : [],
    };

    try {
      const r = await fetch(deskApi('/api/v1/admin/bugs'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const j = await r.json().catch(() => ({} as { error?: string }));
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
    } catch (err) {
      setPhase('error');
      setStatusMsg(`提交失败：${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    // Short summary for confirmation — first 60 chars of the transcribed text.
    const summary = transcribedText.length > 60 ? transcribedText.slice(0, 60) + '…' : transcribedText;
    setDone({ summary, screenshotAttached: !!screenshotDataUrl });
    setPhase('done');
    setStatusMsg('');
  }

  const isRecording = phase === 'recording';

  return (
    <>
      {/* Entry button — rendered inline in the 我 tab card */}
      <button
        type="button"
        className="m-btn-secondary voice-bug-btn"
        onClick={() => void openModal()}
        aria-label="语音报bug"
      >
        <MicIcon />
        语音报bug
      </button>

      {open && (
        <div
          className="bug-fab-backdrop"
          onClick={() => !isRecording && phase !== 'transcribing' && phase !== 'filing' && close()}
          role="presentation"
        >
          <div
            className="bug-fab-sheet"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="语音报bug"
          >
            <div className="bug-fab-sheet-grip" />
            <div className="bug-fab-sheet-title">语音报bug</div>

            <div className="voice-bug-body">
              {phase === 'idle' && (
                <>
                  <p className="voice-bug-hint">按住麦克风，说出遇到的问题。</p>
                  <p className="voice-bug-hint muted">说「截图」「截屏」可附上当前截图。</p>
                  <button
                    type="button"
                    className="voice-bug-mic-btn"
                    onClick={() => void startRecording()}
                    aria-label="开始录音"
                  >
                    <MicIcon size={32} />
                  </button>
                </>
              )}

              {phase === 'recording' && (
                <>
                  <div className="voice-bug-recording-indicator" aria-live="polite">
                    <span className="voice-bug-dot" />
                    录音中…
                  </div>
                  <button
                    type="button"
                    className="voice-bug-mic-btn voice-bug-mic-btn--recording"
                    onClick={stopRecording}
                    aria-label="停止录音"
                  >
                    <StopIcon size={32} />
                  </button>
                  <p className="voice-bug-hint muted">点击停止</p>
                </>
              )}

              {(phase === 'transcribing' || phase === 'filing') && (
                <div className="voice-bug-status" aria-live="polite">
                  <span className="voice-bug-spinner" aria-hidden="true" />
                  {statusMsg}
                </div>
              )}

              {phase === 'done' && done && (
                <div className="voice-bug-done" aria-live="polite">
                  <div className="voice-bug-done-icon">✓</div>
                  <div className="voice-bug-done-text">
                    已记录：{done.summary}
                    {done.screenshotAttached
                      ? <span className="voice-bug-done-meta">（含截图）</span>
                      : null
                    }
                  </div>
                </div>
              )}

              {phase === 'error' && (
                <>
                  <div className="voice-bug-error" role="alert">{statusMsg}</div>
                  <button
                    type="button"
                    className="m-btn-secondary"
                    onClick={() => { setPhase('idle'); setStatusMsg(''); }}
                  >
                    重试
                  </button>
                </>
              )}
            </div>

            {phase !== 'done' && (
              <div className="bug-fab-actions" style={{ justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="m-btn-secondary"
                  onClick={close}
                  disabled={isRecording || phase === 'transcribing' || phase === 'filing'}
                >
                  取消
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// ── Tiny inline SVG icons (no new dep) ────────────────────────────────────
function MicIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3.75a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0v-5a3 3 0 0 0-3-3Z" />
      <path d="M6.25 11.25a5.75 5.75 0 0 0 11.5 0" />
      <path d="M12 17v3.25" />
      <path d="M8.75 20.25h6.5" />
    </svg>
  );
}

function StopIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
    >
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}

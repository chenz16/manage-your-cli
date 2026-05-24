'use client';

/**
 * VoiceBugReport — 语音报bug component for 微作 (mobile).
 *
 * Flow:
 *   1. User taps "语音报bug" button.
 *   2. Holds microphone button to record (tap-once-to-start / tap-again-to-stop
 *      model, matching the desk ComposerMicButton UX).
 *   3. Audio blob → base64 → POST /api/v1/connectors/voice/transcribe (reuses
 *      desk BFF via the next.config.ts rewrite / deskApi() in Capacitor).
 *   4. Keyword scan: if transcribed text contains screenshot intent
 *      (截图/截屏/带图/screenshot) we capture lightweight context
 *      (route + note) in lieu of a real DOM screenshot — html2canvas is NOT
 *      in the workspace so DOM capture is deferred. The intent keyword is
 *      preserved in the bug description so the Secretary / dev knows to ask
 *      for a manual screenshot if needed.
 *   5. POST /api/v1/admin/bugs (existing desk endpoint) with description
 *      = "[mobile-voice] <text>", route, viewport, ts.
 *   6. Confirm to user: "已记录：<short summary>" (+ "（含截图意图）" when
 *      screenshot keyword was detected).
 *
 * Secretary visibility: the bug lands in the `bugs/<id>/` disk store that
 * `listBugsWithStatus()` already reads. No new integration needed — the desk
 * BugQueue on /me surfaces it, and the Secretary sees it the next time the
 * owner says "扫一下 bug" in chat.
 *
 * Screenshot note (deferred): html2canvas was checked — NOT in the workspace.
 * A native Capacitor screenshot plugin was explicitly ruled out (no new native
 * deps). DOM capture is therefore deferred. The bug description tags [有截图意图]
 * so it's reviewable. Tracked as: feat/voice-bugreport screenshot-v2.
 *
 * SSR-safe: all MediaRecorder / window / navigator access is gated behind
 * useEffect / event handlers (never at module load). No top-level Capacitor
 * plugin import. No API keys.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { deskApi } from '../_lib/desk-api';

// ── Screenshot-intent keyword detection ───────────────────────────────────
// Returns true when the user's words express screenshot intent.
function hasScreenshotIntent(text: string): boolean {
  return /截图|截屏|带图|with.*screenshot|screenshot/i.test(text);
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
  screenshotIntent: boolean;
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

  // ── Start recording ──────────────────────────────────────────────────────
  async function startRecording() {
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
        void handleRecordingDone(mime);
      };
      recorder.start();
    } catch (err) {
      setPhase('error');
      setStatusMsg(`无法访问麦克风：${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── Stop recording ───────────────────────────────────────────────────────
  function stopRecording() {
    const rec = recorderRef.current;
    if (!rec || rec.state === 'inactive') return;
    setPhase('transcribing');
    setStatusMsg('转录中…');
    rec.stop();
    // MediaRecorder.onstop fires → handleRecordingDone.
  }

  // ── Transcribe + file ────────────────────────────────────────────────────
  async function handleRecordingDone(mime: string) {
    const chunks = chunksRef.current;
    if (chunks.length === 0) {
      setPhase('error');
      setStatusMsg('没有录到音频，请重试');
      return;
    }
    const blob = new Blob(chunks, { type: mime });
    chunksRef.current = [];

    // Cleanup stream — done recording.
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }

    // Transcribe.
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

    // Detect screenshot intent.
    const wantsScreenshot = hasScreenshotIntent(text);

    // File the bug.
    setPhase('filing');
    setStatusMsg('提交中…');
    await fileBug(text, wantsScreenshot);
  }

  // ── File the bug via /api/v1/admin/bugs ──────────────────────────────────
  async function fileBug(transcribedText: string, screenshotIntent: boolean) {
    // Build description. Append a [有截图意图] tag when user said screenshot so
    // the Secretary / dev knows to ask for the manual capture.
    // html2canvas is not available → no DOM screenshot in v1.
    const screenshotTag = screenshotIntent ? '\n\n[有截图意图] 用户在语音中提到截图，请在复现时手动截图。' : '';
    const description = `[mobile-voice] ${transcribedText.trim()}${screenshotTag}`;

    const payload = {
      description,
      url: typeof window !== 'undefined' ? window.location.href : '',
      route: typeof window !== 'undefined' ? window.location.pathname : '/me',
      viewport: typeof window !== 'undefined' ? { w: window.innerWidth, h: window.innerHeight } : { w: 0, h: 0 },
      user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      ts: new Date().toISOString(),
      screenshot_data_url: null,
      screenshot_filename: null,
      screenshots: [],
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
    setDone({ summary, screenshotIntent });
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
        onClick={() => setOpen(true)}
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
                  <p className="voice-bug-hint muted">说「截图」「截屏」可标记截图意图。</p>
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
                    {done.screenshotIntent && <span className="voice-bug-done-meta">（含截图意图）</span>}
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

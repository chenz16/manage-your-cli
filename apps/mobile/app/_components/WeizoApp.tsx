'use client';

// Weizo 微作 — WeChat-style 4-tab mobile shell.
// Tabs: 微信 (chat-first, 小秘 + staff 1:1) | 通讯录 (staff list + profile) |
//        看板 (待办 LEAD → 进行中 → 交付) | 我 (owner identity + persona + disconnect).
// All API calls go through holonApiFetch (proxied to paired desktop).

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ComponentProps,
  type PointerEvent,
  type ReactNode,
  type TouchEvent,
} from 'react';
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAui,
  useMessage,
  useLocalRuntime,
  useThread,
  type ChatModelAdapter,
  type ThreadMessageLike,
} from '@assistant-ui/react';
import {
  loadMessages as loadChatMessages,
  saveMessages as saveChatMessages,
  type CachedMessage,
} from '../_lib/chat-history-cache';
import type {
  Deliverable,
  GetDeliverableResponse,
  GetStaffResponse,
  ListDeliverablesResponse,
  ListStaffResponse,
  Room,
  RoomMember,
  Staff,
  Todo,
  TodoPriority,
  ListTodosResponse,
} from '@holon/api-contract';
import type { PersonaPreset, SkillDescriptor, SkillKind, TeamPack, SecretaryProject } from '@holon/core';
import {
  clearDesktopConnection,
  holonApiFetch,
  installMobileApiFetchProxy,
  normalizeBaseUrl,
  pickLiveBaseUrl,
  readDesktopConnection,
  writeDesktopConnection,
  type MobileDesktopConnection,
} from '../_lib/mobile-runtime';
import { discoverDeskOnLan } from '../_lib/desk-discovery';
import { speak as deviceTtsSpeak, stop as deviceTtsStop, primeAudio as ttsPrimeAudio, type TtsOpts } from '../_lib/tts';
import * as nativeStt from '../_lib/native-stt';
import { deskOrigin } from '../_lib/desk-origin';

// ─── TTS staff context ────────────────────────────────────────────────────────
//
// Provides the Staff record whose TTS config (tts_voice, tts_style, tts_rate,
// reply_language) should be applied when MessageActionStrip calls speak().
//
// - Owner-chat thread: provider supplies the secretary staff record.
// - StaffChat thread: MessageActionStrip receives opts directly as a prop.
//
const TtsStaffContext = createContext<Staff | null>(null);

/** Map Staff.reply_language / text content → BCP 47 language tag for TTS. */
function resolveTtsLang(staff: Staff | null, text: string): string {
  const raw = staff?.reply_language ?? 'auto';
  if (raw === 'zh-CN') return 'zh-CN';
  if (raw === 'en') return 'en-US';
  // auto: infer from message text — CJK block presence → zh-CN, else en-US
  return /[一-鿿㐀-䶿]/.test(text) ? 'zh-CN' : 'en-US';
}

/** Map Staff.tts_rate enum → numeric rate for plugin / Web Speech API. */
function resolveTtsRate(staff: Staff | null, fallback: number = 1.0): number {
  const raw = staff?.tts_rate;
  if (raw === 'slow') return 0.7;
  if (raw === 'fast') return 1.3;
  if (raw === 'normal') return 1.0;
  // 'inherit' or absent: use the provided fallback (normally 1.0 for secretary,
  // and callers for employees fall back to the secretary rate).
  return fallback;
}

/** Build TtsOpts from a Staff record and the text being spoken. */
function buildTtsOpts(staff: Staff | null, text: string): TtsOpts {
  return {
    lang: resolveTtsLang(staff, text),
    rate: resolveTtsRate(staff),
  };
}

// ─── Chat auto-scroll hook ────────────────────────────────────────────────────
//
// useChatAutoScroll — "stick to bottom unless user scrolled up" pattern.
// Returns a ref to attach to the scroll container.
//
// Scroll triggers:
//   - on every `deps` change (new messages, streamed tokens) — only if
//     already near bottom ("stick to bottom") or if forceNext.current is set
//   - imperatively via scrollToBottom() — used on send / focus / keyboard open
//
// SSR safe: all DOM access is inside effects / event listeners (never at
// module load time). visualViewport is guarded behind typeof checks.

function useChatAutoScroll<T extends HTMLElement>(deps: ReadonlyArray<unknown>) {
  const scrollRef = useRef<T>(null);
  const stuckRef = useRef(true);     // true = at bottom (stick mode)
  const forceRef = useRef(false);    // true = force-scroll on next render regardless

  // Scroll the container to the very bottom.
  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollRef.current;
    if (!el) return;
    if (smooth) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    } else {
      el.scrollTop = el.scrollHeight;
    }
    stuckRef.current = true;
  }, []);

  // On scroll: update stuckRef so we know whether the user has scrolled up.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    function onScroll() {
      if (!el) return;
      const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      stuckRef.current = distFromBottom < 80;
    }
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // On deps change: scroll only if stuck or forced.
  useEffect(() => {
    if (stuckRef.current || forceRef.current) {
      forceRef.current = false;
      scrollToBottom();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, scrollToBottom]);

  // On visualViewport resize (keyboard open/close on Android/iOS).
  // Force-scroll to bottom so the latest message stays visible.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.visualViewport) return;
    function onVVChange() {
      scrollToBottom();
    }
    window.visualViewport.addEventListener('resize', onVVChange);
    window.visualViewport.addEventListener('scroll', onVVChange);
    return () => {
      window.visualViewport!.removeEventListener('resize', onVVChange);
      window.visualViewport!.removeEventListener('scroll', onVVChange);
    };
  }, [scrollToBottom]);

  return { scrollRef, scrollToBottom, forceRef };
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface StreamEvent {
  type: 'text' | 'done' | 'error' | string;
  text?: string;
  finalText?: string;
  message?: string;
}

type TabKey = 'chats' | 'contacts' | 'work' | 'me';
type StaffChatMessage = { role: 'user' | 'assistant'; content: string };
type BadgedTabKey = 'chats' | 'work';

/** SecretaryProject with inlined staff record from the API response. */
interface SecretaryProjectWithStaff extends SecretaryProject {
  secretary_staff: Staff | null;
}

/** A pending attachment chosen by the user, before/after upload. */
interface PendingAttachment {
  /** Local object URL (for image preview) or null for non-image files. */
  previewUrl: string | null;
  /** Original file name from the picker. */
  filename: string;
  /** MIME type reported by the browser. */
  mime: string;
  /** File size in bytes. */
  size: number;
  /** Raw file data (base64 without prefix) — populated by readFileBase64. */
  base64: string;
  /** Absolute desk path — set after a successful upload. */
  deskPath: string | null;
  /** Upload state. */
  uploadState: 'pending' | 'uploading' | 'done' | 'error';
  /** Error message if uploadState === 'error'. */
  uploadError: string | null;
}

interface OwnerProfile {
  owner_name?: string;
  owner_role?: string;
  owner_intro?: string;
  language_preference?: 'en' | 'zh-CN' | 'auto';
}
interface OwnerSnapshot {
  owner?: { name?: string; role?: string; intro?: string };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<Deliverable['status'], string> = {
  draft: '草稿',
  final: '完成',
  accepted: '已接受',
  rejected: '已拒绝',
  revised: '已修改',
};

function excerpt(text: string, limit = 96): string {
  const s = text.split(/\r?\n/)[0]?.trim() ?? '';
  return s.length > limit ? `${s.slice(0, limit - 1)}…` : s;
}

function bodyText(body: Deliverable['body']): string {
  if (body && typeof body === 'object' && 'markdown' in body && typeof body.markdown === 'string') {
    return body.markdown;
  }
  if (typeof body === 'string') return body;
  return JSON.stringify(body, null, 2);
}

function substrateIcon(staff: Staff): string {
  const k = staff.substrate.kind;
  if (k === 'cli' || k === 'cli_agent') return '⌨️';
  if (k === 'peer') return '👤';
  return '🤖';
}

function flattenText(content: ReadonlyArray<{ type: string; text?: unknown }>): string {
  return content
    .map((part) => (part.type === 'text' && typeof part.text === 'string' ? part.text : ''))
    .filter(Boolean)
    .join('\n\n');
}

interface TranscribeResponse {
  text?: string;
  error?: string;
  message?: string;
}

type RecordingState = 'idle' | 'recording' | 'transcribing';

function recorderMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  const preferred = 'audio/webm;codecs=opus';
  return MediaRecorder.isTypeSupported(preferred) ? preferred : undefined;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('录音读取失败。'));
    reader.onloadend = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const [, base64 = ''] = result.split(',', 2);
      if (base64) resolve(base64);
      else reject(new Error('录音为空。'));
    };
    reader.readAsDataURL(blob);
  });
}

function insertTranscriptIntoComposer(transcript: string, autoSend = false): void {
  const ta = document.querySelector<HTMLTextAreaElement>('.mobile-chat-composer .chat-input');
  if (!ta) return;
  const next = ta.value ? `${ta.value} ${transcript}` : transcript;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
  setter?.call(ta, next);
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  if (autoSend) {
    // 语音:识别完直接提交,owner 不用再按 ↑(那会把软键盘又弹出来)。延后一拍,
    // 让 assistant-ui 的受控 state 先吃到上面的 input 事件,再 requestSubmit。
    const form = ta.closest('form');
    window.setTimeout(() => { form?.requestSubmit(); }, 0);
  } else {
    ta.focus();
  }
}

// ─── Attachment helpers ───────────────────────────────────────────────────────

interface UploadResponse {
  path?: string;
  filename?: string;
  mime?: string;
  size?: number;
  error?: string;
  message?: string;
}

/** Read a File object as base64 string (without the data-URL prefix). */
function readFileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('文件读取失败。'));
    reader.onloadend = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const [, b64 = ''] = result.split(',', 2);
      if (b64) resolve(b64);
      else reject(new Error('文件内容为空。'));
    };
    reader.readAsDataURL(file);
  });
}

/** Format bytes as a human-readable size string. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Upload a PendingAttachment to the desk and return the absolute path. */
async function uploadAttachmentToDesk(
  attachment: PendingAttachment,
): Promise<string> {
  const res = await holonApiFetch('/api/v1/uploads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename: attachment.filename,
      mime: attachment.mime,
      base64: attachment.base64,
    }),
  });
  const data = await res.json().catch(() => ({})) as UploadResponse;
  if (!res.ok || typeof data.path !== 'string') {
    throw new Error(data.message ?? `上传失败 (${res.status})`);
  }
  return data.path;
}

/** Build the text annotation to append to the user message. */
function attachmentAnnotation(filename: string, deskPath: string): string {
  return `\n[附件: ${filename} → ${deskPath}]`;
}

// ─── Attachment button + preview ─────────────────────────────────────────────

/**
 * MobileAttachButton — a "+" button that opens a file picker and calls
 * onAttach with the selected file's data.
 *
 * SSR-safe: the hidden file input is rendered client-side only (no
 * FileReader at module load); all DOM/File access is inside event handlers.
 */
function MobileAttachButton({
  onAttach,
  disabled,
}: {
  onAttach: (attachment: PendingAttachment) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  function handleClick() {
    inputRef.current?.click();
  }

  async function handleChange(ev: ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0];
    // Reset the input so the same file can be re-selected after removal.
    if (inputRef.current) inputRef.current.value = '';
    if (!file) return;

    const isImage = file.type.startsWith('image/');
    const previewUrl = isImage ? URL.createObjectURL(file) : null;

    // Read base64 immediately so the file handle stays valid.
    let base64 = '';
    try {
      base64 = await readFileBase64(file);
    } catch {
      // If reading fails, deliver an attachment in error state — the UI
      // will show the error and the user can remove it.
      onAttach({
        previewUrl,
        filename: file.name,
        mime: file.type || 'application/octet-stream',
        size: file.size,
        base64: '',
        deskPath: null,
        uploadState: 'error',
        uploadError: '文件读取失败，请重试。',
      });
      return;
    }

    onAttach({
      previewUrl,
      filename: file.name,
      mime: file.type || 'application/octet-stream',
      size: file.size,
      base64,
      deskPath: null,
      uploadState: 'pending',
      uploadError: null,
    });
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,.pdf,.txt,.md,.doc,.docx,.csv,.xlsx"
        aria-hidden="true"
        tabIndex={-1}
        style={{ display: 'none' }}
        onChange={(ev) => void handleChange(ev)}
      />
      <button
        type="button"
        className="mobile-attach-button"
        aria-label="添加附件"
        disabled={disabled}
        onClick={handleClick}
      >
        +
      </button>
    </>
  );
}

/**
 * AttachmentPreviewBar — shows the pending attachment above the send button row.
 * Renders a small image thumbnail for images, or a file chip for other types.
 */
function AttachmentPreviewBar({
  attachment,
  onRemove,
}: {
  attachment: PendingAttachment;
  onRemove: () => void;
}) {
  const isImage = attachment.mime.startsWith('image/');
  const stateLabel =
    attachment.uploadState === 'uploading' ? '上传中…' :
    attachment.uploadState === 'error' ? `上传失败: ${attachment.uploadError ?? ''}` :
    attachment.uploadState === 'done' ? '已上传' :
    '待发送';

  return (
    <div className="attachment-preview-bar">
      {isImage && attachment.previewUrl ? (
        <img
          src={attachment.previewUrl}
          alt={attachment.filename}
          className="attachment-preview-image"
        />
      ) : (
        <span className="attachment-file-icon" aria-hidden="true">📄</span>
      )}
      <div className="attachment-preview-info">
        <span className="attachment-preview-name" title={attachment.filename}>
          {attachment.filename}
        </span>
        <span className="attachment-preview-meta">
          {formatBytes(attachment.size)} · {stateLabel}
        </span>
      </div>
      <button
        type="button"
        className="attachment-remove-btn"
        aria-label="移除附件"
        onClick={onRemove}
      >
        ✕
      </button>
    </div>
  );
}

// ── Native STT state (no pre-probe needed — permission-first try-anyway) ─────
// nativeSttGaveUpCache = true only after start() itself throws NO_RECOGNIZER,
// meaning the device genuinely has no recognizer. Persists across re-renders.
let nativeSttGaveUpCache = false;

function MobileVoiceRecorderButton({ onTranscript }: { onTranscript?: (text: string) => void }) {
  const [state, setState] = useState<RecordingState>('idle');
  const [hint, setHint] = useState('');
  // partial text shown while native STT is listening
  const [partialText, setPartialText] = useState('');
  // true once start() itself confirmed no recognizer on device
  const [nativeGaveUp, setNativeGaveUp] = useState(nativeSttGaveUpCache);

  // Fallback (desk-transcribe) refs — used only when native is confirmed absent.
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const pointerIdRef = useRef<number | null>(null);
  const stopPendingRef = useRef(false);
  // Track whether native STT is in flight so stop() can cancel it.
  const nativeSttActiveRef = useRef(false);

  function showHint(message: string) {
    setHint(message);
    window.setTimeout(() => setHint((current) => (current === message ? '' : current)), 4500);
  }

  function deliverTranscript(text: string) {
    if (onTranscript) onTranscript(text);
    else insertTranscriptIntoComposer(text, getVoiceAutoSend()); // 语音→直接发送 or 先填入可编辑
  }

  // ── PRIMARY: native on-device STT ─────────────────────────────────────────
  // Permission-first; attempt start() even when available()=false (Samsung/AOSP
  // devices often report false but the recognizer actually works).

  async function startNativeStt(ev: PointerEvent<HTMLButtonElement>) {
    ev.preventDefault();
    if (state !== 'idle') return;
    pointerIdRef.current = ev.pointerId;
    ev.currentTarget.setPointerCapture(ev.pointerId);
    // iOS WKWebView audio-autoplay gate: unlock here while we still have a real
    // user gesture, so the auto-TTS that fires async after the reply lands can
    // actually play. No-op after first call.
    ttsPrimeAudio();
    setHint('');
    setPartialText('');

    // ① Permission check — STOP here if denied; never fall back for a permission problem.
    const perm = await nativeStt.requestPermission();
    if (perm !== 'granted') {
      showHint('麦克风/语音权限被拒，请在 设置→应用→微作→权限 里允许');
      setState('idle');
      return;
    }

    // ② Start — even if available() says false; some devices still work.
    setState('recording');
    nativeSttActiveRef.current = true;
    try {
      const text = await nativeStt.listen({
        language: 'zh-CN',
        partialResults: true,
        onPartial: (partial) => setPartialText(partial),
      });
      nativeSttActiveRef.current = false;
      setPartialText('');
      setState('idle');
      if (!text) {
        showHint('没有听清，请再试一次。');
        return;
      }
      deliverTranscript(text);
    } catch (err) {
      nativeSttActiveRef.current = false;
      setPartialText('');
      setState('idle');
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === 'PERMISSION_DENIED') {
        // Permission revoked between request and start (race) — treat same as denied.
        showHint('麦克风/语音权限被拒，请在 设置→应用→微作→权限 里允许');
      } else if (msg === 'NO_RECOGNIZER') {
        // Device has no speech recognizer at all — mark permanently and fall back.
        nativeSttGaveUpCache = true;
        setNativeGaveUp(true);
        showHint('没找到语音识别器，请在 设置→通用管理→语言和输入→语音输入 启用「Google 语音输入」');
        // After showing the message, also attempt desk fallback silently.
        await startDeskTranscribeFallback(ev);
      } else {
        // Other native error — show the actual message.
        showHint(msg || '语音识别失败，请重试。');
      }
    }
  }

  function stopNativeStt(ev: PointerEvent<HTMLButtonElement>) {
    ev.preventDefault();
    if (pointerIdRef.current === ev.pointerId) pointerIdRef.current = null;
    if (nativeSttActiveRef.current) {
      // Signal native recognizer to finish and return result.
      void nativeStt.stop();
    }
  }

  // ── FALLBACK: getUserMedia + desk-transcribe (only when native confirmed absent) ──

  function cleanupStream() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  async function transcribeViaDesk(blob: Blob, mime: string) {
    setState('transcribing');
    const base64 = await blobToBase64(blob);
    const res = await holonApiFetch('/api/v1/connectors/voice/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base64, mime, language: 'zh' }),
    });
    const data = await res.json().catch(() => ({})) as TranscribeResponse;
    if (!res.ok) throw new Error(data.message ?? `转写失败 (${res.status})`);
    if (data.error) {
      if (data.error === 'no_stt_provider') {
        // Make clear: the problem started with the device, not with the desk.
        throw new Error('手机语音识别不可用，且桌面未配置 STT');
      }
      throw new Error(data.message ?? data.error);
    }
    const text = typeof data.text === 'string' ? data.text.trim() : '';
    if (!text) {
      showHint('没有听清，请再试一次。');
      return;
    }
    deliverTranscript(text);
  }

  function stopDeskRecording() {
    const recorder = recorderRef.current;
    if (!recorder) {
      stopPendingRef.current = state === 'recording';
      return;
    }
    if (recorder.state !== 'inactive') recorder.stop();
  }

  async function startDeskTranscribeFallback(ev: PointerEvent<HTMLButtonElement>) {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      showHint('这个浏览器不支持录音。');
      setState('idle');
      return;
    }
    pointerIdRef.current = ev.pointerId;
    ev.currentTarget?.setPointerCapture(ev.pointerId);
    setHint('');
    setState('recording');
    stopPendingRef.current = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const mimeType = recorderMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const chunks = chunksRef.current;
        const mime = recorder.mimeType || mimeType || 'audio/webm';
        chunksRef.current = [];
        recorderRef.current = null;
        cleanupStream();
        if (chunks.length === 0) {
          showHint('没有录到声音。');
          setState('idle');
          return;
        }
        void transcribeViaDesk(new Blob(chunks, { type: mime }), mime)
          .catch((error: unknown) => {
            showHint(error instanceof Error ? error.message : '语音转写失败。');
          })
          .finally(() => setState('idle'));
      };
      recorder.onerror = () => {
        cleanupStream();
        recorderRef.current = null;
        setState('idle');
        showHint('录音失败，请重试。');
      };
      recorder.start();
      if (stopPendingRef.current) {
        stopPendingRef.current = false;
        stopDeskRecording();
      }
    } catch (error) {
      cleanupStream();
      setState('idle');
      const name = error instanceof DOMException ? error.name : '';
      showHint(name === 'NotAllowedError' || name === 'PermissionDeniedError'
        ? '麦克风权限被拒绝。'
        : '无法启动麦克风。');
    }
  }

  function releaseDeskPointer(ev: PointerEvent<HTMLButtonElement>) {
    ev.preventDefault();
    if (pointerIdRef.current === ev.pointerId) pointerIdRef.current = null;
    stopDeskRecording();
  }

  // ── Unified press / release handlers ─────────────────────────────────────
  // Always try native first unless we have confirmed the device has no recognizer.

  function onPointerDown(ev: PointerEvent<HTMLButtonElement>) {
    if (nativeGaveUp) {
      void startDeskTranscribeFallback(ev);
    } else {
      void startNativeStt(ev);
    }
  }

  function onPointerUp(ev: PointerEvent<HTMLButtonElement>) {
    if (nativeGaveUp) {
      releaseDeskPointer(ev);
    } else {
      stopNativeStt(ev);
    }
  }

  // ── Hint text during recording ────────────────────────────────────────────

  const recordingHint = nativeGaveUp
    ? '正在录音，松开转写'
    : (partialText || '正在聆听…');

  return (
    <div className="mobile-voice-control">
      <button
        type="button"
        className={`mobile-voice-button${state === 'recording' ? ' is-recording' : ''}`}
        aria-label={state === 'recording' ? '松开结束' : '按住说话'}
        disabled={state === 'transcribing'}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onContextMenu={(ev) => ev.preventDefault()}
      >
        {state === 'transcribing' ? (
          '…'
        ) : (
          <svg
            className="mobile-voice-icon"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="22" />
          </svg>
        )}
      </button>
      {(state === 'recording' || state === 'transcribing' || hint) && (
        <span className="mobile-voice-hint" role="status">
          {state === 'recording' ? recordingHint : state === 'transcribing' ? '正在转写…' : hint}
        </span>
      )}
    </div>
  );
}

// ─── Global TTS state — one message playing at a time ────────────────────────
// playingId is tracked in module scope (not React state) so all MessageActionStrip
// instances can coordinate without prop-drilling.
const ttsGlobal = { playingId: null as string | null };

// SVG icon primitives (single-color, 16×16, currentColor). No emoji.
function IconSpeaker() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
    </svg>
  );
}
function IconStop() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="4" y="4" width="16" height="16" rx="2"/>
    </svg>
  );
}
function IconCopy() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
    </svg>
  );
}

// Tap-bubble → action strip (朗读 + 复制) with 3s auto-dismiss.
// Long-press → WeChat-style context menu.
// ttsOptsOverride: callers that already have the Staff object (StaffChat) can
// pass pre-built opts directly; owner-chat reads them from TtsStaffContext.
function MessageActionStrip({
  id,
  text,
  ttsOptsOverride,
}: {
  id: string;
  text: string;
  ttsOptsOverride?: TtsOpts;
}) {
  const contextStaff = useContext(TtsStaffContext);
  const [showStrip, setShowStrip] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [ttsState, setTtsState] = useState<'idle' | 'loading' | 'playing' | 'error'>('idle');
  const [copied, setCopied] = useState(false);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isThisPlaying = ttsState === 'playing' || ttsState === 'loading';

  // Auto-dismiss the strip after 3s (not while playing).
  function armDismiss() {
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    if (isThisPlaying) return;
    dismissTimerRef.current = setTimeout(() => {
      setShowStrip(false);
    }, 3000);
  }

  function disarmDismiss() {
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
  }

  // Keep dismiss armed based on playing state.
  useEffect(() => {
    if (isThisPlaying) {
      disarmDismiss();
    } else if (showStrip) {
      armDismiss();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isThisPlaying, showStrip]);

  // Clean up on unmount.
  useEffect(() => {
    return () => {
      disarmDismiss();
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    };
  }, []);

  async function startSpeak() {
    if (!text.trim()) return;
    // Stop whatever is currently playing (global mutex).
    if (ttsGlobal.playingId && ttsGlobal.playingId !== id) {
      try { await deviceTtsStop(); } catch { /* best-effort */ }
    }
    ttsGlobal.playingId = id;
    setTtsState('loading');
    disarmDismiss();
    try {
      // Resolve TTS opts: caller-provided override first (StaffChat passes the
      // employee's staff record opts), then fall back to TtsStaffContext
      // (owner-chat thread sets secretary staff) or plain defaults.
      const opts: TtsOpts = ttsOptsOverride ?? buildTtsOpts(contextStaff, text);
      await deviceTtsSpeak(text, opts);
      setTtsState('idle');
    } catch {
      setTtsState('error');
      setTimeout(() => setTtsState('idle'), 1000);
    } finally {
      if (ttsGlobal.playingId === id) ttsGlobal.playingId = null;
    }
  }

  async function stopSpeak() {
    try { await deviceTtsStop(); } catch { /* best-effort */ }
    if (ttsGlobal.playingId === id) ttsGlobal.playingId = null;
    setTtsState('idle');
    armDismiss();
  }

  function handleTtsClick() {
    if (ttsState === 'playing' || ttsState === 'loading') {
      void stopSpeak();
    } else {
      void startSpeak();
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1000);
    } catch { /* clipboard not available */ }
    armDismiss();
  }

  // Tap bubble: show strip.
  function onBubbleTap() {
    if (showMenu) { setShowMenu(false); return; }
    setShowStrip(true);
    armDismiss();
  }

  // Long press: show context menu instead.
  function onPointerDown() {
    longPressTimerRef.current = setTimeout(() => {
      longPressTimerRef.current = null;
      setShowMenu(true);
      setShowStrip(false);
      disarmDismiss();
    }, 500);
  }

  function onPointerUp() {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }

  const ttsLabel =
    ttsState === 'loading' ? '加载中' :
    ttsState === 'playing' ? '停止' :
    ttsState === 'error' ? '失败' :
    '朗读';
  const ttsIcon = (ttsState === 'playing' || ttsState === 'loading') ? <IconStop /> : <IconSpeaker />;

  return (
    <div
      className="msg-bubble-wrap"
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClick={onBubbleTap}
      onContextMenu={(ev) => ev.preventDefault()}
    >
      {showStrip && (
        <div
          className={`msg-action-strip${isThisPlaying ? ' is-playing' : ''}`}
          onClick={(ev) => ev.stopPropagation()}
        >
          <button
            type="button"
            className={`msg-action-btn${ttsState !== 'idle' ? ' is-active' : ''}${ttsState === 'error' ? ' is-error' : ''}`}
            onClick={handleTtsClick}
            aria-label={ttsLabel}
          >
            {ttsIcon}
            <span>{ttsLabel}</span>
          </button>
          <span className="msg-action-divider" aria-hidden="true" />
          <button
            type="button"
            className={`msg-action-btn${copied ? ' is-active' : ''}`}
            onClick={() => void handleCopy()}
            aria-label={copied ? '已复制' : '复制'}
          >
            <IconCopy />
            <span>{copied ? '已复制' : '复制'}</span>
          </button>
        </div>
      )}
      {showMenu && (
        <div className="msg-context-menu-backdrop" onClick={() => setShowMenu(false)}>
          <div className="msg-context-menu" onClick={(ev) => ev.stopPropagation()}>
            <button
              type="button"
              className="msg-context-menu-item"
              onClick={() => { void handleCopy(); setShowMenu(false); }}
            >
              <IconCopy /><span>复制</span>
            </button>
            <button
              type="button"
              className="msg-context-menu-item"
              onClick={() => {
                setShowMenu(false);
                setShowStrip(true);
                void startSpeak();
              }}
            >
              <IconSpeaker /><span>朗读</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Owner chat (小秘 SSE) ────────────────────────────────────────────────────

function makeMobileOwnerAdapter(projectId?: string | null): ChatModelAdapter {
  return {
    async *run({ messages, abortSignal }) {
      const payload = messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: flattenText(m.content) }));

      let assembled = '';
      try {
        const body: Record<string, unknown> = { messages: payload, client: 'mobile' };
        if (projectId) body.project_id = projectId;
        const response = await holonApiFetch('/api/v1/chat/owner/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: abortSignal,
        });

        if (!response.ok || !response.body) {
          const body = await response.text().catch(() => '');
          yield { content: [{ type: 'text', text: `小秘聊天失败 (${response.status})。${body.slice(0, 180)}` }] };
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let frameEnd = buffer.indexOf('\n\n');
          while (frameEnd !== -1) {
            const frame = buffer.slice(0, frameEnd);
            buffer = buffer.slice(frameEnd + 2);
            frameEnd = buffer.indexOf('\n\n');

            for (const line of frame.split('\n')) {
              if (!line.startsWith('data:')) continue;
              const json = line.slice(5).trim();
              if (!json) continue;
              let event: StreamEvent;
              try {
                event = JSON.parse(json) as StreamEvent;
              } catch {
                continue;
              }
              if (event.type === 'text' && typeof event.text === 'string') {
                assembled = event.text;
                yield { content: [{ type: 'text', text: assembled }] };
              } else if (event.type === 'done' && event.finalText && event.finalText !== assembled) {
                assembled = event.finalText;
                yield { content: [{ type: 'text', text: assembled }] };
              } else if (event.type === 'error') {
                yield { content: [{ type: 'text', text: `小秘错误：${event.message ?? 'stream interrupted'}` }] };
              }
            }
          }
        }
      } catch (error) {
        if (abortSignal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) return;
        yield { content: [{ type: 'text', text: '无法连接已配对的桌面。请确认桌面端正在运行，且手机与电脑在同一网络。' }] };
      }
    },
  };
}

// ─── assistant-ui message components ─────────────────────────────────────────

function UserMsg() {
  return (
    <MessagePrimitive.Root className="chatmsg chatmsg-user">
      <div className="chatmsg-bubble chatmsg-bubble-user">
        <MessagePrimitive.Parts />
      </div>
    </MessagePrimitive.Root>
  );
}

function AssistantMsg() {
  const message = useMessage();
  const text = flattenText(message.content);
  return (
    <MessagePrimitive.Root className="chatmsg chatmsg-assistant">
      <div className="chatmsg-avatar" aria-hidden="true">秘</div>
      <div className="chatmsg-body">
        <div className="chatmsg-bubble chatmsg-bubble-assistant">
          <MessagePrimitive.Parts />
        </div>
        <MessageActionStrip id={message.id} text={text} />
      </div>
    </MessagePrimitive.Root>
  );
}

// ─── @-mention typeahead ──────────────────────────────────────────────────────

function MobileMentionTypeahead({ staff }: { staff: readonly Staff[] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const stateRef = useRef({ open: false, mentionStart: -1 });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = staff.slice();
    if (!q) return base.slice(0, 8);
    return base
      .filter((s) => s.name.toLowerCase().includes(q) || s.role_label.toLowerCase().includes(q))
      .slice(0, 8);
  }, [staff, query]);

  const filteredRef = useRef(filtered);
  filteredRef.current = filtered;
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => { stateRef.current.open = open; }, [open]);

  function insert(s: Staff) {
    const ta = document.querySelector<HTMLTextAreaElement>('.mobile-chat-composer .chat-input');
    if (!ta) return;
    const start = stateRef.current.mentionStart;
    const cursor = ta.selectionStart ?? ta.value.length;
    if (start < 0) return;
    const before = ta.value.slice(0, start);
    const after = ta.value.slice(cursor);
    const insertion = `@${s.name} `;
    const next = before + insertion + after;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(ta, next);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    const newPos = (before + insertion).length;
    ta.setSelectionRange(newPos, newPos);
    ta.focus();
    setOpen(false);
    setQuery('');
    setActive(0);
    stateRef.current.mentionStart = -1;
  }

  useEffect(() => {
    const ta = document.querySelector<HTMLTextAreaElement>('.mobile-chat-composer .chat-input');
    if (!ta) return;
    const input = ta;

    function recompute() {
      const cursor = input.selectionStart ?? input.value.length;
      const before = input.value.slice(0, cursor);
      const at = before.lastIndexOf('@');
      const validStart = at >= 0 && (at === 0 || /\s/.test(before.charAt(at - 1)));
      const token = at >= 0 ? before.slice(at + 1) : '';
      if (validStart && !/\s/.test(token)) {
        stateRef.current.mentionStart = at;
        setQuery(token);
        setOpen(true);
        setActive(0);
      } else if (stateRef.current.open) {
        setOpen(false);
        setQuery('');
        stateRef.current.mentionStart = -1;
      }
    }

    function onKeyDown(ev: KeyboardEvent) {
      if (!stateRef.current.open) return;
      const list = filteredRef.current;
      if (ev.key === 'ArrowDown' && list.length > 0) {
        ev.preventDefault();
        setActive((i) => (i + 1) % list.length);
      } else if (ev.key === 'ArrowUp' && list.length > 0) {
        ev.preventDefault();
        setActive((i) => (i - 1 + list.length) % list.length);
      } else if (ev.key === 'Enter' && list.length > 0) {
        ev.preventDefault();
        ev.stopPropagation();
        insert(list[activeRef.current] ?? list[0]!);
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        setOpen(false);
        setQuery('');
        stateRef.current.mentionStart = -1;
      }
    }

    input.addEventListener('input', recompute);
    input.addEventListener('click', recompute);
    input.addEventListener('keyup', recompute);
    input.addEventListener('keydown', onKeyDown, true);
    return () => {
      input.removeEventListener('input', recompute);
      input.removeEventListener('click', recompute);
      input.removeEventListener('keyup', recompute);
      input.removeEventListener('keydown', onKeyDown, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!open) return null;
  return (
    <div className="mention-menu mobile-mention-menu" role="listbox" aria-label="选择员工">
      {filtered.length === 0 ? (
        <div className="mention-empty">没有匹配的员工"{query}"</div>
      ) : filtered.map((s, i) => (
        <button
          key={s.id}
          type="button"
          role="option"
          aria-selected={i === active}
          className={`mention-item${i === active ? ' active' : ''}`}
          onMouseDown={(ev) => { ev.preventDefault(); insert(s); }}
          onMouseEnter={() => setActive(i)}
        >
          <span className="mention-avatar">{substrateIcon(s)}</span>
          <span className="mention-name">{s.name}</span>
          <span className="mention-role">{s.role_label}</span>
        </button>
      ))}
    </div>
  );
}

// ─── 小秘 chat (owner SSE) ────────────────────────────────────────────────────

/** Rendered inside AssistantRuntimeProvider — seeds the composer then clears. */
function ComposerSeeder({ seed, onSeedConsumed }: { seed: string | null; onSeedConsumed: () => void }) {
  const aui = useAui();
  useEffect(() => {
    if (!seed) return;
    aui.composer().setText(seed);
    onSeedConsumed();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);
  return null;
}

/**
 * OwnerChatVvScroller — rendered inside the chat thread; listens to
 * visualViewport resize/scroll (soft keyboard opening on Android/iOS) and
 * force-scrolls the .mobile-chat-viewport container to bottom.
 * Also handles input focus events on the composer textarea.
 *
 * assistant-ui's ThreadPrimitive.Viewport has its own auto-scroll for new
 * messages.  This component adds only the keyboard-open trigger which
 * assistant-ui does not cover.
 *
 * SSR-safe: all DOM access is inside useEffect (never at module load).
 */
function OwnerChatVvScroller() {
  useEffect(() => {
    function scrollOwnerViewport() {
      const el = document.querySelector<HTMLElement>('.mobile-chat-thread .mobile-chat-viewport');
      if (!el) return;
      el.scrollTop = el.scrollHeight;
    }

    // visualViewport resize = keyboard open/close
    if (typeof window !== 'undefined' && window.visualViewport) {
      window.visualViewport.addEventListener('resize', scrollOwnerViewport);
      window.visualViewport.addEventListener('scroll', scrollOwnerViewport);
    }

    // Also scroll when the chat input receives focus (tap into composer)
    function onFocusIn(ev: FocusEvent) {
      const target = ev.target as HTMLElement | null;
      if (target?.classList.contains('chat-input')) {
        // Small delay so the keyboard has started to open before we scroll
        window.setTimeout(scrollOwnerViewport, 120);
      }
    }
    document.addEventListener('focusin', onFocusIn);

    return () => {
      if (typeof window !== 'undefined' && window.visualViewport) {
        window.visualViewport.removeEventListener('resize', scrollOwnerViewport);
        window.visualViewport.removeEventListener('scroll', scrollOwnerViewport);
      }
      document.removeEventListener('focusin', onFocusIn);
    };
  }, []);
  return null;
}

const OWNER_CHAT_ID = 'owner';

/**
 * OwnerChatHistorySync — rendered inside AssistantRuntimeProvider.
 * Reads the live thread via useThread() and:
 *   1. On mount: seeds from desk transcript (PRIMARY) via
 *      GET /api/v1/chat/history?thread=owner. Falls back to local
 *      cache (offline / desk unreachable) for instant first-paint.
 *   2. On every message array change: persists to local cache (write-through
 *      so offline fallback stays warm).
 * Both operations are SSR-safe (only inside effects).
 *
 * Desk-fetch strategy:
 *   a. Immediately seed from local cache (fast first-paint, may be stale).
 *   b. Fetch desk transcript async. When it arrives and it is longer
 *      than the local cache, call runtime.thread.reset() to replace
 *      the thread WITHOUT triggering the LLM (reset() = state-only).
 */
function OwnerChatHistorySync({ runtime, projectId }: { runtime: ReturnType<typeof useLocalRuntime>; projectId?: string | null | undefined }) {
  const thread = useThread();
  const restoredRef = useRef(false);
  const deskSyncedRef = useRef(false);
  // Chat cache key: project-scoped when projectId present, else legacy 'owner'.
  const chatCacheId = projectId ? `project:${projectId}` : OWNER_CHAT_ID;
  // Desk thread URL: project-scoped or legacy owner.
  const deskThreadParam = projectId ? `project:${projectId}` : 'owner';

  // Step 1: instant first-paint from local cache (offline fallback)
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    const cached = loadChatMessages(chatCacheId);
    if (cached.length === 0) return;
    const seed: ThreadMessageLike[] = cached.map((m) => ({
      role: m.role,
      content: m.content,
    }));
    // reset() re-populates the thread with existing messages without sending to the LLM
    runtime.thread.reset(seed);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Step 2: desk-primary sync — fetch desk transcript, reconcile with local
  useEffect(() => {
    if (deskSyncedRef.current) return;
    deskSyncedRef.current = true;
    holonApiFetch(`/api/v1/chat/history?thread=${encodeURIComponent(deskThreadParam)}`, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) return;
        const data = await res.json().catch(() => ({})) as {
          messages?: Array<{ role?: unknown; content?: unknown }>;
        };
        const raw = Array.isArray(data.messages) ? data.messages : [];
        const deskMsgs: CachedMessage[] = raw
          .filter((m) =>
            (m.role === 'user' || m.role === 'assistant') &&
            typeof m.content === 'string' &&
            (m.content as string).length > 0,
          )
          .map((m) => ({
            role: m.role as 'user' | 'assistant',
            content: m.content as string,
          }));
        if (deskMsgs.length === 0) return;
        // Write-through to local cache (keeps offline fallback fresh)
        saveChatMessages(chatCacheId, deskMsgs);
        // Re-seed if desk has more messages than what is currently displayed
        if (deskMsgs.length > thread.messages.length) {
          const seed: ThreadMessageLike[] = deskMsgs.map((m) => ({
            role: m.role,
            content: m.content,
          }));
          // reset() does NOT trigger the model — safe for restoring history
          runtime.thread.reset(seed);
        }
      })
      .catch(() => {
        // Desk unreachable (offline / not paired) — local cache already shown
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist thread messages to local cache whenever they change (write-through)
  useEffect(() => {
    const msgs = thread.messages;
    if (msgs.length === 0) return;
    const toSave: CachedMessage[] = msgs
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => {
        const text = m.content
          .filter((p): p is { type: 'text'; text: string } => p.type === 'text' && typeof (p as { text?: unknown }).text === 'string')
          .map((p) => (p as { text: string }).text)
          .join('');
        return { role: m.role as 'user' | 'assistant', content: text };
      })
      .filter((m) => m.content.length > 0);
    if (toSave.length > 0) saveChatMessages(chatCacheId, toSave);
  // chatCacheId is stable for the component lifetime (projectId is a prop)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread.messages]);

  // Kimi-mode auto-TTS: speak every new assistant reply once it stops streaming.
  // Secretary streams token-by-token; firing speak() on each chunk would create
  // overlapping audio that interrupts itself. Debounce: only speak after the
  // last message's text has been stable for 1.5s.
  const lastSpokenOwnerIdxRef = useRef<number>(-1);
  const ownerSpeakBaselineRef = useRef(false);
  const ttsDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const msgs = thread.messages;
    if (!ownerSpeakBaselineRef.current && msgs.length > 0) {
      lastSpokenOwnerIdxRef.current = msgs.length - 1;
      ownerSpeakBaselineRef.current = true;
      return;
    }
    if (!getVoiceAutoSend()) return;
    const lastIdx = msgs.length - 1;
    if (lastIdx < 0) return;
    const last = msgs[lastIdx];
    if (!last || last.role !== 'assistant') return;
    const text = last.content
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text' && typeof (p as { text?: unknown }).text === 'string')
      .map((p) => (p as { text: string }).text)
      .join('').trim();
    if (!text) return;
    // Reset debounce on every update — fires only after 1500ms of no change.
    if (ttsDebounceRef.current) clearTimeout(ttsDebounceRef.current);
    ttsDebounceRef.current = setTimeout(() => {
      // Re-check: only speak if this is still a fresh, unspoken message.
      if (lastIdx <= lastSpokenOwnerIdxRef.current) return;
      lastSpokenOwnerIdxRef.current = lastIdx;
      void (async () => {
        try {
          const opts = buildTtsOpts(null, text);
          await deviceTtsSpeak(text, opts);
        } catch { /* best-effort */ }
      })();
    }, 1500);
    return () => {
      if (ttsDebounceRef.current) {
        clearTimeout(ttsDebounceRef.current);
        ttsDebounceRef.current = null;
      }
    };
  }, [thread.messages]);

  return null;
}

/**
 * OwnerAttachAwareSend — wraps the assistant-ui send button with attachment upload.
 * Before letting the send proceed, it uploads any pending attachment and injects
 * the [附件: …] annotation into the composer textarea (via the same DOM-setter
 * pattern used by voice transcription). Then it fires the normal send.
 */
function OwnerAttachAwareSend({
  attachment,
  onAttachmentUpdate,
  onAttachmentClear,
}: {
  attachment: PendingAttachment | null;
  onAttachmentUpdate: (a: PendingAttachment) => void;
  onAttachmentClear: () => void;
}) {
  const aui = useAui();
  const [busy, setBusy] = useState(false);

  async function handleSend() {
    if (busy) return;

    if (attachment && attachment.uploadState !== 'error') {
      setBusy(true);
      let deskPath = attachment.deskPath;
      if (!deskPath) {
        // Upload now
        onAttachmentUpdate({ ...attachment, uploadState: 'uploading' });
        try {
          deskPath = await uploadAttachmentToDesk(attachment);
          onAttachmentUpdate({ ...attachment, deskPath, uploadState: 'done', uploadError: null });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          onAttachmentUpdate({ ...attachment, uploadState: 'error', uploadError: msg });
          setBusy(false);
          return;
        }
      }
      // Inject annotation into the textarea BEFORE assistant-ui reads it.
      const annotation = attachmentAnnotation(attachment.filename, deskPath);
      insertTranscriptIntoComposer(annotation);
      // Small tick to let React flush the textarea value change.
      await new Promise<void>((r) => window.setTimeout(r, 0));
      onAttachmentClear();
      setBusy(false);
    }

    aui.thread().composer().send();
  }

  return (
    <button
      type="button"
      className="chat-send"
      aria-label="发送"
      disabled={busy}
      onClick={() => void handleSend()}
    >
      {busy ? '…' : '↑'}
    </button>
  );
}

// ─── ✨ 技能 — skill panel (composer sheet) ───────────────────────────────────
//
// 组合式: 最近用过(localStorage) + 能用的技能(implemented) + 创建 + 技能库链接(桌面)。
// 手机只放精华;完整库(全 28 个 + 增删改查)在桌面 /skills。点技能 → 把示例填进
// 输入框 → 用户直接发,秘书调用。Owner-confirmed design 2026-05-25.

const RECENT_SKILLS_KEY = 'holon.mobile.recentSkills.v1';
const RECENT_SKILLS_MAX = 5;

const SKILL_KIND_LABELS: Record<SkillKind, string> = {
  office: '办公',
  media: '媒体',
  engineering: '工程',
  communication: '沟通',
  research: '调研',
  ops: '运营',
};

function readRecentSkillIds(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(RECENT_SKILLS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function pushRecentSkillId(id: string): void {
  if (typeof window === 'undefined') return;
  try {
    const next = [id, ...readRecentSkillIds().filter((x) => x !== id)].slice(0, RECENT_SKILLS_MAX);
    window.localStorage.setItem(RECENT_SKILLS_KEY, JSON.stringify(next));
  } catch {
    /* localStorage best-effort */
  }
}

/** Prefill payload for a tapped skill: prefer the first example, fall back to name. */
function skillInvocation(s: SkillDescriptor): string {
  return (s.examples && s.examples[0]) || s.name;
}

function SkillCard({ s, onPick }: { s: SkillDescriptor; onPick: (s: SkillDescriptor) => void }) {
  return (
    <button type="button" className="mobile-skill-card" onClick={() => onPick(s)}>
      <span className="mobile-skill-icon">{s.icon}</span>
      <span className="mobile-skill-name">{s.name}</span>
    </button>
  );
}

function SkillSheet({ onClose, onPick }: { onClose: () => void; onPick: (text: string) => void }) {
  const [skills, setSkills] = useState<SkillDescriptor[]>(() => getCachedSkills());
  const [loadErr, setLoadErr] = useState('');
  const [recentIds, setRecentIds] = useState<string[]>(() => readRecentSkillIds());
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newKind, setNewKind] = useState<SkillKind>('ops');
  const [newDesc, setNewDesc] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState('');

  useEffect(() => {
    holonApiFetch('/api/v1/skills', { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json() as { items?: SkillDescriptor[] };
        const items = Array.isArray(j.items) ? j.items : [];
        setSkills(items);
        setCachedSkills(items);
        setLoadErr('');
      })
      .catch((e) => setLoadErr(e instanceof Error ? e.message : String(e)));
  }, []);

  const implemented = useMemo(() => skills.filter((s) => s.implemented), [skills]);
  const recent = useMemo(
    () => recentIds.map((id) => skills.find((s) => s.id === id)).filter((s): s is SkillDescriptor => !!s),
    [recentIds, skills],
  );

  function pick(s: SkillDescriptor) {
    pushRecentSkillId(s.id);
    setRecentIds(readRecentSkillIds());
    onPick(skillInvocation(s));
  }

  async function createSkill() {
    const name = newName.trim();
    const description = newDesc.trim();
    if (!name || !description) { setSaveErr('名称和描述都要填'); return; }
    setSaving(true);
    setSaveErr('');
    try {
      const r = await holonApiFetch('/api/v1/skills', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, kind: newKind, description }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({})) as { error?: string };
        throw new Error(j.error || `HTTP ${r.status}`);
      }
      const created = await r.json() as SkillDescriptor;
      setSkills((prev) => [...prev, created]);
      setNewName('');
      setNewDesc('');
      setCreating(false);
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  function openLibrary() {
    const base = readDesktopConnection()?.baseUrl;
    if (base) window.open(`${base}/skills`, '_blank');
  }

  return (
    <div className="mobile-sheet-backdrop" onClick={onClose}>
      <div className="mobile-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="mobile-sheet-head">
          <h2 className="mobile-sheet-title">技能</h2>
          <button type="button" className="mobile-sheet-close" onClick={onClose} aria-label="关闭">×</button>
        </div>

        {loadErr && <div className="mobile-error">技能加载失败：{loadErr}</div>}

        {recent.length > 0 && (
          <div className="mobile-skill-section">
            <div className="mobile-skill-section-title">🕘 最近用过</div>
            <div className="mobile-skill-grid">
              {recent.map((s) => <SkillCard key={s.id} s={s} onPick={pick} />)}
            </div>
          </div>
        )}

        <div className="mobile-skill-section">
          <div className="mobile-skill-section-title">✅ 能用的技能</div>
          {implemented.length === 0 && !loadErr ? (
            <div className="mobile-skill-empty">暂无可用技能</div>
          ) : (
            <div className="mobile-skill-grid">
              {implemented.map((s) => <SkillCard key={s.id} s={s} onPick={pick} />)}
            </div>
          )}
        </div>

        {creating ? (
          <div className="mobile-skill-create">
            <input
              className="mobile-skill-input"
              placeholder="技能名称（如：周报总结）"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <select
              className="mobile-skill-input"
              value={newKind}
              onChange={(e) => setNewKind(e.target.value as SkillKind)}
            >
              {(Object.keys(SKILL_KIND_LABELS) as SkillKind[]).map((k) => (
                <option key={k} value={k}>{SKILL_KIND_LABELS[k]}</option>
              ))}
            </select>
            <textarea
              className="mobile-skill-input"
              rows={3}
              placeholder="这个技能做什么、什么时候用"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
            />
            {saveErr && <div className="mobile-error">{saveErr}</div>}
            <div className="mobile-skill-create-actions">
              <button type="button" className="mobile-skill-link" onClick={() => { setCreating(false); setSaveErr(''); }}>取消</button>
              <button type="button" className="mobile-skill-save" disabled={saving} onClick={() => void createSkill()}>
                {saving ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="mobile-skill-row" onClick={() => setCreating(true)}>
            <span className="mobile-skill-row-icon">＋</span>
            <span>创建技能</span>
          </button>
        )}

        <button type="button" className="mobile-skill-row" onClick={openLibrary}>
          <span className="mobile-skill-row-icon">📚</span>
          <span>技能库（桌面）</span>
          <span className="mobile-skill-row-chevron">›</span>
        </button>
      </div>
    </div>
  );
}

// ─── 技能使用统计 (约) ─────────────────────────────────────────────────────────
//
// 近似版 (owner 2026-05-25 选 ①+②, 真相源 ④ MCP skill.invoked 记技术债):
//   ① 交付物标题关键词匹配 ② 我的对话关键词匹配 ③ 本地点击 (localStorage)
// 没有真实调用埋点 — 标"约"。完整/真相去桌面。docs/tech-debt/skill-usage-stats.md
function skillKeywords(s: SkillDescriptor): string[] {
  const ks = new Set<string>();
  ks.add(s.name.toLowerCase());
  for (const t of s.tags ?? []) ks.add(t.toLowerCase());
  // distinctive head noun from the name (e.g. "Slides / PPT" → "ppt")
  for (const part of s.name.split(/[\s/·,，]+/)) {
    const p = part.trim().toLowerCase();
    if (p.length >= 2) ks.add(p);
  }
  return [...ks].filter((k) => k.length >= 2);
}

function SkillUsageView({ onClose, onOpenDesk }: { onClose: () => void; onOpenDesk: (path: string) => void }) {
  const [rows, setRows] = useState<Array<{ id: string; name: string; icon: string; count: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [skRes, dvRes, hxRes] = await Promise.all([
          holonApiFetch('/api/v1/skills', { cache: 'no-store' }),
          holonApiFetch('/api/v1/deliverables', { cache: 'no-store' }).catch(() => null),
          holonApiFetch('/api/v1/chat/history?thread=owner', { cache: 'no-store' }).catch(() => null),
        ]);
        if (!skRes.ok) throw new Error(`技能 HTTP ${skRes.status}`);
        const skills = ((await skRes.json()) as { items?: SkillDescriptor[] }).items ?? [];
        setCachedSkills(skills);
        const delivJson = dvRes && dvRes.ok ? (await dvRes.json()) as { items?: Array<{ title?: string }> } : null;
        if (delivJson?.items) setCachedDeliverables(delivJson.items as Deliverable[]);
        const titles: string[] = delivJson
          ? (delivJson.items ?? []).map((d) => (d.title ?? '').toLowerCase()).filter(Boolean)
          : [];
        const msgs: string[] = hxRes && hxRes.ok
          ? (((await hxRes.json()) as { messages?: Array<{ content?: unknown }> }).messages ?? [])
              .map((m) => (typeof m.content === 'string' ? m.content.toLowerCase() : '')).filter(Boolean)
          : [];
        const taps = readRecentSkillIds();
        const haystack = [...titles, ...msgs];
        const computed = skills.map((s) => {
          const kws = skillKeywords(s);
          let count = 0;
          for (const text of haystack) {
            if (kws.some((k) => text.includes(k))) count += 1;
          }
          if (taps.includes(s.id)) count += 1; // your own taps as a weak signal
          return { id: s.id, name: s.name, icon: s.icon, count };
        }).filter((r) => r.count > 0).sort((a, b) => b.count - a.count);
        if (!cancelled) { setRows(computed); setLoading(false); }
      } catch (e) {
        if (!cancelled) { setErr(e instanceof Error ? e.message : String(e)); setLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const max = rows.length > 0 ? (rows[0]?.count ?? 1) : 1;

  return (
    <div className="mobile-sheet-backdrop" onClick={onClose}>
      <div className="mobile-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="mobile-sheet-head">
          <h2 className="mobile-sheet-title">技能使用 · 约</h2>
          <button type="button" className="mobile-sheet-close" onClick={onClose} aria-label="关闭">×</button>
        </div>
        <div className="mobile-me-note" style={{ marginBottom: 8 }}>
          近似值：按交付标题 + 对话关键词估算，非真实调用次数。
        </div>
        {loading && <div className="mobile-skill-empty">统计中…</div>}
        {err && <div className="mobile-error">{err}</div>}
        {!loading && !err && rows.length === 0 && <div className="mobile-skill-empty">暂无可估算的使用</div>}
        {rows.map((r) => (
          <div key={r.id} className="mobile-usage-row">
            <span className="mobile-usage-icon">{r.icon}</span>
            <span className="mobile-usage-name">{r.name}</span>
            <span className="mobile-usage-bar"><span className="mobile-usage-bar-fill" style={{ width: `${Math.round((r.count / max) * 100)}%` }} /></span>
            <span className="mobile-usage-count">{r.count}</span>
          </div>
        ))}
        <button type="button" className="mobile-skill-row" onClick={() => onOpenDesk('/skills')}>
          <span className="mobile-skill-row-icon">📊</span>
          <span>桌面查看完整</span>
          <span className="mobile-skill-row-chevron">›</span>
        </button>
      </div>
    </div>
  );
}

// ─── Project list (聊天 tab root) ─────────────────────────────────────────────
//
// Shows a WeChat-style list of secretary projects. Each row has:
//   - color dot / secretary avatar letter
//   - project name + secretary name
//   - last message preview from localStorage cache
// Tapping a row → enters that project's chat thread (sets activeProjectId).
// + button top-right → create-project dialog.

function ProjectListTab({
  projects,
  onEnter,
  onProjectCreated,
}: {
  projects: SecretaryProjectWithStaff[];
  onEnter: (projectId: string) => void;
  onProjectCreated: (project: SecretaryProjectWithStaff) => void;
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  async function handleCreate() {
    if (!newName.trim()) return;
    setCreating(true);
    setCreateError('');
    try {
      const r = await holonApiFetch('/api/v1/secretary-projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({})) as { error?: string };
        setCreateError(err.error ?? `创建失败 (${r.status})`);
        return;
      }
      const data = await r.json() as { project?: SecretaryProjectWithStaff };
      if (data.project) {
        onProjectCreated(data.project);
        setNewName('');
        setShowCreate(false);
      }
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : '网络错误');
    } finally {
      setCreating(false);
    }
  }

  function lastMsgPreview(projectId: string): string {
    const msgs = loadChatMessages(`project:${projectId}`);
    if (msgs.length === 0) return '暂无消息';
    const last = msgs[msgs.length - 1];
    if (!last) return '暂无消息';
    const text = last.content.trim();
    return text.length > 60 ? `${text.slice(0, 60)}…` : text;
  }

  return (
    <div className="project-list-tab">
      <div className="project-list-header">
        <span className="project-list-title">聊天</span>
        <button
          type="button"
          className="project-list-add"
          onClick={() => setShowCreate(true)}
          aria-label="新建项目"
        >
          ＋
        </button>
      </div>

      {projects.length === 0 ? (
        <div className="project-list-empty">
          <p>暂无项目</p>
          <button type="button" className="project-list-empty-btn" onClick={() => setShowCreate(true)}>
            新建项目
          </button>
        </div>
      ) : (
        <ul className="project-list-items">
          {projects.map((p) => {
            const avatarLetter = (p.secretary_staff?.name ?? p.name).slice(0, 1).toUpperCase();
            const bgColor = p.color ?? '#4e6ef2';
            return (
              <li key={p.id}>
                <button
                  type="button"
                  className="project-list-row"
                  onClick={() => onEnter(p.id)}
                >
                  <span
                    className="project-list-avatar"
                    style={{ background: bgColor }}
                    aria-hidden="true"
                  >
                    {avatarLetter}
                  </span>
                  <span className="project-list-info">
                    <span className="project-list-name">{p.name}</span>
                    <span className="project-list-sub">
                      {p.secretary_staff?.name ?? '小秘'} · {lastMsgPreview(p.id)}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {showCreate && (
        <div className="project-create-overlay" onClick={() => setShowCreate(false)}>
          <div className="project-create-dialog" onClick={(e) => e.stopPropagation()}>
            <h3 className="project-create-title">新建项目</h3>
            <input
              type="text"
              className="project-create-input"
              placeholder="项目名称"
              value={newName}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleCreate(); }}
              autoFocus
              maxLength={50}
            />
            {createError && <p className="project-create-error">{createError}</p>}
            <div className="project-create-actions">
              <button
                type="button"
                className="project-create-cancel"
                onClick={() => { setShowCreate(false); setCreateError(''); setNewName(''); }}
                disabled={creating}
              >
                取消
              </button>
              <button
                type="button"
                className="project-create-confirm"
                onClick={() => void handleCreate()}
                disabled={creating || !newName.trim()}
              >
                {creating ? '创建中…' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── ProjectSwipeArea ────────────────────────────────────────────────────────
// Single-pane swipe between project chats with finger-follow + opacity crossfade
// on commit. Simpler + more reliable than a 3-pane carousel; React doesn't have
// to re-key sibling components when activeProjectId changes.
function ProjectSwipeArea({
  projects,
  activeProjectId,
  onSwitch,
  renderChat,
}: {
  projects: SecretaryProjectWithStaff[];
  activeProjectId: string | null;
  onSwitch: (nextId: string) => void;
  renderChat: (projectId: string) => ReactNode;
}) {
  const [dragX, setDragX] = useState(0);
  const [animating, setAnimating] = useState(false);
  const dragOrigin = useRef<{ x: number; y: number; locked: 'h' | 'v' | null } | null>(null);
  const hapticFired = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  // Owner: 大拇指 1/2 屏宽就该触发. Width-relative threshold beats fixed px.
  const threshold = width > 0 ? width * 0.5 : 100;
  const hapticAt = width > 0 ? width * 0.25 : 60;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setWidth(el.offsetWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const idx = projects.findIndex((p) => p.id === activeProjectId);
  const n = projects.length;
  const hasNeighbors = n >= 2 && idx >= 0;
  const nextProj = hasNeighbors ? projects[(idx + 1) % n]! : null;
  const prevProj = hasNeighbors ? projects[(idx - 1 + n) % n]! : null;

  function vibrate(ms: number) {
    try { (navigator as { vibrate?: (n: number) => boolean }).vibrate?.(ms); } catch { /* noop */ }
  }

  function reset(snap = true) {
    if (snap) setAnimating(true);
    setDragX(0);
    hapticFired.current = false;
    dragOrigin.current = null;
    if (snap) setTimeout(() => setAnimating(false), 220);
  }

  function commit(direction: 'next' | 'prev') {
    if (projects.length < 2 || idx < 0) { reset(); return; }
    const target = direction === 'next' ? nextProj : prevProj;
    if (!target) { reset(); return; }
    const liveW = containerRef.current?.offsetWidth ?? width ?? 360;
    setAnimating(true);
    setDragX(direction === 'next' ? -liveW : liveW);
    vibrate(20);
    // Animate slide-out + fade. After 200ms, swap project (new chat appears at
    // translateX=0 instantly), then animate fade-in over 150ms.
    setTimeout(() => {
      onSwitch(target.id);
      // Snap to new project position WITHOUT animation, then fade in.
      setAnimating(false);
      setDragX(0);
      hapticFired.current = false;
      dragOrigin.current = null;
    }, 200);
  }

  return (
    <div
      ref={containerRef}
      className="mobile-chat-swipe-area"
      style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column', touchAction: 'pan-y' }}
      onPointerDown={(e) => {
        if (projects.length < 2 || idx < 0) return;
        // Sync width from DOM right now in case ResizeObserver hasn't fired yet
        // — protects against state lag that was causing swipes to bounce.
        const liveW = containerRef.current?.offsetWidth ?? 0;
        if (liveW > 0 && liveW !== width) setWidth(liveW);
        dragOrigin.current = { x: e.clientX, y: e.clientY, locked: null };
        hapticFired.current = false;
      }}
      onPointerMove={(e) => {
        const o = dragOrigin.current;
        if (!o) return;
        const dx = e.clientX - o.x;
        const dy = e.clientY - o.y;
        // Loose horizontal detect: if the move is more horizontal than vertical,
        // treat as swipe. If clearly vertical (dy dominates), don't translate
        // (let ThreadPrimitive's own scroll handle it). No sticky direction lock.
        if (Math.abs(dy) > Math.abs(dx) * 1.5 && Math.abs(dy) > 12) {
          // Vertical scroll dominates — release the swipe attempt.
          setDragX(0);
          return;
        }
        const liveW = containerRef.current?.offsetWidth ?? width ?? 360;
        const clamped = Math.max(-liveW, Math.min(liveW, dx));
        setDragX(clamped);
        const hAt = liveW * 0.25;
        if (!hapticFired.current && Math.abs(dx) >= hAt) {
          hapticFired.current = true;
          vibrate(15);
        } else if (hapticFired.current && Math.abs(dx) < hAt * 0.6) {
          hapticFired.current = false;
        }
      }}
      onPointerUp={(e) => {
        const o = dragOrigin.current;
        if (!o) return;
        const dx = e.clientX - o.x;
        const dy = e.clientY - o.y;
        dragOrigin.current = null;
        // Reject only obvious vertical scrolls; otherwise commit on >= 1/3 width.
        if (Math.abs(dy) > Math.abs(dx) * 1.5 && Math.abs(dy) > 12) { reset(false); return; }
        const liveW = containerRef.current?.offsetWidth ?? width ?? 360;
        const liveThreshold = liveW > 0 ? liveW * 0.33 : 100;
        if (Math.abs(dx) >= liveThreshold) {
          commit(dx < 0 ? 'next' : 'prev');
        } else {
          reset();
        }
      }}
      onPointerCancel={() => { reset(); }}
    >
      {/* Carousel track — three slides side by side, offset by `dragX`. Each slide
          is absolutely positioned at width offsets so layout flexbox isn't fighting
          us. Only the active slide is interactive (composer focus etc); neighbours
          are visual previews. pointer-events:none on neighbours prevents them from
          stealing input. */}
      {/* Single chat pane that follows the finger and crossfades on commit. */}
      <div
        style={{
          flex: 1, minHeight: 0,
          display: 'flex', flexDirection: 'column',
          transform: `translate3d(${dragX}px, 0, 0)`,
          opacity: animating ? Math.max(0, 1 - Math.abs(dragX) / (containerRef.current?.offsetWidth || 360)) : 1,
          transition: animating ? 'transform 200ms ease-out, opacity 200ms ease-out' : 'none',
          willChange: 'transform, opacity',
        }}
      >
        {activeProjectId && renderChat(activeProjectId)}
      </div>
      {/* Peer-name hint that fades in as the user drags toward it. */}
      {dragX !== 0 && hasNeighbors && (
        <div
          style={{
            position: 'absolute', top: '46%',
            ...(dragX < 0 ? { right: 18 } : { left: 18 }),
            background: 'rgba(0,0,0,0.65)', color: '#fff',
            borderRadius: 14, padding: '8px 16px',
            fontSize: 14, fontWeight: 500,
            opacity: Math.min(1, Math.abs(dragX) / ((containerRef.current?.offsetWidth || 360) * 0.5)),
            pointerEvents: 'none', zIndex: 99,
            whiteSpace: 'nowrap',
          }}
        >
          {dragX < 0 ? `→ ${nextProj?.name ?? ''}` : `← ${prevProj?.name ?? ''}`}
        </div>
      )}
    </div>
  );
}

// ─── ProjectChatHeader ────────────────────────────────────────────────────────
// Chat header for the active secretary project. Supports:
//   • Long-press on project name → inline rename (blur/Enter saves, Esc cancels)
//   • ⋯ overflow → action sheet: 重命名 / 删除项目
function ProjectChatHeader({
  projectId,
  projects,
  onBack,
  onRename,
  onDeleted,
  onCreateProject,
}: {
  projectId: string;
  projects: SecretaryProjectWithStaff[];
  onBack: () => void;
  onRename: (id: string, newName: string) => void;
  onDeleted: () => void;
  onCreateProject?: () => void;
}) {
  const proj = projects.find((p) => p.id === projectId);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [renameError, setRenameError] = useState('');
  const [showMenu, setShowMenu] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function startEdit() {
    setEditValue(proj?.name ?? '');
    setRenameError('');
    setEditing(true);
    setShowMenu(false);
    // focus after state flushes
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  async function commitRename() {
    const trimmed = editValue.trim();
    if (!trimmed) { setRenameError('名称不能为空'); return; }
    if (trimmed.length > 50) { setRenameError('最多 50 个字符'); return; }
    try {
      const r = await holonApiFetch(`/api/v1/secretary-projects/${encodeURIComponent(projectId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!r.ok) { setRenameError('重命名失败'); return; }
      onRename(projectId, trimmed);
      setEditing(false);
    } catch {
      setRenameError('网络错误');
    }
  }

  function cancelEdit() {
    setEditing(false);
    setRenameError('');
  }

  function onLongPressStart() {
    longPressTimer.current = setTimeout(() => { startEdit(); }, 500);
  }
  function onLongPressEnd() {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
  }

  async function doDelete() {
    setDeleting(true);
    setDeleteError('');
    try {
      const r = await holonApiFetch(`/api/v1/secretary-projects/${encodeURIComponent(projectId)}`, {
        method: 'DELETE',
      });
      if (r.status === 409) {
        setDeleteError('至少保留 1 个项目');
        setDeleting(false);
        return;
      }
      if (!r.ok) {
        setDeleteError('删除失败');
        setDeleting(false);
        return;
      }
      setShowDeleteConfirm(false);
      onDeleted();
    } catch {
      setDeleteError('网络错误');
      setDeleting(false);
    }
  }

  return (
    <>
      <div className="mobile-chat-header">
        {/* Owner: 聊天 tab 始终是某项目 chat, 没"列表页"可返回. 多于 1 项目时显示
            ‹ 切换上一个; 单项目时不渲染. */}
        {/* No back arrow — owner: 聊天 tab 始终是某项目 chat, 用 swipe 切换. */}
        <span className="mobile-chat-header-title">
          {editing ? (
            <span className="mobile-chat-header-rename-wrap">
              <input
                ref={inputRef}
                type="text"
                className="mobile-chat-header-rename-input"
                value={editValue}
                maxLength={50}
                onChange={(e) => { setEditValue(e.target.value); setRenameError(''); }}
                onBlur={() => { void commitRename(); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); void commitRename(); }
                  if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
                }}
                aria-label="项目名称"
              />
              {renameError && <span className="mobile-chat-header-rename-err">{renameError}</span>}
            </span>
          ) : (
            <>
              <span
                className="mobile-chat-header-name"
                onMouseDown={onLongPressStart}
                onMouseUp={onLongPressEnd}
                onMouseLeave={onLongPressEnd}
                onTouchStart={onLongPressStart}
                onTouchEnd={onLongPressEnd}
                onTouchCancel={onLongPressEnd}
                title="长按重命名"
              >
                {proj?.name ?? '小秘'}
              </span>
              <span className="mobile-chat-header-sub">
                {proj?.secretary_staff?.name ?? '小秘'}
                {projects.length > 1 && (() => {
                  const i = projects.findIndex((p) => p.id === projectId);
                  return (
                    <span className="mobile-chat-header-paging">
                      {projects.map((_, k) => (
                        <span
                          key={k}
                          className={`mobile-chat-header-dot${k === i ? ' is-active' : ''}`}
                          aria-hidden="true"
                        />
                      ))}
                    </span>
                  );
                })()}
              </span>
            </>
          )}
        </span>
        <button
          type="button"
          className="mobile-chat-header-overflow"
          aria-label="更多操作"
          onClick={() => setShowMenu((v) => !v)}
        >
          ⋯
        </button>
      </div>
      {showMenu && (
        <div className="mobile-proj-menu-backdrop" onClick={() => setShowMenu(false)}>
          <div className="mobile-proj-menu-sheet" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="mobile-proj-menu-item" onClick={startEdit}>重命名</button>
            {onCreateProject && (
              <button type="button" className="mobile-proj-menu-item" onClick={() => { setShowMenu(false); onCreateProject(); }}>新建项目</button>
            )}
            <button type="button" className="mobile-proj-menu-item mobile-proj-menu-danger" onClick={() => { setShowMenu(false); setShowDeleteConfirm(true); }}>删除项目</button>
            <button type="button" className="mobile-proj-menu-cancel" onClick={() => setShowMenu(false)}>取消</button>
          </div>
        </div>
      )}
      {showDeleteConfirm && (
        <div className="mobile-proj-menu-backdrop" onClick={() => { if (!deleting) setShowDeleteConfirm(false); }}>
          <div className="mobile-proj-confirm-sheet" onClick={(e) => e.stopPropagation()}>
            <p className="mobile-proj-confirm-msg">确定删除项目「{proj?.name ?? projectId}」?<br />聊天记录会保留。不可恢复.</p>
            {deleteError && <p className="mobile-proj-confirm-err">{deleteError}</p>}
            <div className="mobile-proj-confirm-actions">
              <button type="button" className="mobile-proj-confirm-cancel" disabled={deleting} onClick={() => setShowDeleteConfirm(false)}>取消</button>
              <button type="button" className="mobile-proj-confirm-delete" disabled={deleting} onClick={() => { void doDelete(); }}>
                {deleting ? '删除中…' : '删除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function MobileOwnerChat({
  staff,
  seed,
  onSeedConsumed,
  onComposerActiveChange,
  projectId,
}: {
  staff: readonly Staff[];
  seed: string | null;
  onSeedConsumed: () => void;
  onComposerActiveChange?: (active: boolean) => void;
  projectId?: string | null;
}) {
  const adapter = useMemo(() => makeMobileOwnerAdapter(projectId), [projectId]);
  const runtime = useLocalRuntime(adapter);
  const [mounted, setMounted] = useState(false);
  const [attachment, setAttachment] = useState<PendingAttachment | null>(null);

  // Secretary staff record — used to supply per-staff TTS config (lang/rate)
  // to MessageActionStrip via TtsStaffContext.
  const secretaryStaff = useMemo(
    () => staff.find((s) => s.role_name === 'secretary') ?? null,
    [staff],
  );

  useEffect(() => {
    setMounted(true);
    void holonApiFetch('/api/v1/chat/warm').catch(() => undefined);
  }, []);

  // Revoke object URL on removal to avoid memory leaks.
  function clearAttachment() {
    setAttachment((prev) => {
      if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
      return null;
    });
  }

  return (
    <TtsStaffContext.Provider value={secretaryStaff}>
    <AssistantRuntimeProvider runtime={runtime}>
      <OwnerChatHistorySync runtime={runtime} projectId={projectId} />
      <ComposerSeeder seed={seed} onSeedConsumed={onSeedConsumed} />
      {mounted && <OwnerChatVvScroller />}
      <ThreadPrimitive.Root className="chat-thread mobile-chat-thread">
        <ThreadPrimitive.Viewport className="chat-viewport mobile-chat-viewport">
          <ThreadPrimitive.Empty>
            <div className="chat-empty">
              <div className="chat-empty-title">小秘</div>
              <div className="chat-empty-sub">这里是你的助手。输入 @ 可以选择员工，把任务交给他们。</div>
            </div>
          </ThreadPrimitive.Empty>
          <ThreadPrimitive.Messages components={{ UserMessage: UserMsg, AssistantMessage: AssistantMsg }} />
        </ThreadPrimitive.Viewport>
        {mounted ? (
          <ComposerPrimitive.Root className="chat-composer mobile-chat-composer">
            {attachment && (
              <AttachmentPreviewBar
                attachment={attachment}
                onRemove={clearAttachment}
              />
            )}
            <div className="composer-input-row">
              <MobileVoiceRecorderButton />
              <MobileAttachButton
                onAttach={(a) => setAttachment(a)}
                disabled={attachment !== null}
              />
              <ComposerPrimitive.Input
                rows={1}
                className="chat-input"
                placeholder="发消息给小秘…"
                onFocus={() => {
                  onComposerActiveChange?.(true);
                  void deviceTtsStop().catch(() => { /* noop */ });
                }}
                onBlur={() => onComposerActiveChange?.(false)}
                onChange={() => { void deviceTtsStop().catch(() => { /* noop */ }); }}
              />
              <OwnerAttachAwareSend
                attachment={attachment}
                onAttachmentUpdate={(a) => setAttachment(a)}
                onAttachmentClear={clearAttachment}
              />
            </div>
          </ComposerPrimitive.Root>
        ) : (
          <div className="chat-composer mobile-chat-composer" aria-hidden="true">
            <div className="composer-input-row">
              <button type="button" className="mobile-voice-button" disabled tabIndex={-1}>🎙</button>
              <button type="button" className="mobile-attach-button" disabled tabIndex={-1}>+</button>
              <textarea rows={1} className="chat-input" placeholder="发消息给小秘…" readOnly tabIndex={-1} />
              <button type="button" className="chat-send" disabled tabIndex={-1}>↑</button>
            </div>
          </div>
        )}
        {mounted && <MobileMentionTypeahead staff={staff} />}
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
    </TtsStaffContext.Provider>
  );
}

// ─── Staff 1:1 chat ───────────────────────────────────────────────────────────

function StaffChat({ staff, onBack, embedded }: { staff: Staff; onBack?: () => void; embedded?: boolean }) {
  const staffChatId = `staff:${staff.id}`;
  const [messages, setMessages] = useState<StaffChatMessage[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [attachment, setAttachment] = useState<PendingAttachment | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Reset textarea height when text is cleared (e.g. after send) — otherwise
  // the auto-grow inline height stays at whatever the largest message was.
  useEffect(() => {
    if (!text && inputRef.current) inputRef.current.style.height = '';
  }, [text]);

  // Kimi-style voice chat: when 语音直发 is ON, ALSO auto-read every new
  // assistant reply aloud. Owner: 跟 Kimi 一样,语音聊天就自动读。
  // Anchors on staffChatId so opening a different staff resets the baseline.
  const lastSpokenIdxRef = useRef<number>(-1);
  const baselineSetRef = useRef(false);
  useEffect(() => {
    // First time we see messages for this staff, mark everything as "already
    // seen" so we don't speak the entire history on entry.
    if (!baselineSetRef.current && messages.length > 0) {
      lastSpokenIdxRef.current = messages.length - 1;
      baselineSetRef.current = true;
      return;
    }
    if (!getVoiceAutoSend()) return;
    const lastIdx = messages.length - 1;
    if (lastIdx <= lastSpokenIdxRef.current) return;
    const last = messages[lastIdx];
    if (!last || last.role !== 'assistant') return;
    const content = last.content.trim();
    if (!content) return;
    lastSpokenIdxRef.current = lastIdx;
    // Fire async; ignore failures (TTS is enhancement, not critical).
    void (async () => {
      try {
        const opts = buildTtsOpts(staff, content);
        await deviceTtsSpeak(content, opts);
      } catch { /* best-effort */ }
    })();
  }, [messages, staff]);

  // Reset auto-speak baseline when navigating to a different staff.
  useEffect(() => {
    lastSpokenIdxRef.current = -1;
    baselineSetRef.current = false;
  }, [staffChatId]);

  // Step 1: instant first-paint from local cache (offline fallback)
  // Step 2: desk-primary sync — fetch desk transcript and reconcile, then POLL
  // (every 2.5s) so async-appended messages show up live — e.g. the adopted-CLI
  // front-stage summary that the desk appends ~1-2s after the turn settles.
  useEffect(() => {
    // Immediate: seed from local cache for first-paint
    const cached = loadChatMessages(staffChatId);
    if (cached.length > 0) setMessages(cached);

    const encodedThread = encodeURIComponent(staffChatId);
    let stopped = false;
    async function syncFromDesk() {
      try {
        const res = await holonApiFetch(`/api/v1/chat/history?thread=${encodedThread}`, { cache: 'no-store' });
        if (!res.ok || stopped) return;
        const data = await res.json().catch(() => ({})) as {
          messages?: Array<{ role?: unknown; content?: unknown }>;
        };
        const raw = Array.isArray(data.messages) ? data.messages : [];
        const deskMsgs: StaffChatMessage[] = raw
          .filter((m) =>
            (m.role === 'user' || m.role === 'assistant') &&
            typeof m.content === 'string' &&
            (m.content as string).length > 0,
          )
          .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content as string }));
        if (deskMsgs.length === 0 || stopped) return;
        saveChatMessages(staffChatId, deskMsgs);
        // Desk is source of truth. Adopt when desk has MORE messages OR when
        // the last-message content changed (summarizer wipes a "正在总结…"
        // placeholder with the final story — same count, new text).
        setMessages((current) => {
          if (deskMsgs.length > current.length) return deskMsgs;
          const a = deskMsgs[deskMsgs.length - 1];
          const b = current[current.length - 1];
          if (a && b && a.content !== b.content) return deskMsgs;
          return current;
        });
      } catch {
        // Desk unreachable — local cache already shown, no action needed
      }
    }
    void syncFromDesk();
    const id = window.setInterval(() => void syncFromDesk(), 2500);
    return () => { stopped = true; window.clearInterval(id); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staffChatId]);

  // Persist messages to local cache whenever they change (write-through)
  useEffect(() => {
    if (messages.length === 0) return;
    saveChatMessages(staffChatId, messages);
  }, [messages, staffChatId]);

  // Auto-scroll: stick to bottom unless user scrolled up.
  // deps = [messages, sending] so every new message / "正在回复…" indicator scrolls down.
  const { scrollRef, scrollToBottom, forceRef } = useChatAutoScroll<HTMLDivElement>([messages, sending]);

  // Revoke object URL on removal to avoid memory leaks.
  function clearAttachment() {
    setAttachment((prev) => {
      if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
      return null;
    });
  }

  async function send(overrideText?: string) {
    let content = (overrideText ?? text).trim();
    if ((!content && !attachment) || sending) return;

    // Upload attachment if pending
    if (attachment && attachment.uploadState !== 'error') {
      setSending(true);
      let deskPath = attachment.deskPath;
      if (!deskPath) {
        setAttachment((prev) => prev ? { ...prev, uploadState: 'uploading' } : prev);
        try {
          deskPath = await uploadAttachmentToDesk(attachment);
          setAttachment((prev) => prev ? { ...prev, deskPath, uploadState: 'done', uploadError: null } : prev);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          setAttachment((prev) => prev ? { ...prev, uploadState: 'error', uploadError: msg } : prev);
          setSending(false);
          return;
        }
      }
      content = (content ? content + '\n' : '') + `[附件: ${attachment.filename} → ${deskPath}]`;
      clearAttachment();
    }

    if (!content) { setSending(false); return; }

    const next = [...messages, { role: 'user' as const, content }];
    setMessages(next);
    setText('');
    setError('');
    setSending(true);
    // Force scroll on send regardless of scroll position
    forceRef.current = true;
    try {
      const summarize = getSummaryEnabled(staff.id);
      const res = await holonApiFetch(`/api/v1/staff/${encodeURIComponent(staff.id)}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(summarize ? { messages: next, summarize: true } : { messages: next }),
      });
      const data = await res.json().catch(() => ({})) as { reply?: string; error?: string };
      if (!res.ok || typeof data.reply !== 'string') {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setMessages((current) => [...current, { role: 'assistant', content: data.reply ?? '' }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  return (
    // Provide this employee's staff record as TTS context so MessageActionStrip
    // uses the correct language/rate for each message bubble.
    <TtsStaffContext.Provider value={staff}>
    <div className="mobile-staff-chat">
      {/* thin WeChat-style chat header: ‹ back + name (skipped when embedded
          in StaffDetail — the 聊天|配置 shell provides the bar). */}
      {!embedded && (
        <div className="mobile-chat-header">
          <button type="button" className="mobile-chat-header-back" onClick={onBack} aria-label="返回">‹</button>
          <span className="mobile-chat-header-name">{staff.name}</span>
          <span className="mobile-chat-header-spacer" />
        </div>
      )}
      <div ref={scrollRef} className="mobile-chat-viewport mobile-staff-chat-scroll">
        {messages.length === 0 ? (
          <div className="chat-empty">
            <div className="chat-empty-title">{staff.name}</div>
            <div className="chat-empty-sub">{staff.role_label}</div>
          </div>
        ) : messages.map((m, i) => (
          m.role === 'user' ? (
            <div key={i} className="chatmsg chatmsg-user">
              <div className="chatmsg-bubble chatmsg-bubble-user">{m.content}</div>
            </div>
          ) : (
            <div key={i} className="chatmsg chatmsg-assistant">
              <div className="chatmsg-avatar" aria-hidden="true">{staff.name.slice(0, 1)}</div>
              <div className="chatmsg-body">
                <div className="chatmsg-bubble chatmsg-bubble-assistant">{m.content}</div>
                <MessageActionStrip id={`${staff.id}-${i}`} text={m.content} />
              </div>
            </div>
          )
        ))}
        {sending && (
          <div className="chatmsg chatmsg-assistant">
            <div className="chatmsg-avatar" aria-hidden="true">{staff.name.slice(0, 1)}</div>
            <div className="chatmsg-body">
              <div className="chatmsg-bubble chatmsg-bubble-assistant chat-typing-bubble">
                <span className="chat-typing-dots" aria-label="正在回复">
                  <i /><i /><i />
                </span>
              </div>
            </div>
          </div>
        )}
        {error && <div className="mobile-error">发送失败：{error}</div>}
      </div>
      <div className="chat-composer mobile-chat-composer">
        {attachment && (
          <AttachmentPreviewBar
            attachment={attachment}
            onRemove={clearAttachment}
          />
        )}
        {/* Drag-to-resize handle: a wider, more obvious bar above the input.
            Tap = toggle between default (3-row) and large (60vh). Drag = manual
            sizing. Owner: 要看到能拉大的 affordance + 一键放大。 */}
        <div
          className="chat-input-grab"
          aria-label="拖动或点击放大输入框"
          onClick={() => {
            const el = inputRef.current; if (!el) return;
            const big = Math.floor(window.innerHeight * 0.6);
            const cur = el.getBoundingClientRect().height;
            // toggle: if already enlarged, collapse to natural (clear inline → CSS min-height takes over).
            if (cur >= big - 8) el.style.height = '';
            else el.style.height = big + 'px';
          }}
          onPointerDown={(ev) => {
            const el = inputRef.current; if (!el) return;
            (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
            const startY = ev.clientY;
            const startH = el.getBoundingClientRect().height;
            const maxH = Math.floor(window.innerHeight * 0.7);
            let moved = false;
            const onMove = (e: globalThis.PointerEvent) => {
              const dy = startY - e.clientY;
              if (Math.abs(dy) > 4) moved = true;
              const h = Math.max(40, Math.min(startH + dy, maxH));
              el.style.height = h + 'px';
            };
            const onUp = (e: globalThis.PointerEvent) => {
              try { (ev.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* noop */ }
              window.removeEventListener('pointermove', onMove);
              window.removeEventListener('pointerup', onUp);
              window.removeEventListener('pointercancel', onUp);
              // suppress click toggle if user actually dragged
              if (moved) (ev.currentTarget as HTMLElement).dataset.justDragged = '1';
            };
            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', onUp);
            window.addEventListener('pointercancel', onUp);
          }}
        >
          <span className="chat-input-grab-bar" aria-hidden="true" />
        </div>
        <div className="composer-input-row">
          <MobileVoiceRecorderButton onTranscript={(transcript) => {
            // Honor 语音模式 setting: 直接发送 → send with transcript NOW (don't
            // rely on the next-render's text closure — that read the OLD text);
            // 识别编辑 → just fill the box for review.
            const autoSend = getVoiceAutoSend();
            if (autoSend) {
              setText('');
              void send(transcript);
            } else {
              setText((current) => current ? `${current} ${transcript}` : transcript);
            }
          }} />
          <MobileAttachButton
            onAttach={(a) => setAttachment(a)}
            disabled={attachment !== null}
          />
          <textarea
            ref={inputRef}
            rows={3}
            className="chat-input chat-input-grow"
            value={text}
            onChange={(ev) => {
              setText(ev.target.value);
              // Auto-grow up to ~50% of viewport; past that it scrolls inside.
              // Owner: 默认就要够大,矫正时直接能看见整段。
              const el = ev.target as HTMLTextAreaElement;
              el.style.height = 'auto';
              const cap = Math.max(180, Math.floor(window.innerHeight * 0.5));
              el.style.height = Math.min(el.scrollHeight, cap) + 'px';
            }}
            onKeyDown={(ev) => {
              if (ev.key === 'Enter' && !ev.shiftKey) {
                ev.preventDefault();
                void send();
              }
            }}
            onFocus={() => { forceRef.current = true; scrollToBottom(); }}
            placeholder={`发消息给 ${staff.name}…`}
          />
          <button
            type="button"
            className="chat-send"
            onClick={() => void send()}
            disabled={sending || (!text.trim() && !attachment)}
            aria-label="发送"
          >
            ↑
          </button>
        </div>
      </div>
    </div>
    </TtsStaffContext.Provider>
  );
}

// ─── 通讯录 — contacts tab ────────────────────────────────────────────────────

interface AgentUsage { today_tokens: number; total_tokens: number }

/** A staff member's model/CLI label (claude/codex/…) for the roster + usage row. */
function staffModelLabel(s: Staff): string {
  const sub = s.substrate;
  if (sub?.kind === 'cli_agent' && typeof sub.binary === 'string' && sub.binary) return sub.binary;
  return 'local';
}

const CONTACTS_GROUPS_KEY = 'holon.mobile.contactGroups.v1';

function readContactGroupsState(): Record<string, boolean> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(CONTACTS_GROUPS_KEY);
    return raw ? JSON.parse(raw) as Record<string, boolean> : {};
  } catch { return {}; }
}

function writeContactGroupsState(state: Record<string, boolean>) {
  try { window.localStorage.setItem(CONTACTS_GROUPS_KEY, JSON.stringify(state)); } catch { /* quota */ }
}

function Contacts({
  staff,
  agentUsage,
  onOpen,
  onOpenConfig,
  onRefresh,
  refreshing,
  rooms,
  onOpenRoom,
}: {
  staff: readonly Staff[];
  agentUsage: Record<string, AgentUsage>;
  onOpen: (s: Staff) => void;
  onOpenConfig: (s: Staff) => void;
  onRefresh: () => void;
  refreshing: boolean;
  rooms: Room[];
  onOpenRoom: (r: Room) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const startY = useRef<number | null>(null);
  const armedRef = useRef(false);
  const [pullY, setPullY] = useState(0);
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();

  // task_group collapsible state — persisted in localStorage, defaults to all expanded.
  const [groupsExpanded, setGroupsExpanded] = useState<Record<string, boolean>>(() => readContactGroupsState());

  const TRIGGER_PX = 64;
  const MAX_PULL_PX = 96;
  const DAMPING = 0.55;

  function onTouchStart(e: TouchEvent<HTMLDivElement>) {
    if (refreshing) return;
    const el = scrollRef.current;
    if (el && el.scrollTop > 0) { armedRef.current = false; return; }
    armedRef.current = true;
    startY.current = e.touches[0]?.clientY ?? null;
  }

  function onTouchMove(e: TouchEvent<HTMLDivElement>) {
    if (!armedRef.current || refreshing || startY.current === null) return;
    const dy = (e.touches[0]?.clientY ?? startY.current) - startY.current;
    if (dy <= 0) { setPullY(0); return; }
    setPullY(Math.min(MAX_PULL_PX, dy * DAMPING));
  }

  function onTouchEnd() {
    if (!armedRef.current) return;
    armedRef.current = false;
    const shouldFire = pullY >= TRIGGER_PX;
    startY.current = null;
    setPullY(0);
    if (shouldFire) onRefresh();
  }

  function toggleGroup(groupName: string) {
    setGroupsExpanded((prev) => {
      const next = { ...prev, [groupName]: !(prev[groupName] ?? true) };
      writeContactGroupsState(next);
      return next;
    });
  }

  // Build ordered list of groups (first-seen order), '其他' always last.
  // Owner: 一个人可能在多个 task_group(多团队). Collect ALL task_group: tags from
  // each staff and place that staff in every group they belong to. Fallback to
  // '其他' only when staff has no task_group tags at all.
  const { groupOrder, groupedStaff } = useMemo(() => {
    const orderMap: string[] = [];
    const buckets: Record<string, Staff[]> = {};
    const pushTo = (label: string, s: Staff) => {
      if (!buckets[label]) {
        buckets[label] = [];
        if (label !== '其他') orderMap.push(label);
      }
      buckets[label]!.push(s);
    };
    for (const s of staff) {
      const labels: string[] = [];
      for (const t of s.tags ?? []) {
        if (typeof t === 'string' && t.startsWith('task_group:')) {
          const v = t.slice('task_group:'.length).trim();
          if (v && !labels.includes(v)) labels.push(v);
        }
      }
      if (labels.length === 0) {
        pushTo('其他', s as Staff);
      } else {
        for (const label of labels) pushTo(label, s as Staff);
      }
    }
    if (buckets['其他']?.length) orderMap.push('其他');
    return { groupOrder: orderMap, groupedStaff: buckets };
  }, [staff]);

  // Search filter: flatten across all groups. When searching, bypass group view.
  const filteredFlat = useMemo(() => {
    if (!query) return null; // null = use grouped rendering
    return staff.filter((s) =>
      `${s.name} ${s.role_label ?? ''} ${s.role_name ?? ''} ${(s.tags ?? []).join(' ')}`.toLowerCase().includes(query)
    );
  }, [staff, query]);

  const progress = Math.min(1, pullY / TRIGGER_PX);

  function renderStaffRow(s: Staff) {
    const usage = agentUsage[s.id];
    const model = staffModelLabel(s);
    return (
      <button key={s.id} type="button" className="mobile-row" onClick={() => onOpen(s)}>
        <StaffAvatar staff={s} size={44} />
        <span className="mobile-row-main">
          <span className="mobile-row-title">{s.name}</span>
          {s.role_label && s.role_label !== s.name && (
            <span className="mobile-row-sub">{s.role_label}</span>
          )}
          <span className="mobile-row-usage">
            <span className="mobile-row-model">{model}</span>
            {usage
              ? <span className="mobile-row-tokens">今日 {fmtTokens(usage.today_tokens)} · 累计 {fmtTokens(usage.total_tokens)}</span>
              : <span className="mobile-row-tokens mobile-row-tokens-na">暂无统计</span>}
          </span>
        </span>
        <button
          type="button"
          className="mobile-row-action"
          onClick={(e) => { e.stopPropagation(); onOpenConfig(s); }}
          aria-label={`配置 ${s.name}`}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </button>
      </button>
    );
  }

  return (
    <div
      ref={scrollRef}
      className="mobile-list contacts-scroll"
      style={{ overflowY: 'auto', flex: '1 1 auto', minHeight: 0 }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
    >
      {/* Pull-to-refresh indicator */}
      <div
        className="ptr-indicator"
        style={{ height: refreshing ? 48 : pullY > 0 ? pullY : 0, opacity: refreshing ? 1 : progress, overflow: 'hidden' }}
        aria-hidden={!refreshing && pullY === 0}
      >
        <div className={`ptr-spinner${refreshing ? ' ptr-spinner-spin' : ''}`}
          style={{ transform: refreshing ? undefined : `rotate(${progress * 270}deg)` }} />
      </div>
      {/* WeChat-style: search at the very top, then a flat list (team room +
          employees) sharing one row treatment. Owner: 会议室是员工的一个,不要隔着. */}
      <div className="mobile-search-bar">
        <span className="mobile-search-icon" aria-hidden="true">🔍</span>
        <input
          className="mobile-search-input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜索员工"
          inputMode="search"
        />
        {q && <button type="button" className="mobile-search-clear" onClick={() => setQ('')} aria-label="清除">×</button>}
      </div>
      {/* Team room row — always at top, NOT inside a folder */}
      {(() => {
        // v1: always show the singleton default team room; fetch member count from rooms list.
        const DEFAULT_ID = 'room_default_team';
        const teamRoom = rooms.find((r) => r.id === DEFAULT_ID) ?? rooms[0];
        if (!teamRoom) return null; // skip silently while rooms loads — no awkward "加载中" row
        const memberCount = (teamRoom as Room & { _memberCount?: number })._memberCount ?? staff.filter((s) => s.role_name !== 'secretary').length;
        return (
          <button type="button" className="mobile-row" onClick={() => onOpenRoom(teamRoom)}>
            <span className="mobile-contacts-team-avatar">🏢</span>
            <span className="mobile-row-main">
              <span className="mobile-row-title">{teamRoom.name} · {memberCount} 人</span>
              <span className="mobile-row-sub">团队成员</span>
            </span>
          </button>
        );
      })()}
      {/* Staff list — flat when searching, grouped by task_group otherwise */}
      {staff.length === 0 ? (
        <div className="mobile-empty-panel">还没有员工。</div>
      ) : filteredFlat !== null ? (
        // Search mode: flat list across all groups
        filteredFlat.length === 0 ? (
          <div className="mobile-empty-panel">没有匹配「{q}」的员工。</div>
        ) : (
          filteredFlat.map((s) => renderStaffRow(s))
        )
      ) : (
        // Owner: 员工跟小秘走, 不分 group. 项目里就是项目自己的员工, 直接 flat list.
        // task_group 分组已删, staff 顺序按 first-seen.
        staff.map((s) => renderStaffRow(s))
      )}
    </div>
  );
}

/** Read-only live view of an employee's CLI terminal (tmux screen + scrollback),
 *  mirroring what the desk shows. Snapshot-polls /cli/output every 3s (robust on
 *  Capacitor; avoids the SSE buffering pitfalls). */
// Avatar helpers — a refined gradient circle with a smart initial when there's
// no custom image. Chinese 小X/老X names → use the distinctive 2nd char.
function staffInitial(name: string): string {
  const n = (name ?? '').trim();
  if (!n) return '?';
  if (/^[小老阿大]/.test(n) && n.length > 1) return n.charAt(1);
  return n.charAt(0).toUpperCase();
}
// Curated palette — 8 slightly-muted WeChat-like solid backgrounds (white initial).
// Picked deterministically by hashing the staff id/name index into this list.
const AVATAR_PALETTE = [
  '#5B8FF9', // periwinkle blue
  '#3FB68B', // muted teal-green
  '#F6A04D', // warm amber
  '#9B7BE8', // soft violet
  '#E86A8C', // muted rose
  '#4FB0C6', // sky teal
  '#E0A93B', // golden yellow
  '#7C8AA5', // slate blue-grey
];

function staffPaletteColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  const idx = Math.abs(h) % AVATAR_PALETTE.length;
  return AVATAR_PALETTE[idx]!;
}

/** Darken a hex color by ~12% for the gradient bottom stop. */
function darkenHex(hex: string, amount = 0.12): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const dr = Math.round(r * (1 - amount));
  const dg = Math.round(g * (1 - amount));
  const db = Math.round(b * (1 - amount));
  return `#${dr.toString(16).padStart(2, '0')}${dg.toString(16).padStart(2, '0')}${db.toString(16).padStart(2, '0')}`;
}

/** Refined avatar: custom image if set, else a curated-palette gradient + initial. */
function StaffAvatar({ staff, size = 56, onPick }: { staff: Staff; size?: number; onPick?: () => void }) {
  const custom = (staff as Staff & { avatar_data?: string }).avatar_data;
  const baseColor = staffPaletteColor(staff.id || staff.name);
  const style: React.CSSProperties = custom
    ? { width: size, height: size, backgroundImage: `url(${custom})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : { width: size, height: size, background: `linear-gradient(160deg, ${baseColor} 0%, ${darkenHex(baseColor)} 100%)` };
  return (
    <span
      className="mobile-staff-avatar2"
      style={style}
      onClick={onPick}
      role={onPick ? 'button' : undefined}
      aria-label={onPick ? '更换头像' : undefined}
    >
      {!custom && <span className="mobile-staff-avatar2-initial" style={{ fontSize: size * 0.4 }}>{staffInitial(staff.name)}</span>}
      {onPick && <span className="mobile-staff-avatar2-edit" aria-hidden="true">✎</span>}
    </span>
  );
}

/** Center-crop + resize an image File to a square data URL (keeps avatar_data
 *  small so it fits the ≤256KB cap and renders instantly). */
function resizeImageToDataUrl(file: File, size: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error('canvas unavailable')); return; }
        const s = Math.min(img.width, img.height);
        ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image load failed')); };
    img.src = url;
  });
}

/** Strip claude-TUI chrome from a captured pane so the mobile terminal reads
 *  clean: drop pure box-drawing/rule lines (────, │ │ borders), the persistent
 *  "bypass permissions … / for agents" footer, and collapse blank runs. */
function cleanTerminal(raw: string): string {
  const BOX = /[─━│┃┌┐└┘├┤┬┴┼╭╮╰╯═║╔╗╚╝▏▕▎▔▁]/g;
  const out: string[] = [];
  let blanks = 0;
  for (const line of raw.split('\n')) {
    if (/bypass permissions|shift\+tab to cycle|⌫ for agents|⏵⏵/i.test(line)) continue;
    // Remove box-drawing chars and the trailing padding tmux adds to fill the
    // pane width — otherwise every line carries a long tail of spaces.
    const cleaned = line.replace(BOX, '').replace(/[ \t]+$/, '');
    if (cleaned.trim() === '') { blanks++; if (blanks <= 1) out.push(''); continue; }
    blanks = 0;
    out.push(cleaned);
  }
  // Dedent: claude's box adds a uniform left gutter (the padding after the │
  // border). Strip the smallest common leading indent across non-blank lines so
  // text reads flush-left instead of carrying a wide blank margin.
  const indents = out.filter((l) => l.trim() !== '').map((l) => (l.match(/^ */)?.[0].length ?? 0));
  const minIndent = indents.length ? Math.min(...indents) : 0;
  const dedented = minIndent > 0 ? out.map((l) => l.slice(minIndent)) : out;
  return dedented.join('\n').trim();
}

function StaffTerminal({ staffId }: { staffId: string }) {
  // Instant first-paint from local cache (owner: "刚开始时停留在那边"). The initial
  // fetch then runs silently — no loading-state flash, no UI churn.
  const cached = useMemo(() => getCachedTerminal(staffId), [staffId]);
  const [output, setOutput] = useState<string>(() => cached?.output ?? '');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [cmd, setCmd] = useState('');
  const [sending, setSending] = useState(false);
  const preRef = useRef<HTMLPreElement>(null);
  const termInputRef = useRef<HTMLTextAreaElement>(null);

  // Summary panel pref — read on mount; update live via event.
  const [summaryEnabled, setSummaryEnabled_] = useState<boolean>(() => getSummaryEnabled(staffId));
  useEffect(() => {
    function onPrefChange(e: Event) {
      const ev = e as CustomEvent<{ staffId: string; enabled: boolean }>;
      if (ev.detail?.staffId === staffId) setSummaryEnabled_(ev.detail.enabled);
    }
    window.addEventListener('holon:summaryEnabledChange', onPrefChange);
    return () => window.removeEventListener('holon:summaryEnabledChange', onPrefChange);
  }, [staffId]);

  // Summary side panel state.
  const [panelOpen, setPanelOpen] = useState(false);
  type SummaryMsg = { role: string; content: string };
  // Instant first-paint of the summary panel from localStorage cache (owner:
  // "打开的时候不要每次都去抓"). Background poll then refreshes; only re-renders
  // when the count actually changes (avoids needless flicker).
  const [summaryMsgs, setSummaryMsgs] = useState<SummaryMsg[]>(() => getCachedSummary(staffId));

  // Transient "正在总结…" placeholder: set when user sends a command with
  // summarize on; cleared when the summary poll detects a new assistant entry.
  // NOT persisted — purely render-time.
  const [pendingSummary, setPendingSummary] = useState(false);
  const prevSummaryCountRef = useRef(summaryMsgs.length);

  // Fetch summary thread when panel is open; poll every 3s.
  useEffect(() => {
    if (!panelOpen) return;
    let stopped = false;
    async function fetchSummary() {
      try {
        const thread = encodeURIComponent(`staff:${staffId}`);
        const res = await holonApiFetch(`/api/v1/chat/history?thread=${thread}`, { cache: 'no-store' });
        if (!res.ok || stopped) return;
        const data = await res.json().catch(() => ({})) as { messages?: Array<{ role?: unknown; content?: unknown }> };
        const raw = Array.isArray(data.messages) ? data.messages : [];
        const msgs: SummaryMsg[] = raw
          .filter((m) => m.role === 'assistant' && typeof m.content === 'string' && (m.content as string).trim())
          .map((m) => ({ role: 'assistant', content: m.content as string }));
        if (stopped) return;
        // Only commit + write-through cache when something actually changed.
        setSummaryMsgs((prev) => {
          if (prev.length === msgs.length
            && prev[prev.length - 1]?.content === msgs[msgs.length - 1]?.content) return prev;
          setCachedSummary(staffId, msgs);
          return msgs;
        });
      } catch { /* desk unreachable — keep stale */ }
    }
    void fetchSummary();
    const id = window.setInterval(() => void fetchSummary(), 3000);
    return () => { stopped = true; window.clearInterval(id); };
  }, [panelOpen, staffId]);

  // Clear pendingSummary when a new assistant summary entry lands (count went up).
  // Also Kimi-mode: if 语音直发 is ON, auto-TTS the newest summary so the owner
  // hears each turn's outcome without tapping a button.
  const lastSpokenSummaryIdxRef = useRef<number>(-1);
  const summaryBaselineRef = useRef(false);
  useEffect(() => {
    if (summaryMsgs.length > prevSummaryCountRef.current) {
      setPendingSummary(false);
    }
    prevSummaryCountRef.current = summaryMsgs.length;
    // Baseline on first observation — skip speaking the cache on entry.
    if (!summaryBaselineRef.current && summaryMsgs.length > 0) {
      lastSpokenSummaryIdxRef.current = summaryMsgs.length - 1;
      summaryBaselineRef.current = true;
      return;
    }
    if (!getVoiceAutoSend()) return;
    const lastIdx = summaryMsgs.length - 1;
    if (lastIdx <= lastSpokenSummaryIdxRef.current) return;
    const last = summaryMsgs[lastIdx];
    if (!last || !last.content?.trim()) return;
    lastSpokenSummaryIdxRef.current = lastIdx;
    void (async () => {
      try {
        const opts = buildTtsOpts(null, last.content);
        await deviceTtsSpeak(last.content, opts);
      } catch { /* best-effort */ }
    })();
  }, [summaryMsgs]);

  // Reset baseline when navigating to a different staff terminal.
  useEffect(() => {
    lastSpokenSummaryIdxRef.current = -1;
    summaryBaselineRef.current = false;
  }, [staffId]);

  // Swipe detection: horizontal-dominant pointer drag on the terminal area.
  // RIGHT-to-LEFT (dx < -60): open panel. LEFT-to-RIGHT (dx > 60): close.
  const swipeStartX = useRef<number | null>(null);
  const swipeStartY = useRef<number | null>(null);
  const swipeLocked = useRef<'h' | 'v' | null>(null);

  function onPointerDown(e: React.PointerEvent) {
    if (!summaryEnabled) return;
    swipeStartX.current = e.clientX;
    swipeStartY.current = e.clientY;
    swipeLocked.current = null;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!summaryEnabled || swipeStartX.current === null || swipeStartY.current === null) return;
    const dx = e.clientX - swipeStartX.current;
    const dy = e.clientY - swipeStartY.current;
    if (!swipeLocked.current) {
      if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
        swipeLocked.current = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
      }
    }
    // Prevent vertical scroll only when we've locked onto a horizontal swipe.
    if (swipeLocked.current === 'h') e.preventDefault();
  }
  function onPointerUp(e: React.PointerEvent) {
    if (!summaryEnabled || swipeStartX.current === null || swipeLocked.current !== 'h') {
      swipeStartX.current = null; swipeStartY.current = null; swipeLocked.current = null;
      return;
    }
    const dx = e.clientX - swipeStartX.current;
    swipeStartX.current = null; swipeStartY.current = null; swipeLocked.current = null;
    if (dx < -60) setPanelOpen(true);
    if (dx > 60) setPanelOpen(false);
  }

  const hashRef = useRef(cached?.hash ?? '');
  // Delta/conditional poll: send the last hash we saw; the desk returns a tiny
  // {unchanged:true} when the pane hasn't changed (stateless per-client — works
  // across multiple devices since each holds its own hash). `silent` skips the
  // loading flicker on background polls.
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const q = `lines=300${hashRef.current ? `&hash=${encodeURIComponent(hashRef.current)}` : ''}`;
      const r = await holonApiFetch(`/api/v1/staff/${encodeURIComponent(staffId)}/cli/output?${q}`, { cache: 'no-store' });
      const j = await r.json().catch(() => ({})) as { ok?: boolean; output?: string; hash?: string; unchanged?: boolean; reason?: string };
      if (j.ok && j.unchanged) { setReason(''); return; } // no change — keep current output
      if (j.ok && typeof j.output === 'string') {
        if (j.hash) hashRef.current = j.hash;
        setOutput(j.output); setReason('');
        if (j.hash) setCachedTerminal(staffId, j.output, j.hash); // write-through cache
      } else { setReason(j.reason ?? '该员工当前没有运行中的终端会话'); }
    } catch (e) {
      setReason(e instanceof Error ? e.message : String(e));
    } finally { if (!silent) setLoading(false); }
  }, [staffId]);

  // Send a command (keystrokes + Enter) straight into the agent's tmux session.
  // Voice fills the box; the owner reviews, then taps 发送 — no auto-fire, since a
  // wrong command can disrupt the agent's work.
  async function sendCmd() {
    const text = cmd.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const summarize = getSummaryEnabled(staffId);
      const r = await holonApiFetch(`/api/v1/staff/${encodeURIComponent(staffId)}/cli/input`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(summarize ? { input: text, enter: true, summarize: true } : { input: text, enter: true }),
      });
      if (r.ok) {
        setCmd('');
        // Show placeholder immediately so the panel feels responsive while
        // the desk settle-watch + Haiku summarize runs in the background.
        if (summarize) setPendingSummary(true);
        window.setTimeout(() => void load(), 400);
      }
      else {
        const j = await r.json().catch(() => ({})) as { error?: string };
        setReason(j.error === 'no_session' ? '该员工没有运行中的终端会话' : (j.error ?? '发送失败'));
      }
    } catch (e) {
      setReason(e instanceof Error ? e.message : String(e));
    } finally { setSending(false); }
  }

  useEffect(() => {
    // Initial fetch is SILENT (cache already painted the screen — no need to
    // flash "刷新中").
    void load(true);
    const id = window.setInterval(() => void load(true), 1500);
    return () => window.clearInterval(id);
  }, [load]);

  // Keep pinned to the latest output (like a real terminal).
  useEffect(() => { const el = preRef.current; if (el) el.scrollTop = el.scrollHeight; }, [output]);

  return (
    <div className="mobile-term-wrap">
      {/* Swipe-out summary panel (only rendered when pref is on) */}
      {summaryEnabled && (
        <>
          {/* Dim left strip when panel open — tap to close */}
          {panelOpen && (
            <div
              className="mobile-summary-backdrop"
              onClick={() => setPanelOpen(false)}
              aria-hidden="true"
            />
          )}
          <div className={`mobile-summary-panel${panelOpen ? ' is-open' : ''}`} aria-label="总结面板">
            <div className="mobile-summary-panel-header">
              <span className="mobile-summary-panel-title">总结</span>
              <button
                type="button"
                className="mobile-summary-panel-speak"
                onClick={() => {
                  // Owner: 喇叭按钮读最新一条总结(手动触发,不等 Kimi 自动)。
                  ttsPrimeAudio();
                  const last = summaryMsgs[summaryMsgs.length - 1];
                  const text = last?.content?.trim();
                  if (!text) return;
                  void deviceTtsStop().catch(() => { /* noop */ });
                  void (async () => {
                    try {
                      const opts = buildTtsOpts(null, text);
                      await deviceTtsSpeak(text, opts);
                    } catch { /* best-effort */ }
                  })();
                }}
                aria-label="朗读最新总结"
              >🔊</button>
              <button
                type="button"
                className="mobile-summary-panel-close"
                onClick={() => setPanelOpen(false)}
                aria-label="关闭总结面板"
              >×</button>
            </div>
            <div className="mobile-summary-panel-body">
              {/* Placeholder entry: shown immediately after send, replaced in-place
                  when the real summary arrives (like voice-to-text live caption). */}
              {pendingSummary && (
                <div className="mobile-summary-item mobile-summary-item--pending">
                  <span className="mobile-summary-state-pill is-pending">进行中</span>
                  正在总结…
                </div>
              )}
              {summaryMsgs.length === 0 && !pendingSummary ? (
                <div className="mobile-summary-empty">暂无总结。发送一条消息后自动生成。</div>
              ) : (
                // Latest on top for quick scan.
                [...summaryMsgs].reverse().map((m, i) => (
                  <div key={i} className="mobile-summary-item">
                    {m.content}
                    <span className="mobile-summary-state-pill is-done">已完成</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}

      {/* Visible entry to the summary panel — discoverable affordance beside the
          swipe gesture (owner: "右滑就是总结之类的 你可以加个那个东西"). */}
      {summaryEnabled && !panelOpen && (
        <button
          type="button"
          className="mobile-term-summary-btn"
          onClick={() => setPanelOpen(true)}
          aria-label="打开总结面板"
        >
          总结 ›
        </button>
      )}

      {/* Terminal area with swipe handlers when summary pref is on */}
      <div
        className="mobile-term-swipe-area"
        onPointerDown={summaryEnabled ? onPointerDown : undefined}
        onPointerMove={summaryEnabled ? onPointerMove : undefined}
        onPointerUp={summaryEnabled ? onPointerUp : undefined}
        style={{ flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column' }}
      >
        {output ? (
          <>
            {reason && <div className="mobile-term-status">{reason}</div>}
            <pre ref={preRef} className="mobile-term-screen">{cleanTerminal(output)}</pre>
          </>
        ) : (
          <div className="mobile-term-empty">{reason || (loading ? '加载中…' : '加载中…')}</div>
        )}
      </div>

      {/* Direct CLI control: speak/type a command → straight into the tmux session. */}
      {/* Owner: 员工 CLI 输入框默认 3 行 + 灰 bar 点击放大 / 拖拽缩放,跟员工
          聊天那边一样的可调大小。原来是单行 input,语音转写整段看不见。 */}
      <div
        className="chat-input-grab"
        aria-label="拖动或点击放大输入框"
        onClick={() => {
          const el = termInputRef.current; if (!el) return;
          const big = Math.floor(window.innerHeight * 0.6);
          const cur = el.getBoundingClientRect().height;
          if (cur >= big - 8) el.style.height = '';
          else el.style.height = big + 'px';
        }}
        onPointerDown={(ev) => {
          const el = termInputRef.current; if (!el) return;
          (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
          const startY = ev.clientY;
          const startH = el.getBoundingClientRect().height;
          const maxH = Math.floor(window.innerHeight * 0.7);
          const onMove = (e: globalThis.PointerEvent) => {
            const dy = startY - e.clientY;
            const h = Math.max(40, Math.min(startH + dy, maxH));
            el.style.height = h + 'px';
          };
          const onUp = (e: globalThis.PointerEvent) => {
            try { (ev.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* noop */ }
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            window.removeEventListener('pointercancel', onUp);
          };
          window.addEventListener('pointermove', onMove);
          window.addEventListener('pointerup', onUp);
          window.addEventListener('pointercancel', onUp);
        }}
      >
        <span className="chat-input-grab-bar" aria-hidden="true" />
      </div>
      <div className="mobile-term-input-row">
        <MobileVoiceRecorderButton onTranscript={(t) => setCmd((c) => (c ? `${c} ${t}` : t))} />
        <textarea
          ref={termInputRef}
          rows={3}
          className="mobile-term-input"
          value={cmd}
          onChange={(e) => setCmd(e.target.value)}
          placeholder="输入命令…（语音或打字,回车执行;Shift+回车换行）"
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendCmd(); } }}
          disabled={sending}
        />
        <button type="button" className="mobile-term-send" onClick={() => void sendCmd()} disabled={sending || !cmd.trim()}>
          {sending ? '…' : '发送'}
        </button>
      </div>
    </div>
  );
}

function StaffProfile({
  staffId,
  fallback,
  onMessage,
  onBack,
  embedded,
  beforeRows,
}: {
  staffId: string;
  fallback?: Staff;
  onMessage?: (staff: Staff) => void;
  onBack?: () => void;
  embedded?: boolean;
  /** Optional node inserted between the hero and the row list (embedded mode only). */
  beforeRows?: ReactNode;
}) {
  const [staff, setStaff] = useState<Staff | null>(fallback ?? null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // 人设编辑(可编辑 + 小秘 CLI 润色 + 保存)
  const [personaDraft, setPersonaDraft] = useState('');
  const [polishing, setPolishing] = useState(false);
  const [savingPersona, setSavingPersona] = useState(false);
  const [personaMsg, setPersonaMsg] = useState('');

  // Seed/refresh the editable draft whenever the loaded staff changes (incl. after save).
  useEffect(() => { setPersonaDraft(staff?.system_prompt?.trim() ?? ''); }, [staff]);

  // Editable fixed attributes (名称/角色标签/角色名/并发上限) — all PATCHABLE on the desk.
  const [nameDraft, setNameDraft] = useState('');
  const [roleLabelDraft, setRoleLabelDraft] = useState('');
  const [roleNameDraft, setRoleNameDraft] = useState('');
  const [maxJobsDraft, setMaxJobsDraft] = useState('1');
  const [savingProps, setSavingProps] = useState(false);
  const [propsMsg, setPropsMsg] = useState('');
  const avatarInputRef = useRef<HTMLInputElement>(null);

  async function onAvatarPicked(file: File) {
    if (!staff) return;
    setPropsMsg('头像处理中…');
    try {
      const dataUrl = await resizeImageToDataUrl(file, 128);
      const r = await holonApiFetch(`/api/v1/staff/${encodeURIComponent(staff.id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatar_data: dataUrl }),
      });
      const j = await r.json().catch(() => ({})) as Staff & { error?: string };
      if (!r.ok || !j.id) throw new Error(j.error ?? `HTTP ${r.status}`);
      setStaff(j as Staff);
      setPropsMsg('头像已更新');
    } catch (e) {
      setPropsMsg(`头像更新失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }
  useEffect(() => {
    setNameDraft(staff?.name ?? '');
    setRoleLabelDraft(staff?.role_label ?? '');
    setRoleNameDraft(staff?.role_name ?? '');
    setMaxJobsDraft(String(staff?.max_concurrent_jobs ?? 1));
  }, [staff]);

  async function saveProps() {
    if (!staff || savingProps) return;
    setSavingProps(true); setPropsMsg('');
    try {
      const patch: Record<string, unknown> = {};
      if (nameDraft.trim() && nameDraft.trim() !== staff.name) patch.name = nameDraft.trim();
      if (roleLabelDraft.trim() && roleLabelDraft.trim() !== staff.role_label) patch.role_label = roleLabelDraft.trim();
      if (roleNameDraft.trim() && roleNameDraft.trim() !== staff.role_name) patch.role_name = roleNameDraft.trim();
      const mj = parseInt(maxJobsDraft, 10);
      if (Number.isFinite(mj) && mj > 0 && mj !== staff.max_concurrent_jobs) patch.max_concurrent_jobs = mj;
      if (Object.keys(patch).length === 0) { setPropsMsg('没有改动'); return; }
      const r = await holonApiFetch(`/api/v1/staff/${encodeURIComponent(staff.id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const j = await r.json().catch(() => ({})) as Staff & { error?: string };
      if (!r.ok || !j.id) throw new Error(j.error ?? `HTTP ${r.status}`);
      setStaff(j as Staff);
      setPropsMsg('已保存');
    } catch (err) {
      setPropsMsg(`保存失败：${err instanceof Error ? err.message : String(err)}`);
    } finally { setSavingProps(false); }
  }
  const propsDirty = staff
    ? nameDraft.trim() !== staff.name
      || roleLabelDraft.trim() !== staff.role_label
      || roleNameDraft.trim() !== staff.role_name
      || (parseInt(maxJobsDraft, 10) || 0) !== staff.max_concurrent_jobs
    : false;

  async function polishPersona() {
    if (!staff || !personaDraft.trim() || polishing) return;
    setPolishing(true); setPersonaMsg('');
    try {
      const r = await holonApiFetch('/api/v1/persona/polish', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: personaDraft, role_label: staff.role_label }),
      });
      const j = await r.json().catch(() => ({})) as { polished?: string; error?: string };
      if (!r.ok || typeof j.polished !== 'string') throw new Error(j.error ?? `HTTP ${r.status}`);
      setPersonaDraft(j.polished);
      setPersonaMsg('已润色，确认后点保存');
    } catch (err) {
      setPersonaMsg(`润色失败：${err instanceof Error ? err.message : String(err)}`);
    } finally { setPolishing(false); }
  }

  async function savePersona() {
    if (!staff || savingPersona) return;
    setSavingPersona(true); setPersonaMsg('');
    try {
      const r = await holonApiFetch(`/api/v1/staff/${encodeURIComponent(staff.id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ system_prompt: personaDraft.trim() }),
      });
      const j = await r.json().catch(() => ({})) as Staff & { error?: string };
      if (!r.ok || !j.id) throw new Error(j.error ?? `HTTP ${r.status}`);
      setStaff(j as Staff);
      setPersonaMsg('已保存');
    } catch (err) {
      setPersonaMsg(`保存失败：${err instanceof Error ? err.message : String(err)}`);
    } finally { setSavingPersona(false); }
  }

  const personaDirty = staff ? personaDraft.trim() !== (staff.system_prompt?.trim() ?? '') : false;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    holonApiFetch(`/api/v1/staff/${encodeURIComponent(staffId)}`, { cache: 'no-store' })
      .then(async (r) => {
        const j = await r.json().catch(() => ({})) as Partial<GetStaffResponse> & { error?: string };
        if (!r.ok || !j.staff) throw new Error(j.error ?? `HTTP ${r.status}`);
        if (!cancelled) setStaff(j.staff);
      })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [staffId]);

  // Row-list expand state (embedded mode only)
  const [openRow, setOpenRow] = useState<'name' | 'roleLabel' | 'roleName' | 'maxJobs' | 'persona' | 'ttsVoice' | 'ttsStyle' | 'ttsRate' | 'replyLang' | 'voiceAutoSend' | 'showOwnerTodo' | 'summaryEnabled' | null>(null);

  function toggleRow(row: 'name' | 'roleLabel' | 'roleName' | 'maxJobs' | 'persona' | 'ttsVoice' | 'ttsStyle' | 'ttsRate' | 'replyLang' | 'voiceAutoSend' | 'showOwnerTodo' | 'summaryEnabled') {
    setOpenRow((prev) => (prev === row ? null : row));
  }

  // Feature 2: voice auto-send pref (secretary only, localStorage)
  const [voiceAutoSend, setVoiceAutoSendState] = useState<boolean>(() => getVoiceAutoSend());
  // Feature 3: show/hide 请示 strip pref (secretary only, localStorage)
  const [showOwnerTodoPref, setShowOwnerTodoPrefState] = useState<boolean>(() => getShowOwnerTodo());
  // Feature 4: summary panel pref (non-secretary cli_agent, per-staff, localStorage)
  const [summaryEnabledPref, setSummaryEnabledPrefState] = useState<boolean>(() =>
    staff !== null ? getSummaryEnabled(staff.id) : false,
  );

  // TTS + reply language drafts (per-staff AI-agent config)
  const [ttsVoiceDraft, setTtsVoiceDraft] = useState('');
  const [ttsStyleDraft, setTtsStyleDraft] = useState('');
  const [ttsRateDraft, setTtsRateDraft] = useState<'inherit' | 'slow' | 'normal' | 'fast'>('inherit');
  const [replyLangDraft, setReplyLangDraft] = useState<'auto' | 'zh-CN' | 'en'>('auto');
  const [savingAiCfg, setSavingAiCfg] = useState(false);
  const [aiCfgMsg, setAiCfgMsg] = useState('');

  useEffect(() => {
    setTtsVoiceDraft(staff?.tts_voice ?? '');
    setTtsStyleDraft(staff?.tts_style ?? '');
    setTtsRateDraft(staff?.tts_rate ?? 'inherit');
    setReplyLangDraft(staff?.reply_language ?? 'auto');
  }, [staff]);

  async function saveAiCfgField(patch: Record<string, unknown>) {
    if (!staff || savingAiCfg) return;
    setSavingAiCfg(true); setAiCfgMsg('');
    try {
      const r = await holonApiFetch(`/api/v1/staff/${encodeURIComponent(staff.id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const j = await r.json().catch(() => ({})) as Staff & { error?: string };
      if (!r.ok || !j.id) throw new Error(j.error ?? `HTTP ${r.status}`);
      setStaff(j as Staff);
      setAiCfgMsg('已保存');
    } catch (err) {
      setAiCfgMsg(`保存失败：${err instanceof Error ? err.message : String(err)}`);
    } finally { setSavingAiCfg(false); }
  }

  const TTS_VOICE_OPTIONS: Array<{ label: string; value: string }> = [
    { label: '默认（系统）', value: '' },
    { label: '晓晓·女声', value: 'zh-CN-XiaoxiaoNeural' },
    { label: '云希·男声', value: 'zh-CN-YunxiNeural' },
    { label: '晓伊·女声', value: 'zh-CN-XiaoyiNeural' },
    { label: '云扬·男声', value: 'zh-CN-YunyangNeural' },
  ];
  const TTS_STYLE_OPTIONS: Array<{ label: string; value: string }> = [
    { label: '默认', value: '' },
    { label: '平和', value: 'calm' },
    { label: '热情', value: 'cheerful' },
    { label: '专业', value: 'serious' },
  ];
  const isSecretaryProfile = staff?.role_name === 'secretary';
  const TTS_RATE_OPTIONS: Array<{ label: string; value: 'inherit' | 'slow' | 'normal' | 'fast' }> = [
    ...(isSecretaryProfile ? [] : [{ label: '跟随小秘', value: 'inherit' as const }]),
    { label: '慢', value: 'slow' as const },
    { label: '正常', value: 'normal' as const },
    { label: '快', value: 'fast' as const },
  ];
  const REPLY_LANG_OPTIONS: Array<{ label: string; value: 'auto' | 'zh-CN' | 'en' }> = [
    { label: '跟随', value: 'auto' },
    { label: '中文', value: 'zh-CN' },
    { label: 'English', value: 'en' },
  ];

  const ttsVoiceLabel = TTS_VOICE_OPTIONS.find((o) => o.value === (staff?.tts_voice ?? ''))?.label ?? '默认';
  const ttsStyleLabel = TTS_STYLE_OPTIONS.find((o) => o.value === (staff?.tts_style ?? ''))?.label ?? '默认';
  const ttsRateLabel = TTS_RATE_OPTIONS.find((o) => o.value === (staff?.tts_rate ?? (isSecretaryProfile ? 'normal' : 'inherit')))?.label ?? (isSecretaryProfile ? '正常' : '跟随小秘');
  const replyLangLabel = REPLY_LANG_OPTIONS.find((o) => o.value === (staff?.reply_language ?? 'auto'))?.label ?? '跟随';

  if (embedded && staff) {
    return (
      <div className="mobile-staff-profile">
        {loading && !staff && <div className="mobile-empty-panel">加载中…</div>}
        {error && <div className="mobile-error">员工配置加载失败：{error}</div>}
        {/* Compact avatar hero */}
        <div className="mobile-staff-profile-hero">
          <input
            ref={avatarInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void onAvatarPicked(f); if (e.target) e.target.value = ''; }}
          />
          <StaffAvatar staff={staff} size={64} onPick={() => avatarInputRef.current?.click()} />
          <span className="mobile-staff-cap" onClick={() => avatarInputRef.current?.click()}>点图换头像</span>
          <span className="mobile-staff-profile-name">{staff.name}</span>
          {staff.role_label && staff.role_label !== staff.name && (
            <span className="mobile-staff-profile-role">{staff.role_label}</span>
          )}
        </div>

        {/* Slot between hero and rows (e.g. landing toggle in config mode) */}
        {beforeRows}

        {/* Row list — WeChat 我-tab style */}
        <div className="mobile-me-section" style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>

          {/* 名称 row */}
          <button type="button" className="mobile-collapse-head" onClick={() => toggleRow('name')}>
            <span className="mobile-me-row-title">名称</span>
            <span className="mobile-collapse-summary">{staff.name}</span>
            <span className={`mobile-collapse-chevron${openRow === 'name' ? ' open' : ''}`}>›</span>
          </button>
          {openRow === 'name' && (
            <div className="mobile-staff-edit" style={{ paddingBottom: 8 }}>
              <input id="staff-name-emb" className="mobile-staff-field" value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)} disabled={savingProps} />
              <div className="mobile-persona-editor-actions">
                {propsMsg && <span className="mobile-persona-editor-msg">{propsMsg}</span>}
                <button type="button" className="mobile-persona-save-btn"
                  onClick={() => { void saveProps().then(() => setOpenRow(null)); }} disabled={savingProps || !propsDirty}>
                  {savingProps ? '保存中…' : '保存'}
                </button>
              </div>
            </div>
          )}

          {/* 角色 row */}
          <button type="button" className="mobile-collapse-head" onClick={() => toggleRow('roleLabel')}>
            <span className="mobile-me-row-title">角色</span>
            <span className="mobile-collapse-summary">{staff.role_label || '—'}</span>
            <span className={`mobile-collapse-chevron${openRow === 'roleLabel' ? ' open' : ''}`}>›</span>
          </button>
          {openRow === 'roleLabel' && (
            <div className="mobile-staff-edit" style={{ paddingBottom: 8 }}>
              <input id="staff-rolelabel-emb" className="mobile-staff-field" value={roleLabelDraft}
                onChange={(e) => setRoleLabelDraft(e.target.value)} disabled={savingProps} />
              <div className="mobile-persona-editor-actions">
                {propsMsg && <span className="mobile-persona-editor-msg">{propsMsg}</span>}
                <button type="button" className="mobile-persona-save-btn"
                  onClick={() => { void saveProps().then(() => setOpenRow(null)); }} disabled={savingProps || !propsDirty}>
                  {savingProps ? '保存中…' : '保存'}
                </button>
              </div>
            </div>
          )}

          {/* 并发任务上限 row */}
          <button type="button" className="mobile-collapse-head" onClick={() => toggleRow('maxJobs')}>
            <span className="mobile-me-row-title">并发任务上限</span>
            <span className="mobile-collapse-summary">{staff.max_concurrent_jobs ?? 1}</span>
            <span className={`mobile-collapse-chevron${openRow === 'maxJobs' ? ' open' : ''}`}>›</span>
          </button>
          {openRow === 'maxJobs' && (
            <div className="mobile-staff-edit" style={{ paddingBottom: 8 }}>
              <input id="staff-maxjobs-emb" type="number" min="1" inputMode="numeric"
                className="mobile-staff-field" value={maxJobsDraft}
                onChange={(e) => setMaxJobsDraft(e.target.value)} disabled={savingProps} />
              <div className="mobile-persona-editor-actions">
                {propsMsg && <span className="mobile-persona-editor-msg">{propsMsg}</span>}
                <button type="button" className="mobile-persona-save-btn"
                  onClick={() => { void saveProps().then(() => setOpenRow(null)); }} disabled={savingProps || !propsDirty}>
                  {savingProps ? '保存中…' : '保存'}
                </button>
              </div>
            </div>
          )}

          {/* 职责 row */}
          <button type="button" className="mobile-collapse-head" onClick={() => toggleRow('persona')}>
            <span className="mobile-me-row-title">职责</span>
            <span className="mobile-collapse-summary">
              {staff.system_prompt?.trim() ? staff.system_prompt.trim().slice(0, 30) + (staff.system_prompt.trim().length > 30 ? '…' : '') : '未设置'}
            </span>
            <span className={`mobile-collapse-chevron${openRow === 'persona' ? ' open' : ''}`}>›</span>
          </button>
          {openRow === 'persona' && (
            <div className="mobile-persona-editor">
              {personaMsg && <span className="mobile-persona-editor-msg">{personaMsg}</span>}
              <textarea
                className="mobile-persona-editor-textarea"
                value={personaDraft}
                onChange={(e) => setPersonaDraft(e.target.value)}
                placeholder="描述这个员工的职责与风格，可先随手写，再点「润色」让小秘整理。"
                rows={6}
                disabled={polishing || savingPersona}
              />
              <div className="mobile-persona-editor-actions">
                <button
                  type="button"
                  className="mobile-persona-polish-btn"
                  onClick={() => void polishPersona()}
                  disabled={polishing || savingPersona || !personaDraft.trim()}
                >
                  {polishing ? '润色中…' : '✨ 润色'}
                </button>
                <button
                  type="button"
                  className="mobile-persona-save-btn"
                  onClick={() => { void savePersona().then(() => setOpenRow(null)); }}
                  disabled={savingPersona || polishing || !personaDirty}
                >
                  {savingPersona ? '保存中…' : '保存'}
                </button>
              </div>
            </div>
          )}

          {/* 朗读声音 row */}
          <button type="button" className="mobile-collapse-head" onClick={() => toggleRow('ttsVoice')}>
            <span className="mobile-me-row-title">朗读声音</span>
            <span className="mobile-collapse-summary">{ttsVoiceLabel}</span>
            <span className={`mobile-collapse-chevron${openRow === 'ttsVoice' ? ' open' : ''}`}>›</span>
          </button>
          {openRow === 'ttsVoice' && (
            <div className="mobile-staff-edit" style={{ paddingBottom: 8 }}>
              {aiCfgMsg && <span className="mobile-persona-editor-msg" >{aiCfgMsg}</span>}
              <select
                className="mobile-staff-field"
                value={ttsVoiceDraft}
                onChange={(e) => setTtsVoiceDraft(e.target.value)}
                disabled={savingAiCfg}
              >
                {TTS_VOICE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <div className="mobile-persona-editor-actions">
                <button type="button" className="mobile-persona-save-btn"
                  onClick={() => { void saveAiCfgField({ tts_voice: ttsVoiceDraft }).then(() => setOpenRow(null)); }}
                  disabled={savingAiCfg || ttsVoiceDraft === (staff?.tts_voice ?? '')}>
                  {savingAiCfg ? '保存中…' : '保存'}
                </button>
              </div>
            </div>
          )}

          {/* 朗读风格 row */}
          <button type="button" className="mobile-collapse-head" onClick={() => toggleRow('ttsStyle')}>
            <span className="mobile-me-row-title">朗读风格</span>
            <span className="mobile-collapse-summary">{ttsStyleLabel}</span>
            <span className={`mobile-collapse-chevron${openRow === 'ttsStyle' ? ' open' : ''}`}>›</span>
          </button>
          {openRow === 'ttsStyle' && (
            <div className="mobile-staff-edit" style={{ paddingBottom: 8 }}>
              {aiCfgMsg && <span className="mobile-persona-editor-msg" >{aiCfgMsg}</span>}
              <select
                className="mobile-staff-field"
                value={ttsStyleDraft}
                onChange={(e) => setTtsStyleDraft(e.target.value)}
                disabled={savingAiCfg}
              >
                {TTS_STYLE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <div className="mobile-persona-editor-actions">
                <button type="button" className="mobile-persona-save-btn"
                  onClick={() => { void saveAiCfgField({ tts_style: ttsStyleDraft }).then(() => setOpenRow(null)); }}
                  disabled={savingAiCfg || ttsStyleDraft === (staff?.tts_style ?? '')}>
                  {savingAiCfg ? '保存中…' : '保存'}
                </button>
              </div>
            </div>
          )}

          {/* 朗读语速 row */}
          <button type="button" className="mobile-collapse-head" onClick={() => toggleRow('ttsRate')}>
            <span className="mobile-me-row-title">朗读语速</span>
            <span className="mobile-collapse-summary">{ttsRateLabel}</span>
            <span className={`mobile-collapse-chevron${openRow === 'ttsRate' ? ' open' : ''}`}>›</span>
          </button>
          {openRow === 'ttsRate' && (
            <div className="mobile-staff-edit" style={{ paddingBottom: 8 }}>
              {aiCfgMsg && <span className="mobile-persona-editor-msg" >{aiCfgMsg}</span>}
              <select
                className="mobile-staff-field"
                value={ttsRateDraft}
                onChange={(e) => setTtsRateDraft(e.target.value as 'inherit' | 'slow' | 'normal' | 'fast')}
                disabled={savingAiCfg}
              >
                {TTS_RATE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <div className="mobile-persona-editor-actions">
                <button type="button" className="mobile-persona-save-btn"
                  onClick={() => { void saveAiCfgField({ tts_rate: ttsRateDraft }).then(() => setOpenRow(null)); }}
                  disabled={savingAiCfg || ttsRateDraft === (staff?.tts_rate ?? (isSecretaryProfile ? 'normal' : 'inherit'))}>
                  {savingAiCfg ? '保存中…' : '保存'}
                </button>
              </div>
            </div>
          )}

          {/* 回复语言 row */}
          <button type="button" className="mobile-collapse-head" onClick={() => toggleRow('replyLang')}>
            <span className="mobile-me-row-title">回复语言</span>
            <span className="mobile-collapse-summary">{replyLangLabel}</span>
            <span className={`mobile-collapse-chevron${openRow === 'replyLang' ? ' open' : ''}`}>›</span>
          </button>
          {openRow === 'replyLang' && (
            <div className="mobile-staff-edit" style={{ paddingBottom: 8 }}>
              {aiCfgMsg && <span className="mobile-persona-editor-msg" >{aiCfgMsg}</span>}
              <select
                className="mobile-staff-field"
                value={replyLangDraft}
                onChange={(e) => setReplyLangDraft(e.target.value as 'auto' | 'zh-CN' | 'en')}
                disabled={savingAiCfg}
              >
                {REPLY_LANG_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <div className="mobile-persona-editor-actions">
                <button type="button" className="mobile-persona-save-btn"
                  onClick={() => { void saveAiCfgField({ reply_language: replyLangDraft }).then(() => setOpenRow(null)); }}
                  disabled={savingAiCfg || replyLangDraft === (staff?.reply_language ?? 'auto')}>
                  {savingAiCfg ? '保存中…' : '保存'}
                </button>
              </div>
            </div>
          )}

          {/* 语音模式 row — owner: employees should also have this (was secretary-
              only by mistake). Pref is a global localStorage key shared by all
              staff configs — toggling it anywhere applies app-wide. */}
          <button type="button" className="mobile-collapse-head" onClick={() => toggleRow('voiceAutoSend')}>
            <span className="mobile-me-row-title">语音模式</span>
            <span className="mobile-collapse-summary">{voiceAutoSend ? '直接发送' : '识别编辑'}</span>
            <span className={`mobile-collapse-chevron${openRow === 'voiceAutoSend' ? ' open' : ''}`}>›</span>
          </button>
          {openRow === 'voiceAutoSend' && (
            <div className="mobile-staff-edit" style={{ paddingBottom: 8 }}>
              <div className="mobile-landing-seg">
                <button
                  type="button"
                  className={`mobile-landing-opt${voiceAutoSend ? ' is-active' : ''}`}
                  onClick={() => { setVoiceAutoSend(true); setVoiceAutoSendState(true); setOpenRow(null); }}
                >直接发送</button>
                <button
                  type="button"
                  className={`mobile-landing-opt${!voiceAutoSend ? ' is-active' : ''}`}
                  onClick={() => { setVoiceAutoSend(false); setVoiceAutoSendState(false); setOpenRow(null); }}
                >识别编辑</button>
              </div>
            </div>
          )}

          {/* 请示提醒 row — secretary only (Feature 3) */}
          {isSecretaryProfile && (
            <>
              <button type="button" className="mobile-collapse-head" onClick={() => toggleRow('showOwnerTodo')}>
                <span className="mobile-me-row-title">请示提醒</span>
                <span className="mobile-collapse-summary">{showOwnerTodoPref ? '显示' : '隐藏'}</span>
                <span className={`mobile-collapse-chevron${openRow === 'showOwnerTodo' ? ' open' : ''}`}>›</span>
              </button>
              {openRow === 'showOwnerTodo' && (
                <div className="mobile-staff-edit" style={{ paddingBottom: 8 }}>
                  <div className="mobile-landing-seg">
                    <button
                      type="button"
                      className={`mobile-landing-opt${showOwnerTodoPref ? ' is-active' : ''}`}
                      onClick={() => { setShowOwnerTodo(true); setShowOwnerTodoPrefState(true); setOpenRow(null); }}
                    >显示</button>
                    <button
                      type="button"
                      className={`mobile-landing-opt${!showOwnerTodoPref ? ' is-active' : ''}`}
                      onClick={() => { setShowOwnerTodo(false); setShowOwnerTodoPrefState(false); setOpenRow(null); }}
                    >隐藏</button>
                  </div>
                </div>
              )}
            </>
          )}

          {/* 总结面板 row — non-secretary cli_agent employees (Feature 4) */}
          {!isSecretaryProfile && staff?.substrate.kind === 'cli_agent' && (
            <>
              <button type="button" className="mobile-collapse-head" onClick={() => toggleRow('summaryEnabled')}>
                <span className="mobile-me-row-title">总结面板</span>
                <span className="mobile-collapse-summary">{summaryEnabledPref ? '显示' : '关闭'}</span>
                <span className={`mobile-collapse-chevron${openRow === 'summaryEnabled' ? ' open' : ''}`}>›</span>
              </button>
              {openRow === 'summaryEnabled' && (
                <div className="mobile-staff-edit" style={{ paddingBottom: 8 }}>
                  <div className="mobile-landing-seg">
                    <button
                      type="button"
                      className={`mobile-landing-opt${summaryEnabledPref ? ' is-active' : ''}`}
                      onClick={() => { if (staff) { setSummaryEnabled(staff.id, true); setSummaryEnabledPrefState(true); } setOpenRow(null); }}
                    >显示</button>
                    <button
                      type="button"
                      className={`mobile-landing-opt${!summaryEnabledPref ? ' is-active' : ''}`}
                      onClick={() => { if (staff) { setSummaryEnabled(staff.id, false); setSummaryEnabledPrefState(false); } setOpenRow(null); }}
                    >关闭</button>
                  </div>
                </div>
              )}
            </>
          )}

        </div>
      </div>
    );
  }

  return (
    <div className="mobile-staff-profile">
      {!embedded && <button type="button" className="mobile-back-row" onClick={onBack}>‹ 通讯录</button>}
      {loading && !staff && <div className="mobile-empty-panel">加载中…</div>}
      {error && <div className="mobile-error">员工配置加载失败：{error}</div>}
      {staff && (
        <>
          <div className="mobile-staff-profile-hero">
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void onAvatarPicked(f); if (e.target) e.target.value = ''; }}
            />
            <StaffAvatar staff={staff} size={64} onPick={() => avatarInputRef.current?.click()} />
            <span className="mobile-staff-cap" onClick={() => avatarInputRef.current?.click()}>点图换头像</span>
            <span className="mobile-staff-profile-name">{staff.name}</span>
            {staff.role_label && staff.role_label !== staff.name && (
              <span className="mobile-staff-profile-role">{staff.role_label}</span>
            )}
          </div>
          {/* 发消息 = primary action (WeChat contact-detail style) → full-screen chat.
              配置 / 看后台 are secondary. 看后台 (tmux view) only applies to
              tmux-backed employees — the Secretary has no terminal. */}
          {!embedded && onMessage && (
            <button type="button" className="mobile-staff-message-btn" onClick={() => onMessage(staff)}>
              💬 发消息
            </button>
          )}
          <div className="mobile-staff-edit">
            <label className="mobile-config-dt" htmlFor="staff-name">名称</label>
            <input id="staff-name" className="mobile-staff-field" value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)} disabled={savingProps} />
            <label className="mobile-config-dt" htmlFor="staff-rolelabel">角色标签</label>
            <input id="staff-rolelabel" className="mobile-staff-field" value={roleLabelDraft}
              onChange={(e) => setRoleLabelDraft(e.target.value)} disabled={savingProps} />
            <label className="mobile-config-dt" htmlFor="staff-rolename">角色名</label>
            <input id="staff-rolename" className="mobile-staff-field" value={roleNameDraft}
              onChange={(e) => setRoleNameDraft(e.target.value)} disabled={savingProps} />
            <label className="mobile-config-dt" htmlFor="staff-maxjobs">并发任务上限</label>
            <input id="staff-maxjobs" type="number" min="1" inputMode="numeric"
              className="mobile-staff-field" value={maxJobsDraft}
              onChange={(e) => setMaxJobsDraft(e.target.value)} disabled={savingProps} />
            <div className="mobile-persona-editor-actions">
              {propsMsg && <span className="mobile-persona-editor-msg">{propsMsg}</span>}
              <button type="button" className="mobile-persona-save-btn"
                onClick={() => void saveProps()} disabled={savingProps || !propsDirty}>
                {savingProps ? '保存中…' : '保存属性'}
              </button>
            </div>
          </div>
          <div className="mobile-persona-editor">
            <div className="mobile-persona-editor-head">
              <span className="mobile-config-dt">系统指令（人设）</span>
              {personaMsg && <span className="mobile-persona-editor-msg">{personaMsg}</span>}
            </div>
            <textarea
              className="mobile-persona-editor-textarea"
              value={personaDraft}
              onChange={(e) => setPersonaDraft(e.target.value)}
              placeholder="描述这个员工的职责与风格，可先随手写，再点「润色」让小秘整理。"
              rows={6}
              disabled={polishing || savingPersona}
            />
            <div className="mobile-persona-editor-actions">
              <button
                type="button"
                className="mobile-persona-polish-btn"
                onClick={() => void polishPersona()}
                disabled={polishing || savingPersona || !personaDraft.trim()}
              >
                {polishing ? '润色中…' : '✨ 润色'}
              </button>
              <button
                type="button"
                className="mobile-persona-save-btn"
                onClick={() => void savePersona()}
                disabled={savingPersona || polishing || !personaDirty}
              >
                {savingPersona ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Priority helpers ──────────────────────────────────────────────────────────

const PRIORITY_LABEL: Record<TodoPriority, string> = { high: '高', medium: '中', low: '低' };
const PRIORITY_COLOR: Record<TodoPriority, string> = {
  high: '#e0533a',
  medium: '#d4952a',
  low: '#9a9a9a',
};
const PRIORITY_CYCLE: Record<TodoPriority, TodoPriority> = { high: 'medium', medium: 'low', low: 'high' };
const PRIORITY_ORDER: Record<TodoPriority, number> = { high: 0, medium: 1, low: 2 };

// Urgency-via-text-color: 高=red, 中=normal ink, 低=muted grey.
const PRIORITY_TEXT_COLOR: Record<TodoPriority, string> = {
  high: '#e0533a',
  medium: 'inherit',
  low: '#9a9a9a',
};

// Local 'YYYY-MM-DD' (avoids UTC off-by-one from toISOString).
function todayLocalIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// 'YYYY-MM-DD' → 'MM-DD' for the compact pill.
function shortDate(iso: string): string {
  const parts = iso.split('-');
  return parts.length === 3 ? `${parts[1]}-${parts[2]}` : iso;
}

// Overdue = due date is today or earlier.
function isOverdue(iso: string): boolean {
  return iso <= todayLocalIso();
}

// ─── SwipeToDelete — WeChat/iOS-style swipe-left to reveal 删除 ───────────

interface SwipeToDeleteProps {
  id: string;
  openId: string | null;
  onOpen: (id: string | null) => void;
  onDelete: () => void;
  children: ReactNode;
}

function SwipeToDelete({ id, openId, onOpen, onDelete, children }: SwipeToDeleteProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  // Touch tracking state — kept in a ref so no re-renders during drag
  const drag = useRef({
    active: false,
    startX: 0,
    startY: 0,
    axisLocked: false,
    isHorizontal: false,
    currentX: 0,
  });
  const [isOpen, setIsOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const SNAP_THRESHOLD = 40;   // px drag to snap open
  const ACTION_WIDTH   = 80;   // px width of the red button

  // If another card opened, snap this one shut
  useEffect(() => {
    if (openId !== id && isOpen) {
      setIsOpen(false);
      applyTransform(0, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId]);

  function applyTransform(x: number, animated: boolean) {
    const card = cardRef.current;
    if (!card) return;
    if (animated) {
      card.classList.add('is-snapping');
      card.addEventListener('transitionend', () => card.classList.remove('is-snapping'), { once: true });
    } else {
      card.classList.remove('is-snapping');
    }
    card.style.transform = x === 0 ? '' : `translateX(${x}px)`;
  }

  const handleTouchStart = useCallback((ev: TouchEvent<HTMLDivElement>) => {
    const t = ev.touches[0];
    if (!t) return;
    drag.current = {
      active: true,
      startX: t.clientX,
      startY: t.clientY,
      axisLocked: false,
      isHorizontal: false,
      currentX: isOpen ? -ACTION_WIDTH : 0,
    };
  }, [isOpen]);

  const handleTouchMove = useCallback((ev: TouchEvent<HTMLDivElement>) => {
    if (!drag.current.active) return;
    const t = ev.touches[0];
    if (!t) return;
    const dx = t.clientX - drag.current.startX;
    const dy = t.clientY - drag.current.startY;

    // Axis lock: first move > 6px decides
    if (!drag.current.axisLocked) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      drag.current.axisLocked = true;
      drag.current.isHorizontal = Math.abs(dx) > Math.abs(dy);
    }

    if (!drag.current.isHorizontal) return;

    // Prevent vertical scroll page-scroll when we own the gesture
    ev.preventDefault();

    const base = drag.current.currentX;
    const raw = base + dx;
    // Clamp: 0 (closed) to -ACTION_WIDTH (fully open)
    const clamped = Math.max(-ACTION_WIDTH, Math.min(0, raw));
    applyTransform(clamped, false);
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (!drag.current.active) return;
    drag.current.active = false;
    if (!drag.current.isHorizontal) return;

    const card = cardRef.current;
    if (!card) return;
    // Read current translateX
    const matrix = new DOMMatrix(getComputedStyle(card).transform);
    const tx = matrix.m41;

    const dragged = Math.abs(tx) - (isOpen ? 0 : 0);
    const shouldOpen = isOpen
      ? Math.abs(tx) > ACTION_WIDTH / 4          // must drag back > 20px to close
      : Math.abs(tx) > SNAP_THRESHOLD;

    if (shouldOpen && !isOpen) {
      applyTransform(-ACTION_WIDTH, true);
      setIsOpen(true);
      onOpen(id);
    } else if (!shouldOpen || (isOpen && Math.abs(tx) < ACTION_WIDTH - ACTION_WIDTH / 4)) {
      applyTransform(0, true);
      setIsOpen(false);
      if (openId === id) onOpen(null);
    } else {
      // keep open
      applyTransform(-ACTION_WIDTH, true);
    }
    void dragged; // consumed above
  }, [id, isOpen, onOpen, openId]);

  function handleDelete() {
    // Animate out, then fire delete
    const wrap = wrapRef.current;
    if (wrap) {
      wrap.classList.add('is-deleting');
      wrap.addEventListener('animationend', () => { onDelete(); }, { once: true });
    } else {
      onDelete();
    }
    setIsDeleting(true);
  }

  return (
    <div
      ref={wrapRef}
      className="weizo-swipe-wrap"
      style={{ pointerEvents: isDeleting ? 'none' : undefined }}
    >
      <button
        type="button"
        className="weizo-swipe-action"
        onClick={handleDelete}
        tabIndex={isOpen ? 0 : -1}
        aria-label="删除"
      >
        删除
      </button>
      <div
        ref={cardRef}
        className="weizo-swipe-card"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
      >
        {children}
      </div>
    </div>
  );
}

// ─── 看板 — work tracker (待办 LEAD) ───────────────────────────────────────

function AgingLine({ days }: { days: number }) {
  return (
    <span className="weizo-kanban-aging">
      ⏳ 已挂{days}天
    </span>
  );
}

function PriorityBar({ priority }: { priority: TodoPriority }) {
  return <span className={`weizo-kanban-priority-bar weizo-kanban-priority-bar-${priority}`} aria-hidden="true" />;
}

function TodoBacklog({ onTalkToSecretary }: { onTalkToSecretary: (text: string) => void }) {
  const [items, setItems] = useState<Todo[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [openSwipeId, setOpenSwipeId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const r = await holonApiFetch('/api/v1/todos?status=pending', { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json() as ListTodosResponse;
      const todos = Array.isArray(j.items) ? j.items : [];
      // Client-side sort: high→medium→low, then newest first (server already orders by created_at DESC)
      todos.sort((a, b) => {
        const pa = PRIORITY_ORDER[a.priority ?? 'medium'] ?? 1;
        const pb = PRIORITY_ORDER[b.priority ?? 'medium'] ?? 1;
        return pa - pb;
      });
      setItems(todos);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function addTodo() {
    const text = input.trim();
    if (!text || adding) return;
    setAdding(true);
    try {
      const r = await holonApiFetch('/api/v1/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),  // priority defaults to 'medium' on server
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setInput('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAdding(false);
    }
  }

  async function updateTodo(id: string, status: Todo['status']) {
    try {
      await holonApiFetch(`/api/v1/todos/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      await load();
    } catch {
      // best-effort
    }
  }

  async function cyclePriority(id: string, current: TodoPriority) {
    const next = PRIORITY_CYCLE[current];
    // Optimistic update for snappy feel
    setItems((prev) => {
      const updated = prev.map((t) => t.id === id ? { ...t, priority: next } : t);
      updated.sort((a, b) => {
        const pa = PRIORITY_ORDER[a.priority ?? 'medium'] ?? 1;
        const pb = PRIORITY_ORDER[b.priority ?? 'medium'] ?? 1;
        return pa - pb;
      });
      return updated;
    });
    try {
      await holonApiFetch(`/api/v1/todos/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priority: next }),
      });
    } catch {
      // revert on failure
      await load();
    }
  }

  async function setDueDate(id: string, due_date: string | null) {
    // Optimistic update for snappy feel; re-sort so sooner-due rises within priority.
    setItems((prev) => {
      const updated = prev.map((t) => t.id === id ? { ...t, due_date } : t);
      updated.sort((a, b) => {
        const pa = PRIORITY_ORDER[a.priority ?? 'medium'] ?? 1;
        const pb = PRIORITY_ORDER[b.priority ?? 'medium'] ?? 1;
        if (pa !== pb) return pa - pb;
        const da = a.due_date ?? null;
        const db = b.due_date ?? null;
        if (da !== db) {
          if (da === null) return 1;
          if (db === null) return -1;
          return da < db ? -1 : 1;
        }
        return 0;
      });
      return updated;
    });
    try {
      await holonApiFetch(`/api/v1/todos/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ due_date }),
      });
    } catch {
      // revert on failure
      await load();
    }
  }

  async function deleteTodo(id: string) {
    try {
      await holonApiFetch(`/api/v1/todos/${encodeURIComponent(id)}`, { method: 'DELETE' });
      await load();
    } catch {
      // best-effort
    }
  }

  return (
    <section className="mobile-work-section weizo-kanban-lead" aria-label="待办">
      <div className="mobile-section-heading">
        <h2>待办 · {items.length}</h2>
      </div>
      <div className="weizo-todo-compose">
        <input
          className="weizo-todo-input"
          value={input}
          onChange={(ev) => setInput(ev.target.value)}
          onKeyDown={(ev) => {
            if (ev.key === 'Enter') { ev.preventDefault(); void addTodo(); }
          }}
          placeholder="＋ 新增待办任务…"
          disabled={adding}
        />
        <button
          type="button"
          className="weizo-todo-add"
          onClick={() => void addTodo()}
          disabled={adding || !input.trim()}
        >
          {adding ? '…' : '加'}
        </button>
      </div>
      {error && <div className="mobile-error">{error}</div>}
      {loading && items.length === 0 && <div className="mobile-empty-panel">加载中…</div>}
      {!loading && items.length === 0 && <div className="mobile-empty-panel">暂无待办任务</div>}
      <div className="mobile-job-list">
        {items.map((todo) => {
          const priority = todo.priority ?? 'medium';
          const ageDays = todo.created_at
            ? Math.max(0, Math.floor((Date.now() - new Date(todo.created_at).getTime()) / 86400000))
            : 0;
          return (
            <SwipeToDelete
              key={todo.id}
              id={todo.id}
              openId={openSwipeId}
              onOpen={setOpenSwipeId}
              onDelete={() => void deleteTodo(todo.id)}
            >
              <div className="weizo-kanban-todo-card">
                <PriorityBar priority={priority} />
                <div className="weizo-kanban-todo-body">
                  <div className="weizo-kanban-todo-titlerow">
                    <button
                      type="button"
                      className="weizo-priority-tag"
                      style={{ background: PRIORITY_COLOR[priority] }}
                      onClick={() => void cyclePriority(todo.id, priority)}
                      title={`优先级：${PRIORITY_LABEL[priority]}（点击切换）`}
                      aria-label={`优先级 ${PRIORITY_LABEL[priority]}，点击切换`}
                    >
                      {PRIORITY_LABEL[priority]}
                    </button>
                    <span
                      className="weizo-kanban-todo-title"
                      style={{ color: PRIORITY_TEXT_COLOR[priority] }}
                    >
                      {todo.text}
                    </span>
                  </div>
                  <div className="weizo-kanban-todo-meta">
                    {todo.due_date && (
                      <span
                        className="weizo-todo-due"
                        style={isOverdue(todo.due_date) ? { color: '#e0533a' } : undefined}
                        title={`截止 ${todo.due_date}${isOverdue(todo.due_date) ? '（已到期）' : ''}`}
                      >
                        📅 {shortDate(todo.due_date)}{isOverdue(todo.due_date) ? '(逾期)' : ''}
                      </span>
                    )}
                    {ageDays > 0 && <AgingLine days={ageDays} />}
                  </div>
                  <div className="weizo-kanban-todo-actions">
                    <label className="weizo-todo-action weizo-todo-datelabel" title="设日期" aria-label="设日期">
                      📅
                      <input
                        type="date"
                        className="weizo-todo-dateinput"
                        value={todo.due_date ?? ''}
                        onChange={(ev) => void setDueDate(todo.id, ev.target.value || null)}
                      />
                    </label>
                    {todo.due_date && (
                      <button
                        type="button"
                        className="weizo-todo-action"
                        onClick={() => void setDueDate(todo.id, null)}
                        title="清除日期"
                        aria-label="清除日期"
                      >
                        ✕
                      </button>
                    )}
                    <button
                      type="button"
                      className="weizo-todo-action weizo-kanban-cta"
                      onClick={() => onTalkToSecretary(todo.text)}
                      title="对话小秘（派活）"
                      aria-label="对话小秘"
                    >
                      💬
                    </button>
                    <button
                      type="button"
                      className="weizo-todo-action"
                      onClick={() => void updateTodo(todo.id, 'done')}
                      title="完成"
                    >
                      ✓
                    </button>
                  </div>
                </div>
              </div>
            </SwipeToDelete>
          );
        })}
      </div>
    </section>
  );
}

interface JobRow {
  id: string;
  staff_id?: string;
  brief?: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  created_at?: string;
  completed_at?: string;
}

function JobStatusPill({ status }: { status: 'running' | 'queued' | 'stuck' }) {
  const label = status === 'running' ? '运行中' : status === 'queued' ? '排队' : '⚠卡住';
  return (
    <span className={`weizo-kanban-status-pill weizo-kanban-status-${status}`}>
      {status === 'running' && <span className="weizo-kanban-pulse-dot" aria-hidden="true" />}
      {label}
    </span>
  );
}

function AssigneeAvatar({ initial }: { initial: string }) {
  return <span className="weizo-kanban-avatar">{initial}</span>;
}

function ActiveJobs({ onTalkToSecretary }: { onTalkToSecretary: (text: string) => void }) {
  const [items, setItems] = useState<JobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openSwipeId, setOpenSwipeId] = useState<string | null>(null);
  const [latest, setLatest] = useState<Record<string, string>>({}); // staff_id → latest terminal line
  const [liveStaffId, setLiveStaffId] = useState<string | null>(null); // open terminal overlay

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    holonApiFetch('/api/v1/jobs', { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json() as { items?: JobRow[] };
        if (!cancelled) {
          const all = Array.isArray(j.items) ? j.items : [];
          setItems(all.filter((job) => job.status === 'queued' || job.status === 'running').slice(0, 12));
        }
      })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  async function deleteJob(id: string) {
    // Optimistic remove
    setItems((prev) => prev.filter((j) => j.id !== id));
    try {
      const r = await holonApiFetch(`/api/v1/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!r.ok && r.status !== 404) throw new Error(`HTTP ${r.status}`);
    } catch {
      // On failure: reload list to restore
      holonApiFetch('/api/v1/jobs', { cache: 'no-store' })
        .then(async (r) => {
          if (!r.ok) return;
          const j = await r.json() as { items?: JobRow[] };
          const all = Array.isArray(j.items) ? j.items : [];
          setItems(all.filter((job) => job.status === 'queued' || job.status === 'running').slice(0, 12));
        })
        .catch(() => undefined);
    }
  }

  // Live status: poll each running job's terminal for its latest line so the
  // 进行中 cards show real activity (not a hardcoded "排队中…"), and stalls show.
  useEffect(() => {
    const running = items.filter((j) => j.status === 'running' && j.staff_id);
    if (running.length === 0) return;
    let cancelled = false;
    const pull = async () => {
      const updates: Record<string, string> = {};
      await Promise.all(running.map(async (j) => {
        const sid = j.staff_id;
        if (!sid) return;
        try {
          const r = await holonApiFetch(`/api/v1/staff/${encodeURIComponent(sid)}/cli/output?lines=12`, { cache: 'no-store' });
          if (!r.ok) return;
          const x = await r.json() as { output?: string };
          const line = (x.output ?? '').split('\n').map((s) => s.trim()).filter(Boolean).pop() ?? '';
          if (line) updates[sid] = line.slice(0, 60);
        } catch { /* ignore — keep last known */ }
      }));
      if (!cancelled && Object.keys(updates).length) setLatest((p) => ({ ...p, ...updates }));
    };
    void pull();
    const id = window.setInterval(() => void pull(), 5000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [items]);

  function elapsedMinutes(createdAt: string | undefined): string | null {
    if (!createdAt) return null;
    const mins = Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000);
    if (mins < 1) return '< 1分';
    return `${mins}分`;
  }

  return (
    <section className="mobile-work-section" aria-label="进行中">
      <div className="mobile-section-heading">
        <h2>进行中 · {items.length}</h2>
      </div>
      {loading && items.length === 0 && <div className="mobile-empty-panel">加载中…</div>}
      {!loading && items.length === 0 && !error && <div className="mobile-empty-panel">暂无进行中的任务</div>}
      {error && <div className="mobile-error">任务加载失败：{error}</div>}
      <div className="mobile-job-list">
        {items.map((job) => {
          const jobStatus: 'running' | 'queued' | 'stuck' =
            job.status === 'running' ? 'running' : 'queued';
          const elapsed = elapsedMinutes(job.created_at);
          const assigneeInitial = job.staff_id ? job.staff_id.charAt(0).toUpperCase() : '?';
          return (
            <SwipeToDelete
              key={job.id}
              id={job.id}
              openId={openSwipeId}
              onOpen={setOpenSwipeId}
              onDelete={() => void deleteJob(job.id)}
            >
              <div className="weizo-kanban-job-card">
                <div className="weizo-kanban-job-row1">
                  <AssigneeAvatar initial={assigneeInitial} />
                  <span className="weizo-kanban-job-name">{job.staff_id ?? '未分配'}</span>
                  <JobStatusPill status={jobStatus} />
                  {elapsed && <span className="weizo-kanban-elapsed">⏱ 已跑{elapsed}</span>}
                </div>
                <div className="weizo-kanban-job-title">{job.brief ?? job.id}</div>
                <div className="weizo-kanban-job-latest">
                  {jobStatus === 'queued'
                    ? '等待：排队中…'
                    : `最新：${(job.staff_id && latest[job.staff_id]) || '运行中…'}`}
                </div>
                <div className="weizo-kanban-job-actions">
                  <button
                    type="button"
                    className="weizo-kanban-action-btn"
                    disabled={!job.staff_id}
                    onClick={() => job.staff_id && setLiveStaffId(job.staff_id)}
                  >
                    查看实时
                  </button>
                  <button
                    type="button"
                    className="weizo-kanban-action-btn weizo-kanban-action-primary"
                    onClick={() => onTalkToSecretary(job.brief ?? job.id)}
                  >
                    去对话
                  </button>
                </div>
              </div>
            </SwipeToDelete>
          );
        })}
      </div>
      {liveStaffId && (
        <div className="mobile-live-overlay" role="dialog" aria-modal="true">
          <div className="mobile-live-sheet">
            <div className="mobile-live-head">
              <span>实时终端</span>
              <button type="button" className="mobile-live-close" onClick={() => setLiveStaffId(null)}>关闭</button>
            </div>
            <StaffTerminal staffId={liveStaffId} />
          </div>
        </div>
      )}
    </section>
  );
}

function DelivReviewPill({ status }: { status: 'pending' | 'seen' }) {
  return (
    <span className={`weizo-kanban-status-pill weizo-kanban-review-${status}`}>
      {status === 'pending' ? '待验收' : '已看'}
    </span>
  );
}

function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${mins}分钟前`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}小时前`;
  return `${Math.floor(hrs / 24)}天前`;
}

// Inline markdown: `code`, **bold**, *italic*, [text](url). No dependency.
function renderInline(text: string, keyBase: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('`')) nodes.push(<code key={`${keyBase}-${i}`} className="md-code">{tok.slice(1, -1)}</code>);
    else if (tok.startsWith('**')) nodes.push(<strong key={`${keyBase}-${i}`}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith('*')) nodes.push(<em key={`${keyBase}-${i}`}>{tok.slice(1, -1)}</em>);
    else {
      const mm = /\[([^\]]+)\]\(([^)]+)\)/.exec(tok);
      if (mm) nodes.push(<a key={`${keyBase}-${i}`} href={mm[2]} target="_blank" rel="noreferrer">{mm[1]}</a>);
      else nodes.push(tok);
    }
    last = m.index + tok.length;
    i++;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

// Lightweight markdown block renderer for deliverable bodies — headings, fenced
// code, ordered/unordered lists, paragraphs. No external dependency (keeps the
// static export lean per North Star).
function MarkdownView({ text }: { text: string }) {
  const lines = (text ?? '').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;
  const at = (n: number) => lines[n] ?? '';
  while (i < lines.length) {
    const line = at(i);
    if (line.trim().startsWith('```')) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !at(i).trim().startsWith('```')) { buf.push(at(i)); i++; }
      i++;
      blocks.push(<pre key={key++} className="md-pre"><code>{buf.join('\n')}</code></pre>);
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const lvl = (h[1] ?? '').length;
      const content = renderInline(h[2] ?? '', `h${key}`);
      blocks.push(lvl <= 2
        ? <h3 key={key++} className="md-h">{content}</h3>
        : <h4 key={key++} className="md-h">{content}</h4>);
      i++;
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const lis: ReactNode[] = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(at(i))) {
        const item = at(i).replace(/^\s*([-*]|\d+\.)\s+/, '');
        lis.push(<li key={lis.length}>{renderInline(item, `li${key}-${lis.length}`)}</li>);
        i++;
      }
      blocks.push(ordered
        ? <ol key={key++} className="md-list">{lis}</ol>
        : <ul key={key++} className="md-list">{lis}</ul>);
      continue;
    }
    if (line.trim() === '') { i++; continue; }
    const para: string[] = [];
    while (
      i < lines.length && at(i).trim() !== ''
      && !/^\s*([-*]|\d+\.)\s+/.test(at(i))
      && !/^#{1,6}\s/.test(at(i))
      && !at(i).trim().startsWith('```')
    ) { para.push(at(i)); i++; }
    blocks.push(<p key={key++} className="md-p">{renderInline(para.join('\n'), `p${key}`)}</p>);
  }
  return <div className="md-body">{blocks}</div>;
}

function DelivSection() {
  const [items, setItems] = useState<Deliverable[]>(() => getCachedDeliverables().slice(0, 8));
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<GetDeliverableResponse | null>(null);
  const [loading, setLoading] = useState(() => getCachedDeliverables().length === 0);
  const [error, setError] = useState('');
  const [openSwipeId, setOpenSwipeId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    holonApiFetch('/api/v1/deliverables', { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json() as ListDeliverablesResponse;
        if (!cancelled) {
          const fetched = Array.isArray(j.items) ? j.items : [];
          setItems(fetched.slice(0, 8));
          setCachedDeliverables(fetched);
        }
      })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!openId) { setDetail(null); return; }
    let cancelled = false;
    setLoading(true);
    holonApiFetch(`/api/v1/deliverables/${encodeURIComponent(openId)}`, { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json() as GetDeliverableResponse;
        if (!cancelled) setDetail(j);
      })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [openId]);

  async function handleDeleteDeliverable(id: string) {
    // Optimistic remove
    setItems((prev) => prev.filter((d) => d.id !== id));
    try {
      const r = await holonApiFetch(`/api/v1/deliverables/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!r.ok && r.status !== 404) throw new Error(`HTTP ${r.status}`);
    } catch {
      // On failure: reload
      holonApiFetch('/api/v1/deliverables', { cache: 'no-store' })
        .then(async (r) => {
          if (!r.ok) return;
          const j = await r.json() as ListDeliverablesResponse;
          setItems(Array.isArray(j.items) ? j.items.slice(0, 8) : []);
        })
        .catch(() => undefined);
    }
  }

  async function reviewDeliverable(id: string, status: 'accepted' | 'rejected') {
    try {
      const r = await holonApiFetch(`/api/v1/deliverables/${encodeURIComponent(id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json() as GetDeliverableResponse;
      setDetail(j);
      setItems((prev) => prev.map((d) => (d.id === id ? { ...d, status } : d)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (openId) {
    const d = detail?.deliverable;
    const reviewable = d && (d.status === 'draft' || d.status === 'final' || d.status === 'revised');
    return (
      <div className="mobile-deliverables">
        <button type="button" className="mobile-back-row" onClick={() => setOpenId(null)}>‹ 交付</button>
        {loading && !d && <div className="mobile-empty-panel">加载中…</div>}
        {error && <div className="mobile-error">加载失败：{error}</div>}
        {d && (
          <article className="mobile-deliverable-detail">
            <div className="mobile-detail-kicker">{STATUS_LABEL[d.status]} · {d.created_at?.slice(0, 10) ?? ''}</div>
            <h2>{d.title}</h2>
            <MarkdownView text={bodyText(d.body)} />
          </article>
        )}
        {d && reviewable && (
          <div className="mobile-deliv-review">
            <button type="button" className="mobile-deliv-reject" onClick={() => void reviewDeliverable(d.id, 'rejected')}>
              ✕ 拒绝
            </button>
            <button type="button" className="mobile-deliv-accept" onClick={() => void reviewDeliverable(d.id, 'accepted')}>
              ✓ 接受
            </button>
          </div>
        )}
        {d && (d.status === 'accepted' || d.status === 'rejected') && (
          <div className="mobile-deliv-reviewed">已{d.status === 'accepted' ? '接受' : '拒绝'} · 可下拉重看</div>
        )}
      </div>
    );
  }

  return (
    <section className="mobile-work-section weizo-deliverables-section" aria-label="交付">
      <div className="mobile-section-heading">
        <h2>交付 · {items.length}</h2>
      </div>
      {loading && items.length === 0 && <div className="mobile-empty-panel">加载中…</div>}
      {!loading && items.length === 0 && !error && <div className="mobile-empty-panel">还没有交付</div>}
      {error && <div className="mobile-error">加载失败：{error}</div>}
      <div className="mobile-job-list">
        {items.map((d) => {
          const reviewStatus: 'pending' | 'seen' =
            d.status === 'accepted' || d.status === 'rejected' ? 'seen' : 'pending';
          return (
            <SwipeToDelete
              key={d.id}
              id={d.id}
              openId={openSwipeId}
              onOpen={setOpenSwipeId}
              onDelete={() => void handleDeleteDeliverable(d.id)}
            >
              <div className="weizo-kanban-deliv-card">
                <div className="weizo-kanban-deliv-row1">
                  <span className="weizo-kanban-deliv-icon">📄</span>
                  <span className="weizo-kanban-deliv-title">{d.title}</span>
                  <DelivReviewPill status={reviewStatus} />
                </div>
                <div className="weizo-kanban-deliv-meta">
                  {d.created_at ? `🕐 ${timeAgo(d.created_at)}` : ''}
                  {d.created_at ? ' · ' : ''}
                  {'👤 ' + (d.title ? d.title.slice(0, 4) : '—')}
                </div>
                <div className="weizo-kanban-deliv-excerpt">{excerpt(bodyText(d.body))}</div>
                <div className="weizo-kanban-job-actions">
                  <button
                    type="button"
                    className="weizo-kanban-action-btn weizo-kanban-action-primary"
                    onClick={() => setOpenId(d.id)}
                  >
                    查看交付
                  </button>
                </div>
              </div>
            </SwipeToDelete>
          );
        })}
      </div>
    </section>
  );
}

// ─── KanbanBoard — Phase 1: unified single-scroll 4-section board ─────────────
//
// Sections (top→bottom, urgency-ordered):
//   1. 外接任务   — inbound work from peers/superiors/external (outward-facing)
//   2. 团队动态   — running/queued jobs with agent heartbeat
//   3. 刚完成     — recently accepted deliverables (last 24h, up to 6)
//   4. 待办积压   — pending todos (top 3 preview + see-all)
//
// 老板要决定 (blocked-on-owner items) moved to 小秘 "需要老板处理" strip.
// Auto-refresh: 10s poll while tab visible; manual 刷新 button in header.

function KanbanSectionHeader({ label, count, extra }: { label: string; count?: number; extra?: string | undefined }) {
  return (
    <div className="kb-section-header">
      <span className="kb-section-label">{label}</span>
      {count !== undefined && <span className="kb-section-count">{count}</span>}
      {extra && <span className="kb-section-extra">{extra}</span>}
    </div>
  );
}

function WorkTracker({ onTalkToSecretary, initialDelivId }: { onTalkToSecretary: (text: string) => void; initialDelivId?: string | null }) {
  // ── shared data ────────────────────────────────────────────────────────
  // Lazy-init from kanban cache for instant first-paint (no loading flash).
  const [deliverables, setDeliverables] = useState<Deliverable[]>(() => getCachedKanban()?.deliverables ?? []);
  const [jobs, setJobs] = useState<JobRow[]>(() => getCachedKanban()?.jobs ?? []);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [staffNames, setStaffNames] = useState<Map<string, string>>(() => new Map(getCachedKanban()?.staffNames ?? []));
  const [latestOutput, setLatestOutput] = useState<Record<string, string>>({}); // staff_id → latest terminal line
  const [liveStaffId, setLiveStaffId] = useState<string | null>(null);
  const [loading, setLoading] = useState(() => getCachedKanban() === null);
  const [error, setError] = useState('');
  // deliverable detail/review overlay
  const [openDelivId, setOpenDelivId] = useState<string | null>(() => initialDelivId ?? null);
  const [delivDetail, setDelivDetail] = useState<GetDeliverableResponse | null>(null);
  const [delivDetailLoading, setDelivDetailLoading] = useState(false);
  const [delivDetailError, setDelivDetailError] = useState('');
  // todo add input (in section 4)
  const [todoInput, setTodoInput] = useState('');
  const [todoAdding, setTodoAdding] = useState(false);

  // ── loaders ────────────────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    setError('');
    try {
      const [dRes, jRes, tRes, sRes] = await Promise.all([
        holonApiFetch('/api/v1/deliverables', { cache: 'no-store' }),
        holonApiFetch('/api/v1/jobs', { cache: 'no-store' }),
        holonApiFetch('/api/v1/todos?status=pending', { cache: 'no-store' }),
        holonApiFetch('/api/v1/staff', { cache: 'no-store' }),
      ]);
      const [dj, jj, tj, sj] = await Promise.all([
        dRes.ok ? (dRes.json() as Promise<ListDeliverablesResponse>) : Promise.resolve({ items: [] }),
        jRes.ok ? (jRes.json() as Promise<{ items?: JobRow[] }>) : Promise.resolve({ items: [] }),
        tRes.ok ? (tRes.json() as Promise<ListTodosResponse>) : Promise.resolve({ items: [] }),
        sRes.ok ? (sRes.json() as Promise<ListStaffResponse>) : Promise.resolve({ items: [] }),
      ]);
      const delivItems = Array.isArray(dj.items) ? dj.items : [];
      const jobItems = Array.isArray(jj.items) ? jj.items : [];
      setDeliverables(delivItems);
      setCachedDeliverables(delivItems);
      setJobs(jobItems);
      const pending = Array.isArray(tj.items) ? tj.items.filter((t) => t.status === 'pending') : [];
      pending.sort((a, b) => {
        const pa = PRIORITY_ORDER[a.priority ?? 'medium'] ?? 1;
        const pb = PRIORITY_ORDER[b.priority ?? 'medium'] ?? 1;
        return pa - pb;
      });
      setTodos(pending);
      const nm = new Map<string, string>();
      for (const s of (Array.isArray(sj.items) ? sj.items : [])) {
        if (s.name) nm.set(s.id, s.name);
      }
      setStaffNames(nm);
      // Write-through kanban composite cache
      setCachedKanban({ deliverables: delivItems, jobs: jobItems, staffNames: [...nm.entries()] });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // ── auto-refresh: 10s poll while visible ──────────────────────────────
  useEffect(() => {
    let h: ReturnType<typeof setInterval> | null = null;
    const stop = () => { if (h !== null) { clearInterval(h); h = null; } };
    const start = () => { if (h === null) h = setInterval(() => void loadAll(), 10000); };
    const onVis = () => {
      if (typeof document !== 'undefined' && document.hidden) { stop(); }
      else { void loadAll(); start(); }
    };
    void loadAll();
    if (typeof document === 'undefined' || !document.hidden) start();
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVis);
    return () => { stop(); if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVis); };
  }, [loadAll]);

  // ── poll running jobs for latest terminal line ─────────────────────────
  useEffect(() => {
    const running = jobs.filter((j) => j.status === 'running' && j.staff_id);
    if (running.length === 0) return;
    let cancelled = false;
    const pull = async () => {
      const updates: Record<string, string> = {};
      await Promise.all(running.map(async (j) => {
        const sid = j.staff_id;
        if (!sid) return;
        try {
          const r = await holonApiFetch(`/api/v1/staff/${encodeURIComponent(sid)}/cli/output?lines=12`, { cache: 'no-store' });
          if (!r.ok) return;
          const x = await r.json() as { output?: string };
          const line = (x.output ?? '').split('\n').map((s) => s.trim()).filter(Boolean).pop() ?? '';
          if (line) updates[sid] = line.slice(0, 60);
        } catch { /* keep last known */ }
      }));
      if (!cancelled && Object.keys(updates).length) setLatestOutput((p) => ({ ...p, ...updates }));
    };
    void pull();
    const id = window.setInterval(() => void pull(), 5000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [jobs]);

  // ── deliverable detail loader ─────────────────────────────────────────
  useEffect(() => {
    if (!openDelivId) { setDelivDetail(null); return; }
    let cancelled = false;
    setDelivDetailLoading(true);
    setDelivDetailError('');
    holonApiFetch(`/api/v1/deliverables/${encodeURIComponent(openDelivId)}`, { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json() as GetDeliverableResponse;
        if (!cancelled) setDelivDetail(j);
      })
      .catch((e) => { if (!cancelled) setDelivDetailError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setDelivDetailLoading(false); });
    return () => { cancelled = true; };
  }, [openDelivId]);

  // ── deliverable review ────────────────────────────────────────────────
  async function reviewDeliverable(id: string, status: 'accepted' | 'rejected') {
    try {
      const r = await holonApiFetch(`/api/v1/deliverables/${encodeURIComponent(id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json() as GetDeliverableResponse;
      setDelivDetail(j);
      setDeliverables((prev) => prev.map((d) => (d.id === id ? { ...d, status } : d)));
    } catch (e) {
      setDelivDetailError(e instanceof Error ? e.message : String(e));
    }
  }

  // ── todo add ──────────────────────────────────────────────────────────
  async function addTodo() {
    const text = todoInput.trim();
    if (!text || todoAdding) return;
    setTodoAdding(true);
    try {
      const r = await holonApiFetch('/api/v1/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setTodoInput('');
      await loadAll();
    } catch { /* best-effort */ }
    finally { setTodoAdding(false); }
  }

  // ── derived buckets ───────────────────────────────────────────────────
  // (老板要决定 items moved to 小秘 "需要老板处理" strip; 看板 is outward-facing)
  const stuckJobs = jobs.filter((j) => {
    if (j.status !== 'running') return false;
    if (!j.created_at) return false;
    const mins = (Date.now() - new Date(j.created_at).getTime()) / 60000;
    return mins > 20;
  });

  const activeJobs = jobs.filter((j) => j.status === 'queued' || j.status === 'running');
  const nonStuckActive = activeJobs.filter((j) => !stuckJobs.some((s) => s.id === j.id));

  const cutoff24h = Date.now() - 86400 * 1000;
  const recentDone = deliverables
    .filter((d) => d.status === 'accepted' && d.created_at && new Date(d.created_at).getTime() > cutoff24h)
    .slice(0, 6);

  // ── deliverable detail view ────────────────────────────────────────────
  if (openDelivId) {
    const d = delivDetail?.deliverable;
    const reviewable = d && (d.status === 'draft' || d.status === 'final' || d.status === 'revised');
    return (
      <div className="mobile-work" style={{ overflowY: 'auto' }}>
        <button type="button" className="mobile-back-row" onClick={() => setOpenDelivId(null)}>‹ 看板</button>
        {delivDetailLoading && !d && <div className="mobile-empty-panel">加载中…</div>}
        {delivDetailError && <div className="mobile-error">加载失败：{delivDetailError}</div>}
        {d && (
          <article className="mobile-deliverable-detail">
            <div className="mobile-detail-kicker">{STATUS_LABEL[d.status]} · {d.created_at?.slice(0, 10) ?? ''}</div>
            <h2>{d.title}</h2>
            <MarkdownView text={bodyText(d.body)} />
          </article>
        )}
        {d && reviewable && (
          <div className="mobile-deliv-review">
            <button type="button" className="mobile-deliv-reject" onClick={() => void reviewDeliverable(d.id, 'rejected')}>
              ✕ 拒绝
            </button>
            <button type="button" className="mobile-deliv-accept" onClick={() => void reviewDeliverable(d.id, 'accepted')}>
              ✓ 接受
            </button>
          </div>
        )}
        {d && (d.status === 'accepted' || d.status === 'rejected') && (
          <div className="mobile-deliv-reviewed">已{d.status === 'accepted' ? '接受' : '拒绝'} · 可下拉重看</div>
        )}
      </div>
    );
  }

  function elapsedLabel(createdAt: string | undefined): string {
    if (!createdAt) return '';
    const mins = Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000);
    if (mins < 1) return '< 1分';
    if (mins < 60) return `${mins}分`;
    return `${Math.floor(mins / 60)}小时`;
  }

  return (
    <div className="mobile-work" style={{ overflowY: 'auto', flex: '1 1 auto', minHeight: 0 }}>
      {/* ── header — title is rendered by AppHeader above; only the refresh button lives here */}
      <div className="kb-header">
        <button
          type="button"
          className="kb-refresh-btn"
          onClick={() => void loadAll()}
          disabled={loading}
          aria-label="刷新"
        >
          ↻
        </button>
      </div>

      {error && <div className="mobile-error" style={{ margin: '8px 16px' }}>{error}</div>}
      {loading && deliverables.length === 0 && jobs.length === 0 && todos.length === 0 && (
        <div className="mobile-empty-panel">加载中…</div>
      )}

      {/* ──────────────────────────────────────────────────────────── */}
      {/* Section 1: 外接任务 — inbound from peers/superiors/external    */}
      {/* TODO: wire A2A/peer inbound missions when /api/v1/missions      */}
      {/*       (or equivalent) is available; no fake data until then.    */}
      {/* ──────────────────────────────────────────────────────────── */}
      <KanbanSectionHeader label="外接任务" />
      <div className="kb-empty-row kb-empty-mission">暂无外接任务</div>

      {/* ──────────────────────────────────────────────────────────── */}
      {/* Section 2: 团队动态                                         */}
      {/* ──────────────────────────────────────────────────────────── */}
      <KanbanSectionHeader
        label="团队动态"
        count={nonStuckActive.length}
        {...(nonStuckActive.length > 0 ? { extra: '运行中' } : {})}
      />

      {nonStuckActive.length === 0 && (
        <div className="kb-empty-row">暂无进行中的任务</div>
      )}

      {nonStuckActive.map((j) => {
        const staffName = j.staff_id ? (staffNames.get(j.staff_id) ?? j.staff_id) : '未分配';
        const initial = j.staff_id ? j.staff_id.charAt(0).toUpperCase() : '?';
        const jobStatus: 'running' | 'queued' = j.status === 'running' ? 'running' : 'queued';
        const elapsed = elapsedLabel(j.created_at);
        const latestLine = j.staff_id ? latestOutput[j.staff_id] : undefined;
        return (
          <div key={j.id} className="kb-card kb-card-inflight">
            <div className="kb-card-accent kb-accent-green" />
            <div className="kb-card-body">
              <div className="kb-card-row1">
                <AssigneeAvatar initial={initial} />
                <span className="kb-card-name">{staffName}</span>
                <JobStatusPill status={jobStatus} />
                {elapsed && <span className="weizo-kanban-elapsed">⏱ {elapsed}</span>}
                <button
                  type="button"
                  className="kb-ghost-btn"
                  disabled={!j.staff_id}
                  onClick={() => j.staff_id && setLiveStaffId(j.staff_id)}
                >
                  实时
                </button>
              </div>
              <div className="kb-card-latest">
                &gt; {jobStatus === 'queued' ? '等待：排队中…' : (latestLine ?? '运行中…')}
              </div>
            </div>
          </div>
        );
      })}

      {/* ──────────────────────────────────────────────────────────── */}
      {/* Section 3: 待验收 — deliverables awaiting review            */}
      {/* ──────────────────────────────────────────────────────────── */}
      {(() => {
        const pendingReview = deliverables.filter(
          (d) => d.status === 'draft' || d.status === 'final' || d.status === 'revised'
        );
        return (
          <>
            <KanbanSectionHeader label="待验收" count={pendingReview.length} />
            {pendingReview.length === 0 && (
              <div className="kb-empty-row">暂无待验收交付</div>
            )}
            {pendingReview.map((d) => {
              const authorName = d.author_staff_id ? (staffNames.get(d.author_staff_id) ?? d.author_staff_id) : '—';
              return (
                <div key={d.id} className="kb-compact-row">
                  <span className="kb-done-check" aria-hidden="true">📄</span>
                  <span className="kb-compact-title">{d.title}</span>
                  <span className="kb-compact-meta"> · {authorName} · {d.created_at ? timeAgo(d.created_at) : '—'}</span>
                  <button
                    type="button"
                    className="kb-look-btn"
                    onClick={() => setOpenDelivId(d.id)}
                  >
                    验收
                  </button>
                </div>
              );
            })}
          </>
        );
      })()}

      {/* ──────────────────────────────────────────────────────────── */}
      {/* Section 4: 刚完成                                           */}
      {/* ──────────────────────────────────────────────────────────── */}
      <KanbanSectionHeader
        label="刚完成"
        count={recentDone.length}
        {...(recentDone.length > 0 ? { extra: '今日' } : {})}
      />

      {recentDone.length === 0 && (
        <div className="kb-empty-row">今日暂无完成交付</div>
      )}

      {recentDone.map((d) => {
        const authorName = d.author_staff_id ? (staffNames.get(d.author_staff_id) ?? d.author_staff_id) : '—';
        return (
          <div key={d.id} className="kb-compact-row">
            <span className="kb-done-check" aria-hidden="true">✓</span>
            <span className="kb-compact-title">{d.title}</span>
            <span className="kb-compact-meta"> · {authorName} · {d.created_at ? timeAgo(d.created_at) : '—'}</span>
            <button
              type="button"
              className="kb-look-btn"
              onClick={() => setOpenDelivId(d.id)}
            >
              看
            </button>
          </div>
        );
      })}

      {/* ──────────────────────────────────────────────────────────── */}
      {/* Section 5: 待派                                             */}
      {/* ──────────────────────────────────────────────────────────── */}
      <KanbanSectionHeader label="待派" count={todos.length} />

      {/* Quick-add input */}
      <div className="weizo-todo-compose" style={{ margin: '0 0 4px 0' }}>
        <input
          className="weizo-todo-input"
          value={todoInput}
          onChange={(ev) => setTodoInput(ev.target.value)}
          onKeyDown={(ev) => { if (ev.key === 'Enter') { ev.preventDefault(); void addTodo(); } }}
          placeholder="＋ 新增待办…"
          disabled={todoAdding}
        />
        <button
          type="button"
          className="weizo-todo-add"
          onClick={() => void addTodo()}
          disabled={todoAdding || !todoInput.trim()}
        >
          {todoAdding ? '…' : '加'}
        </button>
      </div>

      {todos.length === 0 && (
        <div className="kb-empty-row">暂无待派任务</div>
      )}

      {todos.slice(0, 3).map((t) => {
        const priority = t.priority ?? 'medium';
        return (
          <div key={t.id} className="kb-compact-row kb-todo-row">
            <button
              type="button"
              className="weizo-priority-tag"
              style={{ background: PRIORITY_COLOR[priority], marginRight: 6, flexShrink: 0 }}
              title={`优先级：${PRIORITY_LABEL[priority]}`}
              aria-label={`优先级 ${PRIORITY_LABEL[priority]}`}
              onClick={() => {/* priority cycling not in compact view */}}
            >
              {PRIORITY_LABEL[priority]}
            </button>
            <span className="kb-compact-title" style={{ color: PRIORITY_TEXT_COLOR[priority] }}>{t.text}</span>
            {t.due_date && (
              <span className="weizo-todo-due" style={isOverdue(t.due_date) ? { color: '#e0533a', marginLeft: 4 } : { marginLeft: 4 }}>
                📅 {shortDate(t.due_date)}
              </span>
            )}
            <button
              type="button"
              className="kb-delegate-btn"
              onClick={() => onTalkToSecretary(t.text)}
              title="派给小秘"
              aria-label="派活"
            >
              派活 💬
            </button>
          </div>
        );
      })}

      {todos.length > 3 && (
        <div className="kb-see-all-row">
          <button
            type="button"
            className="kb-see-all-btn"
            onClick={() => onTalkToSecretary(`查看全部 ${todos.length} 条待办`)}
          >
            查看全部 {todos.length} 条 →
          </button>
        </div>
      )}

      {/* ── terminal overlay ──────────────────────────────────────── */}
      {liveStaffId && (
        <div className="mobile-live-overlay" role="dialog" aria-modal="true">
          <div className="mobile-live-sheet">
            <div className="mobile-live-head">
              <span>实时终端</span>
              <button type="button" className="mobile-live-close" onClick={() => setLiveStaffId(null)}>关闭</button>
            </div>
            <StaffTerminal staffId={liveStaffId} />
          </div>
        </div>
      )}

      {/* bottom padding */}
      <div style={{ height: 32 }} />
    </div>
  );
}

// ─── CLI 用量 — local log stats ───────────────────────────────────────────────

interface CliUsageEntry {
  binary: string;
  label: string;
  in_use: boolean;
  usage?: {
    today_tokens: number;
    week_tokens: number;
    total_tokens: number;
    since: string;
    last_scan: string;
  };
}

interface AgentUsageEntry {
  id: string;
  name: string;
  total_tokens: number;
  today_tokens: number;
}

interface CliUsageResponse {
  clis: CliUsageEntry[];
  agents?: AgentUsageEntry[];
  note: string;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

// ─── Token 用量 — drill-in detail view ───────────────────────────────────────

function UsageDetail({ onBack }: { onBack: () => void }) {
  // Instant first-paint from local cache (owner: "token使用量也要缓存,不能每次都去抓").
  // Then refresh silently — no loading flash when cache is present.
  const [data, setData] = useState<CliUsageResponse | null>(() => getCachedUsage());
  const [loading, setLoading] = useState<boolean>(() => getCachedUsage() === null);

  useEffect(() => {
    holonApiFetch('/api/v1/usage', { cache: 'no-store' })
      .then((r) => r.ok ? r.json() as Promise<CliUsageResponse> : Promise.resolve(null))
      .then((d) => { if (d) { setData(d); setCachedUsage(d); } })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  const agents = useMemo(() => {
    const raw = data && Array.isArray(data.agents) ? data.agents : [];
    return [...raw].sort((a, b) => b.total_tokens - a.total_tokens);
  }, [data]);

  const maxAgentTokens = agents.length > 0 ? (agents[0]?.total_tokens ?? 1) : 1;

  return (
    <div className="mobile-me">
      <button type="button" className="mobile-back-row" onClick={onBack}>‹ 返回</button>
      <div className="mobile-me-section">
        <div className="mobile-me-label">Token 用量</div>
        {loading && !data && <div className="mobile-me-note">加载中…</div>}
        {data && (
          <>
            <div className="weizo-clilist">
              {data.clis.map((cli) => (
                <div key={cli.binary} className="weizo-clilist-row">
                  <span className="weizo-clilist-dot">{cli.in_use ? '●' : '○'}</span>
                  <span className="weizo-clilist-label">{cli.label}</span>
                  {cli.usage && (
                    <span className="weizo-clilist-tokens">
                      今日 ~{fmtTokens(cli.usage.today_tokens)} · 本周 ~{fmtTokens(cli.usage.week_tokens)} · 总计 ~{fmtTokens(cli.usage.total_tokens)}
                    </span>
                  )}
                </div>
              ))}
            </div>
            {agents.length > 0 && (
              <div className="weizo-agentbar-section">
                <div className="weizo-agentbar-title">各 agent 用量(含 sub-agent)</div>
                {agents.map((a) => {
                  const pct = maxAgentTokens > 0 ? Math.max(2, Math.round((a.total_tokens / maxAgentTokens) * 100)) : 2;
                  return (
                    <div key={a.id} className="weizo-agentbar-row">
                      <span className="weizo-agentbar-label">{a.name}</span>
                      <div className="weizo-agentbar-track" aria-label={`${a.name} 总计 ${fmtTokens(a.total_tokens)} tokens`}>
                        <div className="weizo-agentbar-fill" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="weizo-clilist-note">{data.note}</div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── 集成 / 连接服务 — integrations section ──────────────────────────────────

interface MeOwnerData {
  integrations?: Array<{ kind: string; config?: { email_address?: string } }>;
  slack_webhook_url?: string | null;
  discord_webhook_url?: string | null;
  telegram_bot_token?: string | null;
  telegram_chat_id?: string | null;
}

type IntegrationModal =
  | { kind: 'slack' }
  | { kind: 'discord' }
  | { kind: 'telegram' }
  | { kind: 'gmail_hint' }
  | { kind: 'wechat_hint' };

function IntegrationConnectedPill({ label }: { label: string }) {
  return <span className="mobile-intg-pill mobile-intg-pill-connected">{label}</span>;
}
function IntegrationDisconnectedPill() {
  return <span className="mobile-intg-pill mobile-intg-pill-disconnected">未连接</span>;
}
function IntegrationNeutralPill({ label }: { label: string }) {
  return <span className="mobile-intg-pill mobile-intg-pill-neutral">{label}</span>;
}

// ─── 我的 Agent Card — QR block ───────────────────────────────────────────────

function AgentCardSection({ deskBaseUrl }: { deskBaseUrl: string }) {
  const agentCardUrl = `${deskBaseUrl}/.well-known/agent-card.json`;
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(agentCardUrl)}`;

  function copyUrl() {
    navigator.clipboard?.writeText(agentCardUrl).catch(() => undefined);
  }

  return (
    <div className="mobile-me-section">
      <div className="mobile-me-label">连接 AI Agent</div>
      <div className="mobile-me-note" style={{ marginBottom: 8 }}>让另一个 AI Agent 扫码连接你(A2A)</div>
      <div className="mobile-connector-qr-wrap">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={qrSrc}
          alt="Agent Card QR"
          width={180}
          height={180}
          className="mobile-connector-qr-img"
        />
      </div>
      <button
        type="button"
        className="mobile-connector-url-copy"
        onClick={copyUrl}
        title="复制地址"
      >
        <span className="mobile-connector-url-text">{agentCardUrl}</span>
        <span className="mobile-connector-url-copy-icon">⎘</span>
      </button>
    </div>
  );
}

// ─── 微信扫码找小秘 — clawbot QR for others to scan ───────────────────────────

function WechatQrSection() {
  const [qr, setQr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  async function load() {
    setLoading(true);
    setErr('');
    try {
      const r = await holonApiFetch('/api/v1/connectors/wechat/qr', { cache: 'no-store' });
      const j = await r.json().catch(() => ({})) as { qrcode_url?: string; error?: string };
      if (!r.ok || !j.qrcode_url) throw new Error(j.error ?? `HTTP ${r.status}`);
      setQr(j.qrcode_url);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mobile-me-section">
      <div className="mobile-me-label">微信扫码找小秘</div>
      <div className="mobile-me-note" style={{ marginBottom: 8 }}>别人用微信扫这个，直接跟小秘对话(微信码)</div>
      {qr ? (
        <>
          <div className="mobile-connector-qr-wrap">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt="微信二维码" width={200} height={200} className="mobile-connector-qr-img" />
          </div>
          <button type="button" className="mobile-connector-url-copy" onClick={() => void load()} disabled={loading}>
            <span className="mobile-connector-url-text">{loading ? '刷新中…' : '↻ 刷新二维码'}</span>
          </button>
        </>
      ) : (
        <button type="button" className="mobile-secondary-action" onClick={() => void load()} disabled={loading}>
          {loading ? '生成中…' : '生成微信二维码'}
        </button>
      )}
      {err && <div className="mobile-error">微信码获取失败：{err}</div>}
    </div>
  );
}

// ─── 微信连接状态 ─────────────────────────────────────────────────────────────

interface WechatStatusData {
  connected: boolean;
  accountId?: string;
}

function WechatStatusBlock() {
  const [data, setData] = useState<WechatStatusData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    holonApiFetch('/api/v1/connectors/wechat/status', { cache: 'no-store' })
      .then((r) => r.ok ? r.json() as Promise<WechatStatusData> : Promise.resolve(null))
      .then((d) => { setData(d); })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="mobile-me-note">加载微信状态…</div>;

  return data?.connected && data.accountId
    ? <IntegrationConnectedPill label={`已连接 · ${data.accountId}`} />
    : <span className="mobile-me-note">未连接(在桌面连接)</span>;
}

// ─── 插件列表 ─────────────────────────────────────────────────────────────────

interface PluginEntry {
  id: string;
  name: string;
  enabled?: boolean;
}

interface PluginsResponse {
  installed?: PluginEntry[];
  registry?: PluginEntry[];
}

function PluginsBlock() {
  const [installed, setInstalled] = useState<PluginEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    holonApiFetch('/api/v1/plugins', { cache: 'no-store' })
      .then((r) => r.ok ? r.json() as Promise<PluginsResponse> : Promise.resolve(null))
      .then((d) => {
        if (d && Array.isArray(d.installed)) setInstalled(d.installed);
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="mobile-me-note">加载插件…</div>;
  if (installed.length === 0) return <div className="mobile-me-note">暂无已安装插件</div>;

  return (
    <div className="mobile-connector-plugin-list">
      {installed.map((p) => (
        <div key={p.id} className="mobile-connector-plugin-row">
          <span
            className="mobile-connector-plugin-dot"
            style={{ color: p.enabled !== false ? '#34a853' : '#9a9a9a' }}
            aria-hidden="true"
          >●</span>
          <span className="mobile-connector-plugin-name">{p.name ?? p.id}</span>
          <span className="mobile-connector-plugin-status">
            {p.enabled !== false ? '已启用' : '已停用'}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── 扫一扫 / 扫码连接 ───────────────────────────────────────────────────────

type ScanConnectResult =
  | { kind: 'wechat' }
  | { kind: 'a2a'; url: string }
  | { kind: 'unknown'; raw: string };

type A2aConnectState =
  | { phase: 'idle' }
  | { phase: 'connecting' }
  | { phase: 'success'; peerName: string }
  | { phase: 'error'; message: string };

interface A2aConnectResponse {
  ok: boolean;
  peer?: { id?: string; name?: string };
  error?: string;
}

function classifyQrText(text: string): ScanConnectResult {
  const t = text.trim();
  if (/weixin\.qq\.com/i.test(t)) return { kind: 'wechat' };
  if (t.includes('/.well-known/agent-card') || /^https?:\/\//i.test(t)) {
    const base = t.replace(/\/$/, '').replace(/\/\.well-known\/agent-card(\.json)?$/, '');
    return { kind: 'a2a', url: base };
  }
  return { kind: 'unknown', raw: t };
}

function ScanConnectSection() {
  const [scanOpen, setScanOpen] = useState(false);
  const [result, setResult] = useState<ScanConnectResult | null>(null);
  const [a2aState, setA2aState] = useState<A2aConnectState>({ phase: 'idle' });

  function handleResult(text: string) {
    setScanOpen(false);
    const classified = classifyQrText(text);
    setResult(classified);
    setA2aState({ phase: 'idle' });
    if (classified.kind === 'a2a') {
      void connectA2a(classified.url);
    }
  }

  async function connectA2a(url: string) {
    setA2aState({ phase: 'connecting' });
    try {
      const res = await holonApiFetch('/api/v1/a2a/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = await res.json().catch(() => ({})) as A2aConnectResponse;
      if (res.status === 401 || res.status === 403) {
        setA2aState({ phase: 'error', message: '请先在「我」里配对桌面端' });
        return;
      }
      if (!res.ok || !data.ok) {
        setA2aState({ phase: 'error', message: data.error ?? `连接失败 (${res.status})` });
        return;
      }
      const peerName = data.peer?.name ?? url;
      setA2aState({ phase: 'success', peerName });
    } catch (err) {
      setA2aState({ phase: 'error', message: err instanceof Error ? err.message : '网络错误，请重试' });
    }
  }

  function handleClose() {
    setScanOpen(false);
  }

  function reset() {
    setResult(null);
    setA2aState({ phase: 'idle' });
  }

  if (scanOpen) {
    return (
      <QrScanner onResult={handleResult} onClose={handleClose} />
    );
  }

  return (
    <div className="mobile-me-section">
      <div className="mobile-me-label">扫一扫</div>
      <div className="mobile-me-note" style={{ marginBottom: 8 }}>
        用摄像头扫另一个 AI Agent 的二维码，直接完成连接。
      </div>
      <button
        type="button"
        className="mobile-scan-connect-btn"
        onClick={() => { setResult(null); setA2aState({ phase: 'idle' }); setScanOpen(true); }}
      >
        <span className="mobile-scan-connect-icon">📷</span>
        <span>扫一扫 / 扫码连接</span>
      </button>

      {result && (
        <div className="mobile-scan-connect-result">
          {result.kind === 'wechat' && (
            <span className="mobile-scan-connect-hint">
              这是微信码，微信连接请在桌面操作。
            </span>
          )}
          {result.kind === 'a2a' && (
            <>
              {a2aState.phase === 'connecting' && (
                <span className="mobile-scan-connect-hint">
                  连接中…
                </span>
              )}
              {a2aState.phase === 'success' && (
                <span className="mobile-scan-connect-hint mobile-scan-connect-hint-ok">
                  已连接智能体「{a2aState.peerName}」
                </span>
              )}
              {a2aState.phase === 'error' && (
                <span className="mobile-scan-connect-hint mobile-scan-connect-hint-err">
                  连接失败：{a2aState.message}
                </span>
              )}
              {a2aState.phase === 'idle' && (
                <span className="mobile-scan-connect-hint">
                  扫到 A2A 地址：<span className="mobile-scan-connect-url">{result.url}</span>
                </span>
              )}
            </>
          )}
          {result.kind === 'unknown' && (
            <span className="mobile-scan-connect-hint">
              无法识别的二维码。
            </span>
          )}
          <button
            type="button"
            className="mobile-scan-connect-reset"
            onClick={reset}
          >
            清除
          </button>
        </div>
      )}
    </div>
  );
}

// ─── 集成列表 ─────────────────────────────────────────────────────────────────

function IntegrationsSection({ meData, onRefresh }: {
  meData: MeOwnerData | null;
  onRefresh: () => void;
}) {
  const [modal, setModal] = useState<IntegrationModal | null>(null);
  const [inputA, setInputA] = useState('');
  const [inputB, setInputB] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [integOpen, setIntegOpen] = useState(false); // 集成区默认折叠(微信风)

  const integrations = Array.isArray(meData?.integrations) ? meData.integrations : [];
  const gmailLink = integrations.find((i) => i.kind === 'gmail');
  const gmailEmail = gmailLink?.config?.email_address ?? null;

  const slackConnected = typeof meData?.slack_webhook_url === 'string' && meData.slack_webhook_url.length > 0;
  const discordConnected = typeof meData?.discord_webhook_url === 'string' && meData.discord_webhook_url.length > 0;
  const telegramConnected = typeof meData?.telegram_bot_token === 'string' && meData.telegram_bot_token.length > 0;

  function openModal(m: IntegrationModal) {
    setSaveError('');
    setInputA('');
    setInputB('');
    setModal(m);
  }

  function closeModal() {
    if (saving) return;
    setModal(null);
    setSaveError('');
    setInputA('');
    setInputB('');
  }

  async function handleSave() {
    if (!modal || modal.kind === 'gmail_hint' || modal.kind === 'wechat_hint') return;
    const value = inputA.trim();
    const valueB = inputB.trim();

    let body: Record<string, string | null>;
    if (modal.kind === 'slack') {
      if (!value) { setSaveError('请粘贴 Slack Webhook URL'); return; }
      body = { slack_webhook_url: value };
    } else if (modal.kind === 'discord') {
      if (!value) { setSaveError('请粘贴 Discord Webhook URL'); return; }
      body = { discord_webhook_url: value };
    } else {
      // telegram
      if (!value) { setSaveError('请填写 Bot Token'); return; }
      if (!valueB) { setSaveError('请填写 Chat ID'); return; }
      body = { telegram_bot_token: value, telegram_chat_id: valueB };
    }

    setSaving(true);
    setSaveError('');
    try {
      const res = await holonApiFetch('/api/v1/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? `保存失败 HTTP ${res.status}`);
      }
      setModal(null);
      setInputA('');
      setInputB('');
      onRefresh();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const ROWS = [
    {
      key: 'gmail',
      icon: '📧',
      name: '邮件 Gmail',
      pill: gmailEmail
        ? <IntegrationConnectedPill label={`已连接 · ${gmailEmail}`} />
        : <IntegrationDisconnectedPill />,
      action: () => openModal({ kind: 'gmail_hint' }),
    },
    {
      key: 'slack',
      icon: '🔔',
      name: 'Slack',
      pill: slackConnected
        ? <IntegrationConnectedPill label="已连接" />
        : <IntegrationDisconnectedPill />,
      action: () => openModal({ kind: 'slack' }),
    },
    {
      key: 'discord',
      icon: '🎮',
      name: 'Discord',
      pill: discordConnected
        ? <IntegrationConnectedPill label="已连接" />
        : <IntegrationDisconnectedPill />,
      action: () => openModal({ kind: 'discord' }),
    },
    {
      key: 'telegram',
      icon: '✈️',
      name: 'Telegram',
      pill: telegramConnected
        ? <IntegrationConnectedPill label="已连接" />
        : <IntegrationDisconnectedPill />,
      action: () => openModal({ kind: 'telegram' }),
    },
  ] as const;

  const isHintModal = modal?.kind === 'gmail_hint' || modal?.kind === 'wechat_hint';

  return (
    <>
      {/* Scan + Agent Card + WeChat QR all moved into the profile's 扫码连接 sheet. */}

      {/* ── 集成 / 连接服务(默认折叠,微信风)── */}
      <div className="mobile-me-section">
        <button type="button" className="mobile-collapse-head" onClick={() => setIntegOpen((v) => !v)}>
          <span className="mobile-me-row-title">连接服务</span>
          <span className={`mobile-collapse-chevron${integOpen ? ' open' : ''}`}>›</span>
        </button>
        {integOpen && (
          <>
            <div className="mobile-me-note" style={{ margin: '6px 0 8px' }}>这些连接在桌面设置，这里只看状态。</div>

            {/* 微信 live status */}
            <div className="mobile-connector-channel-row">
              <span className="mobile-intg-icon">💬</span>
              <span className="mobile-intg-name">微信</span>
              <span className="mobile-intg-pill-wrap">
                <WechatStatusBlock />
              </span>
            </div>

            {/* 插件 */}
            <div className="mobile-me-label" style={{ marginTop: 12 }}>插件</div>
            <PluginsBlock />

            {/* Gmail / 消息渠道 */}
            <div className="mobile-me-label" style={{ marginTop: 12 }}>Gmail / 消息渠道</div>
            <div className="mobile-intg-list">
              {ROWS.map((row) => (
                <button
                  key={row.key}
                  type="button"
                  className="mobile-intg-row"
                  onClick={row.action}
                >
                  <span className="mobile-intg-icon">{row.icon}</span>
                  <span className="mobile-intg-name">{row.name}</span>
                  <span className="mobile-intg-pill-wrap">{row.pill}</span>
                  <span className="mobile-intg-chevron">›</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {modal && (
        <div
          className="bug-modal-backdrop mobile-intg-backdrop"
          onClick={closeModal}
          role="presentation"
        >
          <div
            className="bug-modal mobile-intg-sheet"
            role="dialog"
            aria-modal="true"
            onClick={(ev) => ev.stopPropagation()}
          >
            <div className="bug-modal-header">
              <h2 className="mobile-intg-sheet-title">
                {modal.kind === 'slack' && 'Slack Webhook'}
                {modal.kind === 'discord' && 'Discord Webhook'}
                {modal.kind === 'telegram' && 'Telegram Bot'}
                {modal.kind === 'gmail_hint' && '邮件 Gmail'}
                {modal.kind === 'wechat_hint' && '微信'}
              </h2>
              <button type="button" className="bug-modal-close" onClick={closeModal} aria-label="关闭">×</button>
            </div>

            {isHintModal ? (
              <p className="mobile-intg-hint">
                {modal.kind === 'gmail_hint'
                  ? 'Gmail 的授权需在桌面完成，连好后这里会自动显示已连接。'
                  : '微信 的授权需在桌面完成，连好后这里会自动显示已连接。'}
              </p>
            ) : (
              <>
                {modal.kind === 'slack' && (
                  <>
                    <label className="mobile-intg-field-label" htmlFor="intg-slack-url">Webhook URL</label>
                    <input
                      id="intg-slack-url"
                      className="mobile-intg-input"
                      type="url"
                      value={inputA}
                      onChange={(ev) => setInputA(ev.target.value)}
                      placeholder="https://hooks.slack.com/services/..."
                      autoComplete="off"
                      disabled={saving}
                    />
                  </>
                )}
                {modal.kind === 'discord' && (
                  <>
                    <label className="mobile-intg-field-label" htmlFor="intg-discord-url">Webhook URL</label>
                    <input
                      id="intg-discord-url"
                      className="mobile-intg-input"
                      type="url"
                      value={inputA}
                      onChange={(ev) => setInputA(ev.target.value)}
                      placeholder="https://discord.com/api/webhooks/..."
                      autoComplete="off"
                      disabled={saving}
                    />
                  </>
                )}
                {modal.kind === 'telegram' && (
                  <>
                    <label className="mobile-intg-field-label" htmlFor="intg-tg-token">Bot Token</label>
                    <input
                      id="intg-tg-token"
                      className="mobile-intg-input"
                      type="text"
                      value={inputA}
                      onChange={(ev) => setInputA(ev.target.value)}
                      placeholder="123456:ABC-..."
                      autoComplete="off"
                      disabled={saving}
                    />
                    <label className="mobile-intg-field-label" htmlFor="intg-tg-chatid" style={{ marginTop: 10 }}>Chat ID</label>
                    <input
                      id="intg-tg-chatid"
                      className="mobile-intg-input"
                      type="text"
                      value={inputB}
                      onChange={(ev) => setInputB(ev.target.value)}
                      placeholder="数字 Chat ID"
                      autoComplete="off"
                      disabled={saving}
                    />
                  </>
                )}
                {saveError && <div className="mobile-error" style={{ marginTop: 10 }}>{saveError}</div>}
                <div className="mobile-intg-sheet-actions">
                  <button
                    type="button"
                    className="mobile-feedback-cancel"
                    onClick={closeModal}
                    disabled={saving}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    className="mobile-feedback-submit"
                    onClick={() => void handleSave()}
                    disabled={saving}
                  >
                    {saving ? '保存中…' : '保存到桌面'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// ─── 我 — me tab ──────────────────────────────────────────────────────────────

type MobileFeedbackAttachment = { file: File; id: string; url: string };
const MAX_FEEDBACK_SCREENSHOTS = 5;

function MeFeedbackDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [description, setDescription] = useState('');
  const [attachments, setAttachments] = useState<MobileFeedbackAttachment[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState('');
  const urlsRef = useRef<string[]>([]);

  useEffect(() => () => { for (const u of urlsRef.current) URL.revokeObjectURL(u); }, []);

  function addFiles(files: File[]) {
    setAttachments((prev) => {
      const room = MAX_FEEDBACK_SCREENSHOTS - prev.length;
      if (room <= 0) { setResult('最多只能附加 5 张截图'); return prev; }
      const accepted = files.slice(0, room).map((file) => {
        const url = URL.createObjectURL(file);
        urlsRef.current.push(url);
        return { file, url, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` };
      });
      return [...prev, ...accepted];
    });
  }

  function onFileChange(ev: ChangeEvent<HTMLInputElement>) {
    const files = ev.target.files ? Array.from(ev.target.files) : [];
    addFiles(files);
    ev.target.value = '';
  }

  async function submit() {
    const text = description.trim();
    if (!text) { setResult('请先填写反馈内容'); return; }
    setSubmitting(true);
    setResult('');
    try {
      // Encode attached screenshots as data URLs so the desk can persist them.
      const screenshots = await Promise.all(
        attachments.map(
          (a) =>
            new Promise<{ data_url: string; filename: string | null }>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve({ data_url: String(reader.result), filename: a.file.name || null });
              reader.onerror = () => reject(new Error('读取截图失败'));
              reader.readAsDataURL(a.file);
            }),
        ),
      );
      const response = await holonApiFetch('/api/v1/admin/bugs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: text,
          url: window.location.href,
          route: window.location.pathname,
          ts: new Date().toISOString(),
          viewport: { w: window.innerWidth, h: window.innerHeight },
          user_agent: navigator.userAgent,
          screenshots,
        }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string; bug_id?: string };
      if (!response.ok) throw new Error(body.error ?? `提交失败 HTTP ${response.status}`);
      setResult(`已提交：${body.bug_id ?? '反馈已收到'}`);
      setDescription('');
      setAttachments([]);
    } catch (err) {
      setResult(`提交失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;
  return (
    <div className="bug-modal-backdrop mobile-feedback-backdrop" onClick={onClose} role="presentation">
      <div
        className="bug-modal mobile-feedback-modal"
        onClick={(ev) => ev.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="反馈 / 报错"
      >
        <div className="bug-modal-header">
          <h2 className="mobile-feedback-title">反馈 / 报错</h2>
          <button type="button" className="bug-modal-close" onClick={onClose} aria-label="关闭">×</button>
        </div>
        <div className="mobile-feedback-body">
          <label className="mobile-feedback-label" htmlFor="weizo-feedback-desc">反馈内容</label>
          <textarea
            id="weizo-feedback-desc"
            value={description}
            onChange={(ev) => setDescription(ev.target.value)}
            rows={5}
            className="bug-modal-textarea mobile-feedback-textarea"
            placeholder="请描述你遇到的问题或建议（可语音）。"
          />
          <div className="mobile-feedback-voice-row">
            <MobileVoiceRecorderButton onTranscript={(t) => setDescription((d) => (d ? `${d} ${t}` : t))} />
            <span className="mobile-feedback-voice-hint">按住说话，自动转文字</span>
          </div>
          <label className="mobile-feedback-label" htmlFor="weizo-feedback-files">
            截图（可选，最多 {MAX_FEEDBACK_SCREENSHOTS} 张）
          </label>
          <input
            id="weizo-feedback-files"
            type="file"
            accept="image/*"
            multiple
            onChange={onFileChange}
            disabled={attachments.length >= MAX_FEEDBACK_SCREENSHOTS}
            className="mobile-feedback-file"
          />
        </div>
        <div className="mobile-feedback-actions">
          {result && <span className="mobile-feedback-result">{result}</span>}
          <button type="button" className="mobile-feedback-cancel" onClick={onClose} disabled={submitting}>取消</button>
          <button
            type="button"
            className="mobile-feedback-submit"
            onClick={() => void submit()}
            disabled={submitting || !description.trim()}
          >
            {submitting ? '提交中…' : '提交'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── OwnerChatSearch — 搜索小秘聊天记录 ────────────────────────────────────────

interface ChatHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

function OwnerChatSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ChatHistoryMessage[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    holonApiFetch('/api/v1/chat/history?thread=owner', { cache: 'no-store' })
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) { setResults([]); return; }
        const data = await res.json().catch(() => ({})) as { messages?: Array<{ role?: unknown; content?: unknown }> };
        const raw = Array.isArray(data.messages) ? data.messages : [];
        const q = query.trim().toLowerCase();
        const matched = raw
          .filter((m): m is ChatHistoryMessage =>
            (m.role === 'user' || m.role === 'assistant') &&
            typeof m.content === 'string' &&
            (m.content as string).toLowerCase().includes(q),
          ) as ChatHistoryMessage[];
        if (!cancelled) setResults(matched);
      })
      .catch(() => { if (!cancelled) setResults([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [query]);

  return (
    <div className="owner-chat-search">
      <div className="owner-chat-search-bar">
        <span className="owner-chat-search-icon" aria-hidden="true">🔍</span>
        <input
          type="search"
          className="owner-chat-search-input"
          placeholder="搜索聊天记录"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="搜索聊天记录"
        />
        {query && (
          <button
            type="button"
            className="owner-chat-search-clear"
            aria-label="清除搜索"
            onClick={() => setQuery('')}
          >
            ✕
          </button>
        )}
      </div>
      {query.trim() && (
        <div className="owner-chat-search-results" role="listbox" aria-label="搜索结果">
          {loading && <div className="owner-chat-search-empty">搜索中…</div>}
          {!loading && results.length === 0 && (
            <div className="owner-chat-search-empty">无匹配</div>
          )}
          {!loading && results.map((msg, i) => (
            <button
              key={i}
              type="button"
              className="owner-chat-search-result"
              role="option"
              aria-selected={false}
              onClick={() => setQuery('')}
            >
              <span className={`owner-chat-search-role${msg.role === 'user' ? ' is-user' : ''}`}>
                {msg.role === 'user' ? '我' : '小秘'}
              </span>
              <span className="owner-chat-search-snippet">
                {msg.content.length > 60 ? msg.content.slice(0, 60) + '…' : msg.content}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── 请示 strip — real-time interrupts requiring the boss's instruction/decision ──
// Union of:
//   (a) chat-derived action items from /api/v1/chat/owner-actions
//   (b) stuck jobs (running > 20min) → secretary surfaces "卡住"
// (待验收 deliverables moved to 看板)
// Collapsed by default; auto-collapse on composer touch.
const OWNER_ACTIONS_CACHE = 'holon.mobile.ownerActions.v1';

function readCachedActions(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(OWNER_ACTIONS_CACHE);
    const j = raw ? JSON.parse(raw) : [];
    return Array.isArray(j) ? j.filter((x): x is string => typeof x === 'string') : [];
  } catch { return []; }
}

interface BlockerItem {
  kind: 'job';
  id: string;
  label: string;
  staffId?: string | undefined;
}

function OwnerTodoStrip({
  onOpenStaff,
}: {
  onOpenStaff: (staffId: string) => void;
}) {
  const [chatItems, setChatItems] = useState<string[]>(() => readCachedActions());
  const [blockers, setBlockers] = useState<BlockerItem[]>([]);
  const [collapsed, setCollapsed] = useState(true);

  // (a) chat-derived action items
  useEffect(() => {
    holonApiFetch('/api/v1/chat/owner-actions', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() as Promise<{ items?: string[] }> : Promise.resolve(null)))
      .then((d) => {
        if (d && Array.isArray(d.items)) {
          setChatItems(d.items);
          try { window.localStorage.setItem(OWNER_ACTIONS_CACHE, JSON.stringify(d.items)); } catch { /* noop */ }
        }
      })
      .catch(() => undefined);
  }, []);

  // (b) stuck jobs (running > 20min) — real-time interrupt for the boss
  useEffect(() => {
    let cancelled = false;
    async function fetchBlockers() {
      try {
        const [jRes, sRes] = await Promise.all([
          holonApiFetch('/api/v1/jobs', { cache: 'no-store' }),
          holonApiFetch('/api/v1/staff', { cache: 'no-store' }),
        ]);
        const [jj, sj] = await Promise.all([
          jRes.ok ? (jRes.json() as Promise<{ items?: JobRow[] }>) : Promise.resolve({ items: [] }),
          sRes.ok ? (sRes.json() as Promise<ListStaffResponse>) : Promise.resolve({ items: [] }),
        ]);
        if (cancelled) return;

        const staffNames = new Map<string, string>();
        for (const s of (Array.isArray(sj.items) ? sj.items : [])) {
          if (s.name) staffNames.set(s.id, s.name);
        }

        const list: BlockerItem[] = [];

        // stuck jobs (running > 20min)
        const allJobs = Array.isArray(jj.items) ? jj.items : [];
        const now = Date.now();
        for (const j of allJobs) {
          if (j.status !== 'running' || !j.created_at) continue;
          const mins = (now - new Date(j.created_at).getTime()) / 60000;
          if (mins <= 20) continue;
          const agentName = j.staff_id ? (staffNames.get(j.staff_id) ?? j.staff_id) : '未知员工';
          list.push({ kind: 'job', id: j.id, label: `⚠ ${agentName} 卡住`, staffId: j.staff_id ?? undefined });
        }

        setBlockers(list);
      } catch { /* best-effort */ }
    }
    void fetchBlockers();
    const h = window.setInterval(() => void fetchBlockers(), 30000);
    return () => { cancelled = true; window.clearInterval(h); };
  }, []);

  // Auto-collapse the moment the boss touches the composer
  useEffect(() => {
    function onDown(ev: Event) {
      const t = ev.target as HTMLElement | null;
      if (t?.closest('.mobile-chat-composer')) setCollapsed(true);
    }
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, []);

  const totalCount = chatItems.length + blockers.length;
  if (totalCount === 0) return null;

  return (
    <div className="mobile-todo-strip">
      <button type="button" className="mobile-todo-strip-head" onClick={() => setCollapsed((v) => !v)}>
        <span className="mobile-todo-strip-title">请示 · {totalCount}</span>
        <span className="mobile-todo-strip-more">{collapsed ? '展开 ›' : '收起 ⌄'}</span>
        <button
          type="button"
          aria-label="隐藏请示"
          onClick={(e) => { e.stopPropagation(); setShowOwnerTodo(false); }}
          style={{ background: 'none', border: 'none', padding: '0 4px', cursor: 'pointer', fontSize: 16, lineHeight: 1, color: 'inherit', opacity: 0.5 }}
        >×</button>
      </button>
      {!collapsed && (
        <>
          {/* work-blocker items — tappable navigation */}
          {blockers.map((b) => (
            <button
              key={b.id}
              type="button"
              className="mobile-todo-line mobile-todo-line-tappable"
              onClick={() => {
                if (b.staffId) {
                  onOpenStaff(b.staffId);
                }
              }}
            >
              <span className="mobile-todo-mark">●</span>
              <span className="mobile-todo-text">{b.label}</span>
              <span className="mobile-todo-nav-hint">›</span>
            </button>
          ))}
          {/* chat-derived items — plain text, no nav */}
          {chatItems.slice(0, 3).map((t, i) => (
            <div key={`chat-${i}`} className="mobile-todo-line">
              <span className="mobile-todo-mark">○</span>
              <span className="mobile-todo-text">{t}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

// ─── 员工详情 — 点进默认落在 聊天 或 看后台(每员工可在配置里选);齿轮 ⚙ → 配置 ──
// Owner 2026-05-25: one landing view per employee (chat OR terminal), chosen in
// config. No top tab bar. Per-device preference in localStorage.
const STAFF_LANDING_KEY = 'holon.mobile.staffLanding.v1';
function getStaffLanding(id: string): 'chat' | 'terminal' {
  // Default = 'terminal': all employees are tmux-driven now (unified model);
  // open straight to the 后台 terminal unless the owner explicitly picked 前台.
  if (typeof window === 'undefined') return 'terminal';
  try { return window.localStorage.getItem(`${STAFF_LANDING_KEY}.${id}`) === 'chat' ? 'chat' : 'terminal'; }
  catch { return 'terminal'; }
}
function setStaffLanding(id: string, v: 'chat' | 'terminal'): void {
  try { window.localStorage.setItem(`${STAFF_LANDING_KEY}.${id}`, v); } catch { /* noop */ }
}

// ─── 语音输入模式偏好 (Feature 2) ──────────────────────────────────────────────
// '1' = 直接发送 (default), '0' = 先填入可编辑
const VOICE_AUTO_SEND_KEY = 'holon.mobile.voiceAutoSend.v1';
function getVoiceAutoSend(): boolean {
  if (typeof window === 'undefined') return true;
  try { return window.localStorage.getItem(VOICE_AUTO_SEND_KEY) !== '0'; }
  catch { return true; }
}
function setVoiceAutoSend(b: boolean): void {
  try { window.localStorage.setItem(VOICE_AUTO_SEND_KEY, b ? '1' : '0'); } catch { /* noop */ }
}

// ─── 请示提醒显示偏好 ────────────────────────────────────────────────────────
// '1' = 显示 (default), '0' = 隐藏
const SHOW_OWNER_TODO_KEY = 'holon.mobile.showOwnerTodo.v1';
function getShowOwnerTodo(): boolean {
  if (typeof window === 'undefined') return true;
  try { return window.localStorage.getItem(SHOW_OWNER_TODO_KEY) !== '0'; }
  catch { return true; }
}
function setShowOwnerTodo(b: boolean): void {
  try {
    window.localStorage.setItem(SHOW_OWNER_TODO_KEY, b ? '1' : '0');
    window.dispatchEvent(new Event('holon:ownerTodoPrefChange'));
  } catch { /* noop */ }
}

// ─── 总结面板偏好 (每员工 per-staff, localStorage) ───────────────────────────
// '1' = 显示, '0' = 关闭 (default 关闭)
const SUMMARY_ENABLED_KEY = 'holon.mobile.summaryEnabled.v1';
function getSummaryEnabled(staffId: string): boolean {
  if (typeof window === 'undefined') return false;
  try { return window.localStorage.getItem(`${SUMMARY_ENABLED_KEY}.${staffId}`) === '1'; }
  catch { return false; }
}
function setSummaryEnabled(staffId: string, b: boolean): void {
  try {
    window.localStorage.setItem(`${SUMMARY_ENABLED_KEY}.${staffId}`, b ? '1' : '0');
    window.dispatchEvent(new CustomEvent('holon:summaryEnabledChange', { detail: { staffId, enabled: b } }));
  } catch { /* noop */ }
}

// ─── Generic local-cache helper (SSR-safe, JSON, best-effort) ────────────────
// localCache.get<T>(key) → T | null (null on miss / SSR / parse error)
// localCache.set(key, value) → void (swallows localStorage errors)
const localCache = {
  get<T>(key: string): T | null {
    if (typeof window === 'undefined') return null;
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw) as T;
    } catch { return null; }
  },
  set<T>(key: string, value: T): void {
    if (typeof window === 'undefined') return;
    try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* noop */ }
  },
};

// ─── Staff cache ─────────────────────────────────────────────────────────────
const STAFF_CACHE_KEY = 'holon.mobile.staffCache.v1';
function getCachedStaff(): Staff[] {
  return localCache.get<Staff[]>(STAFF_CACHE_KEY) ?? [];
}
function setCachedStaff(items: Staff[]): void {
  localCache.set(STAFF_CACHE_KEY, items);
}

// ─── Deliverables cache ───────────────────────────────────────────────────────
const DELIVERABLES_CACHE_KEY = 'holon.mobile.deliverablesCache.v1';
function getCachedDeliverables(): Deliverable[] {
  return localCache.get<Deliverable[]>(DELIVERABLES_CACHE_KEY) ?? [];
}
function setCachedDeliverables(items: Deliverable[]): void {
  localCache.set(DELIVERABLES_CACHE_KEY, items);
}

// ─── Kanban composite cache ───────────────────────────────────────────────────
interface KanbanCached { deliverables: Deliverable[]; staffNames: Array<[string, string]>; jobs: JobRow[] }
const KANBAN_CACHE_KEY = 'holon.mobile.kanbanCache.v1';
function getCachedKanban(): KanbanCached | null {
  return localCache.get<KanbanCached>(KANBAN_CACHE_KEY);
}
function setCachedKanban(v: KanbanCached): void {
  localCache.set(KANBAN_CACHE_KEY, v);
}

// ─── Skills cache ─────────────────────────────────────────────────────────────
const SKILLS_CACHE_KEY = 'holon.mobile.skillsCache.v1';
function getCachedSkills(): SkillDescriptor[] {
  return localCache.get<SkillDescriptor[]>(SKILLS_CACHE_KEY) ?? [];
}
function setCachedSkills(items: SkillDescriptor[]): void {
  localCache.set(SKILLS_CACHE_KEY, items);
}

// ─── References count cache ───────────────────────────────────────────────────
const REFERENCES_CACHE_KEY = 'holon.mobile.referencesCache.v1';
function getCachedReferenceCount(): number | null {
  return localCache.get<number>(REFERENCES_CACHE_KEY);
}
function setCachedReferenceCount(n: number): void {
  localCache.set(REFERENCES_CACHE_KEY, n);
}

// ─── Owner snapshot cache ─────────────────────────────────────────────────────
const OWNER_SNAPSHOT_CACHE_KEY = 'holon.mobile.ownerSnapshotCache.v1';
function getCachedOwnerSnapshot(): OwnerSnapshot | null {
  return localCache.get<OwnerSnapshot>(OWNER_SNAPSHOT_CACHE_KEY);
}
function setCachedOwnerSnapshot(v: OwnerSnapshot): void {
  localCache.set(OWNER_SNAPSHOT_CACHE_KEY, v);
}

// ─── Room members per-room cache ──────────────────────────────────────────────
const ROOM_MEMBERS_CACHE_PREFIX = 'holon.mobile.roomMembersCache.v1.';
function getCachedRoomMembers(roomId: string): RoomMember[] {
  return localCache.get<RoomMember[]>(`${ROOM_MEMBERS_CACHE_PREFIX}${roomId}`) ?? [];
}
function setCachedRoomMembers(roomId: string, members: RoomMember[]): void {
  localCache.set(`${ROOM_MEMBERS_CACHE_PREFIX}${roomId}`, members);
}

// ─── Personas cache ───────────────────────────────────────────────────────────
const PERSONAS_CACHE_KEY = 'holon.mobile.personasCache.v1';
function getCachedPersonas(): PersonaPreset[] {
  return localCache.get<PersonaPreset[]>(PERSONAS_CACHE_KEY) ?? [];
}
function setCachedPersonas(items: PersonaPreset[]): void {
  localCache.set(PERSONAS_CACHE_KEY, items);
}

// ─── Owner-actions cache ──────────────────────────────────────────────────────
// Separate key from legacy OWNER_ACTIONS_CACHE used by OwnerTodoStrip.
const OWNER_ACTIONS_CACHE_KEY = 'holon.mobile.ownerActionsCache.v1';
function getCachedOwnerActionsNew(): string[] {
  return localCache.get<string[]>(OWNER_ACTIONS_CACHE_KEY) ?? [];
}
function setCachedOwnerActionsNew(items: string[]): void {
  localCache.set(OWNER_ACTIONS_CACHE_KEY, items);
}

// ─── 终端本地缓存 (instant first-paint; silent background refresh) ────────────
// Owner: "刚开始时停留在那边,后来抓的时候也不要通知客户" — don't make me wait for the
// fetch every time I open 看后台. Cache last seen output + hash per staff; on
// mount, populate from cache instantly + initial load runs silently.
const TERM_CACHE_KEY = 'holon.mobile.termCache.v1';
interface TermCache { output: string; hash: string }
function getCachedTerminal(staffId: string): TermCache | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(`${TERM_CACHE_KEY}.${staffId}`);
    if (!raw) return null;
    const j = JSON.parse(raw) as Partial<TermCache>;
    if (typeof j.output !== 'string' || typeof j.hash !== 'string') return null;
    return { output: j.output, hash: j.hash };
  } catch { return null; }
}
function setCachedTerminal(staffId: string, output: string, hash: string): void {
  try { window.localStorage.setItem(`${TERM_CACHE_KEY}.${staffId}`, JSON.stringify({ output, hash })); }
  catch { /* localStorage full / disabled — fine, it's a perf cache */ }
}

// ─── 总结面板本地缓存 (instant first-paint; only new summaries shown) ─────────
const SUMMARY_CACHE_KEY = 'holon.mobile.summaryCache.v1';
interface CachedSummary { role: string; content: string }
function getCachedSummary(staffId: string): CachedSummary[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(`${SUMMARY_CACHE_KEY}.${staffId}`);
    if (!raw) return [];
    const j = JSON.parse(raw) as unknown;
    if (!Array.isArray(j)) return [];
    return j
      .filter((x): x is CachedSummary => typeof x === 'object' && x !== null
        && typeof (x as { role?: unknown }).role === 'string'
        && typeof (x as { content?: unknown }).content === 'string')
      .map((x) => ({ role: x.role, content: x.content }));
  } catch { return []; }
}
function setCachedSummary(staffId: string, msgs: CachedSummary[]): void {
  try { window.localStorage.setItem(`${SUMMARY_CACHE_KEY}.${staffId}`, JSON.stringify(msgs)); }
  catch { /* noop */ }
}

// ─── Token usage 本地缓存 (instant first-paint) ─────────────────────────────
const USAGE_CACHE_KEY = 'holon.mobile.usageCache.v1';
function getCachedUsage(): CliUsageResponse | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(USAGE_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CliUsageResponse;
  } catch { return null; }
}
function setCachedUsage(d: CliUsageResponse): void {
  try { window.localStorage.setItem(USAGE_CACHE_KEY, JSON.stringify(d)); }
  catch { /* noop */ }
}

// ─── Room localStorage helpers ────────────────────────────────────────────────

const ROOMS_LIST_CACHE_KEY = 'holon.mobile.roomsListCache.v1';
const ROOM_MSGS_CACHE_PREFIX = 'holon.mobile.roomMessagesCache.v1.';

// ─── Secretary projects cache ─────────────────────────────────────────────────
const SECRETARY_PROJECTS_CACHE_KEY = 'holon.mobile.secretaryProjectsCache.v1';
function getCachedSecretaryProjects(): SecretaryProjectWithStaff[] {
  return localCache.get<SecretaryProjectWithStaff[]>(SECRETARY_PROJECTS_CACHE_KEY) ?? [];
}
function setCachedSecretaryProjects(items: SecretaryProjectWithStaff[]): void {
  localCache.set(SECRETARY_PROJECTS_CACHE_KEY, items);
}

interface RoomMsgCached { role: 'user' | 'assistant'; content: string; ts: string; author?: { kind: string; ref_id: string; display_name: string } }

function getCachedRooms(): Room[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(ROOMS_LIST_CACHE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Room[];
  } catch { return []; }
}
function setCachedRooms(rooms: Room[]): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(ROOMS_LIST_CACHE_KEY, JSON.stringify(rooms)); } catch { /* noop */ }
}
function getCachedRoomMsgs(roomId: string): RoomMsgCached[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(`${ROOM_MSGS_CACHE_PREFIX}${roomId}`);
    if (!raw) return [];
    return JSON.parse(raw) as RoomMsgCached[];
  } catch { return []; }
}
function setCachedRoomMsgs(roomId: string, msgs: RoomMsgCached[]): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(`${ROOM_MSGS_CACHE_PREFIX}${roomId}`, JSON.stringify(msgs)); } catch { /* noop */ }
}

// ─── RoomView — full-screen meeting room chat ─────────────────────────────────

function RoomView({
  room,
  allStaff,
  onBack,
  onRename,
}: {
  room: Room;
  allStaff: readonly Staff[];
  onBack: () => void;
  onRename: (newName: string) => void;
}) {
  const [members, setMembers] = useState<RoomMember[]>(() => getCachedRoomMembers(room.id));
  const [messages, setMessages] = useState<RoomMsgCached[]>(() => getCachedRoomMsgs(room.id));
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [mentionPickerOpen, setMentionPickerOpen] = useState(false);
  const [mention, setMention] = useState<{ staff_id: string; name: string } | null>(null);
  const [showMembers, setShowMembers] = useState(false);
  const [addingStaff, setAddingStaff] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState(room.name);

  const { scrollRef, scrollToBottom, forceRef } = useChatAutoScroll<HTMLDivElement>([messages, sending]);

  // Load members on mount — cache-first, then background refresh
  useEffect(() => {
    let stopped = false;
    holonApiFetch(`/api/v1/rooms/${encodeURIComponent(room.id)}`, { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok || stopped) return;
        const j = await r.json().catch(() => ({})) as { members?: RoomMember[] };
        if (stopped) return;
        const fetched = Array.isArray(j.members) ? j.members : [];
        setMembers(fetched);
        setCachedRoomMembers(room.id, fetched);
      })
      .catch(() => undefined);
    return () => { stopped = true; };
  }, [room.id]);

  // Poll history every 2.5s — mirrors StaffChat polling pattern.
  useEffect(() => {
    let stopped = false;
    async function syncHistory() {
      try {
        const r = await holonApiFetch(`/api/v1/rooms/${encodeURIComponent(room.id)}/history`, { cache: 'no-store' });
        if (!r.ok || stopped) return;
        const j = await r.json().catch(() => ({})) as { messages?: RoomMsgCached[] };
        const raw = Array.isArray(j.messages) ? j.messages : [];
        if (stopped) return;
        setMessages((prev) => {
          if (prev.length === raw.length && prev[prev.length - 1]?.ts === raw[raw.length - 1]?.ts) return prev;
          setCachedRoomMsgs(room.id, raw);
          return raw;
        });
      } catch { /* desk unreachable */ }
    }
    void syncHistory();
    const id = window.setInterval(() => void syncHistory(), 2500);
    return () => { stopped = true; window.clearInterval(id); };
  }, [room.id]);

  async function sendMessage(overrideText?: string) {
    const content = (overrideText ?? text).trim();
    if (!content || sending) return;
    setSending(true);
    setError('');
    forceRef.current = true;
    const body: Record<string, unknown> = { text: content };
    if (mention) body.mention = { staff_id: mention.staff_id };
    try {
      const r = await holonApiFetch(`/api/v1/rooms/${encodeURIComponent(room.id)}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await r.json().catch(() => ({})) as { error?: string; code?: string };
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      setText('');
      setMention(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  async function addMemberStaff(staffId: string, staffName: string) {
    setAddingStaff(true);
    try {
      const r = await holonApiFetch(`/api/v1/rooms/${encodeURIComponent(room.id)}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ staff_id: staffId }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({})) as { error?: string };
        throw new Error(d.error ?? `HTTP ${r.status}`);
      }
      const j = await r.json().catch(() => ({})) as { member?: RoomMember };
      if (j.member) setMembers((prev) => [...prev, j.member!]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAddingStaff(false);
    }
  }

  async function removeMemberParty(partyId: string) {
    try {
      await holonApiFetch(`/api/v1/rooms/${encodeURIComponent(room.id)}/members/${encodeURIComponent(partyId)}`, {
        method: 'DELETE',
      });
      setMembers((prev) => prev.filter((m) => m.party_id !== partyId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function saveRename() {
    const name = renameDraft.trim();
    if (!name || name === room.name) { setRenaming(false); return; }
    try {
      const r = await holonApiFetch(`/api/v1/rooms/${encodeURIComponent(room.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({})) as { error?: string };
        throw new Error(d.error ?? `HTTP ${r.status}`);
      }
      onRename(name);
      setRenaming(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const isDefaultTeamRoom = room.id === 'room_default_team';
  const aiMembers = members.filter((m) => m.kind === 'ai_agent');
  const nonMemberStaff = allStaff.filter((s) => !aiMembers.some((m) => m.ref_id === s.id));

  return (
    <div className="mobile-room-shell">
      {/* ── Header ── */}
      <div className="mobile-chat-header mobile-room-header">
        <button type="button" className="mobile-chat-header-back" onClick={onBack} aria-label="返回通讯录">‹</button>
        {!isDefaultTeamRoom && renaming ? (
          <input
            className="mobile-staff-field mobile-room-rename-input"
            value={renameDraft}
            onChange={(e) => setRenameDraft(e.target.value)}
            onBlur={() => void saveRename()}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void saveRename(); } if (e.key === 'Escape') setRenaming(false); }}
            autoFocus
          />
        ) : (
          <span
            className="mobile-chat-header-name"
            role={isDefaultTeamRoom ? undefined : 'button'}
            tabIndex={isDefaultTeamRoom ? undefined : 0}
            onClick={isDefaultTeamRoom ? undefined : () => { setRenameDraft(room.name); setRenaming(true); }}
            onKeyDown={isDefaultTeamRoom ? undefined : (e) => { if (e.key === 'Enter') { setRenameDraft(room.name); setRenaming(true); } }}
          >
            {room.name}
          </span>
        )}
        {/* Gear hidden for v1 default team room — its members auto-sync from the
            staff list; the owner doesn't manage them manually. Future non-default
            rooms (v2) will navigate to a contacts picker for 邀请. */}
        {!isDefaultTeamRoom && (
          <button type="button" className="mobile-chat-header-gear" onClick={() => setShowMembers((v) => !v)} aria-label="成员管理" aria-pressed={showMembers}>
            ⓘ
          </button>
        )}
      </div>

      {/* ── Members strip ── */}
      <div className="mobile-room-members">
        {aiMembers.map((m) => (
          <button
            key={m.party_id}
            type="button"
            className="mobile-room-member-chip"
            title={m.display_name}
            onClick={() => {
              if (showMembers) void removeMemberParty(m.party_id);
              else setMention({ staff_id: m.ref_id, name: m.display_name });
            }}
          >
            <span
              className="mobile-room-member-chip-avatar"
              style={{ background: `linear-gradient(160deg, ${staffPaletteColor(m.ref_id)} 0%, ${darkenHex(staffPaletteColor(m.ref_id))} 100%)` }}
              aria-hidden="true"
            >
              {staffInitial(m.display_name)}
            </span>
            <span className="mobile-room-member-name">{m.display_name}</span>
            {showMembers && <span className="mobile-room-member-remove" aria-hidden="true">×</span>}
          </button>
        ))}
        {/* Add-member toggle — hidden for default team room in v1 */}
        {!isDefaultTeamRoom && (
          <button
            type="button"
            className="mobile-room-member-add"
            onClick={() => setShowMembers((v) => !v)}
            aria-label="添加成员"
          >＋</button>
        )}
      </div>

      {/* Add-member panel (slides in when showMembers + non-default room) */}
      {showMembers && !isDefaultTeamRoom && nonMemberStaff.length > 0 && (
        <div className="mobile-room-add-panel">
          <span className="mobile-room-add-label">添加成员</span>
          <div className="mobile-room-add-chips">
            {nonMemberStaff.map((s) => (
              <button
                key={s.id}
                type="button"
                className="mobile-persona-save-btn"
                disabled={addingStaff}
                onClick={() => void addMemberStaff(s.id, s.name)}
              >
                ＋ {s.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Chat thread ── */}
      <div ref={scrollRef} className="mobile-chat-viewport mobile-staff-chat-scroll mobile-room-chat">
        {messages.length === 0 ? (
          <div className="mobile-room-empty">
            <span>和团队聊聊。@提名某位成员让他单独回答。</span>
          </div>
        ) : messages.map((m, i) => {
          const isUser = m.role === 'user';
          const authorName = m.author?.display_name ?? (isUser ? '我' : '助理');
          const initial = staffInitial(authorName);
          return isUser ? (
            <div key={i} className="chatmsg chatmsg-user">
              <div className="chatmsg-bubble chatmsg-bubble-user">{m.content}</div>
            </div>
          ) : (
            <div key={i} className="chatmsg chatmsg-assistant">
              <span
                className="chatmsg-avatar"
                style={{ background: `linear-gradient(160deg, ${staffPaletteColor(m.author?.ref_id ?? authorName)} 0%, ${darkenHex(staffPaletteColor(m.author?.ref_id ?? authorName))} 100%)` }}
                title={authorName}
                aria-hidden="true"
              >{initial}</span>
              <div className="chatmsg-body">
                <span className="mobile-room-agent-name">{authorName}</span>
                <div className="chatmsg-bubble chatmsg-bubble-assistant">{m.content}</div>
              </div>
            </div>
          );
        })}
        {sending && (
          <div className="chatmsg chatmsg-assistant">
            <div className="chatmsg-avatar" aria-hidden="true">…</div>
            <div className="chatmsg-body">
              <div className="chatmsg-bubble chatmsg-bubble-assistant chat-typing-bubble">
                <span className="chat-typing-dots" aria-label="正在回复"><i /><i /><i /></span>
              </div>
            </div>
          </div>
        )}
        {error && <div className="mobile-error">发送失败：{error}</div>}
      </div>

      {/* ── Composer ── */}
      <div className="mobile-chat-composer">
        {/* @ mention pill */}
        {mention && (
          <div className="mobile-room-mention-pill">
            <span>@{mention.name}</span>
            <button type="button" className="mobile-room-mention-clear" onClick={() => setMention(null)} aria-label="取消提及">✕</button>
          </div>
        )}
        {/* @ picker popover */}
        {mentionPickerOpen && aiMembers.length > 0 && (
          <div className="mobile-room-at-picker">
            {aiMembers.map((m) => (
              <button
                key={m.party_id}
                type="button"
                className="mobile-row"
                onClick={() => { setMention({ staff_id: m.ref_id, name: m.display_name }); setMentionPickerOpen(false); }}
              >
                <span
                  className="mobile-room-at-picker-avatar"
                  style={{ background: `linear-gradient(160deg, ${staffPaletteColor(m.ref_id)} 0%, ${darkenHex(staffPaletteColor(m.ref_id))} 100%)` }}
                  aria-hidden="true"
                >{staffInitial(m.display_name)}</span>
                <span>{m.display_name}</span>
              </button>
            ))}
          </div>
        )}
        <div className="composer-input-row">
          <MobileVoiceRecorderButton onTranscript={(t) => {
            const autoSend = getVoiceAutoSend();
            if (autoSend) {
              setText('');
              void sendMessage(t);
            } else {
              setText((c) => c ? `${c} ${t}` : t);
            }
          }} />
          <button
            type="button"
            className="mobile-attach-button"
            aria-label="@提及成员"
            aria-pressed={mentionPickerOpen}
            onClick={() => setMentionPickerOpen((v) => !v)}
          >@</button>
          <textarea
            rows={1}
            className="chat-input"
            value={text}
            onChange={(ev) => setText(ev.target.value)}
            onKeyDown={(ev) => {
              if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); void sendMessage(); }
            }}
            onFocus={() => { forceRef.current = true; scrollToBottom(); }}
            placeholder={mention ? `发消息给 ${mention.name}…` : '发消息到团队…'}
          />
          <button
            type="button"
            className="chat-send"
            onClick={() => void sendMessage()}
            disabled={sending || !text.trim()}
            aria-label="发送"
          >↑</button>
        </div>
      </div>
    </div>
  );
}

function StaffDetail({ staff, onBack, initialMode, onOpenTeamRoom }: { staff: Staff; onBack: () => void; initialMode?: 'primary' | 'config'; onOpenTeamRoom?: () => void }) {
  const isSecretary = staff.role_name === 'secretary';
  // Unified tmux model: all employees open straight to the 后台 terminal
  // (getStaffLanding now defaults 'terminal'); only the secretary is 前台 chat.
  const [mode, setMode] = useState<'primary' | 'config'>(initialMode ?? 'primary');
  const [landing, setLanding] = useState<'chat' | 'terminal'>(() => (isSecretary ? 'chat' : getStaffLanding(staff.id)));

  function pickLanding(v: 'chat' | 'terminal') { setLanding(v); setStaffLanding(staff.id, v); }

  if (mode === 'config') {
    return (
      <div className="mobile-staff-detail">
        <div className="mobile-chat-header">
          <button type="button" className="mobile-chat-header-back" onClick={() => setMode('primary')} aria-label="返回">‹</button>
          <span className="mobile-chat-header-spacer" />
        </div>
        <div className="mobile-staff-cfg-scroll">
          <StaffProfile
            key={`cfg-${staff.id}`}
            staffId={staff.id}
            fallback={staff}
            embedded
          />
        </div>
      </div>
    );
  }
  return (
    <div className="mobile-staff-detail">
      <div className="mobile-chat-header">
        <button type="button" className="mobile-chat-header-back" onClick={onBack} aria-label="返回通讯录">‹</button>
        <span className="mobile-chat-header-name">{staff.name}{landing === 'terminal' ? ' · 后台' : ''}</span>
        <button type="button" className="mobile-chat-header-gear" onClick={() => setMode('config')} aria-label="配置">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </button>
      </div>
      {landing === 'terminal' && !isSecretary
        ? <StaffTerminal staffId={staff.id} />
        : <StaffChat key={`chat-${staff.id}`} staff={staff} embedded />}
    </div>
  );
}

// ─── 资产 — 「我」的资产页 (WeChat 钱包式: 技能 / 交付 / 文件夹设置 / 统计) ───────
function AssetsView({
  onBack,
  delivCount,
  refCount,
  onOpenSkills,
  onOpenUsage,
  onOpenDesk,
}: {
  onBack: () => void;
  delivCount: number | null;
  refCount: number | null;
  onOpenSkills: () => void;
  onOpenUsage: () => void;
  onOpenDesk: (path: string) => void;
}) {
  return (
    <div className="mobile-me">
      <button type="button" className="mobile-back-row" onClick={onBack}>‹ 我</button>
      <div className="mobile-me-label" style={{ marginTop: 4 }}>能力 · 知识</div>
      <div className="mobile-asset-grid">
        <button type="button" className="mobile-asset-cell" onClick={onOpenSkills}>
          <span className="mobile-asset-icon">🧰</span>
          <span className="mobile-asset-name">技能</span>
          <span className="mobile-asset-sub">团队能力</span>
        </button>
        <button type="button" className="mobile-asset-cell" onClick={() => onOpenDesk('/references')}>
          <span className="mobile-asset-icon">📚</span>
          <span className="mobile-asset-name">引用</span>
          <span className="mobile-asset-sub">{refCount === null ? '桌面库' : `${refCount} 条`}</span>
        </button>
        <button type="button" className="mobile-asset-cell" onClick={() => onOpenDesk('/references')}>
          <span className="mobile-asset-icon">🧩</span>
          <span className="mobile-asset-name">模板</span>
          <span className="mobile-asset-sub">输出格式</span>
        </button>
      </div>
      <div className="mobile-me-label" style={{ marginTop: 14 }}>产出</div>
      <div className="mobile-asset-grid">
        <div className="mobile-asset-cell is-static">
          <span className="mobile-asset-icon">📦</span>
          <span className="mobile-asset-name">交付物</span>
          <span className="mobile-asset-sub">{delivCount === null ? '…' : delivCount === 0 ? '暂无' : `${delivCount} 份`}</span>
        </div>
        <div className="mobile-asset-cell is-static">
          <span className="mobile-asset-icon">📁</span>
          <span className="mobile-asset-name">交付文件夹</span>
          <span className="mobile-asset-sub">桌面设置</span>
        </div>
        <button type="button" className="mobile-asset-cell" onClick={onOpenUsage}>
          <span className="mobile-asset-icon">📊</span>
          <span className="mobile-asset-name">使用统计</span>
          <span className="mobile-asset-sub">技能 · 约</span>
        </button>
      </div>
      <div className="mobile-me-note" style={{ marginTop: 12 }}>
        资产是团队的能力、知识与产出（不是消息）。技能可浏览 / 新建；引用、模板在桌面完整管理；交付文件夹与统计随后接入。
      </div>
    </div>
  );
}

// ─── Marketplace (商店) views ────────────────────────────────────────────────

function PackDetailView({
  pack,
  onBack,
  onImportDone,
  activeProjectId,
}: {
  pack: TeamPack;
  onBack: () => void;
  onImportDone: () => void;
  activeProjectId?: string | null | undefined;
}) {
  // Build ordered group list preserving pack order.
  const groups: Array<{ label: string; items: TeamPack['staff'] }> = [];
  const seenGroups = new Set<string>();
  for (const s of pack.staff) {
    const g = s.task_group ?? '其他';
    if (!seenGroups.has(g)) { seenGroups.add(g); groups.push({ label: g, items: [] }); }
    const grp = groups.find((x) => x.label === g);
    if (grp) grp.items.push(s);
  }

  const [checked, setChecked] = useState<Set<string>>(() => new Set(pack.staff.map((s) => s.name)));
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState('');
  // Conflict mode — default 'skip' preserves v1 behaviour.
  const [conflictMode, setConflictMode] = useState<'skip' | 'rename' | 'replace'>('skip');
  // Existing staff names for collision detection.
  const [existingNames, setExistingNames] = useState<Set<string>>(new Set());
  // workspace_hint overrides keyed by staff name.
  const [workspaceOverrides, setWorkspaceOverrides] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const s of pack.staff) { init[s.name] = s.workspace_hint ?? ''; }
    return init;
  });

  // Fetch existing staff names once when the detail view mounts.
  useEffect(() => {
    holonApiFetch('/api/v1/staff', { cache: 'no-store' })
      .then((r) => r.ok ? r.json() as Promise<{ items?: Array<{ name: string }> }> : Promise.resolve({ items: [] }))
      .then((j) => {
        const names = new Set<string>(Array.isArray(j.items) ? j.items.map((s) => s.name) : []);
        setExistingNames(names);
      })
      .catch(() => undefined);
  }, []);

  function toggle(name: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(name)) { next.delete(name); } else { next.add(name); }
      return next;
    });
  }

  async function doImport() {
    if (importing) return;
    const selected = pack.staff.map((s) => s.name).filter((n) => checked.has(n));
    if (selected.length === 0) { setResult('请至少勾选一名成员'); return; }
    setImporting(true);
    setResult('');
    // Build workspace_overrides — only include entries that differ from the pack default.
    const overrides: Record<string, string> = {};
    for (const name of selected) {
      const defaultHint = pack.staff.find((s) => s.name === name)?.workspace_hint ?? '';
      const edited = workspaceOverrides[name] ?? defaultHint;
      if (edited !== defaultHint) overrides[name] = edited;
    }
    try {
      const body: Record<string, unknown> = {
        selected_staff_names: selected,
        conflict: conflictMode,
      };
      if (Object.keys(overrides).length > 0) body.workspace_overrides = overrides;
      // Scope import to the active project when one is selected.
      if (activeProjectId) body.project_id = activeProjectId;
      const r = await holonApiFetch(`/api/v1/team-packs/${pack.id}/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await r.json() as { created?: string[]; skipped?: string[]; error?: string };
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      const createdCount = j.created?.length ?? 0;
      const skippedCount = j.skipped?.length ?? 0;
      setResult(`已导入 ${createdCount} 人${skippedCount > 0 ? `（跳过 ${skippedCount}）` : ''}`);
      window.setTimeout(() => { onImportDone(); }, 1200);
    } catch (err) {
      setResult(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  }

  const conflictOptions: Array<{ value: 'skip' | 'rename' | 'replace'; label: string }> = [
    { value: 'skip', label: '跳过' },
    { value: 'rename', label: '重命名' },
    { value: 'replace', label: '替换' },
  ];

  return (
    <div className="mobile-subview-page">
      <div className="mobile-subview-header">
        <button type="button" className="mobile-subview-back" onClick={onBack} aria-label="返回">‹</button>
        <span className="mobile-subview-title">{pack.name}</span>
      </div>
      <div className="mobile-pack-detail-body">
        <p className="mobile-pack-card-meta" style={{ margin: '0 0 16px' }}>{pack.description}</p>
        {groups.map((g) => (
          <div key={g.label}>
            <div className="mobile-pack-detail-group-header">{g.label}</div>
            {g.items.map((s) => {
              const hasCollision = existingNames.has(s.name);
              return (
                <label key={s.name} className="mobile-pack-import-checkbox-row">
                  <input
                    type="checkbox"
                    checked={checked.has(s.name)}
                    onChange={() => toggle(s.name)}
                    style={{ marginRight: 10, accentColor: '#1f7a44', flexShrink: 0 }}
                  />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 500 }}>{s.name}</span>
                      {hasCollision && (
                        <span className="mobile-pack-collision-warn" title="已存在同名员工">⚠</span>
                      )}
                      <span className="mobile-pack-card-meta">{s.role_label}</span>
                    </span>
                    {s.workspace_hint !== undefined && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
                        <span className="mobile-pack-card-meta" style={{ flexShrink: 0 }}>工作区:</span>
                        <input
                          type="text"
                          className="mobile-pack-workspace-input"
                          value={workspaceOverrides[s.name] ?? s.workspace_hint}
                          onChange={(e) => setWorkspaceOverrides((prev) => ({ ...prev, [s.name]: e.target.value }))}
                          onClick={(e) => e.stopPropagation()}
                          aria-label={`${s.name} 工作区路径`}
                        />
                      </span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
        ))}
        {/* Conflict resolution control */}
        <div className="mobile-pack-conflict-row">
          <span className="mobile-pack-conflict-label">同名冲突:</span>
          {conflictOptions.map((opt) => (
            <label key={opt.value} className="mobile-pack-conflict-option">
              <input
                type="radio"
                name={`conflict-${pack.id}`}
                value={opt.value}
                checked={conflictMode === opt.value}
                onChange={() => setConflictMode(opt.value)}
                style={{ accentColor: '#1f7a44' }}
              />
              {opt.label}
            </label>
          ))}
        </div>
      </div>
      <div className="mobile-pack-import-bar">
        {result && <div className="mobile-me-note" style={{ textAlign: 'center', marginBottom: 6 }}>{result}</div>}
        <button
          type="button"
          className="mobile-green-cta"
          disabled={importing}
          onClick={() => { void doImport(); }}
        >
          {importing ? '导入中…' : `导入全队 (${checked.size} 人)`}
        </button>
      </div>
    </div>
  );
}

function MarketplaceView({
  onBack,
  onImportDone,
  activeProjectId,
}: {
  onBack: () => void;
  onImportDone: () => void;
  activeProjectId?: string | null | undefined;
}) {
  // SWR cache: instant render from localStorage on entry, then revalidate in
  // background. Owner: 商店打开 第一次冷 compile 慢, 之后秒开。
  const cached = useMemo(() => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = window.localStorage.getItem('holon.mobile.teamPacks.v1');
      return raw ? JSON.parse(raw) as TeamPack[] : [];
    } catch { return []; }
  }, []);
  const [packs, setPacks] = useState<TeamPack[]>(cached);
  const [loading, setLoading] = useState(cached.length === 0);
  const [error, setError] = useState('');
  const [selectedPack, setSelectedPack] = useState<TeamPack | null>(null);
  const [activeCategory, setActiveCategory] = useState<string>('全部');
  const [searchQ, setSearchQ] = useState('');

  useEffect(() => {
    holonApiFetch('/api/v1/team-packs', { cache: 'no-store' })
      .then((r) => r.ok ? r.json() as Promise<{ items?: TeamPack[] }> : Promise.resolve({ items: [] }))
      .then((j) => {
        const items = Array.isArray(j.items) ? j.items : [];
        setPacks(items);
        try { window.localStorage.setItem('holon.mobile.teamPacks.v1', JSON.stringify(items)); } catch { /* quota */ }
      })
      .catch((err) => { setError(err instanceof Error ? err.message : String(err)); })
      .finally(() => { setLoading(false); });
  }, []);

  // Derive unique categories from loaded packs.
  const categories = ['全部', ...Array.from(new Set(packs.map((p) => p.category).filter(Boolean)))];

  // Search filter: match name, description, tags, and staff role_labels (AND with category).
  const searchTerm = searchQ.trim().toLowerCase();
  const categoryFiltered = activeCategory === '全部'
    ? packs
    : packs.filter((p) => p.category === activeCategory);
  const visiblePacks = searchTerm
    ? categoryFiltered.filter((p) => {
        if (p.name.toLowerCase().includes(searchTerm)) return true;
        if (p.description.toLowerCase().includes(searchTerm)) return true;
        if (p.tags.some((t) => t.toLowerCase().includes(searchTerm))) return true;
        if (p.staff.some((s) => s.role_label?.toLowerCase().includes(searchTerm))) return true;
        return false;
      })
    : categoryFiltered;

  if (selectedPack) {
    return (
      <PackDetailView
        pack={selectedPack}
        onBack={() => setSelectedPack(null)}
        onImportDone={onImportDone}
        activeProjectId={activeProjectId}
      />
    );
  }

  return (
    <div className="mobile-subview-page">
      <div className="mobile-subview-header">
        <button type="button" className="mobile-subview-back" onClick={onBack} aria-label="返回">‹</button>
        <span className="mobile-subview-title">商店</span>
      </div>
      {/* Marketplace search bar */}
      {!loading && packs.length > 0 && (
        <input
          className="mobile-marketplace-search"
          type="search"
          value={searchQ}
          onChange={(e) => setSearchQ(e.target.value)}
          placeholder="搜索角色包..."
        />
      )}
      {/* Category filter chip row — horizontally scrollable */}
      {!loading && packs.length > 0 && (
        <div className="mobile-pack-category-row">
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              className={`mobile-pack-category-chip${activeCategory === cat ? ' is-active' : ''}`}
              onClick={() => setActiveCategory(cat)}
            >
              {cat}
            </button>
          ))}
        </div>
      )}
      <div className="mobile-marketplace-list">
        {loading && <div className="mobile-me-note" style={{ padding: '16px 0' }}>加载中…</div>}
        {error && <div className="mobile-me-note" style={{ color: '#c0392b' }}>{error}</div>}
        {!loading && visiblePacks.length === 0 && !error && (
          <div className="mobile-me-note" style={{ padding: '16px 0' }}>
            {searchTerm ? `没有匹配「${searchQ}」的角色包` : '暂无团队包'}
          </div>
        )}
        {visiblePacks.map((pack) => (
          <button
            key={pack.id}
            type="button"
            className="mobile-pack-card"
            onClick={() => setSelectedPack(pack)}
          >
            <div className="mobile-pack-card-title">{pack.name}</div>
            <div className="mobile-pack-card-meta">{pack.description}</div>
            <div className="mobile-pack-card-footer">
              {pack.tags.map((t) => (
                <span key={t} className="mobile-pack-tag-chip">{t}</span>
              ))}
              <span className="mobile-pack-card-meta" style={{ marginLeft: 'auto' }}>
                {pack.staff.length} 人 · {pack.est_setup_time}
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── End Marketplace views ───────────────────────────────────────────────────

function MeTab({
  connection,
  onDisconnect,
  onUseSkill,
  onSubviewChange,
  activeProjectId,
}: {
  connection: MobileDesktopConnection;
  onDisconnect: () => void;
  onUseSkill: (text: string) => void;
  onSubviewChange: (inSubview: boolean) => void;
  activeProjectId?: string | null | undefined;
}) {
  const [owner, setOwner] = useState<OwnerProfile | null>(null);
  const [meData, setMeData] = useState<MeOwnerData | null>(null);
  const [snapshot, setSnapshot] = useState<OwnerSnapshot | null>(() => getCachedOwnerSnapshot());
  const [personas, setPersonas] = useState<PersonaPreset[]>(() => getCachedPersonas());
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [personaSheetOpen, setPersonaSheetOpen] = useState(false);
  const [dedupeMsg, setDedupeMsg] = useState<string | null>(null);
  const [dedupeBusy, setDedupeBusy] = useState(false);
  const [ownerDraft, setOwnerDraft] = useState('');
  const [ownerIndustry, setOwnerIndustry] = useState(''); // 行业/职业 — onboarding-style, drives the interview
  const [ownerBusy, setOwnerBusy] = useState<'idle' | 'polishing' | 'saving'>('idle');
  const [ownerMsg, setOwnerMsg] = useState('');
  // AI 采访式人设定位 (multi-turn). Replaces the one-off polish for new users.
  const [interviewTurns, setInterviewTurns] = useState<Array<{ role: 'interviewer' | 'owner'; content: string }>>([]);
  const [interviewActive, setInterviewActive] = useState(false);
  const [interviewAnswer, setInterviewAnswer] = useState('');
  const [interviewLoading, setInterviewLoading] = useState(false);
  const [interviewDone, setInterviewDone] = useState(false);
  const interviewLogRef = useRef<HTMLDivElement>(null);
  // Keep the interview Q&A scrolled to the latest turn.
  useEffect(() => {
    const el = interviewLogRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [interviewTurns, interviewLoading]);
  const [personaApplied, setPersonaApplied] = useState('');
  const [error, setError] = useState('');
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [langPref, setLangPref] = useState<'zh-CN' | 'en'>('zh-CN');
  const [savingLang, setSavingLang] = useState(false);
  const [cliUsage, setCliUsage] = useState<CliUsageResponse | null>(null);
  const [usageOpen, setUsageOpen] = useState(false);
  const [qrSheetOpen, setQrSheetOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false); // 语言区折叠(为以后多语言)
  const [assetsOpen, setAssetsOpen] = useState(false); // 资产区(技能 + 交付统计 + …)
  const [marketplaceOpen, setMarketplaceOpen] = useState(false); // 商店 subview
  const [skillSheetOpen, setSkillSheetOpen] = useState(false);
  const [skillUsageOpen, setSkillUsageOpen] = useState(false);
  const [delivCount, setDelivCount] = useState<number | null>(() => {
    const cached = getCachedDeliverables();
    return cached.length > 0 ? cached.length : null;
  });
  const [refCount, setRefCount] = useState<number | null>(() => getCachedReferenceCount());

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [meRes, snapRes, pRes] = await Promise.all([
        holonApiFetch('/api/v1/me', { cache: 'no-store' }),
        holonApiFetch('/api/v1/chat/owner/snapshot', { cache: 'no-store' }),
        holonApiFetch('/api/v1/personas', { cache: 'no-store' }),
      ]);
      if (!meRes.ok) throw new Error(`/me HTTP ${meRes.status}`);
      if (!snapRes.ok) throw new Error(`/snapshot HTTP ${snapRes.status}`);
      const [meJson, snapJson, pJson] = await Promise.all([
        meRes.json() as Promise<OwnerProfile & MeOwnerData>,
        snapRes.json() as Promise<OwnerSnapshot>,
        pRes.ok ? (pRes.json() as Promise<{ items?: PersonaPreset[] }>) : Promise.resolve({ items: [] }),
      ]);
      setOwner(meJson);
      setMeData(meJson);
      setSnapshot(snapJson);
      setCachedOwnerSnapshot(snapJson);
      const personaItems = Array.isArray(pJson.items) ? pJson.items : [];
      setPersonas(personaItems);
      setCachedPersonas(personaItems);
      // Seed language preference from owner config (default zh-CN).
      setLangPref(meJson.language_preference === 'en' ? 'en' : 'zh-CN');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  // Tell the shell when a 二级页 (资产/用量/商店) is open so it drops the app header.
  useEffect(() => { onSubviewChange(assetsOpen || usageOpen || marketplaceOpen); }, [assetsOpen, usageOpen, marketplaceOpen, onSubviewChange]);

  useEffect(() => {
    holonApiFetch('/api/v1/usage', { cache: 'no-store' })
      .then((r) => r.ok ? r.json() as Promise<CliUsageResponse> : Promise.resolve(null))
      .then((data) => { if (data) setCliUsage(data); })
      .catch(() => undefined);
  }, []);

  // 资产 · 交付统计 — count deliverables (real, from the deliverables API).
  useEffect(() => {
    holonApiFetch('/api/v1/deliverables', { cache: 'no-store' })
      .then((r) => r.ok ? r.json() as Promise<ListDeliverablesResponse> : Promise.resolve(null))
      .then((data) => {
        if (data) {
          const count = Array.isArray(data.items) ? data.items.length : 0;
          setDelivCount(count);
          if (Array.isArray(data.items)) setCachedDeliverables(data.items);
        }
      })
      .catch(() => undefined);
    holonApiFetch('/api/v1/references', { cache: 'no-store' })
      .then((r) => r.ok ? r.json() as Promise<{ items?: unknown[] }> : Promise.resolve(null))
      .then((data) => {
        if (data) {
          const count = Array.isArray(data.items) ? data.items.length : 0;
          setRefCount(count);
          setCachedReferenceCount(count);
        }
      })
      .catch(() => undefined);
  }, []);

  async function saveLangPref(next: 'zh-CN' | 'en') {
    setLangPref(next);
    setSavingLang(true);
    try {
      await holonApiFetch('/api/v1/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language_preference: next }),
      });
    } catch {
      // best-effort; local state already updated
    } finally {
      setSavingLang(false);
    }
  }

  async function applyPersona(persona: PersonaPreset) {
    setSavingId(persona.id);
    setPersonaApplied('');
    setError('');
    try {
      const res = await holonApiFetch('/api/v1/me/apply-persona', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ persona_id: persona.id }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(b.error ?? `HTTP ${res.status}`);
      }
      setPersonaSheetOpen(false);
      setPersonaApplied('已应用');
      window.setTimeout(() => setPersonaApplied(''), 1600);
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingId(null);
    }
  }

  // Free-form owner persona: describe yourself / your pain points → the polish
  // agent (re)positions it → save as owner_role + owner_intro.
  async function polishOwnerPersona() {
    const text = ownerDraft.trim();
    if (!text || ownerBusy !== 'idle') return;
    setOwnerBusy('polishing'); setOwnerMsg('');
    try {
      const r = await holonApiFetch('/api/v1/persona/polish', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, role_label: '个人定位（老板视角）' }),
      });
      const j = await r.json().catch(() => ({})) as { polished?: string; error?: string };
      if (!r.ok || typeof j.polished !== 'string') throw new Error(j.error ?? `HTTP ${r.status}`);
      setOwnerDraft(j.polished);
      setOwnerMsg('已定位，确认后点「用这个」');
    } catch (e) { setOwnerMsg(`定位失败：${e instanceof Error ? e.message : String(e)}`); }
    finally { setOwnerBusy('idle'); }
  }

  // ── AI 采访式定位: one Q at a time → synthesizes the persona at the end ──
  async function runInterviewTurn(transcript: Array<{ role: 'interviewer' | 'owner'; content: string }>) {
    setInterviewLoading(true);
    try {
      const r = await holonApiFetch('/api/v1/persona/interview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript, industry: ownerIndustry.trim() }),
      });
      const j = await r.json().catch(() => ({})) as { done?: boolean; message?: string; persona?: string; error?: string };
      if (!r.ok || typeof j.message !== 'string') throw new Error(j.error ?? `HTTP ${r.status}`);
      setInterviewTurns([...transcript, { role: 'interviewer', content: j.message }]);
      if (j.done && typeof j.persona === 'string' && j.persona.trim()) {
        setOwnerDraft(j.persona.trim());
        setInterviewDone(true);
        setOwnerMsg('采访完成，确认后点「用这个」');
      }
    } catch (e) {
      setOwnerMsg(`采访失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setInterviewLoading(false);
    }
  }

  function startInterview() {
    setInterviewActive(true);
    setInterviewDone(false);
    setInterviewAnswer('');
    setInterviewTurns([]);
    setOwnerMsg('');
    void runInterviewTurn([]);
  }

  function sendInterviewAnswer() {
    const answer = interviewAnswer.trim();
    if (!answer || interviewLoading) return;
    const next = [...interviewTurns, { role: 'owner' as const, content: answer }];
    setInterviewTurns(next);
    setInterviewAnswer('');
    void runInterviewTurn(next);
  }

  async function saveOwnerPersona() {
    const text = ownerDraft.trim();
    if (!text || ownerBusy !== 'idle') return;
    setOwnerBusy('saving'); setOwnerMsg('');
    try {
      // owner_role = the industry/profession the owner picked (onboarding-style);
      // fall back to the first sentence of the intro when none was set.
      const role = (ownerIndustry.trim() || (text.split(/[\n。.!！?？]/)[0] ?? text).trim() || text).slice(0, 30);
      const r = await holonApiFetch('/api/v1/me', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner_role: role, owner_intro: text }),
      });
      if (!r.ok) { const b = await r.json().catch(() => ({})) as { error?: string }; throw new Error(b.error ?? `HTTP ${r.status}`); }
      setPersonaSheetOpen(false);
      setPersonaApplied('已保存我的定位');
      window.setTimeout(() => setPersonaApplied(''), 1600);
      void load();
    } catch (e) { setOwnerMsg(`保存失败：${e instanceof Error ? e.message : String(e)}`); }
    finally { setOwnerBusy('idle'); }
  }

  const ownerRoleRaw = owner?.owner_role?.trim() || snapshot?.owner?.role?.trim() || '';
  const ownerIntro = owner?.owner_intro?.trim() || snapshot?.owner?.intro?.trim() || '';
  const activePersona = personas.find((p) => p.owner_role === ownerRoleRaw || p.name === ownerRoleRaw);
  // P1-4: when nothing is set, name + summary must NOT both fall back to the same
  // string ("未设置人设 / 未设置人设"). Give distinct title + call-to-action.
  const personaName = activePersona ? `${activePersona.icon} ${activePersona.name}` : (ownerRoleRaw || '尚未设置人设');
  let personaSummary = activePersona?.tagline || activePersona?.industry || ownerIntro || '';
  if (!personaSummary) personaSummary = activePersona ? '' : '点击「更换」选择你的身份';
  if (personaSummary === personaName) personaSummary = '';

  if (usageOpen) {
    return <UsageDetail onBack={() => setUsageOpen(false)} />;
  }

  if (marketplaceOpen) {
    return (
      <MarketplaceView
        onBack={() => setMarketplaceOpen(false)}
        onImportDone={() => {
          setMarketplaceOpen(false);
          // Signal WeizoApp to force-refetch the staff roster.
          window.dispatchEvent(new Event('holon:team-pack-imported'));
        }}
        activeProjectId={activeProjectId}
      />
    );
  }

  if (assetsOpen) {
    return (
      <>
        <AssetsView
          onBack={() => setAssetsOpen(false)}
          delivCount={delivCount}
          refCount={refCount}
          onOpenSkills={() => setSkillSheetOpen(true)}
          onOpenUsage={() => setSkillUsageOpen(true)}
          onOpenDesk={(path) => { if (connection.baseUrl) window.open(`${connection.baseUrl}${path}`, '_blank'); }}
        />
        {skillSheetOpen && (
          <SkillSheet
            onClose={() => setSkillSheetOpen(false)}
            onPick={(text) => { onUseSkill(text); setSkillSheetOpen(false); }}
          />
        )}
        {skillUsageOpen && (
          <SkillUsageView
            onClose={() => setSkillUsageOpen(false)}
            onOpenDesk={(path) => { if (connection.baseUrl) window.open(`${connection.baseUrl}${path}`, '_blank'); }}
          />
        )}
      </>
    );
  }

  const todaySummary = cliUsage
    ? (() => {
        const total = cliUsage.clis.reduce((sum, c) => sum + (c.usage?.today_tokens ?? 0), 0);
        return total > 0 ? `今日 ~${fmtTokens(total)}` : null;
      })()
    : null;

  return (
    <div className="mobile-me">
      <div className="mobile-me-profile">
        <span className="mobile-avatar mobile-avatar-owner">我</span>
        <span className="mobile-row-main">
          <span className="mobile-row-title">我</span>
          {/* Simple status — online when reachable, else error. No IP. */}
          <span className={`mobile-me-status${error ? ' mobile-me-conn-error' : ''}`}>
            <span className="mobile-me-status-dot" aria-hidden="true" />
            {error ? '连接异常' : '在线'}
          </span>
        </span>
        {/* WeChat-style QR entry on the profile — opens the two connect QRs. */}
        <button type="button" className="mobile-me-qr-btn" onClick={() => setQrSheetOpen(true)} aria-label="二维码">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" /><path d="M14 14h3v3M21 14v7h-7" />
          </svg>
        </button>
      </div>
      <div className="mobile-me-section">
        <button
          type="button"
          className="mobile-collapse-head"
          onClick={() => {
            setOwnerDraft(ownerIntro);
            setOwnerIndustry(ownerRoleRaw);
            setInterviewActive(false); setInterviewDone(false); setInterviewTurns([]);
            setOwnerMsg(''); setPersonaSheetOpen(true);
          }}
        >
          <span className="mobile-me-row-title">关于我</span>
          {/* highlights like 资产 (技能·引用·交付): the identity dimensions; tap → details */}
          <span className="mobile-collapse-summary">职业 · 人设 · 痛点</span>
          <span className="mobile-collapse-chevron">›</span>
        </button>
      </div>
      {/* 资产 — WeChat 钱包式入口行 → 资产页(技能 / 交付 / 文件夹设置 / 统计) */}
      <div className="mobile-me-section">
        <button type="button" className="mobile-collapse-head" onClick={() => setAssetsOpen(true)}>
          <span className="mobile-me-row-title">资产</span>
          <span className="mobile-collapse-summary">技能 · 引用 · 交付{delivCount ? ` ${delivCount}` : ''}</span>
          <span className="mobile-collapse-chevron">›</span>
        </button>
      </div>
      <div className="mobile-me-section">
        <button type="button" className="mobile-collapse-head" onClick={() => setLangOpen((v) => !v)}>
          <span className="mobile-me-row-title">语言{savingLang ? ' …' : ''}</span>
          <span className="mobile-collapse-summary">{langPref === 'en' ? 'English' : '中文'}</span>
          <span className={`mobile-collapse-chevron${langOpen ? ' open' : ''}`}>›</span>
        </button>
        {langOpen && (
          <>
            <div className="mobile-me-lang-row" style={{ marginTop: 8 }}>
              <button
                type="button"
                className={`mobile-me-lang-btn${langPref === 'zh-CN' ? ' is-active' : ''}`}
                onClick={() => { void saveLangPref('zh-CN'); }}
                disabled={savingLang}
              >
                中文
              </button>
              <button
                type="button"
                className={`mobile-me-lang-btn${langPref === 'en' ? ' is-active' : ''}`}
                onClick={() => { void saveLangPref('en'); }}
                disabled={savingLang}
              >
                English
              </button>
            </div>
            <div className="mobile-me-note">小秘回复语言（默认中文）</div>
          </>
        )}
      </div>
      <IntegrationsSection meData={meData} onRefresh={() => void load()} />
      <button type="button" className="mobile-feedback-button" onClick={() => setUsageOpen(true)}>
        <span className="mobile-me-row-title">Token 用量</span>
        {todaySummary && <span className="weizo-clilist-tokens" style={{ marginRight: 4 }}>{todaySummary}</span>}
        <span className="mobile-collapse-chevron">›</span>
      </button>
      {/* WeChat-style quiet footer: plain centered gray line, no card, no sha/date. */}
      <div className="mobile-me-version">微作 Weizo 0.1.0</div>
      <button type="button" className="mobile-feedback-button" onClick={() => setMarketplaceOpen(true)}>
        <span className="mobile-me-row-title">商店</span>
        <span className="mobile-collapse-chevron">›</span>
      </button>
      <button type="button" className="mobile-feedback-button" onClick={() => setFeedbackOpen(true)}>
        <span>反馈 / 报错</span>
        <span>›</span>
      </button>
      {/* Dedupe-staff cleanup button */}
      {dedupeMsg && (
        <div
          style={{
            margin: '6px 16px',
            padding: '8px 12px',
            background: '#f0f9eb',
            color: '#52c41a',
            borderRadius: 8,
            fontSize: 13,
            textAlign: 'center',
          }}
          onClick={() => setDedupeMsg(null)}
        >
          {dedupeMsg}
        </div>
      )}
      <button
        type="button"
        className="mobile-feedback-button"
        disabled={dedupeBusy}
        onClick={async () => {
          // Step 1: dry-run to count duplicates
          const base = connection.baseUrl;
          if (!base) { window.alert('未连接桌面端'); return; }
          setDedupeBusy(true);
          setDedupeMsg(null);
          try {
            const dry = await fetch(`${base}/api/v1/admin/dedupe-staff`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: '{}',
            });
            if (!dry.ok) throw new Error(`HTTP ${dry.status}`);
            const dryData = await dry.json() as { removed?: unknown[] };
            const count = Array.isArray(dryData.removed) ? dryData.removed.length : 0;
            if (count === 0) {
              setDedupeMsg('没有重复员工，无需清理。');
              setDedupeBusy(false);
              return;
            }
            if (!window.confirm(`发现 ${count} 个重复员工。确认清理?`)) {
              setDedupeBusy(false);
              return;
            }
            // Step 2: confirm=true
            const res = await fetch(`${base}/api/v1/admin/dedupe-staff`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ confirm: true }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json() as { removed?: unknown[]; failed?: number };
            const removed = Array.isArray(data.removed) ? data.removed.length : 0;
            const failed = typeof data.failed === 'number' ? data.failed : 0;
            setDedupeMsg(
              failed > 0
                ? `已清理 ${removed - failed} 个，${failed} 个失败。`
                : `已清理 ${removed} 个重复员工 ✓`,
            );
          } catch (err) {
            setDedupeMsg(`清理失败: ${err instanceof Error ? err.message : String(err)}`);
          } finally {
            setDedupeBusy(false);
          }
        }}
      >
        <span className="mobile-me-row-title">{dedupeBusy ? '清理中…' : '清理重复员工'}</span>
        <span className="mobile-collapse-chevron">›</span>
      </button>
      <button
        type="button"
        className="mobile-disconnect-button"
        onClick={() => {
          // Hard-disconnect wipes the device token → forces a full re-pair on
          // next launch. Owner has confused this with the offline banner's
          // "刷新连接" before — confirm to prevent an accidental re-pair cycle.
          if (window.confirm('彻底断开并清除配对?\n下次连接需要重新扫码或输入验证码。\n\n(如果只是想恢复连接,请用顶部「刷新连接」)')) {
            onDisconnect();
          }
        }}
      >
        断开 / 重新配对
      </button>

      {/* QR access point — all scan-to-connect codes live here (AI Agent + WeChat). */}
      {qrSheetOpen && (
        <div className="mobile-sheet-backdrop" onClick={() => setQrSheetOpen(false)}>
          <div className="mobile-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="mobile-sheet-head">
              <h2 className="mobile-sheet-title">扫码连接</h2>
              <button type="button" className="mobile-sheet-close" onClick={() => setQrSheetOpen(false)} aria-label="关闭">×</button>
            </div>
            <ScanConnectSection />
            <WechatQrSection />
            <AgentCardSection deskBaseUrl={connection.baseUrl} />
          </div>
        </div>
      )}

      {personaSheetOpen && (
        <div
          className="bug-modal-backdrop mobile-persona-backdrop"
          onClick={() => setPersonaSheetOpen(false)}
          role="presentation"
        >
          <div
            className="bug-modal mobile-persona-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="weizo-persona-title"
            onClick={(ev) => ev.stopPropagation()}
          >
            <div className="bug-modal-header mobile-persona-sheet-header">
              <h2 id="weizo-persona-title" className="mobile-persona-sheet-title">选择人设</h2>
              <button
                type="button"
                className="bug-modal-close"
                onClick={() => setPersonaSheetOpen(false)}
                aria-label="关闭"
              >
                ×
              </button>
            </div>
            {/* Step 1 行业/职业 (onboarding-style) → Step 2 AI 采访 */}
            <div className="mobile-persona-freeform">
              <div className="mobile-me-note" style={{ marginBottom: 6 }}>① 你的行业 / 职业</div>
              <input
                className="mobile-persona-editor-textarea mobile-persona-industry"
                value={ownerIndustry}
                onChange={(e) => setOwnerIndustry(e.target.value)}
                placeholder="如：柴油机出口、跨境电商、律师、自由设计师…"
                disabled={ownerBusy !== 'idle'}
              />
              <div className="mobile-persona-chips">
                {['跨境外贸', '电商', '制造业', '咨询顾问', '律师', '自由职业', '投资人', '创业者'].map((c) => (
                  <button key={c} type="button"
                    className={`mobile-persona-chip${ownerIndustry.trim() === c ? ' is-active' : ''}`}
                    onClick={() => setOwnerIndustry(c)} disabled={ownerBusy !== 'idle'}>
                    {c}
                  </button>
                ))}
              </div>

              <div className="mobile-me-note" style={{ margin: '12px 0 6px' }}>② 让 AI 采访你，问出使命、日常、痛点</div>
              {!interviewActive ? (
                <button type="button" className="mobile-persona-interview-cta" onClick={startInterview}>
                  🎤 让 AI 采访我
                  <small>{ownerIndustry.trim() ? `基于「${ownerIndustry.trim()}」问几个问题` : '几个问题，帮你说出使命、日常、痛点'}</small>
                </button>
              ) : (
                <div className="mobile-interview">
                  <div className="mobile-interview-log" ref={interviewLogRef}>
                    {interviewTurns.map((t, i) => (
                      <div key={i} className={`mobile-interview-turn is-${t.role}`}>
                        <span className="mobile-interview-bubble">{t.content}</span>
                      </div>
                    ))}
                    {interviewLoading && (
                      <div className="mobile-interview-turn is-interviewer">
                        <span className="mobile-interview-bubble mobile-interview-typing">…</span>
                      </div>
                    )}
                  </div>
                  {!interviewDone && (
                    <div className="mobile-interview-input-row">
                      <textarea
                        className="mobile-persona-editor-textarea"
                        value={interviewAnswer}
                        onChange={(e) => setInterviewAnswer(e.target.value)}
                        rows={2}
                        placeholder="说说你的情况…"
                        disabled={interviewLoading}
                      />
                      <button type="button" className="mobile-persona-save-btn"
                        onClick={sendInterviewAnswer} disabled={interviewLoading || !interviewAnswer.trim()}>
                        发送
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* The produced / hand-written persona — confirm with 用这个 */}
              <textarea
                className="mobile-persona-editor-textarea"
                style={{ marginTop: 10 }}
                value={ownerDraft}
                onChange={(e) => setOwnerDraft(e.target.value)}
                rows={4}
                placeholder="或自己写：你的角色/行业 + 平时最忙的事 + 想让 AI 帮你接手的痛点。"
                disabled={ownerBusy !== 'idle'}
              />
              <div className="mobile-persona-editor-actions">
                {ownerMsg && <span className="mobile-persona-editor-msg">{ownerMsg}</span>}
                <button type="button" className="mobile-persona-polish-btn"
                  onClick={() => void polishOwnerPersona()} disabled={ownerBusy !== 'idle' || !ownerDraft.trim()}>
                  {ownerBusy === 'polishing' ? '润色中…' : '✨ 润色'}
                </button>
                <button type="button" className="mobile-persona-save-btn"
                  onClick={() => void saveOwnerPersona()} disabled={ownerBusy !== 'idle' || !ownerDraft.trim()}>
                  {ownerBusy === 'saving' ? '保存中…' : '用这个'}
                </button>
              </div>
              <div className="mobile-me-note" style={{ textAlign: 'center', margin: '12px 0 4px' }}>或选一个预设 ↓</div>
            </div>
            <div className="mobile-persona-list">
              {personas.map((persona) => {
                const active = activePersona?.id === persona.id || persona.owner_role === ownerRoleRaw;
                return (
                  <button
                    key={persona.id}
                    type="button"
                    className={`mobile-persona-button${active ? ' is-active' : ''}`}
                    onClick={() => void applyPersona(persona)}
                    disabled={savingId !== null || active}
                  >
                    <span className="mobile-persona-icon">{persona.icon}</span>
                    <span className="mobile-persona-text">
                      <span>{persona.name}</span>
                      <small>{persona.tagline || persona.industry || persona.owner_role}</small>
                    </span>
                    {savingId === persona.id && (
                      <span className="mobile-persona-current">保存中</span>
                    )}
                    {active && savingId !== persona.id && (
                      <span className="mobile-persona-current">当前</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
      <MeFeedbackDialog open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
    </div>
  );
}

// ─── Header & bottom nav ──────────────────────────────────────────────────────

// Thin top-strip shown only when no desktop connection is stored.
// Hides automatically once `paired` becomes true (holon:mobile-paired fires → WeizoApp
// calls readDesktopConnection + setConnection → the paired prop flips to true).
function NotPairedBanner({ paired }: { paired: boolean }) {
  if (paired) return null;
  return (
    <div className="mobile-connection-banner mobile-not-paired-banner">
      未连接桌面
      <a
        href="/pairing"
        className="mobile-not-paired-action"
      >
        去配对
      </a>
    </div>
  );
}

function ConnectionBanner({
  offline,
  checking,
  onRetry,
  onRepair,
}: {
  offline: boolean;
  checking: boolean;
  onRetry: () => void;
  onRepair: () => void;
}) {
  if (!offline) return null;
  return (
    <div className="mobile-connection-banner">
      <button
        type="button"
        className="mobile-connection-banner-status"
        onClick={onRetry}
        disabled={checking}
      >
        桌面暂未响应 · {checking ? '正在重连…' : '自动重连中(点此立即重试)'}
      </button>
      {/* Same action as onRetry — labelled separately as an obvious second tap
          option. NOT a re-pair: token persists, baseUrl tries failover. */}
      <button type="button" className="mobile-connection-banner-repair" onClick={onRepair}>
        刷新连接
      </button>
    </div>
  );
}

function AppHeader({ title, left }: { title: string; left?: ReactNode }) {
  return (
    <header className="mobile-static-header mobile-wechat-header">
      <div className="mobile-header-left">{left}</div>
      <h1 className="mobile-static-title">{title}</h1>
      <div className="mobile-header-right" />
    </header>
  );
}

// Bottom-nav icons — inline SVG (stroke, currentColor) so they render crisply
// everywhere and inherit the active green. Replaces emoji that tofu'd on some
// renderers. 24px to suit the tab bar.
function navSvg(children: ReactNode) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}
const IconNavChat = () => navSvg(<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />);
const IconNavContacts = () => navSvg(<><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>);
const IconNavBoard = () => navSvg(<><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /></>);
const IconNavMe = () => navSvg(<><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>);

function BottomNav({
  active,
  badges,
  onTab,
  chatActive,
}: {
  active: TabKey;
  badges: Record<BadgedTabKey, number>;
  onTab: (tab: TabKey) => void;
  /** When true and on the chats tab, slide the nav bar off screen (WeChat-like). */
  chatActive?: boolean;
}) {
  const TABS: Array<{ key: TabKey; label: string; icon: ReactNode }> = [
    { key: 'chats', label: '聊天', icon: <IconNavChat /> },
    { key: 'contacts', label: '通讯录', icon: <IconNavContacts /> },
    { key: 'work', label: '看板', icon: <IconNavBoard /> },
    { key: 'me', label: '我', icon: <IconNavMe /> },
  ];

  const hidden = !!chatActive;

  return (
    <nav className={`mobile-bottom-nav${hidden ? ' mobile-bottom-nav--hidden' : ''}`} aria-label="微作导航">
      {TABS.map((tab) => (
        <button
          key={tab.key}
          type="button"
          className={`mobile-tab-button${active === tab.key ? ' is-active' : ''}`}
          onClick={() => onTab(tab.key)}
        >
          <span className="mobile-tab-icon-wrap">
            <span className="mobile-tab-icon">{tab.icon}</span>
            {(tab.key === 'chats' || tab.key === 'work') && badges[tab.key] > 0 && (
              <span className="mobile-tab-badge" aria-label={`${badges[tab.key]} 条未读`}>
                {badges[tab.key] > 99 ? '99+' : badges[tab.key]}
              </span>
            )}
          </span>
          <span>{tab.label}</span>
        </button>
      ))}
    </nav>
  );
}

function tabTitle(tab: TabKey, selectedStaff: Staff | null, selectedRoom?: Room | null): string {
  if (tab === 'contacts' && selectedRoom) return selectedRoom.name;
  if (tab === 'contacts' && selectedStaff) return selectedStaff.name;
  switch (tab) {
    case 'contacts': return '通讯录';
    case 'work': return '看板';
    case 'me': return '我';
    default: return '微作';
  }
}

// ─── QR scanner (jsqr + getUserMedia video) ───────────────────────────────────

type ScannerState = 'idle' | 'requesting' | 'scanning' | 'denied' | 'error';

function QrScanner({
  onResult,
  onClose,
}: {
  onResult: (text: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [state, setState] = useState<ScannerState>('requesting');
  const [hint, setHint] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        if (cancelled) { for (const t of stream.getTracks()) t.stop(); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setState('scanning');
        scheduleFrame();
      } catch (e) {
        if (cancelled) return;
        const name = e instanceof DOMException ? e.name : '';
        if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
          setState('denied');
          setHint('摄像头权限被拒绝，请在浏览器设置中允许。');
        } else {
          setState('error');
          setHint(`摄像头无法启动：${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }

    function scheduleFrame() {
      rafRef.current = requestAnimationFrame(tick);
    }

    function tick() {
      if (cancelled) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState < 2) {
        scheduleFrame();
        return;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) { scheduleFrame(); return; }
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      // Dynamic import jsqr to keep initial bundle small.
      import('jsqr').then(({ default: jsQR }) => {
        if (cancelled) return;
        const result = jsQR(imageData.data, imageData.width, imageData.height);
        if (result?.data) {
          onResult(result.data);
        } else {
          scheduleFrame();
        }
      }).catch(() => { scheduleFrame(); });
    }

    void start();

    return () => {
      cancelled = true;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      if (streamRef.current) {
        for (const t of streamRef.current.getTracks()) t.stop();
        streamRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{
      position: 'fixed', inset: 0, background: '#000',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      zIndex: 100,
    }}>
      <div style={{ position: 'relative', width: '100%', maxWidth: 360 }}>
        {/* Video must be in the DOM BEFORE we attach the MediaStream — keeping it
            conditionally rendered meant videoRef.current was still null when
            start() tried to assign srcObject → stream never attached → black
            scanner. Render always; hide via display when not yet scanning. */}
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          style={{
            width: '100%',
            display: state === 'scanning' ? 'block' : 'none',
            borderRadius: 8,
          }}
        />
        {/* hidden canvas for frame capture */}
        <canvas ref={canvasRef} style={{ display: 'none' }} />
        {state === 'requesting' && (
          <div style={{ color: '#fff', textAlign: 'center', padding: 24 }}>正在请求摄像头…</div>
        )}
        {(state === 'denied' || state === 'error') && (
          <div style={{ color: '#f88', textAlign: 'center', padding: 24 }}>{hint}</div>
        )}
        {state === 'scanning' && (
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            pointerEvents: 'none',
          }}>
            <div className="mobile-qr-frame">
              <span className="mobile-qr-corner tl" />
              <span className="mobile-qr-corner tr" />
              <span className="mobile-qr-corner bl" />
              <span className="mobile-qr-corner br" />
              <span className="mobile-qr-scanline" />
            </div>
          </div>
        )}
      </div>
      <div style={{ marginTop: 20, fontSize: 13, color: 'rgba(255,255,255,0.7)', textAlign: 'center', padding: '0 16px' }}>
        {state === 'scanning' ? '将桌面端二维码对准框内' : hint || ''}
      </div>
      <button
        type="button"
        onClick={onClose}
        style={{
          marginTop: 24, padding: '10px 32px', borderRadius: 8,
          background: 'rgba(255,255,255,0.15)', color: '#fff', border: 'none',
          fontSize: 15, cursor: 'pointer',
        }}
      >
        取消
      </button>
    </div>
  );
}

// ─── Pairing screen (inline — mobile-initiated 2-step flow) ──────────────────
//
// Step 1: user confirms desk address, taps 请求连接 → POST /api/v1/pair/request
// Step 2: desk shows 4-digit code → user enters it → POST /api/v1/pair/confirm

function PairingPrompt({ onPaired }: { onPaired: () => void }) {
  const [baseUrl, setBaseUrl] = useState(deskOrigin);
  const [step, setStep] = useState<'request' | 'confirm'>('request');
  const [requestId, setRequestId] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function requestPairing() {
    if (!baseUrl.trim()) { setErr('请填写桌面端地址'); return; }
    setBusy(true);
    setErr('');
    try {
      const normalizedUrl = normalizeBaseUrl(baseUrl.trim());
      const r = await fetch(`${normalizedUrl}/api/v1/pair/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceName: '微作' }),
      });
      const body = await r.json().catch(() => ({})) as {
        requestId?: string; expires_at?: string; error?: string; code?: string;
      };
      if (!r.ok || !body.requestId) {
        const detail = body.error ?? body.code ?? `HTTP ${r.status}`;
        throw new Error(`连不上桌面,确认地址和同一网络: ${detail}`);
      }
      setRequestId(body.requestId);
      setStep('confirm');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function confirmPairing() {
    const digits = code.replace(/\D/g, '');
    if (digits.length < 4) { setErr('请输入 4 位验证码'); return; }
    setBusy(true);
    setErr('');
    try {
      const normalizedUrl = normalizeBaseUrl(baseUrl.trim());
      const r = await fetch(`${normalizedUrl}/api/v1/pair/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, code: digits }),
      });
      const body = await r.json().catch(() => ({})) as {
        ok?: boolean; device_token?: string; device_id?: string;
        lan_candidates?: unknown;
        error?: string; code?: string;
      };
      if (!r.ok || !body.ok || !body.device_token) {
        if (r.status === 410 || body.code === 'expired') {
          throw new Error('验证码已过期,请重新请求');
        }
        if (r.status === 401 || body.code === 'bad_code') {
          throw new Error('验证码不对');
        }
        if (r.status === 404 || body.code === 'not_found') {
          throw new Error('配对请求失效,请重新请求');
        }
        throw new Error(body.error ?? body.code ?? `HTTP ${r.status}`);
      }
      const parsedCandidates = Array.isArray(body.lan_candidates)
        ? (body.lan_candidates as unknown[])
            .filter((u): u is string => typeof u === 'string')
            .map(normalizeBaseUrl)
            .filter((u, i, a) => a.indexOf(u) === i)
        : undefined;
      writeDesktopConnection({
        baseUrl: normalizedUrl,
        deviceToken: body.device_token,
        ...(parsedCandidates !== undefined ? { candidates: parsedCandidates } : {}),
      });
      installMobileApiFetchProxy();
      onPaired();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function goBack() {
    setStep('request');
    setCode('');
    setErr('');
    setRequestId('');
  }

  if (step === 'request') {
    return (
      <div className="mobile-pairing-shell">
        <div className="mobile-pairing-panel">
          <div className="mobile-pairing-kicker">微作 · Weizo</div>
          <h1 className="mobile-pairing-title">连接桌面</h1>

          <div className="mobile-pairing-field">
            <label htmlFor="weizo-pair-url">桌面端地址</label>
            <input
              id="weizo-pair-url"
              type="url"
              value={baseUrl}
              onChange={(ev) => setBaseUrl(ev.target.value)}
              onKeyDown={(ev) => { if (ev.key === 'Enter') { ev.preventDefault(); void requestPairing(); } }}
              placeholder="http://192.168.x.x:3000"
              autoComplete="url"
              disabled={busy}
            />
          </div>

          {err && <div className="mobile-pairing-error">{err}</div>}

          <button
            type="button"
            className="mobile-pairing-submit"
            onClick={() => void requestPairing()}
            disabled={busy || !baseUrl.trim()}
          >
            {busy ? '请求中…' : '请求连接'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mobile-pairing-shell">
      <div className="mobile-pairing-panel">
        <div className="mobile-pairing-kicker">微作 · Weizo</div>
        <h1 className="mobile-pairing-title">输入验证码</h1>

        <p style={{ textAlign: 'center', fontSize: 14, color: 'var(--ink-soft, #555)', margin: '0 0 16px' }}>
          在桌面上查看 4 位验证码并输入
        </p>

        <div className="mobile-pairing-field">
          <label htmlFor="weizo-pair-otp">4 位验证码</label>
          <input
            id="weizo-pair-otp"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={4}
            value={code}
            onChange={(ev) => setCode(ev.target.value.replace(/\D/g, '').slice(0, 4))}
            onKeyDown={(ev) => { if (ev.key === 'Enter') { ev.preventDefault(); void confirmPairing(); } }}
            placeholder="0000"
            disabled={busy}
            style={{ fontSize: 28, letterSpacing: '0.3em', textAlign: 'center' }}
          />
        </div>

        {err && <div className="mobile-pairing-error">{err}</div>}

        <button
          type="button"
          className="mobile-pairing-submit"
          onClick={() => void confirmPairing()}
          disabled={busy || code.replace(/\D/g, '').length < 4}
        >
          {busy ? '连接中…' : '连接'}
        </button>

        <button
          type="button"
          className="mobile-pairing-submit"
          style={{ marginTop: 8, background: 'transparent', color: 'var(--ink-mute, #888)', border: '1px solid var(--line, #ddd)' }}
          onClick={goBack}
          disabled={busy}
        >
          重新请求
        </button>
      </div>
    </div>
  );
}

// ─── Root 4-tab shell ─────────────────────────────────────────────────────────

const CONNECTION_POLL_MS = 12000;

export function WeizoApp() {
  // iOS WKWebView audio-autoplay gate: prime on the FIRST user touch anywhere
  // in the app (not just the voice button) so Kimi-mode auto-TTS works out of
  // the box. After unlock the listener removes itself. Owner: 第一次按语音按钮
  // 才解锁很反直觉, 任何 tap 都该当 gesture.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const prime = () => { ttsPrimeAudio(); };
    document.addEventListener('pointerdown', prime, { once: true, passive: true });
    return () => document.removeEventListener('pointerdown', prime);
  }, []);

  const [connection, setConnection] = useState<MobileDesktopConnection | null>(null);
  const discoveringRef = useRef(false); // guards LAN re-discovery (one sweep at a time)
  const [booted, setBooted] = useState(false);
  const [tab, setTab] = useState<TabKey>('chats');
  const [staff, setStaff] = useState<Staff[]>(() => getCachedStaff());
  const [agentUsage, setAgentUsage] = useState<Record<string, AgentUsage>>({});
  const [chatSeed, setChatSeed] = useState<string | null>(null);
  const [selectedStaff, setSelectedStaff] = useState<Staff | null>(null);
  const [staffInitialMode, setStaffInitialMode] = useState<'primary' | 'config'>('primary');
  const [staffError, setStaffError] = useState('');
  const [rooms, setRooms] = useState<Room[]>(() => getCachedRooms());
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);
  const [secretaryProjects, setSecretaryProjects] = useState<SecretaryProjectWithStaff[]>(() => getCachedSecretaryProjects());
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  // inProjectChat: true when the chat panel is showing (tab === 'chats' full-screen).
  // Kept separate from activeProjectId so back-arrow collapses to list WITHOUT
  // clearing activeProjectId (通讯录 keeps filtering by it).
  const [inProjectChat, setInProjectChat] = useState(false);
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [creatingProject, setCreatingProject] = useState(false);
  const [createProjectErr, setCreateProjectErr] = useState('');
  async function submitCreateProject() {
    const name = newProjectName.trim();
    if (!name) { setCreateProjectErr('请输入名称'); return; }
    if (name.length > 50) { setCreateProjectErr('最多 50 字'); return; }
    setCreatingProject(true);
    setCreateProjectErr('');
    try {
      const r = await holonApiFetch('/api/v1/secretary-projects', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!r.ok) { setCreateProjectErr('创建失败'); setCreatingProject(false); return; }
      const body = await r.json() as { project: SecretaryProjectWithStaff };
      setSecretaryProjects((prev) => {
        const next = [...prev, body.project];
        setCachedSecretaryProjects(next);
        return next;
      });
      setActiveProjectId(body.project.id);
      setInProjectChat(true);
      setShowCreateProject(false);
      setNewProjectName('');
      setCreatingProject(false);
    } catch {
      setCreateProjectErr('网络错误');
      setCreatingProject(false);
    }
  }
  // Owner: 聊天 tab 始终显示一个项目的 chat;切项目用 swipe;无 list page.
  // Always land in chat when on 聊天 tab and there's at least one project.
  useEffect(() => {
    if (tab !== 'chats') return;
    if (inProjectChat) return;
    if (secretaryProjects.length >= 1) {
      const target = activeProjectId
        ? secretaryProjects.find((p) => p.id === activeProjectId) ?? secretaryProjects[0]
        : secretaryProjects[0];
      if (target) {
        setActiveProjectId(target.id);
        setInProjectChat(true);
      }
    }
  }, [tab, secretaryProjects, inProjectChat, activeProjectId]);

  // Swipe hint label: null = hidden, string = project name being navigated to.
  const [swipeHint, setSwipeHint] = useState<string | null>(null);
  // Pointer tracking for horizontal swipe-between-projects gesture.
  const swipeOrigin = useRef<{ x: number; y: number } | null>(null);
  const [desktopOffline, setDesktopOffline] = useState(false);
  const [checkingConnection, setCheckingConnection] = useState(false);
  const [badges] = useState<Record<BadgedTabKey, number>>({ chats: 0, work: 0 });
  const [staffRefreshing, setStaffRefreshing] = useState(false);
  const [meSubview, setMeSubview] = useState(false); // me-tab 二级页(资产/用量)→ 隐藏顶栏
  const [pendingDelivId, setPendingDelivId] = useState<string | null>(null); // strip→看板 deliverable deep-link
  // Feature 1: hide bottom tab bar while actively chatting with 小秘
  const [chatComposerActive, setChatComposerActive] = useState(false);
  // Feature 3: show/hide 请示 strip preference
  const [showOwnerTodo, setShowOwnerTodoState] = useState<boolean>(() => getShowOwnerTodo());

  useEffect(() => {
    function onPrefChange() { setShowOwnerTodoState(getShowOwnerTodo()); }
    window.addEventListener('holon:ownerTodoPrefChange', onPrefChange);
    return () => window.removeEventListener('holon:ownerTodoPrefChange', onPrefChange);
  }, []);

  // Hide the bottom 4-tab bar whenever ANY text field is focused (keyboard up) —
  // anywhere in the app (小秘 chat, employee chat, terminal command box, search).
  // Reclaims space so the soft keyboard never squeezes/covers the input row.
  useEffect(() => {
    const isField = (el: Element | null): boolean =>
      !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || (el as HTMLElement).isContentEditable);
    function onFocusIn(e: FocusEvent) { if (isField(e.target as Element)) setChatComposerActive(true); }
    function onFocusOut() {
      // Defer: when moving between fields, blur fires before the next focus.
      window.setTimeout(() => setChatComposerActive(isField(document.activeElement)), 60);
    }
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
    };
  }, []);

  useEffect(() => {
    const conn = readDesktopConnection();
    if (conn) {
      installMobileApiFetchProxy();
      setConnection(conn);
    }
    setBooted(true);
  }, []);

  const fetchStaff = useCallback(async () => {
    setStaffRefreshing(true);
    try {
      const r = await holonApiFetch('/api/v1/staff', { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json() as ListStaffResponse;
      const staffItems = Array.isArray(j.items) ? j.items : [];
      setStaff(staffItems);
      setCachedStaff(staffItems);
      setStaffError('');
      // Per-agent token usage (best-effort; never blocks the roster). Only
      // claude-based agents have counts (from local Claude logs); codex/others
      // come back without an entry → row shows "暂无统计".
      void holonApiFetch('/api/v1/usage', { cache: 'no-store' })
        .then((ur) => (ur.ok ? ur.json() : null))
        .then((uj: { agents?: Array<{ id: string; today_tokens: number; total_tokens: number }> } | null) => {
          if (!uj?.agents) return;
          const map: Record<string, AgentUsage> = {};
          for (const a of uj.agents) map[a.id] = { today_tokens: a.today_tokens, total_tokens: a.total_tokens };
          setAgentUsage(map);
        })
        .catch(() => { /* usage is optional */ });
    } catch (err) {
      setStaffError(err instanceof Error ? err.message : String(err));
      setDesktopOffline(true);
    } finally {
      setStaffRefreshing(false);
    }
  }, []);

  // Rooms fetch (SWR pattern — cache-first then desk sync).
  const fetchRooms = useCallback(async () => {
    try {
      const r = await holonApiFetch('/api/v1/rooms', { cache: 'no-store' });
      if (!r.ok) return;
      const j = await r.json() as { items?: Room[] };
      const items = Array.isArray(j.items) ? j.items : [];
      setRooms(items);
      setCachedRooms(items);
    } catch { /* desk unreachable — keep stale cache */ }
  }, []);

  // Secretary projects fetch (SWR — cache-first then desk sync).
  const fetchSecretaryProjects = useCallback(async () => {
    try {
      const r = await holonApiFetch('/api/v1/secretary-projects', { cache: 'no-store' });
      if (!r.ok) return;
      const j = await r.json() as { items?: SecretaryProjectWithStaff[] };
      const items = Array.isArray(j.items) ? j.items : [];
      setSecretaryProjects(items);
      setCachedSecretaryProjects(items);
      // Auto-select the first project if none selected yet.
      setActiveProjectId((prev) => prev ?? (items[0]?.id ?? null));
    } catch { /* desk unreachable — keep stale cache */ }
  }, []);

  // Initial staff load when connection is established.
  useEffect(() => {
    if (!connection) return;
    void fetchStaff();
    void fetchRooms();
    void fetchSecretaryProjects();
  }, [connection, fetchStaff, fetchRooms, fetchSecretaryProjects]);

  // Refetch staff roster when a team-pack import completes (triggered from MeTab).
  useEffect(() => {
    function onPackImported() { void fetchStaff(); }
    window.addEventListener('holon:team-pack-imported', onPackImported);
    return () => window.removeEventListener('holon:team-pack-imported', onPackImported);
  }, [fetchStaff]);

  // Re-fetch staff + rooms when the contacts tab becomes active (visibility-gated).
  const prevTabRef = useRef<TabKey>('chats');
  useEffect(() => {
    if (tab === 'contacts' && prevTabRef.current !== 'contacts' && connection) {
      void fetchStaff();
      void fetchRooms();
    }
    prevTabRef.current = tab;
  }, [tab, connection, fetchStaff, fetchRooms]);

  useEffect(() => {
    if (!connection) return;
    void checkDesktop();
    // Adaptive cadence: poll fast (3s) while offline so recovery is near-instant
    // and fully automatic; relax to 12s once connected. No user action, no config.
    const interval = desktopOffline ? 3000 : CONNECTION_POLL_MS;
    const id = window.setInterval(() => void checkDesktop(), interval);
    return () => window.clearInterval(id);
  }, [connection, desktopOffline]);

  // Reconnect IMMEDIATELY when the app returns to the foreground. Android (esp.
  // Samsung) suspends the webview in the background, which also FREEZES the 12s
  // poll timer above — so on resume the app would otherwise sit on a stale
  // "offline" state until a poll eventually fires. visibilitychange + focus fire
  // on resume, so we re-check the desk right away. (No native plugin needed.)
  useEffect(() => {
    if (!connection) return;
    const recheck = () => { if (document.visibilityState === 'visible') void checkDesktop(); };
    document.addEventListener('visibilitychange', recheck);
    window.addEventListener('focus', recheck);
    return () => {
      document.removeEventListener('visibilitychange', recheck);
      window.removeEventListener('focus', recheck);
    };
  }, [connection]);

  // Owner: 不应该一抖就标"离线"。Require 5 consecutive ping failures (~60s @ 12s
  // poll) before flipping to offline. iOS+Tailscale wake-from-suspend, dev-mode
  // route recompile, or a brief cellular/WiFi handoff each can burn 1-3 strikes
  // without indicating real loss. 8s abort on each ping prevents a single hung
  // fetch from stalling the next interval.
  const pingFailRef = useRef(0);
  async function checkDesktop() {
    setCheckingConnection(true);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const r = await holonApiFetch('/api/v1/ping', { cache: 'no-store', signal: ctrl.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      pingFailRef.current = 0;
      setDesktopOffline(false);
      // Refresh stored candidates from the desk's current network state. This
      // lets clients that paired BEFORE the candidates-in-pair-response change
      // pick up the failover list lazily, without re-pairing.
      try {
        const body = await r.json() as { lan_candidates?: unknown };
        if (Array.isArray(body.lan_candidates) && body.lan_candidates.length > 0) {
          const remote = body.lan_candidates
            .filter((u): u is string => typeof u === 'string' && u.length > 0)
            .map((u) => { try { return normalizeBaseUrl(u); } catch { return ''; } })
            .filter((u) => u.length > 0);
          if (remote.length > 0) {
            const conn = readDesktopConnection();
            if (conn) {
              const have = new Set(conn.candidates ?? []);
              const missing = remote.filter((u) => !have.has(u));
              if (missing.length > 0) {
                const merged = [conn.baseUrl, ...(conn.candidates ?? []), ...remote]
                  .filter((u, i, a) => a.indexOf(u) === i);
                const next: MobileDesktopConnection = { ...conn, candidates: merged };
                writeDesktopConnection(next);
                setConnection(next);
              }
            }
          }
        }
      } catch { /* ping ok was enough; body parse is best-effort */ }
    } catch {
      // Before counting a strike, try the stored candidate URLs. If a different
      // one answers, silently re-point the connection — the owner never re-pairs.
      const conn = readDesktopConnection();
      if (conn && (conn.candidates?.length ?? 0) > 0) {
        const newUrl = await pickLiveBaseUrl(conn);
        if (newUrl !== null && newUrl !== conn.baseUrl) {
          // Found a working alternate endpoint — swap it in as primary.
          const others = [conn.baseUrl, ...(conn.candidates ?? [])]
            .filter((u) => u !== newUrl);
          const newConn: MobileDesktopConnection = {
            ...conn,
            baseUrl: newUrl,
            candidates: [newUrl, ...others].filter((u, i, a) => a.indexOf(u) === i),
          };
          writeDesktopConnection(newConn);
          setConnection(newConn);
          pingFailRef.current = 0;
          setDesktopOffline(false);
          return; // don't strike — we're back online via alternate URL
        }
      }
      pingFailRef.current += 1;
      if (pingFailRef.current >= 5) {
        setDesktopOffline(true);
        // LAN sweep only makes sense on the same /24. Tailscale IPs (100.64/10
        // CGNAT range) don't shift and aren't reachable by subnet probe from
        // cellular — skip the sweep to avoid wasted probes + battery drain.
        const host = (() => { try { return new URL(conn?.baseUrl ?? '').hostname; } catch { return ''; } })();
        const isTailscale = /^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\./.test(host);
        if (!isTailscale) void tryRediscoverDesk();
      }
    } finally {
      clearTimeout(timer);
      setCheckingConnection(false);
    }
  }

  // LAN auto-discovery: when the stored desk address stops answering (its IP
  // shifted on the same network), sweep the /24 for the host that accepts our
  // device token, then silently re-point the connection — no QR re-scan, no
  // config. Guarded so only one sweep runs at a time. Intranet-only, no cloud.
  async function tryRediscoverDesk() {
    if (discoveringRef.current) return;
    const conn = readDesktopConnection();
    if (!conn) return;
    discoveringRef.current = true;
    try {
      const found = await discoverDeskOnLan(conn.baseUrl, conn.deviceToken);
      if (found) {
        if (found !== conn.baseUrl) {
          const next: MobileDesktopConnection = { baseUrl: found, deviceToken: conn.deviceToken };
          writeDesktopConnection(next);
          setConnection(next);
        }
        setDesktopOffline(false);
      }
    } catch {
      /* not found on this subnet — stay offline; the poll will retry */
    } finally {
      discoveringRef.current = false;
    }
  }

  function handlePaired() {
    const conn = readDesktopConnection();
    if (conn) {
      installMobileApiFetchProxy();
      setConnection(conn);
    }
  }

  function disconnect() {
    clearDesktopConnection();
    setConnection(null);
    setSelectedStaff(null);
    setSelectedRoom(null);
    setDesktopOffline(false);
  }

  function openTab(next: TabKey) {
    setTab(next);
    setSelectedStaff(null);
    setSelectedRoom(null);
    setStaffInitialMode('primary');
    setMeSubview(false); // returning to 我 root must show its header (no flash)
  }

  // v1: "开会议室" from any staff detail always navigates to the default team room.
  // The staff is already a member there (server syncs on boot and on /team fetch).
  function openDefaultTeamRoom() {
    const DEFAULT_ID = 'room_default_team';
    const teamRoom = rooms.find((r) => r.id === DEFAULT_ID);
    if (teamRoom) {
      setSelectedStaff(null);
      setSelectedRoom(teamRoom);
    } else {
      // Room not yet in local cache — fetch /api/v1/rooms/team to bootstrap.
      holonApiFetch('/api/v1/rooms/team', { cache: 'no-store' })
        .then(async (r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const j = await r.json() as { room?: Room };
          if (!j.room) throw new Error('no room in response');
          const teamR = j.room;
          setRooms((prev) => {
            const next = [teamR, ...prev.filter((x) => x.id !== teamR.id)];
            setCachedRooms(next);
            return next;
          });
          setSelectedStaff(null);
          setSelectedRoom(teamR);
        })
        .catch((err) => {
          console.error('[WeizoApp] openDefaultTeamRoom fetch failed:', err instanceof Error ? err.message : String(err));
        });
    }
  }

  // v2 stubs — kept for data-model completeness but not exposed in v1 UI.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  function _createRoomForStaff_v2_stub(_s: Staff) { /* deferred to v2 */ }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  function _handleNewRoom_v2_stub() { /* deferred to v2 */ }

  // Don't flash anything on SSR — wait until client boot
  if (!booted) return null;

  // M-L-FIX3: pair-first. First-run (no stored connection) renders the pairing
  // screen as the sole UI. Once PairingPrompt calls onPaired(), handlePaired()
  // reads the just-written connection from localStorage and sets it in state,
  // which transitions into the normal shell without a full-page reload.
  if (!connection) {
    return <PairingPrompt onPaired={handlePaired} />;
  }

  const inRoomDrillIn = tab === 'contacts' && !!selectedRoom;

  return (
    <main className={`mobile-app-shell mobile-static-shell mobile-wechat-shell${(chatComposerActive || (tab === 'contacts' && !!selectedStaff) || inRoomDrillIn || (tab === 'me' && !!meSubview)) ? ' mobile-chat-immersive' : ''}`}>
      <ConnectionBanner
        offline={desktopOffline}
        checking={checkingConnection}
        onRetry={() => void checkDesktop()}
        // Owner: 修复按钮 ≠ 断开。 Repair should only retry the connection,
        // NOT clear the device-token / force re-pair. Explicit "断开桌面" lives
        // in 我 tab as the only path to wipe pairing.
        onRepair={() => void checkDesktop()}
      />
      {/* Header shows ONLY on a non-chat tab ROOT. WeChat-style: in the chat
          tab the recipient bar sits at the very top (no title above it); any
          drill-in (staff profile / 资产 / 用量 / room) carries its own back-row. */}
      {tab !== 'chats' && !(tab === 'contacts' && selectedStaff) && !inRoomDrillIn && !(tab === 'me' && meSubview) && (
        <AppHeader title={tabTitle(tab, selectedStaff, selectedRoom ?? undefined)} />
      )}
      <section
        className={`mobile-tab-content${((tab === 'chats' && inProjectChat) || (tab === 'contacts' && selectedStaff) || inRoomDrillIn) ? ' mobile-tab-content-chat' : ''}`}
      >
        {/* 聊天 tab: project list → tap to enter secretary chat thread.
            When activeProjectId is set, show the secretary chat full-screen.
            When null, show the project list (WeChat conversation list style). */}
        {tab === 'chats' && !inProjectChat && (
          <ProjectListTab
            projects={secretaryProjects}
            onEnter={(pid) => { setActiveProjectId(pid); setInProjectChat(true); }}
            onProjectCreated={(proj) => {
              setSecretaryProjects((prev) => {
                const next = [...prev, proj];
                setCachedSecretaryProjects(next);
                return next;
              });
              setActiveProjectId(proj.id);
              setInProjectChat(true);
            }}
          />
        )}
        {tab === 'chats' && inProjectChat && !!activeProjectId && (
          <div className="mobile-chat-panel">
            <ProjectChatHeader
              projectId={activeProjectId}
              projects={secretaryProjects}
              onBack={() => setInProjectChat(false)}
              onRename={(id, newName) => {
                setSecretaryProjects((prev) => {
                  const next = prev.map((p) => p.id === id ? { ...p, name: newName } : p);
                  setCachedSecretaryProjects(next);
                  return next;
                });
              }}
              onDeleted={() => {
                setActiveProjectId(null);
                setInProjectChat(false);
                void fetchSecretaryProjects();
              }}
              onCreateProject={() => setShowCreateProject(true)}
            />
            {showOwnerTodo && (
              <OwnerTodoStrip
                onOpenStaff={(staffId) => {
                  const found = staff.find((s) => s.id === staffId);
                  if (found) {
                    setStaffInitialMode('primary');
                    setSelectedStaff(found);
                  }
                  setTab('contacts');
                }}
              />
            )}
            {/* Swipe-between-projects wrapper. Detects horizontal pan on the
                message area only (not header / composer). Threshold: |dx| > 80
                AND |dx|/|dy| > 1.5. RTL = next project, LTR = prev (wraps). */}
            <ProjectSwipeArea
              projects={secretaryProjects}
              activeProjectId={activeProjectId}
              onSwitch={(nextId) => setActiveProjectId(nextId)}
              renderChat={(pid) => {
                const props: ComponentProps<typeof MobileOwnerChat> = {
                  staff,
                  seed: pid === activeProjectId ? chatSeed : null,
                  onSeedConsumed: () => setChatSeed(null),
                  projectId: pid,
                };
                if (pid === activeProjectId) props.onComposerActiveChange = setChatComposerActive;
                return <MobileOwnerChat {...props} />;
              }}
            />
          </div>
        )}
        {tab === 'contacts' && (
          selectedRoom ? (
            <RoomView
              room={selectedRoom}
              allStaff={staff}
              onBack={() => setSelectedRoom(null)}
              onRename={(name) => {
                const updated: Room = { ...selectedRoom, name };
                setSelectedRoom(updated);
                setRooms((prev) => {
                  const next = prev.map((r) => r.id === updated.id ? updated : r);
                  setCachedRooms(next);
                  return next;
                });
              }}
            />
          ) : selectedStaff ? (
            <StaffDetail
              staff={selectedStaff}
              onBack={() => { setSelectedStaff(null); setStaffInitialMode('primary'); }}
              initialMode={staffInitialMode}
              onOpenTeamRoom={openDefaultTeamRoom}
            />
          ) : (
            <Contacts
              staff={activeProjectId
                ? staff.filter((s) => {
                    const tags: string[] = Array.isArray(s.tags) ? s.tags : [];
                    // Owner: 严格只显示当前项目的员工,无 shared fallback.
                    return tags.includes(`project:${activeProjectId}`);
                  })
                : staff}
              agentUsage={agentUsage}
              onOpen={(s) => { setStaffInitialMode('primary'); setSelectedStaff(s); }}
              onOpenConfig={(s) => { setStaffInitialMode('config'); setSelectedStaff(s); }}
              onRefresh={() => void fetchStaff()}
              refreshing={staffRefreshing}
              rooms={rooms}
              onOpenRoom={(r) => { setSelectedRoom(r); setSelectedStaff(null); }}
            />
          )
        )}
        {tab === 'work' && (
          <WorkTracker
            onTalkToSecretary={(text) => {
              setChatSeed(text);
              // Ensure we navigate into a project chat (use first available if none selected)
              if (!activeProjectId && secretaryProjects.length > 0) {
                setActiveProjectId(secretaryProjects[0]!.id);
              }
              setInProjectChat(true);
              setTab('chats');
            }}
            initialDelivId={pendingDelivId}
          />
        )}
        {tab === 'me' && (
          // connection is always non-null here: unpaired path returns PairingPrompt above
          <MeTab
            connection={connection!}
            onDisconnect={disconnect}
            onSubviewChange={setMeSubview}
            activeProjectId={activeProjectId}
            onUseSkill={(text) => {
              setChatSeed(text);
              if (!activeProjectId && secretaryProjects.length > 0) {
                setActiveProjectId(secretaryProjects[0]!.id);
              }
              setInProjectChat(true);
              setTab('chats');
            }}
          />
        )}
      </section>
      <BottomNav
        active={tab}
        badges={badges}
        onTab={openTab}
        // Hide the bottom 4-tab bar when (a) the keyboard is up OR (b) we've
        // drilled into a 2nd-level view (employee detail / room / 我 subview / terminal).
        // The owner wants drill-ins to use the full screen — especially the
        // adopted-CLI 后台 terminal where every line counts.
        chatActive={chatComposerActive || (tab === 'contacts' && !!selectedStaff) || inRoomDrillIn || (tab === 'me' && !!meSubview)}
      />
      {showCreateProject && (
        <div
          className="project-create-overlay"
          onClick={() => { if (!creatingProject) { setShowCreateProject(false); setNewProjectName(''); setCreateProjectErr(''); } }}
        >
          <div className="project-create-dialog" onClick={(e) => e.stopPropagation()}>
            <h3 className="project-create-title">新建项目</h3>
            <input
              type="text"
              className="project-create-input"
              placeholder="项目名称"
              value={newProjectName}
              onChange={(e: ChangeEvent<HTMLInputElement>) => { setNewProjectName(e.target.value); setCreateProjectErr(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter') void submitCreateProject(); if (e.key === 'Escape') setShowCreateProject(false); }}
              autoFocus
              maxLength={50}
            />
            {createProjectErr && <span style={{ color: '#c0392b', fontSize: 13 }}>{createProjectErr}</span>}
            <div className="project-create-actions">
              <button type="button" className="project-create-cancel" disabled={creatingProject} onClick={() => { setShowCreateProject(false); setNewProjectName(''); setCreateProjectErr(''); }}>取消</button>
              <button type="button" className="project-create-confirm" disabled={creatingProject || !newProjectName.trim()} onClick={() => void submitCreateProject()}>
                {creatingProject ? '创建中…' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

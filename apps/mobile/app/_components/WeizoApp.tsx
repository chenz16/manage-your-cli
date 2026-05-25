'use client';

// Weizo 微作 — WeChat-style 4-tab mobile shell.
// Tabs: 微信 (chat-first, 小秘 + staff 1:1) | 通讯录 (staff list + profile) |
//        看板 (待办 LEAD → 进行中 → 交付) | 我 (owner identity + persona + disconnect).
// All API calls go through holonApiFetch (proxied to paired desktop).

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
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
  Staff,
  Todo,
  TodoPriority,
  ListTodosResponse,
} from '@holon/api-contract';
import type { PersonaPreset, SkillDescriptor, SkillKind } from '@holon/core';
import {
  clearDesktopConnection,
  holonApiFetch,
  installMobileApiFetchProxy,
  normalizeBaseUrl,
  readDesktopConnection,
  writeDesktopConnection,
  type MobileDesktopConnection,
} from '../_lib/mobile-runtime';
import { discoverDeskOnLan } from '../_lib/desk-discovery';
import { speak as deviceTtsSpeak, stop as deviceTtsStop } from '../_lib/tts';
import * as nativeStt from '../_lib/native-stt';
import { deskOrigin } from '../_lib/desk-origin';

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
    else insertTranscriptIntoComposer(text, true); // 语音→直接发送,不弹键盘
  }

  // ── PRIMARY: native on-device STT ─────────────────────────────────────────
  // Permission-first; attempt start() even when available()=false (Samsung/AOSP
  // devices often report false but the recognizer actually works).

  async function startNativeStt(ev: PointerEvent<HTMLButtonElement>) {
    ev.preventDefault();
    if (state !== 'idle') return;
    pointerIdRef.current = ev.pointerId;
    ev.currentTarget.setPointerCapture(ev.pointerId);
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
        {state === 'transcribing' ? '…' : '🎙'}
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
function MessageActionStrip({ id, text }: { id: string; text: string }) {
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
      // TODO: pass per-staff tts_voice + tts_style here once MessageActionStrip
      // receives the current staff's AI-agent config (tts_voice, tts_style).
      // Deferred — fields are stored on Staff but not yet threaded to the speak call.
      await deviceTtsSpeak(text);
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

function makeMobileOwnerAdapter(): ChatModelAdapter {
  return {
    async *run({ messages, abortSignal }) {
      const payload = messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: flattenText(m.content) }));

      let assembled = '';
      try {
        const response = await holonApiFetch('/api/v1/chat/owner/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: payload, client: 'mobile' }),
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
function OwnerChatHistorySync({ runtime }: { runtime: ReturnType<typeof useLocalRuntime> }) {
  const thread = useThread();
  const restoredRef = useRef(false);
  const deskSyncedRef = useRef(false);

  // Step 1: instant first-paint from local cache (offline fallback)
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    const cached = loadChatMessages(OWNER_CHAT_ID);
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
    holonApiFetch('/api/v1/chat/history?thread=owner', { cache: 'no-store' })
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
        saveChatMessages(OWNER_CHAT_ID, deskMsgs);
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
    if (toSave.length > 0) saveChatMessages(OWNER_CHAT_ID, toSave);
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
  const [skills, setSkills] = useState<SkillDescriptor[]>([]);
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
        setSkills(Array.isArray(j.items) ? j.items : []);
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
        const titles: string[] = dvRes && dvRes.ok
          ? (((await dvRes.json()) as { items?: Array<{ title?: string }> }).items ?? [])
              .map((d) => (d.title ?? '').toLowerCase()).filter(Boolean)
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

function MobileOwnerChat({
  staff,
  seed,
  onSeedConsumed,
}: {
  staff: readonly Staff[];
  seed: string | null;
  onSeedConsumed: () => void;
}) {
  const adapter = useMemo(() => makeMobileOwnerAdapter(), []);
  const runtime = useLocalRuntime(adapter);
  const [mounted, setMounted] = useState(false);
  const [attachment, setAttachment] = useState<PendingAttachment | null>(null);

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
    <AssistantRuntimeProvider runtime={runtime}>
      <OwnerChatHistorySync runtime={runtime} />
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
              <ComposerPrimitive.Input rows={1} className="chat-input" placeholder="发消息给小秘…" />
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

  // Step 1: instant first-paint from local cache (offline fallback)
  // Step 2: desk-primary sync — fetch desk transcript and reconcile
  useEffect(() => {
    // Immediate: seed from local cache for first-paint
    const cached = loadChatMessages(staffChatId);
    if (cached.length > 0) setMessages(cached);

    // Async: fetch the shared desk transcript as primary source of truth
    const encodedThread = encodeURIComponent(staffChatId);
    holonApiFetch(`/api/v1/chat/history?thread=${encodedThread}`, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) return;
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
          .map((m) => ({
            role: m.role as 'user' | 'assistant',
            content: m.content as string,
          }));
        if (deskMsgs.length === 0) return;
        // Write-through to local cache for offline use
        saveChatMessages(staffChatId, deskMsgs);
        // Update state if desk has more messages than what we showed from cache
        setMessages((current) =>
          deskMsgs.length > current.length ? deskMsgs : current,
        );
      })
      .catch(() => {
        // Desk unreachable — local cache already shown, no action needed
      });
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

  async function send() {
    let content = text.trim();
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
      const res = await holonApiFetch(`/api/v1/staff/${encodeURIComponent(staff.id)}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next }),
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
        <div className="composer-input-row">
          <MobileVoiceRecorderButton onTranscript={(transcript) => setText((current) => current ? `${current} ${transcript}` : transcript)} />
          <MobileAttachButton
            onAttach={(a) => setAttachment(a)}
            disabled={attachment !== null}
          />
          <textarea
            rows={1}
            className="chat-input"
            value={text}
            onChange={(ev) => setText(ev.target.value)}
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

function Contacts({
  staff,
  agentUsage,
  onOpen,
  onOpenConfig,
  onRefresh,
  refreshing,
}: {
  staff: readonly Staff[];
  agentUsage: Record<string, AgentUsage>;
  onOpen: (s: Staff) => void;
  onOpenConfig: (s: Staff) => void;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const startY = useRef<number | null>(null);
  const armedRef = useRef(false);
  const [pullY, setPullY] = useState(0);
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();
  const filtered = query
    ? staff.filter((s) => `${s.name} ${s.role_label} ${s.role_name}`.toLowerCase().includes(query))
    : staff;

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

  const progress = Math.min(1, pullY / TRIGGER_PX);

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
      {/* WeChat-style search bar */}
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
      {staff.length === 0 ? (
        <div className="mobile-empty-panel">还没有员工。</div>
      ) : filtered.length === 0 ? (
        <div className="mobile-empty-panel">没有匹配「{q}」的员工。</div>
      ) : filtered.map((s) => {
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
                  ? <span className="mobile-row-tokens">今日 {fmtTokens(usage.today_tokens)} · 累计 {fmtTokens(usage.total_tokens)} tokens</span>
                  : <span className="mobile-row-tokens mobile-row-tokens-na">暂无统计</span>}
              </span>
            </span>
            <button
              type="button"
              className="mobile-row-action"
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '8px 4px', color: '#888', display: 'flex', alignItems: 'center' }}
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
      })}
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

function StaffTerminal({ staffId }: { staffId: string }) {
  const [output, setOutput] = useState('');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [cmd, setCmd] = useState('');
  const [sending, setSending] = useState(false);
  const preRef = useRef<HTMLPreElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await holonApiFetch(`/api/v1/staff/${encodeURIComponent(staffId)}/cli/output?lines=300`, { cache: 'no-store' });
      const j = await r.json().catch(() => ({})) as { ok?: boolean; output?: string; reason?: string };
      if (j.ok && typeof j.output === 'string') { setOutput(j.output); setReason(''); }
      else { setReason(j.reason ?? '该员工当前没有运行中的终端会话'); }
    } catch (e) {
      setReason(e instanceof Error ? e.message : String(e));
    } finally { setLoading(false); }
  }, [staffId]);

  // Send a command (keystrokes + Enter) straight into the agent's tmux session.
  // Voice fills the box; the owner reviews, then taps 发送 — no auto-fire, since a
  // wrong command can disrupt the agent's work.
  async function sendCmd() {
    const text = cmd.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const r = await holonApiFetch(`/api/v1/staff/${encodeURIComponent(staffId)}/cli/input`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: text, enter: true }),
      });
      if (r.ok) { setCmd(''); window.setTimeout(() => void load(), 400); }
      else {
        const j = await r.json().catch(() => ({})) as { error?: string };
        setReason(j.error === 'no_session' ? '该员工没有运行中的终端会话' : (j.error ?? '发送失败'));
      }
    } catch (e) {
      setReason(e instanceof Error ? e.message : String(e));
    } finally { setSending(false); }
  }

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 3000);
    return () => window.clearInterval(id);
  }, [load]);

  // Keep pinned to the latest output (like a real terminal).
  useEffect(() => { const el = preRef.current; if (el) el.scrollTop = el.scrollHeight; }, [output]);

  return (
    <div className="mobile-term-wrap">
      <div className="mobile-persona-editor-head">
        <span className="mobile-config-dt">实时后台</span>
        <button type="button" className="mobile-term-refresh" onClick={() => void load()} disabled={loading}>
          {loading ? '刷新中…' : '刷新'}
        </button>
      </div>
      {output
        ? <pre ref={preRef} className="mobile-term-screen">{output}</pre>
        : <div className="mobile-term-empty">{reason || '加载中…'}</div>}
      {/* Direct CLI control: speak/type a command → straight into the tmux session. */}
      <div className="mobile-term-input-row">
        <MobileVoiceRecorderButton onTranscript={(t) => setCmd((c) => (c ? `${c} ${t}` : t))} />
        <input
          className="mobile-term-input"
          value={cmd}
          onChange={(e) => setCmd(e.target.value)}
          placeholder="输入命令…（语音或打字,回车执行）"
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void sendCmd(); } }}
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
}: {
  staffId: string;
  fallback?: Staff;
  onMessage?: (staff: Staff) => void;
  onBack?: () => void;
  embedded?: boolean;
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
  const [openRow, setOpenRow] = useState<'name' | 'roleLabel' | 'roleName' | 'maxJobs' | 'persona' | 'ttsVoice' | 'ttsStyle' | 'replyLang' | null>(null);

  function toggleRow(row: 'name' | 'roleLabel' | 'roleName' | 'maxJobs' | 'persona' | 'ttsVoice' | 'ttsStyle' | 'replyLang') {
    setOpenRow((prev) => (prev === row ? null : row));
  }

  // TTS + reply language drafts (per-staff AI-agent config)
  const [ttsVoiceDraft, setTtsVoiceDraft] = useState('');
  const [ttsStyleDraft, setTtsStyleDraft] = useState('');
  const [replyLangDraft, setReplyLangDraft] = useState<'auto' | 'zh-CN' | 'en'>('auto');
  const [savingAiCfg, setSavingAiCfg] = useState(false);
  const [aiCfgMsg, setAiCfgMsg] = useState('');

  useEffect(() => {
    setTtsVoiceDraft(staff?.tts_voice ?? '');
    setTtsStyleDraft(staff?.tts_style ?? '');
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
  const REPLY_LANG_OPTIONS: Array<{ label: string; value: 'auto' | 'zh-CN' | 'en' }> = [
    { label: '跟随', value: 'auto' },
    { label: '中文', value: 'zh-CN' },
    { label: 'English', value: 'en' },
  ];

  const ttsVoiceLabel = TTS_VOICE_OPTIONS.find((o) => o.value === (staff?.tts_voice ?? ''))?.label ?? '默认';
  const ttsStyleLabel = TTS_STYLE_OPTIONS.find((o) => o.value === (staff?.tts_style ?? ''))?.label ?? '默认';
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

          {/* 角色标签 row */}
          <button type="button" className="mobile-collapse-head" onClick={() => toggleRow('roleLabel')}>
            <span className="mobile-me-row-title">角色标签</span>
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

          {/* 角色名 row */}
          <button type="button" className="mobile-collapse-head" onClick={() => toggleRow('roleName')}>
            <span className="mobile-me-row-title">角色名</span>
            <span className="mobile-collapse-summary">{staff.role_name || '—'}</span>
            <span className={`mobile-collapse-chevron${openRow === 'roleName' ? ' open' : ''}`}>›</span>
          </button>
          {openRow === 'roleName' && (
            <div className="mobile-staff-edit" style={{ paddingBottom: 8 }}>
              <input id="staff-rolename-emb" className="mobile-staff-field" value={roleNameDraft}
                onChange={(e) => setRoleNameDraft(e.target.value)} disabled={savingProps} />
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

          {/* 人设 row */}
          <button type="button" className="mobile-collapse-head" onClick={() => toggleRow('persona')}>
            <span className="mobile-me-row-title">人设（系统指令）</span>
            <span className="mobile-collapse-summary" style={{ maxWidth: '45%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {staff.system_prompt?.trim() ? staff.system_prompt.trim().slice(0, 30) + (staff.system_prompt.trim().length > 30 ? '…' : '') : '未设置'}
            </span>
            <span className={`mobile-collapse-chevron${openRow === 'persona' ? ' open' : ''}`}>›</span>
          </button>
          {openRow === 'persona' && (
            <div className="mobile-persona-editor" style={{ margin: '0 0 8px' }}>
              {personaMsg && <span className="mobile-persona-editor-msg" style={{ display: 'block', marginBottom: 4 }}>{personaMsg}</span>}
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
              {aiCfgMsg && <span className="mobile-persona-editor-msg" style={{ display: 'block', marginBottom: 4 }}>{aiCfgMsg}</span>}
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
              {aiCfgMsg && <span className="mobile-persona-editor-msg" style={{ display: 'block', marginBottom: 4 }}>{aiCfgMsg}</span>}
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

          {/* 回复语言 row */}
          <button type="button" className="mobile-collapse-head" onClick={() => toggleRow('replyLang')}>
            <span className="mobile-me-row-title">回复语言</span>
            <span className="mobile-collapse-summary">{replyLangLabel}</span>
            <span className={`mobile-collapse-chevron${openRow === 'replyLang' ? ' open' : ''}`}>›</span>
          </button>
          {openRow === 'replyLang' && (
            <div className="mobile-staff-edit" style={{ paddingBottom: 8 }}>
              {aiCfgMsg && <span className="mobile-persona-editor-msg" style={{ display: 'block', marginBottom: 4 }}>{aiCfgMsg}</span>}
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
  const [items, setItems] = useState<Deliverable[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<GetDeliverableResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openSwipeId, setOpenSwipeId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    holonApiFetch('/api/v1/deliverables', { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json() as ListDeliverablesResponse;
        if (!cancelled) setItems(Array.isArray(j.items) ? j.items.slice(0, 8) : []);
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
//   1. 老板要决定 — deliverables needing review (draft/final/revised) + stuck jobs
//   2. 团队动态   — running/queued jobs with agent heartbeat
//   3. 刚完成     — recently accepted deliverables (last 24h, up to 6)
//   4. 待办积压   — pending todos (top 3 preview + see-all)
//
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

function WorkTracker({ onTalkToSecretary }: { onTalkToSecretary: (text: string) => void }) {
  // ── shared data ────────────────────────────────────────────────────────
  const [deliverables, setDeliverables] = useState<Deliverable[]>([]);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [staffNames, setStaffNames] = useState<Map<string, string>>(new Map());
  const [latestOutput, setLatestOutput] = useState<Record<string, string>>({}); // staff_id → latest terminal line
  const [liveStaffId, setLiveStaffId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // deliverable detail/review overlay
  const [openDelivId, setOpenDelivId] = useState<string | null>(null);
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
      setDeliverables(Array.isArray(dj.items) ? dj.items : []);
      setJobs(Array.isArray(jj.items) ? jj.items : []);
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
  const needsReviewDeliv = deliverables.filter(
    (d) => d.status === 'draft' || d.status === 'final' || d.status === 'revised',
  );
  const stuckJobs = jobs.filter((j) => {
    if (j.status !== 'running') return false;
    if (!j.created_at) return false;
    const mins = (Date.now() - new Date(j.created_at).getTime()) / 60000;
    return mins > 20;
  });
  const needsYouCount = needsReviewDeliv.length + stuckJobs.length;

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
      {/* ── header ───────────────────────────────────────────────── */}
      <div className="kb-header">
        <span className="kb-header-title">看板</span>
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
      {/* Section 1: 老板要决定                                       */}
      {/* ──────────────────────────────────────────────────────────── */}
      <KanbanSectionHeader label="老板要决定" count={needsYouCount} />

      {needsYouCount === 0 && (
        <div className="kb-empty-row">暂无待决事项</div>
      )}

      {/* Deliverables needing review */}
      {needsReviewDeliv.map((d) => {
        const authorName = d.author_staff_id ? (staffNames.get(d.author_staff_id) ?? d.author_staff_id) : '—';
        return (
          <div key={d.id} className="kb-card kb-card-needs-you">
            <div className="kb-card-accent kb-accent-orange" />
            <div className="kb-card-body">
              <div className="kb-card-row1">
                <span className="kb-card-icon" aria-hidden="true">📄</span>
                <span className="kb-card-title">{d.title}</span>
                <span className="weizo-kanban-status-pill weizo-kanban-review-pending">待验收</span>
              </div>
              <div className="kb-card-row2">
                <span className="kb-card-meta">👤 {authorName} · {d.created_at ? timeAgo(d.created_at) : '—'}</span>
                <button
                  type="button"
                  className="kb-cta-btn"
                  onClick={() => setOpenDelivId(d.id)}
                >
                  立即处理 →
                </button>
              </div>
            </div>
          </div>
        );
      })}

      {/* Stuck jobs */}
      {stuckJobs.map((j) => {
        const staffName = j.staff_id ? (staffNames.get(j.staff_id) ?? j.staff_id) : '—';
        return (
          <div key={j.id} className="kb-card kb-card-needs-you">
            <div className="kb-card-accent kb-accent-red" />
            <div className="kb-card-body">
              <div className="kb-card-row1">
                <span className="kb-card-icon" aria-hidden="true">⚠️</span>
                <span className="kb-card-title">{j.brief ?? j.id}</span>
                <span className="weizo-kanban-status-pill weizo-kanban-status-stuck">⚠卡住</span>
              </div>
              <div className="kb-card-row2">
                <span className="kb-card-meta">👤 {staffName} · {elapsedLabel(j.created_at)}无响应</span>
                <button
                  type="button"
                  className="kb-cta-btn"
                  onClick={() => onTalkToSecretary(j.brief ?? j.id)}
                >
                  去对话 💬
                </button>
              </div>
            </div>
          </div>
        );
      })}

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
      {/* Section 3: 刚完成                                           */}
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
      {/* Section 4: 待办积压                                         */}
      {/* ──────────────────────────────────────────────────────────── */}
      <KanbanSectionHeader label="待办积压" count={todos.length} />

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
        <div className="kb-empty-row">暂无待办积压</div>
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
  const [data, setData] = useState<CliUsageResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    holonApiFetch('/api/v1/usage', { cache: 'no-store' })
      .then((r) => r.ok ? r.json() as Promise<CliUsageResponse> : Promise.resolve(null))
      .then((d) => { setData(d); })
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
      const response = await holonApiFetch('/api/v1/admin/bugs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: text,
          url: window.location.href,
          route: window.location.pathname,
          ts: new Date().toISOString(),
        }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string; bug_id?: string };
      if (!response.ok) throw new Error(body.error ?? `提交失败 HTTP ${response.status}`);
      setResult(`已提交：${body.bug_id ?? '反馈已收到'}`);
      setDescription('');
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
            placeholder="请描述你遇到的问题或建议。"
            autoFocus
          />
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

// ─── 老板代办 strip — 小秘领地: 小秘从「你↔小秘」对话提炼的、需你拍板的事 ────────
// (授权/同意/决定…)。别人/peer 让你做的走看板,不在这。可折叠;一碰输入/语音自动收起。
const OWNER_ACTIONS_CACHE = 'holon.mobile.ownerActions.v1';

function readCachedActions(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(OWNER_ACTIONS_CACHE);
    const j = raw ? JSON.parse(raw) : [];
    return Array.isArray(j) ? j.filter((x): x is string => typeof x === 'string') : [];
  } catch { return []; }
}

function OwnerTodoStrip() {
  const [items, setItems] = useState<string[]>(() => readCachedActions());
  const [collapsed, setCollapsed] = useState(true); // 默认收起,只显示数字;点一下看内容

  useEffect(() => {
    holonApiFetch('/api/v1/chat/owner-actions', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() as Promise<{ items?: string[] }> : Promise.resolve(null)))
      .then((d) => {
        if (d && Array.isArray(d.items)) {
          setItems(d.items);
          try { window.localStorage.setItem(OWNER_ACTIONS_CACHE, JSON.stringify(d.items)); } catch { /* noop */ }
        }
      })
      .catch(() => undefined);
  }, []);

  // Auto-collapse the moment the boss touches the composer (typing or voice) —
  // small Samsung screen, keep the chat window clear.
  useEffect(() => {
    function onDown(ev: Event) {
      const t = ev.target as HTMLElement | null;
      if (t?.closest('.mobile-chat-composer')) setCollapsed(true);
    }
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, []);

  if (items.length === 0) return null;

  return (
    <div className="mobile-todo-strip">
      <button type="button" className="mobile-todo-strip-head" onClick={() => setCollapsed((v) => !v)}>
        <span className="mobile-todo-strip-title">老板代办 · {items.length}</span>
        <span className="mobile-todo-strip-more">{collapsed ? '展开 ›' : '收起 ⌄'}</span>
      </button>
      {!collapsed && items.slice(0, 3).map((t, i) => (
        <div key={i} className="mobile-todo-line">
          <span className="mobile-todo-mark">○</span>
          <span className="mobile-todo-text">{t}</span>
        </div>
      ))}
    </div>
  );
}

// ─── 员工详情 — 点进默认落在 聊天 或 看后台(每员工可在配置里选);齿轮 ⚙ → 配置 ──
// Owner 2026-05-25: one landing view per employee (chat OR terminal), chosen in
// config. No top tab bar. Per-device preference in localStorage.
const STAFF_LANDING_KEY = 'holon.mobile.staffLanding.v1';
function getStaffLanding(id: string): 'chat' | 'terminal' {
  if (typeof window === 'undefined') return 'chat';
  try { return window.localStorage.getItem(`${STAFF_LANDING_KEY}.${id}`) === 'terminal' ? 'terminal' : 'chat'; }
  catch { return 'chat'; }
}
function setStaffLanding(id: string, v: 'chat' | 'terminal'): void {
  try { window.localStorage.setItem(`${STAFF_LANDING_KEY}.${id}`, v); } catch { /* noop */ }
}

function StaffDetail({ staff, onBack, initialMode }: { staff: Staff; onBack: () => void; initialMode?: 'primary' | 'config' }) {
  const isSecretary = staff.role_name === 'secretary';
  const [mode, setMode] = useState<'primary' | 'config'>(initialMode ?? 'primary');
  const [landing, setLanding] = useState<'chat' | 'terminal'>(() => (isSecretary ? 'chat' : getStaffLanding(staff.id)));

  function pickLanding(v: 'chat' | 'terminal') { setLanding(v); setStaffLanding(staff.id, v); }

  if (mode === 'config') {
    return (
      <div className="mobile-staff-detail">
        <div className="mobile-chat-header">
          <button type="button" className="mobile-chat-header-back" onClick={() => setMode('primary')} aria-label="返回">‹</button>
          <span className="mobile-chat-header-name">{staff.name} · 配置</span>
          <span className="mobile-chat-header-spacer" />
        </div>
        <div className="mobile-staff-cfg-scroll">
          {!isSecretary && (
            <div className="mobile-landing-toggle">
              <span className="mobile-me-label" style={{ margin: 0 }}>打开时默认显示</span>
              <div className="mobile-landing-seg">
                <button type="button" className={`mobile-landing-opt${landing === 'chat' ? ' is-active' : ''}`} onClick={() => pickLanding('chat')}>💬 聊天</button>
                <button type="button" className={`mobile-landing-opt${landing === 'terminal' ? ' is-active' : ''}`} onClick={() => pickLanding('terminal')}>🖥 看后台</button>
              </div>
            </div>
          )}
          <StaffProfile key={`cfg-${staff.id}`} staffId={staff.id} fallback={staff} embedded />
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
          <span className="mobile-asset-sub">{delivCount === null ? '…' : `${delivCount} 份`}</span>
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

function MeTab({
  connection,
  onDisconnect,
  onUseSkill,
  onSubviewChange,
}: {
  connection: MobileDesktopConnection;
  onDisconnect: () => void;
  onUseSkill: (text: string) => void;
  onSubviewChange: (inSubview: boolean) => void;
}) {
  const [owner, setOwner] = useState<OwnerProfile | null>(null);
  const [meData, setMeData] = useState<MeOwnerData | null>(null);
  const [snapshot, setSnapshot] = useState<OwnerSnapshot | null>(null);
  const [personas, setPersonas] = useState<PersonaPreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [personaSheetOpen, setPersonaSheetOpen] = useState(false);
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
  const [skillSheetOpen, setSkillSheetOpen] = useState(false);
  const [skillUsageOpen, setSkillUsageOpen] = useState(false);
  const [delivCount, setDelivCount] = useState<number | null>(null);
  const [refCount, setRefCount] = useState<number | null>(null);

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
      setPersonas(Array.isArray(pJson.items) ? pJson.items : []);
      // Seed language preference from owner config (default zh-CN).
      setLangPref(meJson.language_preference === 'en' ? 'en' : 'zh-CN');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  // Tell the shell when a 二级页 (资产/用量) is open so it drops the app header.
  useEffect(() => { onSubviewChange(assetsOpen || usageOpen); }, [assetsOpen, usageOpen, onSubviewChange]);

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
      .then((data) => { if (data) setDelivCount(Array.isArray(data.items) ? data.items.length : 0); })
      .catch(() => undefined);
    holonApiFetch('/api/v1/references', { cache: 'no-store' })
      .then((r) => r.ok ? r.json() as Promise<{ items?: unknown[] }> : Promise.resolve(null))
      .then((data) => { if (data) setRefCount(Array.isArray(data.items) ? data.items.length : 0); })
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
          <span className="mobile-collapse-summary">
            {personaName.length > 10 ? `${personaName.slice(0, 10)}…` : (personaName || '未设置')}
          </span>
          <span className="mobile-collapse-chevron">›</span>
        </button>
      </div>
      {/* 资产 — WeChat 钱包式入口行 → 资产页(技能 / 交付 / 文件夹设置 / 统计) */}
      <div className="mobile-me-section">
        <button type="button" className="mobile-collapse-head" onClick={() => setAssetsOpen(true)}>
          <span className="mobile-me-row-title">资产</span>
          <span className="mobile-collapse-summary">技能 · 引用 · 交付{delivCount !== null ? ` ${delivCount}` : ''}</span>
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
      <div className="mobile-me-section">
        <div className="mobile-me-value" style={{ fontSize: 12, color: '#aaa', textAlign: 'center', padding: '4px 0' }}>
          微作 Weizo 0.1.0
          {process.env.NEXT_PUBLIC_BUILD_SHA
            ? ` · ${process.env.NEXT_PUBLIC_BUILD_SHA}${process.env.NEXT_PUBLIC_BUILD_DATE ? ` · ${process.env.NEXT_PUBLIC_BUILD_DATE}` : ''}`
            : ''}
        </div>
      </div>
      <button type="button" className="mobile-feedback-button" onClick={() => setFeedbackOpen(true)}>
        <span>反馈 / 报错</span>
        <span>›</span>
      </button>
      <button type="button" className="mobile-disconnect-button" onClick={onDisconnect}>
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
                placeholder="或自己写：我是做柴油机出口的小公司老板，平时忙采购和客户跟进，痛点是邮件和报价太占时间…"
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
        桌面未连接 · {checking ? '自动重连中…' : '自动重连中（点此立即重试）'}
      </button>
      {/* Escape hatch: changed desk / new network / discovery failed → re-pair. */}
      <button type="button" className="mobile-connection-banner-repair" onClick={onRepair}>
        重新配对
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
}: {
  active: TabKey;
  badges: Record<BadgedTabKey, number>;
  onTab: (tab: TabKey) => void;
}) {
  const TABS: Array<{ key: TabKey; label: string; icon: ReactNode }> = [
    { key: 'chats', label: '聊天', icon: <IconNavChat /> },
    { key: 'contacts', label: '通讯录', icon: <IconNavContacts /> },
    { key: 'work', label: '看板', icon: <IconNavBoard /> },
    { key: 'me', label: '我', icon: <IconNavMe /> },
  ];

  return (
    <nav className="mobile-bottom-nav" aria-label="微作导航">
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

function tabTitle(tab: TabKey, selectedStaff: Staff | null): string {
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
        {state === 'scanning' && (
          <video
            ref={videoRef}
            playsInline
            muted
            style={{ width: '100%', display: 'block', borderRadius: 8 }}
          />
        )}
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
      writeDesktopConnection({ baseUrl: normalizedUrl, deviceToken: body.device_token });
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
  const [connection, setConnection] = useState<MobileDesktopConnection | null>(null);
  const discoveringRef = useRef(false); // guards LAN re-discovery (one sweep at a time)
  const [booted, setBooted] = useState(false);
  const [tab, setTab] = useState<TabKey>('chats');
  const [staff, setStaff] = useState<Staff[]>([]);
  const [agentUsage, setAgentUsage] = useState<Record<string, AgentUsage>>({});
  const [chatSeed, setChatSeed] = useState<string | null>(null);
  const [selectedStaff, setSelectedStaff] = useState<Staff | null>(null);
  const [staffInitialMode, setStaffInitialMode] = useState<'primary' | 'config'>('primary');
  const [staffError, setStaffError] = useState('');
  const [desktopOffline, setDesktopOffline] = useState(false);
  const [checkingConnection, setCheckingConnection] = useState(false);
  const [badges] = useState<Record<BadgedTabKey, number>>({ chats: 0, work: 0 });
  const [staffRefreshing, setStaffRefreshing] = useState(false);
  const [meSubview, setMeSubview] = useState(false); // me-tab 二级页(资产/用量)→ 隐藏顶栏

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
      setStaff(Array.isArray(j.items) ? j.items : []);
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

  // Initial staff load when connection is established.
  useEffect(() => {
    if (!connection) return;
    void fetchStaff();
  }, [connection, fetchStaff]);

  // Re-fetch staff when the contacts tab becomes active (visibility-gated).
  const prevTabRef = useRef<TabKey>('chats');
  useEffect(() => {
    if (tab === 'contacts' && prevTabRef.current !== 'contacts' && connection) {
      void fetchStaff();
    }
    prevTabRef.current = tab;
  }, [tab, connection, fetchStaff]);

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

  async function checkDesktop() {
    setCheckingConnection(true);
    try {
      const r = await holonApiFetch('/api/v1/ping', { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setDesktopOffline(false);
    } catch {
      setDesktopOffline(true);
      void tryRediscoverDesk(); // stored address failed → auto re-find on the LAN
    } finally {
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
    setDesktopOffline(false);
  }

  function openTab(next: TabKey) {
    setTab(next);
    setSelectedStaff(null);
    setStaffInitialMode('primary');
    setMeSubview(false); // returning to 我 root must show its header (no flash)
  }

  // Don't flash anything on SSR — wait until client boot
  if (!booted) return null;

  // M-L-FIX3: pair-first. First-run (no stored connection) renders the pairing
  // screen as the sole UI. Once PairingPrompt calls onPaired(), handlePaired()
  // reads the just-written connection from localStorage and sets it in state,
  // which transitions into the normal shell without a full-page reload.
  if (!connection) {
    return <PairingPrompt onPaired={handlePaired} />;
  }

  return (
    <main className="mobile-app-shell mobile-static-shell mobile-wechat-shell">
      <ConnectionBanner
        offline={desktopOffline}
        checking={checkingConnection}
        onRetry={() => void checkDesktop()}
        onRepair={disconnect}
      />
      {/* Header shows ONLY on a non-chat tab ROOT. WeChat-style: in the chat
          tab the recipient bar sits at the very top (no title above it); any
          drill-in (staff profile / 资产 / 用量) carries its own back-row, so the
          app header would just double-stack and waste vertical space. */}
      {tab !== 'chats' && !(tab === 'contacts' && selectedStaff) && !(tab === 'me' && meSubview) && (
        <AppHeader title={tabTitle(tab, selectedStaff)} />
      )}
      <section
        className={`mobile-tab-content${(tab === 'chats' || (tab === 'contacts' && selectedStaff)) ? ' mobile-tab-content-chat' : ''}`}
      >
        {/* Option 3 — 小秘专属: 聊天 tab is ONLY the Secretary, full window, no
            switcher. Employee chats live under 通讯录 (contact → 发消息). */}
        {tab === 'chats' && (
          <div className="mobile-chat-panel">
            <div className="mobile-chat-header">
              <span className="mobile-chat-header-title">
                {/* Single source of truth: the secretary's own staff name (renamable),
                    so the chat header always matches 通讯录. Fallback 小秘 pre-load. */}
                <span className="mobile-chat-header-name">{staff.find((s) => s.role_name === 'secretary')?.name || '小秘'}</span>
                <span className="mobile-chat-header-sub">微作 AI 助理</span>
              </span>
            </div>
            <OwnerTodoStrip />
            <MobileOwnerChat staff={staff} seed={chatSeed} onSeedConsumed={() => setChatSeed(null)} />
          </div>
        )}
        {tab === 'contacts' && (
          selectedStaff ? (
            <StaffDetail staff={selectedStaff} onBack={() => { setSelectedStaff(null); setStaffInitialMode('primary'); }} initialMode={staffInitialMode} />
          ) : (
            <Contacts
              staff={staff}
              agentUsage={agentUsage}
              onOpen={(s) => { setStaffInitialMode('primary'); setSelectedStaff(s); }}
              onOpenConfig={(s) => { setStaffInitialMode('config'); setSelectedStaff(s); }}
              onRefresh={() => void fetchStaff()}
              refreshing={staffRefreshing}
            />
          )
        )}
        {tab === 'work' && (
          <WorkTracker
            onTalkToSecretary={(text) => {
              setChatSeed(text);
              setTab('chats');
            }}
          />
        )}
        {tab === 'me' && (
          // connection is always non-null here: unpaired path returns PairingPrompt above
          <MeTab
            connection={connection!}
            onDisconnect={disconnect}
            onSubviewChange={setMeSubview}
            onUseSkill={(text) => {
              setChatSeed(text);
              setTab('chats');
            }}
          />
        )}
      </section>
      <BottomNav active={tab} badges={badges} onTab={openTab} />
    </main>
  );
}

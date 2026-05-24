'use client';

// Weizo 微作 — WeChat-style 4-tab mobile shell.
// Tabs: 微信 (chat-first, 小秘 + staff 1:1) | 通讯录 (staff list + profile) |
//        看板 (待办 LEAD → 进行中 → 交付) | 我 (owner identity + persona + disconnect).
// All API calls go through holonApiFetch (proxied to paired desktop).

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAui,
  useMessage,
  useLocalRuntime,
  type ChatModelAdapter,
} from '@assistant-ui/react';
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
import type { PersonaPreset } from '@holon/core';
import {
  clearDesktopConnection,
  holonApiFetch,
  installMobileApiFetchProxy,
  readDesktopConnection,
  type MobileDesktopConnection,
} from '../_lib/mobile-runtime';

// ─── Types ────────────────────────────────────────────────────────────────────

interface StreamEvent {
  type: 'text' | 'done' | 'error' | string;
  text?: string;
  finalText?: string;
  message?: string;
}

type TabKey = 'chats' | 'contacts' | 'work' | 'me';
type ActiveChat = { kind: 'owner' } | { kind: 'staff'; staff: Staff } | null;
type StaffChatMessage = { role: 'user' | 'assistant'; content: string };
type BadgedTabKey = 'chats' | 'work';

interface OwnerProfile {
  owner_name?: string;
  owner_role?: string;
  owner_intro?: string;
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

interface TtsResponse {
  base64?: string;
  mime?: string;
  error?: string;
  message?: string;
}

type RecordingState = 'idle' | 'recording' | 'transcribing';

const mobileTtsState = {
  activeId: null as string | null,
  audio: null as HTMLAudioElement | null,
  url: null as string | null,
  stop() {
    if (this.audio) {
      this.audio.pause();
      this.audio.currentTime = 0;
      this.audio.src = '';
      this.audio = null;
    }
    if (this.url) {
      URL.revokeObjectURL(this.url);
      this.url = null;
    }
    this.activeId = null;
  },
};

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

function base64ToBlob(base64: string, mime: string): Blob {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function splitTtsText(text: string): string[] {
  const chunks: string[] = [];
  let current = '';
  for (const char of text.replace(/\r\n/g, '\n')) {
    current += char;
    if ('。！？；.!?;\n'.includes(char)) {
      const chunk = current.trim();
      if (chunk) chunks.push(chunk);
      current = '';
    }
  }
  const tail = current.trim();
  if (tail) chunks.push(tail);
  return chunks.length > 0 ? chunks : [text.trim()].filter(Boolean);
}

function insertTranscriptIntoComposer(transcript: string): void {
  const ta = document.querySelector<HTMLTextAreaElement>('.mobile-chat-composer .chat-input');
  if (!ta) return;
  const next = ta.value ? `${ta.value} ${transcript}` : transcript;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
  setter?.call(ta, next);
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  ta.focus();
}

function MobileVoiceRecorderButton({ onTranscript }: { onTranscript?: (text: string) => void }) {
  const [state, setState] = useState<RecordingState>('idle');
  const [hint, setHint] = useState('');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const pointerIdRef = useRef<number | null>(null);
  const stopPendingRef = useRef(false);

  function showHint(message: string) {
    setHint(message);
    window.setTimeout(() => setHint((current) => (current === message ? '' : current)), 3500);
  }

  function cleanupStream() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  async function transcribe(blob: Blob, mime: string) {
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
      if (data.error === 'no_stt_provider') throw new Error('桌面端还没有配置语音识别。');
      throw new Error(data.message ?? data.error);
    }
    const text = typeof data.text === 'string' ? data.text.trim() : '';
    if (!text) {
      showHint('没有听清，请再试一次。');
      return;
    }
    if (onTranscript) onTranscript(text);
    else insertTranscriptIntoComposer(text);
  }

  function stopRecording() {
    const recorder = recorderRef.current;
    if (!recorder) {
      stopPendingRef.current = state === 'recording';
      return;
    }
    if (recorder.state !== 'inactive') recorder.stop();
  }

  async function startRecording(ev: PointerEvent<HTMLButtonElement>) {
    ev.preventDefault();
    if (state !== 'idle') return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      showHint('这个浏览器不支持录音。');
      return;
    }
    pointerIdRef.current = ev.pointerId;
    ev.currentTarget.setPointerCapture(ev.pointerId);
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
        void transcribe(new Blob(chunks, { type: mime }), mime)
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
        stopRecording();
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

  function releasePointer(ev: PointerEvent<HTMLButtonElement>) {
    ev.preventDefault();
    if (pointerIdRef.current === ev.pointerId) pointerIdRef.current = null;
    stopRecording();
  }

  return (
    <div className="mobile-voice-control">
      <button
        type="button"
        className={`mobile-voice-button${state === 'recording' ? ' is-recording' : ''}`}
        aria-label={state === 'recording' ? '松开转写' : '按住说话'}
        disabled={state === 'transcribing'}
        onPointerDown={(ev) => void startRecording(ev)}
        onPointerUp={releasePointer}
        onPointerCancel={releasePointer}
        onContextMenu={(ev) => ev.preventDefault()}
      >
        {state === 'transcribing' ? '…' : '🎙'}
      </button>
      {(state === 'recording' || state === 'transcribing' || hint) && (
        <span className="mobile-voice-hint" role="status">
          {state === 'recording' ? '正在录音，松开转写' : state === 'transcribing' ? '正在转写…' : hint}
        </span>
      )}
    </div>
  );
}

function MobileReadAloudButton({ id, text }: { id: string; text: string }) {
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hint, setHint] = useState('');

  useEffect(() => () => {
    if (mobileTtsState.activeId === id) mobileTtsState.stop();
  }, [id]);

  async function play() {
    const chunks = splitTtsText(text);
    if (chunks.length === 0) {
      setHint('没有可朗读的内容。');
      return;
    }
    mobileTtsState.stop();
    mobileTtsState.activeId = id;
    setLoading(true);
    setHint('');
    try {
      for (const chunk of chunks) {
        if (mobileTtsState.activeId !== id) return;
        const res = await holonApiFetch('/api/v1/connectors/tts/synthesize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: chunk, language: 'zh' }),
        });
        const data = await res.json().catch(() => ({})) as TtsResponse;
        if (!res.ok || !data.base64 || !data.mime) {
          if (data.error === 'no_tts_provider') throw new Error('桌面端还没有配置语音朗读。');
          throw new Error(data.message ?? data.error ?? `朗读失败 (${res.status})`);
        }
        const url = URL.createObjectURL(base64ToBlob(data.base64, data.mime));
        const audio = new Audio(url);
        mobileTtsState.audio = audio;
        mobileTtsState.url = url;
        setLoading(false);
        setPlaying(true);
        await audio.play();
        await new Promise<void>((resolve, reject) => {
          audio.onended = () => resolve();
          audio.onpause = () => resolve();
          audio.onerror = () => reject(new Error('播放失败。'));
        });
        URL.revokeObjectURL(url);
        if (mobileTtsState.url === url) mobileTtsState.url = null;
      }
    } catch (error) {
      setHint(error instanceof Error ? error.message : '朗读失败。');
    } finally {
      if (mobileTtsState.activeId === id) mobileTtsState.stop();
      setLoading(false);
      setPlaying(false);
    }
  }

  function toggle() {
    if (playing || loading) {
      mobileTtsState.stop();
      setPlaying(false);
      setLoading(false);
      return;
    }
    void play();
  }

  return (
    <span className="mobile-tts">
      <button
        type="button"
        className={`mobile-tts-button${playing ? ' is-playing' : ''}`}
        onClick={toggle}
        aria-label={playing || loading ? '停止朗读' : '朗读'}
        title={playing || loading ? '停止朗读' : '朗读'}
      >
        {loading ? '…' : playing ? '■' : '🔊'}
      </button>
      {hint && <span className="mobile-tts-hint" role="status">{hint}</span>}
    </span>
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
          body: JSON.stringify({ messages: payload }),
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
      <MessagePrimitive.Parts />
    </MessagePrimitive.Root>
  );
}

function AssistantMsg() {
  const message = useMessage();
  const text = flattenText(message.content);
  return (
    <MessagePrimitive.Root className="chatmsg chatmsg-assistant">
      <div className="chatmsg-content">
        <MessagePrimitive.Parts />
      </div>
      <MobileReadAloudButton id={message.id} text={text} />
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

  useEffect(() => {
    setMounted(true);
    void holonApiFetch('/api/v1/chat/warm').catch(() => undefined);
  }, []);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ComposerSeeder seed={seed} onSeedConsumed={onSeedConsumed} />
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
            <MobileVoiceRecorderButton />
            <ComposerPrimitive.Input rows={1} className="chat-input" placeholder="发消息给小秘…" autoFocus />
            <ComposerPrimitive.Send className="chat-send" aria-label="发送">↑</ComposerPrimitive.Send>
          </ComposerPrimitive.Root>
        ) : (
          <div className="chat-composer mobile-chat-composer" aria-hidden="true">
            <button type="button" className="mobile-voice-button" disabled tabIndex={-1}>🎙</button>
            <textarea rows={1} className="chat-input" placeholder="发消息给小秘…" readOnly tabIndex={-1} />
            <button type="button" className="chat-send" disabled tabIndex={-1}>↑</button>
          </div>
        )}
        {mounted && <MobileMentionTypeahead staff={staff} />}
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}

// ─── Staff 1:1 chat ───────────────────────────────────────────────────────────

function StaffChat({ staff }: { staff: Staff }) {
  const [messages, setMessages] = useState<StaffChatMessage[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  async function send() {
    const content = text.trim();
    if (!content || sending) return;
    const next = [...messages, { role: 'user' as const, content }];
    setMessages(next);
    setText('');
    setError('');
    setSending(true);
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
      <div className="mobile-chat-viewport mobile-staff-chat-scroll">
        {messages.length === 0 ? (
          <div className="chat-empty">
            <div className="chat-empty-title">{staff.name}</div>
            <div className="chat-empty-sub">{staff.role_label}</div>
          </div>
        ) : messages.map((m, i) => (
          <div key={i} className={`chatmsg ${m.role === 'user' ? 'chatmsg-user' : 'chatmsg-assistant'}`}>
            <div className="chatmsg-content">{m.content}</div>
            {m.role === 'assistant' && <MobileReadAloudButton id={`${staff.id}-${i}`} text={m.content} />}
          </div>
        ))}
        {sending && (
          <div className="chatmsg chatmsg-assistant">
            <div className="chatmsg-content">正在回复…</div>
          </div>
        )}
        {error && <div className="mobile-error">发送失败：{error}</div>}
      </div>
      <div className="chat-composer mobile-chat-composer">
        <MobileVoiceRecorderButton onTranscript={(transcript) => setText((current) => current ? `${current} ${transcript}` : transcript)} />
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
          placeholder={`发消息给 ${staff.name}…`}
          autoFocus
        />
        <button
          type="button"
          className="chat-send"
          onClick={() => void send()}
          disabled={sending || !text.trim()}
          aria-label="发送"
        >
          ↑
        </button>
      </div>
    </div>
  );
}

// ─── Recipient switcher (对话:小秘 ▾) ─────────────────────────────────────────

function MobileRecipientSwitcher({
  activeChat,
  staff,
  onPick,
}: {
  activeChat: ActiveChat;
  staff: readonly Staff[];
  onPick: (chat: Exclude<ActiveChat, null>) => void;
}) {
  const [open, setOpen] = useState(false);
  const currentLabel = activeChat?.kind === 'staff' ? activeChat.staff.name : '小秘';
  const currentRole = activeChat?.kind === 'staff' ? activeChat.staff.role_label : '老板直聊';

  function pick(chat: Exclude<ActiveChat, null>) {
    onPick(chat);
    setOpen(false);
  }

  return (
    <div className="mobile-recipient-switcher">
      <button
        type="button"
        className="mobile-recipient-button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className="mobile-recipient-avatar">
          {activeChat?.kind === 'staff' ? substrateIcon(activeChat.staff) : '秘'}
        </span>
        <span className="mobile-recipient-text">
          <span className="mobile-recipient-name">对话：{currentLabel}</span>
          <span className="mobile-recipient-role">{currentRole}</span>
        </span>
        <span className="mobile-recipient-caret">⌄</span>
      </button>
      {open && (
        <div className="mobile-recipient-menu" role="listbox" aria-label="选择聊天对象">
          <button
            type="button"
            role="option"
            aria-selected={!activeChat || activeChat.kind === 'owner'}
            className="mobile-recipient-option"
            onClick={() => pick({ kind: 'owner' })}
          >
            <span className="mobile-recipient-avatar mobile-recipient-avatar-owner">秘</span>
            <span className="mobile-recipient-text">
              <span className="mobile-recipient-name">小秘</span>
              <span className="mobile-recipient-role">老板直聊 · 可 @ 员工委派</span>
            </span>
          </button>
          {staff.map((s) => (
            <button
              key={s.id}
              type="button"
              role="option"
              aria-selected={activeChat?.kind === 'staff' && activeChat.staff.id === s.id}
              className="mobile-recipient-option"
              onClick={() => pick({ kind: 'staff', staff: s })}
            >
              <span className="mobile-recipient-avatar">{substrateIcon(s)}</span>
              <span className="mobile-recipient-text">
                <span className="mobile-recipient-name">{s.name}</span>
                <span className="mobile-recipient-role">{s.role_label}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── 微信 tab — chat panel ────────────────────────────────────────────────────

function MobileChatPanel({
  activeChat,
  staff,
  staffError,
  onPick,
  seed,
  onSeedConsumed,
}: {
  activeChat: ActiveChat;
  staff: readonly Staff[];
  staffError: string;
  onPick: (chat: Exclude<ActiveChat, null>) => void;
  seed: string | null;
  onSeedConsumed: () => void;
}) {
  const chat = activeChat ?? { kind: 'owner' as const };
  return (
    <div className="mobile-chat-panel">
      <MobileRecipientSwitcher activeChat={chat} staff={staff} onPick={onPick} />
      {staffError && (
        <div className="mobile-error mobile-chat-error">员工列表加载失败：{staffError}</div>
      )}
      {chat.kind === 'owner' ? (
        <MobileOwnerChat staff={staff} seed={seed} onSeedConsumed={onSeedConsumed} />
      ) : (
        <StaffChat key={chat.staff.id} staff={chat.staff} />
      )}
    </div>
  );
}

// ─── 通讯录 — contacts tab ────────────────────────────────────────────────────

function Contacts({
  staff,
  onOpen,
}: {
  staff: readonly Staff[];
  onOpen: (s: Staff) => void;
}) {
  return (
    <div className="mobile-list">
      {staff.length === 0 ? (
        <div className="mobile-empty-panel">还没有员工。</div>
      ) : staff.map((s) => (
        <button key={s.id} type="button" className="mobile-row" onClick={() => onOpen(s)}>
          <span className="mobile-avatar">{substrateIcon(s)}</span>
          <span className="mobile-row-main">
            <span className="mobile-row-title">{s.name}</span>
            <span className="mobile-row-sub">{s.role_label}</span>
          </span>
          <span className="mobile-row-action">配置</span>
        </button>
      ))}
    </div>
  );
}

function StaffProfile({
  staffId,
  fallback,
  onMessage,
}: {
  staffId: string;
  fallback?: Staff;
  onMessage: (staff: Staff) => void;
}) {
  const [staff, setStaff] = useState<Staff | null>(fallback ?? null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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

  return (
    <div className="mobile-staff-profile">
      {loading && !staff && <div className="mobile-empty-panel">加载中…</div>}
      {error && <div className="mobile-error">员工配置加载失败：{error}</div>}
      {staff && (
        <>
          <div className="mobile-staff-profile-hero">
            <span className="mobile-avatar mobile-staff-profile-avatar">{substrateIcon(staff)}</span>
            <span className="mobile-staff-profile-name">{staff.name}</span>
            <span className="mobile-staff-profile-role">{staff.role_label}</span>
          </div>
          <dl className="mobile-config-list">
            <div><dt>名称</dt><dd>{staff.name}</dd></div>
            <div><dt>角色标签</dt><dd>{staff.role_label}</dd></div>
            <div><dt>角色名</dt><dd>{staff.role_name}</dd></div>
            <div>
              <dt>系统指令</dt>
              <dd className="mobile-config-block">{staff.system_prompt?.trim() || '未设置'}</dd>
            </div>
            <div><dt>并发任务上限</dt><dd>{staff.max_concurrent_jobs}</dd></div>
          </dl>
          <button
            type="button"
            className="mobile-primary-action"
            onClick={() => onMessage(staff)}
          >
            发消息
          </button>
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

// ─── 看板 — work tracker (待办 LEAD) ───────────────────────────────────────

function TodoBacklog({ onTalkToSecretary }: { onTalkToSecretary: (text: string) => void }) {
  const [items, setItems] = useState<Todo[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');

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
        <h2>待办</h2>
        <span>老板待办</span>
      </div>
      <div className="weizo-todo-compose">
        <input
          className="weizo-todo-input"
          value={input}
          onChange={(ev) => setInput(ev.target.value)}
          onKeyDown={(ev) => {
            if (ev.key === 'Enter') { ev.preventDefault(); void addTodo(); }
          }}
          placeholder="新增待办任务…"
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
      {!loading && items.length === 0 && !error && (
        <div className="mobile-empty-panel">暂无待办任务。</div>
      )}
      <div className="mobile-job-list">
        {items.map((todo) => {
          const priority = todo.priority ?? 'medium';
          return (
            <div key={todo.id} className="mobile-job-row weizo-todo-row">
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
                className="mobile-job-title"
                style={{ color: PRIORITY_TEXT_COLOR[priority] }}
              >
                {todo.text}
              </span>
              <span className="mobile-job-sub weizo-todo-actions">
                {todo.due_date && (
                  <span
                    className="weizo-todo-due"
                    style={isOverdue(todo.due_date) ? { color: '#e0533a' } : undefined}
                    title={`截止 ${todo.due_date}${isOverdue(todo.due_date) ? '（已到期）' : ''}`}
                  >
                    📅 {shortDate(todo.due_date)}
                  </span>
                )}
                <label className="weizo-todo-action weizo-todo-datelabel" title="设日期">
                  设日期
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
                  >
                    清除
                  </button>
                )}
                <button
                  type="button"
                  className="weizo-todo-action"
                  onClick={() => onTalkToSecretary(todo.text)}
                  title="对话小秘"
                >
                  对话小秘
                </button>
                <button
                  type="button"
                  className="weizo-todo-action"
                  onClick={() => void updateTodo(todo.id, 'done')}
                  title="完成"
                >
                  完成
                </button>
                <button
                  type="button"
                  className="weizo-todo-action weizo-todo-del"
                  onClick={() => void deleteTodo(todo.id)}
                  title="删除"
                >
                  删除
                </button>
              </span>
            </div>
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

function ActiveJobs() {
  const [items, setItems] = useState<JobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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

  const JOB_LABEL: Record<JobRow['status'], string> = {
    queued: '排队中',
    running: '进行中',
    completed: '完成',
    failed: '失败',
  };

  return (
    <section className="mobile-work-section" aria-label="进行中">
      <div className="mobile-section-heading">
        <h2>进行中</h2>
        <span>Active jobs</span>
      </div>
      {loading && items.length === 0 && <div className="mobile-empty-panel">加载中…</div>}
      {error && <div className="mobile-error">任务加载失败：{error}</div>}
      {!loading && items.length === 0 && !error && (
        <div className="mobile-empty-panel">暂无进行中的任务。</div>
      )}
      <div className="mobile-job-list">
        {items.map((job) => (
          <div key={job.id} className="mobile-job-row">
            <span className={`mobile-job-status mobile-job-status-${job.status}`}>
              {JOB_LABEL[job.status]}
            </span>
            <span className="mobile-job-title">{job.brief ?? job.id}</span>
            <span className="mobile-job-sub">
              {(job.completed_at ?? job.created_at)?.slice(0, 16) ?? ''}
              {job.staff_id ? ` · ${job.staff_id}` : ''}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function DelivSection() {
  const [items, setItems] = useState<Deliverable[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<GetDeliverableResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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

  if (openId) {
    const d = detail?.deliverable;
    return (
      <div className="mobile-deliverables">
        <button type="button" className="mobile-back-row" onClick={() => setOpenId(null)}>‹ 交付</button>
        {loading && !d && <div className="mobile-empty-panel">加载中…</div>}
        {error && <div className="mobile-error">加载失败：{error}</div>}
        {d && (
          <article className="mobile-deliverable-detail">
            <div className="mobile-detail-kicker">{STATUS_LABEL[d.status]} · {d.created_at?.slice(0, 10) ?? ''}</div>
            <h2>{d.title}</h2>
            <pre className="mobile-deliverable-body">{bodyText(d.body)}</pre>
          </article>
        )}
      </div>
    );
  }

  return (
    <section className="mobile-work-section weizo-deliverables-section" aria-label="交付">
      <div className="mobile-section-heading">
        <h2>交付</h2>
        <span style={{ fontSize: '11px', color: '#999' }}>DE-EMPHASIZED</span>
      </div>
      {loading && items.length === 0 && <div className="mobile-empty-panel">加载中…</div>}
      {error && <div className="mobile-error">加载失败：{error}</div>}
      {!loading && items.length === 0 && !error && (
        <div className="mobile-empty-panel">还没有交付。</div>
      )}
      <div className="mobile-job-list">
        {items.map((d) => (
          <button
            key={d.id}
            type="button"
            className="mobile-deliverable-row"
            onClick={() => setOpenId(d.id)}
          >
            <span className="mobile-deliverable-status">{STATUS_LABEL[d.status]}</span>
            <span className="mobile-deliverable-title">{d.title}</span>
            <span className="mobile-deliverable-sub">{excerpt(bodyText(d.body))}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function WorkTracker({ onTalkToSecretary }: { onTalkToSecretary: (text: string) => void }) {
  const [board, setBoard] = useState<'todo' | 'doing' | 'done'>('todo');

  const BOARD_TABS: Array<{ key: 'todo' | 'doing' | 'done'; label: string }> = [
    { key: 'todo', label: '待办' },
    { key: 'doing', label: '进行中' },
    { key: 'done', label: '交付' },
  ];

  return (
    <div className="mobile-work">
      <div className="weizo-board-tabs">
        {BOARD_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`weizo-board-tab${board === t.key ? ' is-active' : ''}`}
            onClick={() => setBoard(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {board === 'todo' && <TodoBacklog onTalkToSecretary={onTalkToSecretary} />}
      {board === 'doing' && <ActiveJobs />}
      {board === 'done' && <DelivSection />}
    </div>
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

function MeTab({
  connection,
  onDisconnect,
}: {
  connection: MobileDesktopConnection;
  onDisconnect: () => void;
}) {
  const [owner, setOwner] = useState<OwnerProfile | null>(null);
  const [snapshot, setSnapshot] = useState<OwnerSnapshot | null>(null);
  const [personas, setPersonas] = useState<PersonaPreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [personaSheetOpen, setPersonaSheetOpen] = useState(false);
  const [personaApplied, setPersonaApplied] = useState('');
  const [error, setError] = useState('');
  const [feedbackOpen, setFeedbackOpen] = useState(false);

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
        meRes.json() as Promise<OwnerProfile>,
        snapRes.json() as Promise<OwnerSnapshot>,
        pRes.ok ? (pRes.json() as Promise<{ items?: PersonaPreset[] }>) : Promise.resolve({ items: [] }),
      ]);
      setOwner(meJson);
      setSnapshot(snapJson);
      setPersonas(Array.isArray(pJson.items) ? pJson.items : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

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

  const ownerName = owner?.owner_name?.trim() || snapshot?.owner?.name?.trim() || 'Owner';
  const ownerRole = owner?.owner_role?.trim() || snapshot?.owner?.role?.trim() || '未设置人设';
  const ownerIntro = owner?.owner_intro?.trim() || snapshot?.owner?.intro?.trim() || '';
  const activePersona = personas.find((p) => p.owner_role === ownerRole || p.name === ownerRole);
  const personaName = activePersona ? `${activePersona.icon} ${activePersona.name}` : ownerRole;
  const personaSummary = activePersona?.tagline || activePersona?.industry || ownerIntro || ownerRole;

  return (
    <div className="mobile-me">
      <div className="mobile-me-profile">
        <span className="mobile-avatar mobile-avatar-owner">{ownerName.slice(0, 1).toUpperCase()}</span>
        <span className="mobile-row-main">
          <span className="mobile-row-title">{ownerName}</span>
          <span className="mobile-row-sub">桌面已连接</span>
        </span>
      </div>
      {error && <div className="mobile-error">读取失败：{error}</div>}
      <div className="mobile-me-section">
        <div className="mobile-me-label">已连接桌面</div>
        <div className="mobile-me-value">{connection.baseUrl}</div>
      </div>
      <div className="mobile-me-section">
        <div className="mobile-me-label">我的人设</div>
        <div className="mobile-persona-current-card">
          <span className="mobile-persona-current-copy">
            <span className="mobile-me-value">{personaName}</span>
            <span className="mobile-me-note">{excerpt(personaSummary, 64)}</span>
          </span>
          <button
            type="button"
            className="mobile-persona-change"
            onClick={() => setPersonaSheetOpen(true)}
          >
            更换
          </button>
        </div>
        {personaApplied && <div className="mobile-me-note">{personaApplied}</div>}
        {loading && <div className="mobile-me-note">加载人设…</div>}
      </div>
      <div className="mobile-me-section">
        <div className="mobile-me-label">应用版本</div>
        <div className="mobile-me-value">微作 Weizo 0.1.0</div>
      </div>
      <button type="button" className="mobile-feedback-button" onClick={() => setFeedbackOpen(true)}>
        <span>反馈 / 报错</span>
        <span>›</span>
      </button>
      <button type="button" className="mobile-disconnect-button" onClick={onDisconnect}>
        断开连接
      </button>

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
            <div className="mobile-persona-list">
              {personas.map((persona) => {
                const active = activePersona?.id === persona.id || persona.owner_role === ownerRole;
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

function ConnectionBanner({
  offline,
  checking,
  onRetry,
}: {
  offline: boolean;
  checking: boolean;
  onRetry: () => void;
}) {
  if (!offline) return null;
  return (
    <button
      type="button"
      className="mobile-connection-banner"
      onClick={onRetry}
      disabled={checking}
    >
      桌面未连接 · {checking ? '重试中' : '重试'}
    </button>
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

function BottomNav({
  active,
  badges,
  onTab,
}: {
  active: TabKey;
  badges: Record<BadgedTabKey, number>;
  onTab: (tab: TabKey) => void;
}) {
  const TABS: Array<{ key: TabKey; label: string; icon: string }> = [
    { key: 'chats', label: '聊天', icon: '💬' },
    { key: 'contacts', label: '通讯录', icon: '👥' },
    { key: 'work', label: '看板', icon: '📋' },
    { key: 'me', label: '我', icon: '⚙️' },
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
    default: return '聊天';
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
            <div style={{
              width: 200, height: 200,
              border: '2px solid rgba(255,255,255,0.7)',
              borderRadius: 12,
              boxShadow: '0 0 0 4000px rgba(0,0,0,0.45)',
            }} />
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

// ─── Pairing screen (inline — avoids the old multi-route redirect) ────────────

function PairingPrompt({ onPaired }: { onPaired: () => void }) {
  const [baseUrl, setBaseUrl] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [scanning, setScanning] = useState(false);

  async function claimWithUrl(claimUrl: string): Promise<void> {
    setBusy(true);
    setErr('');
    try {
      // Parse the claim URL: extract baseUrl (origin) and code query param.
      let parsed: URL;
      try {
        parsed = new URL(claimUrl);
      } catch {
        throw new Error('二维码内容无法解析为有效 URL。');
      }
      const scannedCode = parsed.searchParams.get('code');
      if (!scannedCode) throw new Error('二维码中未找到配对码。');
      const scannedBase = parsed.origin;

      const { normalizeBaseUrl, writeDesktopConnection } = await import('../_lib/mobile-runtime');
      const normalizedUrl = normalizeBaseUrl(scannedBase);
      const r = await fetch(`${normalizedUrl}/api/v1/pair/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: scannedCode }),
      });
      const body = await r.json().catch(() => ({})) as {
        ok?: boolean; device_token?: string; device_id?: string; error?: string;
      };
      if (!r.ok || !body.ok || !body.device_token) {
        throw new Error(body.error ?? `HTTP ${r.status}`);
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

  async function submit() {
    const url = baseUrl.trim();
    const pairingCode = code.trim();
    if (!url || !pairingCode) { setErr('请填写桌面端地址和配对码'); return; }
    setBusy(true);
    setErr('');
    try {
      const { normalizeBaseUrl, writeDesktopConnection } = await import('../_lib/mobile-runtime');
      const normalizedUrl = normalizeBaseUrl(url);
      const r = await fetch(`${normalizedUrl}/api/v1/pair/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: pairingCode }),
      });
      const body = await r.json().catch(() => ({})) as {
        ok?: boolean; device_token?: string; device_id?: string; error?: string;
      };
      if (!r.ok || !body.ok || !body.device_token) {
        throw new Error(body.error ?? `HTTP ${r.status}`);
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

  function handleQrResult(text: string) {
    setScanning(false);
    // Only proceed if it looks like a pair/claim URL.
    if (text.includes('/api/v1/pair/claim')) {
      void claimWithUrl(text);
    } else {
      setErr('扫描结果不是配对二维码，请使用桌面端 /me 页面显示的二维码。');
    }
  }

  if (scanning) {
    return (
      <QrScanner
        onResult={handleQrResult}
        onClose={() => setScanning(false)}
      />
    );
  }

  return (
    <div className="mobile-pairing-shell">
      <div className="mobile-pairing-panel">
        <div className="mobile-pairing-kicker">微作 · Weizo</div>
        <h1 className="mobile-pairing-title">连接桌面</h1>

        {/* QR scan button */}
        <button
          type="button"
          className="mobile-pairing-submit"
          style={{ marginBottom: 12, background: 'var(--accent, #1a73e8)' }}
          onClick={() => { setErr(''); setScanning(true); }}
          disabled={busy}
        >
          📷 扫码配对
        </button>

        <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--ink-mute)', margin: '4px 0 12px' }}>
          — 或手动输入 —
        </div>

        <div className="mobile-pairing-field">
          <label htmlFor="weizo-pair-url">桌面端地址</label>
          <input
            id="weizo-pair-url"
            type="url"
            value={baseUrl}
            onChange={(ev) => setBaseUrl(ev.target.value)}
            placeholder="http://192.168.x.x:3000"
            autoComplete="url"
          />
        </div>
        <div className="mobile-pairing-field">
          <label htmlFor="weizo-pair-code">配对码</label>
          <input
            id="weizo-pair-code"
            type="text"
            value={code}
            onChange={(ev) => setCode(ev.target.value)}
            onKeyDown={(ev) => { if (ev.key === 'Enter') { ev.preventDefault(); void submit(); } }}
            placeholder="在桌面端 /me 页面获取"
            autoComplete="one-time-code"
          />
        </div>
        {err && <div className="mobile-pairing-error">{err}</div>}
        <button
          type="button"
          className="mobile-pairing-submit"
          onClick={() => void submit()}
          disabled={busy || !baseUrl.trim() || !code.trim()}
        >
          {busy ? '连接中…' : '连接桌面'}
        </button>
      </div>
    </div>
  );
}

// ─── Root 4-tab shell ─────────────────────────────────────────────────────────

const CONNECTION_POLL_MS = 12000;

export function WeizoApp() {
  const [connection, setConnection] = useState<MobileDesktopConnection | null>(null);
  const [booted, setBooted] = useState(false);
  const [tab, setTab] = useState<TabKey>('chats');
  const [staff, setStaff] = useState<Staff[]>([]);
  const [activeChat, setActiveChat] = useState<ActiveChat>({ kind: 'owner' });
  const [chatSeed, setChatSeed] = useState<string | null>(null);
  const [selectedStaff, setSelectedStaff] = useState<Staff | null>(null);
  const [staffError, setStaffError] = useState('');
  const [desktopOffline, setDesktopOffline] = useState(false);
  const [checkingConnection, setCheckingConnection] = useState(false);
  const [badges] = useState<Record<BadgedTabKey, number>>({ chats: 0, work: 0 });

  useEffect(() => {
    const conn = readDesktopConnection();
    if (conn) {
      installMobileApiFetchProxy();
      setConnection(conn);
    }
    setBooted(true);
  }, []);

  useEffect(() => {
    if (!connection) return;
    let cancelled = false;
    holonApiFetch('/api/v1/staff', { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json() as ListStaffResponse;
        if (!cancelled) setStaff(Array.isArray(j.items) ? j.items : []);
      })
      .catch((err) => {
        if (!cancelled) {
          setStaffError(err instanceof Error ? err.message : String(err));
          setDesktopOffline(true);
        }
      });
    return () => { cancelled = true; };
  }, [connection]);

  useEffect(() => {
    if (!connection) return;
    void checkDesktop();
    const id = window.setInterval(() => void checkDesktop(), CONNECTION_POLL_MS);
    return () => window.clearInterval(id);
  }, [connection]);

  async function checkDesktop() {
    setCheckingConnection(true);
    try {
      const r = await holonApiFetch('/api/v1/ping', { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setDesktopOffline(false);
    } catch {
      setDesktopOffline(true);
    } finally {
      setCheckingConnection(false);
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
    setActiveChat({ kind: 'owner' });
    setSelectedStaff(null);
    setDesktopOffline(false);
  }

  function openTab(next: TabKey) {
    setTab(next);
    setSelectedStaff(null);
  }

  // Don't flash pairing screen on SSR — wait until client boot
  if (!booted) return null;
  if (!connection) return <PairingPrompt onPaired={handlePaired} />;

  return (
    <main className="mobile-app-shell mobile-static-shell mobile-wechat-shell">
      <ConnectionBanner
        offline={desktopOffline}
        checking={checkingConnection}
        onRetry={() => void checkDesktop()}
      />
      <AppHeader
        title={tabTitle(tab, selectedStaff)}
        left={
          selectedStaff ? (
            <button
              type="button"
              className="mobile-back-button"
              onClick={() => setSelectedStaff(null)}
            >
              ‹ 通讯录
            </button>
          ) : undefined
        }
      />
      <section
        className={`mobile-tab-content${tab === 'chats' ? ' mobile-tab-content-chat' : ''}`}
      >
        {tab === 'chats' && (
          <MobileChatPanel
            activeChat={activeChat}
            staff={staff}
            staffError={staffError}
            onPick={setActiveChat}
            seed={chatSeed}
            onSeedConsumed={() => setChatSeed(null)}
          />
        )}
        {tab === 'contacts' && (
          selectedStaff ? (
            <StaffProfile
              staffId={selectedStaff.id}
              fallback={selectedStaff}
              onMessage={(s) => {
                setSelectedStaff(null);
                setTab('chats');
                setActiveChat({ kind: 'staff', staff: s });
              }}
            />
          ) : (
            <Contacts staff={staff} onOpen={setSelectedStaff} />
          )
        )}
        {tab === 'work' && (
          <WorkTracker
            onTalkToSecretary={(text) => {
              setChatSeed(text);
              setTab('chats');
              setActiveChat({ kind: 'owner' });
            }}
          />
        )}
        {tab === 'me' && (
          <MeTab connection={connection} onDisconnect={disconnect} />
        )}
      </section>
      <BottomNav active={tab} badges={badges} onTab={openTab} />
    </main>
  );
}

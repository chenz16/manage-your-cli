'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  ThreadPrimitive,
  MessagePrimitive,
  ComposerPrimitive,
  useAui,
  useAuiState,
  useMessage,
} from '@assistant-ui/react';
import type { MessageState } from '@assistant-ui/react';
import { ChatEmptyState } from './ChatEmptyState';
import { useT } from '../../lib/i18n/useT';
import { useOwner } from '../../lib/hooks/useOwner';

/* Empty-state coaching panel lives in ChatEmptyState.tsx — the old
 * inline EMPTY_SUGGESTIONS list was replaced 2026-05-19 with an
 * owner-intro-aware version (greeting + keyword chips + @-mention
 * hint + Gmail-inheritance pro-tip) for first-time SMB owners
 * landing here post-onboarding. */

/* The owner-agent runtime + AssistantRuntimeProvider live in
 * ChatRuntimeProvider at the root layout level so navigating between
 * routes does NOT unmount the runtime (which would wipe the thread).
 * This component just consumes the context and renders the chat UI. */

/* ── Custom message renderers — brand-tinted ──────────────────────────── */

function UserMessage() {
  return (
    <MessagePrimitive.Root className="chatmsg chatmsg-user">
      <MessagePrimitive.Parts />
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="chatmsg chatmsg-assistant">
      <div className="chatmsg-content">
        <MessagePrimitive.Parts />
      </div>
      <AssistantReadAloudButton />
    </MessagePrimitive.Root>
  );
}

type TtsButtonState = 'idle' | 'loading' | 'playing';
type TtsRate = 0.75 | 1 | 1.25 | 1.5;

interface TtsSynthesizeResponse {
  base64?: string;
  mime?: string;
  error?: string;
  message?: string;
}

interface PlayTtsOptions {
  id: string;
  text: string;
  language: 'zh' | 'en';
  errorFallback?: TtsErrorFallback;
  playbackBlockedMessage?: string;
  playbackErrorMessage?: string;
  onStarted?: (audio: HTMLAudioElement) => void;
  onEnded?: () => void;
  onError?: (message: string) => void;
}

interface TtsChunk {
  url: string;
}

interface TtsErrorFallback {
  noProvider: string;
  upstream: string;
  rateLimited: string;
  generic: string;
}

const TTS_RATE_STORAGE_KEY = 'holon-tts-rate';
const TTS_RATES: readonly TtsRate[] = [0.75, 1, 1.25, 1.5];

const ttsPlaybackState = {
  activeMessageId: null as string | null,
  activeAudio: null as HTMLAudioElement | null,
  activeUrl: null as string | null,
  activeControllers: new Set<AbortController>(),
  listeners: new Set<() => void>(),
  rate: 1 as TtsRate,
  rateListeners: new Set<() => void>(),
  emit() { for (const l of this.listeners) l(); },
  emitRate() { for (const l of this.rateListeners) l(); },
  subscribe(l: () => void) { this.listeners.add(l); return () => { this.listeners.delete(l); }; },
  subscribeRate(l: () => void) { this.rateListeners.add(l); return () => { this.rateListeners.delete(l); }; },
  getSnapshot() { return this.activeMessageId; },
  getRateSnapshot() { return this.rate; },
  setRate(rate: TtsRate) {
    this.rate = rate;
    if (this.activeAudio) this.activeAudio.playbackRate = rate;
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(TTS_RATE_STORAGE_KEY, String(rate));
      } catch (error: unknown) {
        console.warn('[chat-tts] failed to persist playback rate:', error);
      }
    }
    this.emitRate();
  },
  hydrateRate() {
    if (typeof window === 'undefined') return;
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(TTS_RATE_STORAGE_KEY);
    } catch (error: unknown) {
      console.warn('[chat-tts] failed to load playback rate:', error);
    }
    const parsed = Number(raw);
    if (TTS_RATES.includes(parsed as TtsRate)) this.rate = parsed as TtsRate;
  },
  addController(controller: AbortController) {
    this.activeControllers.add(controller);
  },
  removeController(controller: AbortController) {
    this.activeControllers.delete(controller);
  },
  stop() {
    for (const controller of this.activeControllers) controller.abort();
    this.activeControllers.clear();
    if (this.activeAudio) {
      this.activeAudio.pause();
      this.activeAudio.currentTime = 0;
      this.activeAudio.src = '';
      this.activeAudio = null;
    }
    if (this.activeUrl) {
      URL.revokeObjectURL(this.activeUrl);
      this.activeUrl = null;
    }
    if (this.activeMessageId !== null) {
      this.activeMessageId = null;
      this.emit();
    }
  },
  startQueue(messageId: string) {
    this.stop();
    this.activeMessageId = messageId;
    this.emit();
  },
  playChunk(messageId: string, audio: HTMLAudioElement, url: string) {
    if (this.activeAudio) {
      this.activeAudio.pause();
      this.activeAudio.src = '';
    }
    if (this.activeUrl) URL.revokeObjectURL(this.activeUrl);
    this.activeMessageId = messageId;
    this.activeAudio = audio;
    this.activeUrl = url;
    audio.playbackRate = this.rate;
    this.emit();
  },
  releaseChunk(url: string) {
    if (this.activeUrl === url) this.activeUrl = null;
    URL.revokeObjectURL(url);
  },
};

if (typeof window !== 'undefined') ttsPlaybackState.hydrateRate();

function useActiveTtsMessageId(): string | null {
  return useSyncExternalStore(
    (cb) => ttsPlaybackState.subscribe(cb),
    () => ttsPlaybackState.getSnapshot(),
    () => null,
  );
}

function useTtsRate(): TtsRate {
  return useSyncExternalStore(
    (cb) => ttsPlaybackState.subscribeRate(cb),
    () => ttsPlaybackState.getRateSnapshot(),
    () => 1,
  );
}

function TtsRateControl({ label }: { label: string }) {
  const rate = useTtsRate();
  // Compact single chip — tap to cycle through the rates (subtle, saves space).
  function cycle() {
    const idx = TTS_RATES.indexOf(rate);
    ttsPlaybackState.setRate(TTS_RATES[(idx + 1) % TTS_RATES.length] ?? 1);
  }
  return (
    <button
      type="button"
      className="tts-rate-chip"
      onClick={cycle}
      title={`${label} (${rate}×)`}
      aria-label={`${label}: ${rate}×`}
    >
      {rate}×
    </button>
  );
}

function assistantMessageText(content: readonly { type: string; text?: unknown }[]): string {
  return content
    .map((part) => (part.type === 'text' && typeof part.text === 'string' ? part.text : ''))
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

function base64ToBlob(base64: string, mime: string): Blob {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function splitTtsSentences(text: string): string[] {
  const chunks: string[] = [];
  let current = '';
  for (const char of text.replace(/\r\n/g, '\n')) {
    current += char;
    if ('。！？；.!?;\n—'.includes(char)) {
      const chunk = current.trim();
      if (chunk) chunks.push(chunk);
      current = '';
    }
  }
  const tail = current.trim();
  if (tail) chunks.push(tail);
  return chunks.length > 0 ? chunks : [text.trim()].filter(Boolean);
}

function defaultTtsErrorFallback(): TtsErrorFallback {
  return {
    noProvider: 'Text-to-speech is not configured.',
    upstream: 'Text-to-speech engine failed. Try again.',
    rateLimited: 'Too many read-aloud requests. Try again shortly.',
    generic: 'Could not read this message aloud.',
  };
}

function ttsErrorMessage(data: TtsSynthesizeResponse, statusCode: number, fallback: TtsErrorFallback): string {
  if (data.error === 'no_tts_provider') return fallback.noProvider;
  if (data.error === 'upstream_error') return fallback.upstream;
  if (statusCode === 429) return fallback.rateLimited;
  return data.message ?? data.error ?? fallback.generic;
}

async function synthesizeAndPlayTts(options: PlayTtsOptions): Promise<HTMLAudioElement | null> {
  await playChunkedTts(options);
  return ttsPlaybackState.activeAudio;
}

async function synthesizeTtsChunk(
  text: string,
  language: 'zh' | 'en',
  signal: AbortSignal,
  fallback: TtsErrorFallback,
): Promise<TtsChunk> {
  const res = await fetch('/api/v1/connectors/tts/synthesize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, language }),
    signal,
  });
  const data = (await res.json().catch((jsonErr: unknown) => {
    console.warn('[chat-tts] failed to parse synthesize response:', jsonErr);
    return { message: 'Could not parse text-to-speech response.' };
  })) as TtsSynthesizeResponse;

  if (!res.ok || !data.base64 || !data.mime) {
    throw new Error(ttsErrorMessage(data, res.status, fallback));
  }

  const url = URL.createObjectURL(base64ToBlob(data.base64, data.mime));
  return { url };
}

function waitForAudioEnd(audio: HTMLAudioElement): Promise<void> {
  return new Promise((resolve, reject) => {
    audio.onended = () => resolve();
    audio.onpause = () => resolve();
    audio.onerror = () => reject(new Error('Could not play generated audio.'));
  });
}

function isTtsCancel(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

async function synthesizeChunkForQueue(text: string, language: 'zh' | 'en', fallback: TtsErrorFallback): Promise<TtsChunk> {
  const controller = new AbortController();
  ttsPlaybackState.addController(controller);
  return synthesizeTtsChunk(text, language, controller.signal, fallback).finally(() => {
    ttsPlaybackState.removeController(controller);
  });
}

function prefetchTtsChunk(text: string, language: 'zh' | 'en', fallback: TtsErrorFallback): Promise<TtsChunk> {
  const promise = synthesizeChunkForQueue(text, language, fallback);
  void promise.catch((error: unknown) => {
    if (!isTtsCancel(error)) console.warn('[chat-tts] prefetched chunk failed:', error);
  });
  return promise;
}

async function playChunkedTts(options: PlayTtsOptions): Promise<void> {
  const chunks = splitTtsSentences(options.text);
  if (chunks.length === 0) {
    options.onEnded?.();
    return;
  }

  ttsPlaybackState.startQueue(options.id);
  const fallback = options.errorFallback ?? defaultTtsErrorFallback();
  let nextChunk: Promise<TtsChunk> | null = prefetchTtsChunk(chunks[0] ?? '', options.language, fallback);

  for (let i = 0; i < chunks.length; i++) {
    if (ttsPlaybackState.activeMessageId !== options.id || !nextChunk) return;
    let chunk: TtsChunk;
    try {
      chunk = await nextChunk;
    } catch (error: unknown) {
      if (isTtsCancel(error)) return;
      options.onError?.(error instanceof Error ? error.message : 'Could not read this message aloud.');
      if (ttsPlaybackState.activeMessageId === options.id) ttsPlaybackState.stop();
      return;
    }
    if (ttsPlaybackState.activeMessageId !== options.id) {
      URL.revokeObjectURL(chunk.url);
      return;
    }

    const followingText = chunks[i + 1];
    nextChunk = followingText ? prefetchTtsChunk(followingText, options.language, fallback) : null;
    const audio = new Audio(chunk.url);
    ttsPlaybackState.playChunk(options.id, audio, chunk.url);
    try {
      await audio.play();
      options.onStarted?.(audio);
      await waitForAudioEnd(audio);
    } catch (error: unknown) {
      if (ttsPlaybackState.activeMessageId !== options.id || isTtsCancel(error)) return;
      const message = error instanceof Error && error.name === 'NotAllowedError'
        ? options.playbackBlockedMessage ?? error.message
        : options.playbackErrorMessage ?? 'Could not play generated audio.';
      options.onError?.(message);
      ttsPlaybackState.stop();
      return;
    } finally {
      audio.onended = null;
      audio.onpause = null;
      audio.onerror = null;
      if (ttsPlaybackState.activeMessageId === options.id) {
        ttsPlaybackState.activeAudio = null;
        ttsPlaybackState.releaseChunk(chunk.url);
      }
    }
  }

  if (ttsPlaybackState.activeMessageId === options.id) ttsPlaybackState.stop();
  options.onEnded?.();
}

function AssistantReadAloudButton() {
  const { t, lang } = useT();
  const message = useMessage();
  const activeMessageId = useActiveTtsMessageId();
  const [state, setState] = useState<TtsButtonState>('idle');
  const [status, setStatus] = useState('');
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestSeqRef = useRef(0);
  const isPlayingThisMessage = activeMessageId === message.id;
  const visualState: TtsButtonState = isPlayingThisMessage ? 'playing' : state === 'loading' ? 'loading' : 'idle';

  useEffect(() => {
    if (!isPlayingThisMessage && state !== 'idle') setState('idle');
  }, [isPlayingThisMessage, state]);

  useEffect(() => {
    return () => {
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
      if (ttsPlaybackState.activeMessageId === message.id) ttsPlaybackState.stop();
    };
  }, [message.id]);

  function showStatus(msg: string) {
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    setStatus(msg);
    statusTimerRef.current = setTimeout(() => {
      setStatus('');
      statusTimerRef.current = null;
    }, 4000);
  }

  function localizedTtsFallback(): TtsErrorFallback {
    return {
      noProvider: t('chat.tts_error_no_provider', 'Text-to-speech is not configured.'),
      upstream: t('chat.tts_error_upstream', 'Text-to-speech engine failed. Try again.'),
      rateLimited: t('chat.tts_error_rate_limited', 'Too many read-aloud requests. Try again shortly.'),
      generic: t('chat.tts_error_generic', 'Could not read this message aloud.'),
    };
  }

  async function synthesizeAndPlay(text: string, seq: number) {
    await playChunkedTts({
      id: message.id,
      text,
      language: lang === 'zh-CN' ? 'zh' : 'en',
      errorFallback: localizedTtsFallback(),
      playbackBlockedMessage: t('chat.tts_error_play_blocked', 'Browser blocked audio playback. Click again to retry.'),
      playbackErrorMessage: t('chat.tts_error_playback', 'Could not play generated audio.'),
      onStarted: () => {
        if (requestSeqRef.current === seq) setState('playing');
      },
      onEnded: () => {
        if (requestSeqRef.current === seq) setState('idle');
      },
      onError: (msg) => {
        if (requestSeqRef.current !== seq) return;
        setState('idle');
        showStatus(msg);
      },
    });
  }

  function handleClick() {
    if (visualState === 'playing') {
      ttsPlaybackState.stop();
      setState('idle');
      return;
    }
    if (visualState === 'loading') return;

    const text = assistantMessageText(message.content);
    if (!text) {
      showStatus(t('chat.tts_error_empty', 'Nothing to read aloud yet.'));
      return;
    }

    requestSeqRef.current += 1;
    const seq = requestSeqRef.current;
    ttsPlaybackState.stop();
    setStatus('');
    setState('loading');
    void synthesizeAndPlay(text, seq).catch((err: unknown) => {
      if (requestSeqRef.current !== seq) return;
      console.warn('[chat-tts] synthesize/play failed:', err);
      setState('idle');
      showStatus(err instanceof Error && err.name === 'NotAllowedError'
        ? t('chat.tts_error_play_blocked', 'Browser blocked audio playback. Click again to retry.')
        : t('chat.tts_error_generic', 'Could not read this message aloud.'));
    });
  }

  return (
    <div className="chat-tts">
      <button
        type="button"
        className={`chat-tts-button chat-tts-button-${visualState}`}
        aria-label={visualState === 'playing'
          ? t('chat.tts_stop', 'Stop read aloud')
          : t('chat.tts_read', 'Read aloud')}
        title={visualState === 'playing'
          ? t('chat.tts_stop', 'Stop read aloud')
          : t('chat.tts_read', 'Read aloud')}
        disabled={visualState === 'loading'}
        onClick={handleClick}
      >
        {visualState === 'loading' ? '…' : visualState === 'playing' ? '■' : '🔊'}
      </button>
      {/* Speed chip only while THIS message is playing — keep it out of the way
       * on idle messages (owner: "速度要隐秘、别占地方"). */}
      {visualState === 'playing' && <TtsRateControl label={t('chat.tts_rate_label', 'Playback speed')} />}
      {status && <span className="chat-tts-status" role="status">{status}</span>}
    </div>
  );
}

/* Thread tabs removed per user feedback ("通过@ 来找人") — participants
 * are summoned via @-mention in the composer. The MentionTypeahead
 * component below provides the dropdown UI; runtime-side routing of
 * @-mentioned messages to specific staff is still owner-adapter work. */

/* ── Thread root — assistant-ui primitives ──────────────────────────────
 *
 * Hydration fix 2026-05-17 (D12): assistant-ui's ComposerPrimitive.Input
 * renders different aria / data attributes server-side vs client-side
 * (the runtime context isn't available during SSR, so some accessibility
 * attributes flip on mount). The console mismatch warning showed up at
 * every page load. We gate the ComposerPrimitive subtree behind a mounted
 * flag so the server emits a minimal placeholder and the client renders
 * the real composer after hydration. `autoFocus` is also moved behind the
 * mount flag — it was the second trigger because focus state diverges on
 * first paint.
 *
 * Status: MITIGATED, not root-fixed. Root cause is upstream in
 * @assistant-ui/react. Both packages are pinned to exact installed
 * versions (0.14.5 / 0.3.7) in package.json so a future `pnpm install`
 * cannot pull a new minor that changes SSR hydration behavior. Remove
 * the pin once an upstream fix is confirmed. See D12 in docs/dev-queue.md.
 *
 * Upstream issue to file (manual owner follow-up — D12):
 *   Repo: https://github.com/Yonom/assistant-ui
 *   Title: ComposerPrimitive.Input emits different aria / data attrs on
 *   SSR vs CSR, causing React hydration mismatch warnings every page load
 *   Warning text: "Warning: Prop `aria-[x]` did not match. Server: ... Client: ..."
 *   Package: @assistant-ui/react@0.14.5  Next.js 15 / React 19 / App Router */

function ThreadView() {
  const { t } = useT();
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // Stop any read-aloud the moment the user starts typing in the composer —
  // nobody wants the AI still reading the previous reply while they type a new
  // one. (Voice-mode barge-in handles the speaking case separately.)
  useEffect(() => {
    function onComposerInput(ev: Event) {
      const target = ev.target as HTMLElement | null;
      if (target?.classList?.contains('chat-input') && ttsPlaybackState.activeMessageId !== null) {
        ttsPlaybackState.stop();
      }
    }
    document.addEventListener('input', onComposerInput, true);
    return () => document.removeEventListener('input', onComposerInput, true);
  }, []);

  return (
    <ThreadPrimitive.Root className="chat-thread">
      <ThreadPrimitive.Viewport className="chat-viewport">
        <ThreadPrimitive.Empty>
          {mounted ? (
            <ChatEmptyState />
          ) : (
            /* SSR placeholder mirrors the panel footprint so hydration
             * doesn't reflow. Real coaching renders client-side once
             * the runtime + /api/v1/me are available. */
            <div className="chat-empty"><div className="chat-empty-title">Holon</div></div>
          )}
        </ThreadPrimitive.Empty>
        <ThreadPrimitive.Messages
          components={{
            UserMessage,
            AssistantMessage,
          }}
        />
      </ThreadPrimitive.Viewport>

      {mounted ? (
        <ComposerPrimitive.Root className="chat-composer">
          <ComposerPrimitive.Input
            autoFocus
            rows={1}
            placeholder={t('chat.composer_placeholder', 'Message your desk AI…')}
            className="chat-input"
          />
          <ComposerMicButton />
          <VoiceModeControl />
          {/* Owner directive 2026-05-19 19:48 (2)+(3): swap the stock
           *  ComposerPrimitive.Send for our own button that knows about
           *  the in-memory queue. When idle = Send (↑). When running =
           *  Stop (■). When user submits while running = push to queue
           *  (rendered as muted "Queued · …" pills under the input by
           *  QueuedBubbles). assistant-ui's stock Send is disabled while
           *  isRunning (see useComposerSend in @assistant-ui/core), so
           *  we have to provide our own path to enable mid-reply input. */}
          <SendOrStopButton />
        </ComposerPrimitive.Root>
      ) : (
        /* SSR placeholder — same layout footprint as the real composer
         * so the page doesn't reflow on hydration. Disabled / inert. */
        <div className="chat-composer" aria-hidden="true">
          <textarea
            className="chat-input"
            rows={1}
            placeholder="Message your desk AI…"
            readOnly
            tabIndex={-1}
          />
          <button type="button" className="chat-send" tabIndex={-1} disabled>↑</button>
        </div>
      )}
      {mounted && <QueuedBubbles />}
      {mounted && <QueueDispatcher />}
      <VoiceListening />
      {mounted && <MentionTypeahead />}
    </ThreadPrimitive.Root>
  );
}

/* ── Cancel + queue (owner directive 2026-05-19 19:48) ────────────────
 *
 * V1.0 in-memory queue + Stop affordance. See TECH-DEBT TD-013 for the
 * lost-on-refresh caveat (acceptable for V1.0; SQLite persist in V1.1).
 *
 * Mental model:
 *   - When the runtime is idle (`thread.isRunning === false`), the queue
 *     is always empty (drained by QueueDispatcher on each turn-end).
 *   - When the runtime is running, the user can keep typing + submit; we
 *     intercept the submit (Enter or Send button) and push the text into
 *     the queue instead of calling the runtime. Queued items render below
 *     the composer as dim italic pills with a "Queued · …" label.
 *   - When the turn ends, QueueDispatcher pops the head and calls
 *     `aui.thread().append({role:'user', content:[{type:'text', text}]})`,
 *     which kicks off the next turn. This loops until the queue is empty.
 *   - Cancel mid-reply: Stop button calls `aui.thread().cancelRun()`,
 *     which aborts the in-flight adapter call (see owner-adapter.ts —
 *     yields the cancelled-footer on AbortError). Queue is PRESERVED on
 *     cancel — next item still dispatches. Matches owner spec.
 *
 * Why a module-scoped store (not a React context):
 *   - The composer textarea is owned by assistant-ui's ComposerPrimitive;
 *     reading its value from outside the primitive needs a DOM query.
 *   - The dispatcher fires from a thread.isRunning subscription that may
 *     outlive intermediate component mounts (we want queue continuity).
 *   - The reset path (clearStoredMessages → mountKey++) should also
 *     clear the queue; we expose `clearQueue()` for that hook.
 */

interface QueuedItem { id: string; text: string }
const queueState = {
  items: [] as QueuedItem[],
  listeners: new Set<() => void>(),
  emit() { for (const l of this.listeners) l(); },
  subscribe(l: () => void) { this.listeners.add(l); return () => { this.listeners.delete(l); }; },
  getSnapshot() { return this.items; },
  push(text: string) { this.items = [...this.items, { id: `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, text }]; this.emit(); },
  pop(): QueuedItem | null { if (this.items.length === 0) return null; const [head, ...rest] = this.items; this.items = rest; this.emit(); return head ?? null; },
  /* Index-based remove for per-item ✕ button. pop() is head-only (FIFO
   * dispatch); removeAt is for user-driven cancellation of any pending
   * pill. Owner directive 2026-05-19 20:14 ("能不能还能cancel?"). */
  removeAt(index: number) {
    if (index < 0 || index >= this.items.length) return;
    this.items = this.items.filter((_, i) => i !== index);
    this.emit();
  },
  clear() { if (this.items.length === 0) return; this.items = []; this.emit(); },
};

function useQueue(): ReadonlyArray<QueuedItem> {
  return useSyncExternalStore(
    (cb) => queueState.subscribe(cb),
    () => queueState.getSnapshot(),
    () => [],
  );
}

/* Read the current composer text via the AUI store rather than DOM
 * querySelector — the store is the source of truth for ComposerPrimitive
 * and survives the textarea being detached during re-renders. */
function readComposerText(aui: ReturnType<typeof useAui>): string {
  try {
    const s = aui.thread().composer().getState();
    return typeof s.text === 'string' ? s.text : '';
  } catch {
    return '';
  }
}
function clearComposerText(aui: ReturnType<typeof useAui>): void {
  try { aui.thread().composer().setText(''); } catch { /* no-op */ }
}

type ComposerMicButtonState = 'idle' | 'recording' | 'transcribing' | 'done';

const COMPOSER_MIC_TOGGLE_EVENT = 'holon:composer-mic-toggle';

const composerMicButtonState = {
  state: 'idle' as ComposerMicButtonState,
  listeners: new Set<() => void>(),
  doneTimer: null as ReturnType<typeof setTimeout> | null,
  emit() { for (const l of this.listeners) l(); },
  subscribe(l: () => void) { this.listeners.add(l); return () => { this.listeners.delete(l); }; },
  getSnapshot() { return this.state; },
  set(next: ComposerMicButtonState) {
    if (this.doneTimer && next !== 'done') {
      clearTimeout(this.doneTimer);
      this.doneTimer = null;
    }
    if (this.state === next) return;
    this.state = next;
    this.emit();
  },
  markDone() {
    this.set('done');
    if (this.doneTimer) clearTimeout(this.doneTimer);
    this.doneTimer = setTimeout(() => {
      this.doneTimer = null;
      this.set('idle');
    }, 900);
  },
};

function useComposerMicButtonState(): ComposerMicButtonState {
  return useSyncExternalStore(
    (cb) => composerMicButtonState.subscribe(cb),
    () => composerMicButtonState.getSnapshot(),
    () => 'idle',
  );
}

function ComposerMicButton() {
  const { t } = useT();
  const state = useComposerMicButtonState();
  const label = state === 'recording'
    ? t('chat.mic_stop_dictation', 'Stop dictation')
    : state === 'transcribing'
      ? t('chat.mic_transcribing', 'Transcribing speech')
      : t('chat.mic_dictate', 'Dictate');

  return (
    <button
      type="button"
      className={`chat-trigger-button chat-mic-button chat-mic-button--${state}`}
      aria-label={label}
      title={label}
      aria-pressed={state === 'recording'}
      disabled={state === 'transcribing'}
      onClick={() => window.dispatchEvent(new Event(COMPOSER_MIC_TOGGLE_EVENT))}
    >
      <svg className="chat-trigger-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3.75a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0v-5a3 3 0 0 0-3-3Z" />
        <path d="M6.25 11.25a5.75 5.75 0 0 0 11.5 0" />
        <path d="M12 17v3.25" />
        <path d="M8.75 20.25h6.5" />
      </svg>
    </button>
  );
}

function SendOrStopButton() {
  const aui = useAui();
  const { t } = useT();
  const isRunning = useAuiState((s) => s.thread.isRunning);
  const composerText = useAuiState((s) => s.composer.text ?? '');
  const hasText = composerText.trim().length > 0;

  /* Handle "submit while running" → push to queue. The composer's Enter
   * key handler fires assistant-ui's send() which is no-op when running
   * (canSend === false). So we install a capture-phase Enter handler on
   * the .chat-input textarea that pre-empts assistant-ui when running.
   * This is the same pattern MentionTypeahead uses to intercept Enter. */
  useEffect(() => {
    const ta = document.querySelector<HTMLTextAreaElement>('.chat-input');
    if (!ta) return;
    function onKeyDown(ev: KeyboardEvent) {
      if (ev.key !== 'Enter' || ev.shiftKey) return;
      if (!isRunning) return;                  // idle → let assistant-ui handle Enter
      const text = readComposerText(aui).trim();
      if (!text) return;                       // empty → do nothing
      ev.preventDefault();
      ev.stopPropagation();
      queueState.push(text);
      clearComposerText(aui);
    }
    // capture phase so we beat assistant-ui's keydown listener
    ta.addEventListener('keydown', onKeyDown, true);
    return () => { ta.removeEventListener('keydown', onKeyDown, true); };
  }, [aui, isRunning]);

  /* Esc keybinding (owner directive 2026-05-19 20:14Z
   * "排队输入的能不能还能cancel？就是Esc就cancel么?"):
   *   - streaming → cancel current generation (same path as Stop button);
   *     queue is preserved per existing semantics.
   *   - not streaming + queue non-empty → clear the queue.
   *   - otherwise → noop, pass through so Esc can still close modals /
   *     dialogs the user has open.
   *
   * Attached to `document` because Esc should work even when the composer
   * isn't focused (e.g. user clicked into a queued pill or somewhere else
   * on the surface). We skip Esc inside other <input>/<textarea> elements
   * that have selected text so we don't fight native text-editing Esc
   * (rare on the chat surface, but defensive).
   *
   * NOTE: capture: false so MentionTypeahead's own Esc handler (which
   * stopPropagation's when its dropdown is open) gets first crack —
   * dropdown-close takes priority over queue-clear. */
  useEffect(() => {
    function onKeyDown(ev: KeyboardEvent) {
      if (ev.key !== 'Escape') return;
      const target = ev.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') {
          // Allow Esc to clear an active selection inside an unrelated
          // text field without our handler stealing it. The composer
          // itself has no native Esc binding, so this is mostly other
          // fields (e.g. mention typeahead while open).
          const isText = (target as HTMLInputElement | HTMLTextAreaElement);
          if (isText.selectionStart !== isText.selectionEnd) return;
        }
      }
      if (isRunning) {
        ev.preventDefault();
        ev.stopPropagation();
        try { aui.thread().cancelRun(); } catch { /* race: turn already done */ }
        return;
      }
      if (queueState.items.length > 0) {
        ev.preventDefault();
        ev.stopPropagation();
        queueState.clear();
        return;
      }
      // noop: let Esc bubble up to whatever modal/dialog handler is listening.
    }
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); };
  }, [aui, isRunning]);

  if (isRunning) {
    return (
      <button
        type="button"
        className="chat-send chat-stop"
        aria-label={t('chat.stop_button', 'Stop')}
        title={t('chat.stop_button', 'Stop')}
        onClick={() => {
          // If user has typed something while streaming, treat the click
          // as queue-and-stop (push then cancel). Matches the Enter
          // intercept semantics: clicking the action button while text
          // is in the box is always a "submit" gesture from the user's
          // POV, and they shouldn't lose typed content to a Stop click.
          const text = readComposerText(aui).trim();
          if (text) {
            queueState.push(text);
            clearComposerText(aui);
          }
          try { aui.thread().cancelRun(); } catch { /* race: turn already done */ }
        }}
      >
        ■
      </button>
    );
  }

  return (
    <button
      type="button"
      className="chat-send"
      aria-label="Send"
      disabled={!hasText}
      onClick={() => {
        // Use the store's send action — same path as ComposerPrimitive.Send.
        try { aui.thread().composer().send(); } catch { /* no-op */ }
      }}
    >
      ↑
    </button>
  );
}

/* Render queued user messages as dim italic pills below the input.
 * Collapses to "+N more queued" pill once ≥3 items pending so we don't
 * stack a wall of bubbles when the user rapidly types ahead. */
function QueuedBubbles() {
  const items = useQueue();
  const { t, tFmt } = useT();
  if (items.length === 0) return null;
  const VISIBLE = 2;
  const visible = items.slice(0, VISIBLE);
  const moreCount = Math.max(0, items.length - VISIBLE);
  return (
    <div className="chat-queue" aria-live="polite" aria-label={t('chat.queued_label', 'Queued · sending after reply')}>
      {visible.map((q, i) => (
        <div key={q.id} className="chat-queue-item">
          <span className="chat-queue-label">{t('chat.queued_label', 'Queued · sending after reply')}</span>
          <span className="chat-queue-text">{q.text}</span>
          {/* Per-item ✕ remove (owner directive 2026-05-19 20:14). Hover-
            * revealed so the queue strip stays visually clean at rest. */}
          <button
            type="button"
            className="chat-queue-remove"
            aria-label={t('chat.remove_queued_item', 'Remove from queue')}
            title={t('chat.remove_queued_item', 'Remove from queue')}
            onClick={() => queueState.removeAt(i)}
          >
            ✕
          </button>
        </div>
      ))}
      {moreCount > 0 && (
        <div className="chat-queue-item chat-queue-more">
          {tFmt('chat.more_queued', { n: moreCount }, '+{n} more queued')}
        </div>
      )}
      {/* "Clear all" footer link only when queue has 2+ items — single-item
        * removal is covered by the per-item ✕. */}
      {items.length >= 2 && (
        <button
          type="button"
          className="chat-queue-clear-all"
          onClick={() => queueState.clear()}
        >
          {t('chat.clear_all_queued', 'Clear all queued')}
        </button>
      )}
    </div>
  );
}

/* Watches `thread.isRunning`; on every running:true → running:false
 * transition, pops the head queue item and appends it as the next user
 * message (which kicks off the next turn). Uses a ref so back-to-back
 * runs (drain N items) work without losing edges. */
function QueueDispatcher() {
  const aui = useAui();
  const isRunning = useAuiState((s) => s.thread.isRunning);
  const wasRunningRef = useRef(false);

  useEffect(() => {
    if (wasRunningRef.current && !isRunning) {
      const next = queueState.pop();
      if (next) {
        try {
          aui.thread().append({
            role: 'user',
            content: [{ type: 'text', text: next.text }],
          });
        } catch (err) {
          // Append failed (rare: runtime unmounted mid-drain). Re-enqueue
          // at head so the next mount can pick it up. Console-log so the
          // failure is visible — Engineering Rule #4 (no silent failure).
          console.error('[chat-queue] dispatch failed, re-queueing:', err);
          queueState.items = [next, ...queueState.items];
          queueState.emit();
        }
      }
    }
    wasRunningRef.current = isRunning;
  }, [aui, isRunning]);

  // Also clear the queue on the chat-reset event (matches
  // ChatRuntimeProvider's `holon:reset` flow that wipes stored messages).
  useEffect(() => {
    function onReset() { queueState.clear(); }
    window.addEventListener('holon:reset', onReset);
    return () => window.removeEventListener('holon:reset', onReset);
  }, []);

  return null;
}

type HandsFreePhase = 'idle' | 'listening' | 'transcribing' | 'thinking' | 'speaking';

interface VoiceRecordingSession {
  stream: MediaStream;
  recorder: MediaRecorder;
  audioContext: AudioContext;
  analyser: AnalyserNode;
  raf: number;
  chunks: Blob[];
  startedAt: number;
  heardSpeech: boolean;
  speechStartedAt: number | null;
  silenceStartedAt: number | null;
  mimeType: string;
}

interface BargeInSession {
  stream: MediaStream;
  audioContext: AudioContext;
  analyser: AnalyserNode;
  raf: number;
}

function latestAssistantMessage(messages: readonly MessageState[], startIndex: number): MessageState | null {
  for (let i = messages.length - 1; i >= Math.max(0, startIndex); i--) {
    const msg = messages[i];
    if (msg?.role === 'assistant' && assistantMessageText(msg.content).length > 0) return msg;
  }
  return null;
}

function rmsFromAnalyser(analyser: AnalyserNode, data: Uint8Array): number {
  analyser.getByteTimeDomainData(data);
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    const centered = ((data[i] ?? 128) - 128) / 128;
    sum += centered * centered;
  }
  return Math.sqrt(sum / data.length);
}

function VoiceModeControl() {
  const aui = useAui();
  const { t, lang } = useT();
  const [enabled, setEnabled] = useState(false);
  const [phase, setPhase] = useState<HandsFreePhase>('idle');
  const [banner, setBanner] = useState('');
  const isRunning = useAuiState((s) => s.thread.isRunning);
  const messages = useAuiState((s) => s.thread.messages);
  const enabledRef = useRef(false);
  const phaseRef = useRef<HandsFreePhase>('idle');
  const recordingRef = useRef<VoiceRecordingSession | null>(null);
  const bargeInRef = useRef<BargeInSession | null>(null);
  const loopSeqRef = useRef(0);
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const waitingFromIndexRef = useRef<number | null>(null);
  const spokenAssistantIdRef = useRef<string | null>(null);
  const lastAppendedTextRef = useRef('');
  const language = lang === 'zh-CN' ? 'zh' : 'en';

  useEffect(() => { enabledRef.current = enabled; }, [enabled]);
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  function setLoopPhase(next: HandsFreePhase) {
    phaseRef.current = next;
    setPhase(next);
  }

  function showBanner(msg: string) {
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    setBanner(msg);
    statusTimerRef.current = setTimeout(() => {
      setBanner('');
      statusTimerRef.current = null;
    }, 4200);
  }

  function cleanupRecording() {
    const session = recordingRef.current;
    if (!session) return;
    cancelAnimationFrame(session.raf);
    if (session.recorder.state !== 'inactive') {
      session.recorder.onstop = null;
      session.recorder.stop();
    }
    session.stream.getTracks().forEach((track) => track.stop());
    void session.audioContext.close().catch((error: unknown) => {
      console.warn('[voice-mode] audio context close failed:', error);
    });
    recordingRef.current = null;
  }

  function cleanupBargeIn() {
    const session = bargeInRef.current;
    if (!session) return;
    cancelAnimationFrame(session.raf);
    session.stream.getTracks().forEach((track) => track.stop());
    void session.audioContext.close().catch((error: unknown) => {
      console.warn('[voice-mode] barge-in audio context close failed:', error);
    });
    bargeInRef.current = null;
  }

  function stopAllAudio() {
    ttsPlaybackState.stop();
    cleanupBargeIn();
  }

  function exitVoiceMode() {
    loopSeqRef.current += 1;
    enabledRef.current = false;
    setEnabled(false);
    setLoopPhase('idle');
    waitingFromIndexRef.current = null;
    cleanupRecording();
    stopAllAudio();
  }

  async function transcribeBlob(blob: Blob, mime: string): Promise<string> {
    const base64 = await blobToBase64(blob);
    const res = await fetch('/api/v1/connectors/voice/transcribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ base64, mime, language }),
    });
    const data = (await res.json().catch((error: unknown) => {
      console.warn('[voice-mode] failed to parse STT response:', error);
      return { message: t('voice.err_bad_response', 'Could not parse speech response.') };
    })) as LocalTranscribeResponse;
    if (!res.ok || data.error) {
      const msg = data.message ?? data.error ?? `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return typeof data.text === 'string' ? data.text.trim() : '';
  }

  function scheduleListen(seq: number, delay = 250) {
    window.setTimeout(() => {
      if (!enabledRef.current || loopSeqRef.current !== seq || phaseRef.current !== 'listening') return;
      void startListening(seq);
    }, delay);
  }

  async function handleRecordedBlob(blob: Blob, mime: string, seq: number) {
    if (!enabledRef.current || loopSeqRef.current !== seq) return;
    setLoopPhase('transcribing');
    let text = '';
    try {
      text = await transcribeBlob(blob, mime);
    } catch (error: unknown) {
      console.warn('[voice-mode] transcription failed:', error);
      showBanner(t('voice_mode.err_transcribe', 'Could not transcribe that. Listening again.'));
    }
    if (!enabledRef.current || loopSeqRef.current !== seq) return;
    if (!text) {
      showBanner(t('voice.no_speech', "Didn't catch that — try again"));
      setLoopPhase('listening');
      scheduleListen(seq, 500);
      return;
    }

    lastAppendedTextRef.current = text;
    waitingFromIndexRef.current = messages.length;
    setLoopPhase('thinking');
    try {
      aui.thread().append({
        role: 'user',
        content: [{ type: 'text', text }],
      });
    } catch (error: unknown) {
      console.error('[voice-mode] append failed:', error);
      showBanner(t('voice_mode.err_send', 'Could not send that. Listening again.'));
      setLoopPhase('listening');
      scheduleListen(seq, 500);
    }
  }

  function stopRecordingForTranscription() {
    const session = recordingRef.current;
    if (!session || session.recorder.state === 'inactive') return;
    session.recorder.stop();
  }

  async function startListening(seq: number) {
    if (!enabledRef.current || loopSeqRef.current !== seq || recordingRef.current) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      showBanner(t('voice.err_audio_capture', 'No microphone found'));
      exitVoiceMode();
      return;
    }

    let stream: MediaStream;
    let audioContext: AudioContext;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioContext = new AudioContext();
    } catch (error: unknown) {
      console.warn('[voice-mode] mic start failed:', error);
      showBanner(t('voice.err_not_allowed', 'Microphone blocked — allow mic permission in the browser'));
      exitVoiceMode();
      return;
    }

    if (!enabledRef.current || loopSeqRef.current !== seq) {
      stream.getTracks().forEach((track) => track.stop());
      void audioContext.close();
      return;
    }

    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    const mimeType = recorderMimeType();
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    const session: VoiceRecordingSession = {
      stream,
      recorder,
      audioContext,
      analyser,
      raf: 0,
      chunks: [],
      startedAt: performance.now(),
      heardSpeech: false,
      speechStartedAt: null,
      silenceStartedAt: null,
      mimeType: recorder.mimeType || mimeType || 'audio/webm',
    };
    const samples = new Uint8Array(analyser.fftSize);
    const speechThreshold = 0.018;
    const silenceMs = 1200;
    const maxNoSpeechMs = 10000;
    const maxUtteranceMs = 45000;

    recorder.ondataavailable = (ev) => {
      if (ev.data.size > 0) session.chunks.push(ev.data);
    };
    recorder.onerror = (ev) => {
      const recorderError = (ev as unknown as { error?: DOMException }).error;
      console.warn('[voice-mode] recorder error:', recorderError);
      showBanner(t('voice.err_audio_capture', 'No microphone found'));
      cleanupRecording();
      if (enabledRef.current && loopSeqRef.current === seq) {
        setLoopPhase('listening');
        scheduleListen(seq, 700);
      }
    };
    recorder.onstop = () => {
      cancelAnimationFrame(session.raf);
      stream.getTracks().forEach((track) => track.stop());
      void audioContext.close().catch((error: unknown) => {
        console.warn('[voice-mode] audio context close failed:', error);
      });
      recordingRef.current = null;
      const chunks = session.chunks;
      if (chunks.length === 0 || !session.heardSpeech) {
        showBanner(t('voice.no_speech', "Didn't catch that — try again"));
        if (enabledRef.current && loopSeqRef.current === seq) {
          setLoopPhase('listening');
          scheduleListen(seq, 500);
        }
        return;
      }
      void handleRecordedBlob(new Blob(chunks, { type: session.mimeType }), session.mimeType, seq);
    };

    function tick() {
      if (!enabledRef.current || loopSeqRef.current !== seq || recordingRef.current !== session) return;
      const now = performance.now();
      const rms = rmsFromAnalyser(analyser, samples);
      if (rms >= speechThreshold) {
        session.heardSpeech = true;
        session.speechStartedAt ??= now;
        session.silenceStartedAt = null;
      } else if (session.heardSpeech) {
        session.silenceStartedAt ??= now;
        if (now - session.silenceStartedAt >= silenceMs) {
          stopRecordingForTranscription();
          return;
        }
      } else if (now - session.startedAt >= maxNoSpeechMs) {
        stopRecordingForTranscription();
        return;
      }
      if (now - session.startedAt >= maxUtteranceMs) {
        stopRecordingForTranscription();
        return;
      }
      session.raf = requestAnimationFrame(tick);
    }

    recordingRef.current = session;
    setLoopPhase('listening');
    recorder.start();
    session.raf = requestAnimationFrame(tick);
  }

  async function startBargeInMonitor(seq: number) {
    cleanupBargeIn();
    if (!navigator.mediaDevices?.getUserMedia) return;
    let stream: MediaStream;
    let audioContext: AudioContext;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioContext = new AudioContext();
    } catch (error: unknown) {
      console.warn('[voice-mode] barge-in mic monitor unavailable:', error);
      return;
    }
    if (!enabledRef.current || loopSeqRef.current !== seq || phaseRef.current !== 'speaking') {
      stream.getTracks().forEach((track) => track.stop());
      void audioContext.close();
      return;
    }
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    let loudSince: number | null = null;
    const threshold = 0.025;
    const bargeMs = 180;
    const session: BargeInSession = { stream, audioContext, analyser, raf: 0 };

    function tick() {
      if (!enabledRef.current || loopSeqRef.current !== seq || phaseRef.current !== 'speaking' || bargeInRef.current !== session) return;
      const now = performance.now();
      const rms = rmsFromAnalyser(analyser, samples);
      if (rms >= threshold) {
        loudSince ??= now;
        if (now - loudSince >= bargeMs) {
          ttsPlaybackState.stop();
          cleanupBargeIn();
          setLoopPhase('listening');
          void startListening(seq);
          return;
        }
      } else {
        loudSince = null;
      }
      session.raf = requestAnimationFrame(tick);
    }

    bargeInRef.current = session;
    session.raf = requestAnimationFrame(tick);
  }

  async function speakAssistant(msg: MessageState, seq: number) {
    const text = assistantMessageText(msg.content);
    if (!text) {
      setLoopPhase('listening');
      scheduleListen(seq, 250);
      return;
    }
    spokenAssistantIdRef.current = msg.id;
    setLoopPhase('speaking');
    await synthesizeAndPlayTts({
      id: `voice-mode-${msg.id}`,
      text,
      language,
      errorFallback: {
        noProvider: t('chat.tts_error_no_provider', 'Text-to-speech is not configured.'),
        upstream: t('chat.tts_error_upstream', 'Text-to-speech engine failed. Try again.'),
        rateLimited: t('chat.tts_error_rate_limited', 'Too many read-aloud requests. Try again shortly.'),
        generic: t('voice_mode.err_tts', 'Could not read the reply aloud. Listening again.'),
      },
      playbackBlockedMessage: t('chat.tts_error_play_blocked', 'Browser blocked audio playback. Click again to retry.'),
      playbackErrorMessage: t('voice_mode.err_tts', 'Could not read the reply aloud. Listening again.'),
      onStarted: () => {
        if (enabledRef.current && loopSeqRef.current === seq && phaseRef.current === 'speaking') {
          void startBargeInMonitor(seq);
        }
      },
      onEnded: () => {
        cleanupBargeIn();
        if (!enabledRef.current || loopSeqRef.current !== seq || phaseRef.current !== 'speaking') return;
        setLoopPhase('listening');
        scheduleListen(seq, 250);
      },
      onError: (message) => {
        cleanupBargeIn();
        console.warn('[voice-mode] TTS failed:', message);
        showBanner(t('voice_mode.err_tts', 'Could not read the reply aloud. Listening again.'));
        if (!enabledRef.current || loopSeqRef.current !== seq) return;
        setLoopPhase('listening');
        scheduleListen(seq, 700);
      },
    }).catch((error: unknown) => {
      cleanupBargeIn();
      console.warn('[voice-mode] TTS playback failed:', error);
      showBanner(error instanceof Error && error.name === 'NotAllowedError'
        ? t('chat.tts_error_play_blocked', 'Browser blocked audio playback. Click again to retry.')
        : t('voice_mode.err_tts', 'Could not read the reply aloud. Listening again.'));
      if (!enabledRef.current || loopSeqRef.current !== seq) return;
      setLoopPhase('listening');
      scheduleListen(seq, 700);
    });
  }

  function enterVoiceMode() {
    const seq = loopSeqRef.current + 1;
    loopSeqRef.current = seq;
    enabledRef.current = true;
    setEnabled(true);
    setBanner('');
    stopAllAudio();
    setLoopPhase('listening');
    void startListening(seq);
  }

  useEffect(() => {
    return () => {
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
      cleanupRecording();
      cleanupBargeIn();
      if (ttsPlaybackState.activeMessageId?.startsWith('voice-mode-')) ttsPlaybackState.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!enabled || phase !== 'thinking' || isRunning) return;
    const startIndex = waitingFromIndexRef.current;
    if (startIndex === null) return;
    const assistant = latestAssistantMessage(messages, startIndex);
    if (!assistant || assistant.id === spokenAssistantIdRef.current) return;
    waitingFromIndexRef.current = null;
    void speakAssistant(assistant, loopSeqRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, phase, isRunning, messages]);

  const stateLabel = phase === 'listening'
    ? t('voice_mode.state_listening', 'Listen')
    : phase === 'transcribing'
      ? t('voice_mode.state_transcribing', 'Text')
      : phase === 'thinking'
        ? t('voice_mode.state_thinking', 'Think')
        : phase === 'speaking'
          ? t('voice_mode.state_speaking', 'Read')
          : t('voice_mode.state_idle', 'Voice mode');

  return (
    <>
      <button
        type="button"
        className={`chat-trigger-button voice-mode-button${enabled ? ' voice-mode-button--active' : ''}`}
        aria-pressed={enabled}
        aria-label={enabled ? t('voice_mode.exit', 'Exit voice mode') : t('voice_mode.enter', 'Voice mode')}
        title={enabled ? t('voice_mode.exit', 'Exit voice mode') : t('voice_mode.enter', 'Voice mode')}
        onClick={() => { if (enabledRef.current) exitVoiceMode(); else enterVoiceMode(); }}
      >
        <svg className="voice-mode-button-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6.5 13v-2" />
          <path d="M10.2 16V8" />
          <path d="M13.8 18V6" />
          <path d="M17.5 14v-4" />
        </svg>
      </button>
      {enabled && (
        <div
          className={`voice-mode-overlay voice-mode-overlay--${phase}`}
          role="status"
          aria-live="polite"
          aria-label={banner ? `${stateLabel}: ${banner}` : stateLabel}
        >
          <div className="voice-mode-indicator" aria-hidden="true" />
          <div className="voice-mode-title">{stateLabel}</div>
          <TtsRateControl label={t('chat.tts_rate_label', 'Playback speed')} />
          <button
            type="button"
            className="voice-mode-close"
            aria-label={t('voice_mode.exit', 'Exit voice mode')}
            title={t('voice_mode.exit', 'Exit voice mode')}
            onClick={exitVoiceMode}
          >
            ✕
          </button>
        </div>
      )}
    </>
  );
}

/* ── @-mention typeahead ─────────────────────────────────────────────
 *
 * When the user types `@<query>` in the composer, show a dropdown of
 * team members filtered by `<query>` and let them pick one to insert
 * `@<name> `. Per owner request 2026-05-18 ("当我@ 的时候 能不能有个
 * 下拉单子 把Team 列出了 按照我打的字 filter一下").
 *
 * Scope is UI-only: the composer textarea is owned by assistant-ui's
 * ComposerPrimitive, so we mutate it via the same native-setter +
 * input-event pattern used by ComposerPrefillBridge / injectTranscript.
 * Whether the runtime ever routes the @-mentioned message to a specific
 * staff is a separate concern (owner-adapter work).
 *
 * Keyboard: ↑/↓ navigate, Enter inserts, Esc closes. Click also inserts.
 */

interface StaffLite { id: string; name: string; role_label: string }

function MentionTypeahead() {
  const [staff, setStaff] = useState<ReadonlyArray<StaffLite>>([]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const stateRef = useRef({ open: false, mentionStart: -1 });

  useEffect(() => {
    fetch('/api/v1/staff')
      .then((r) => r.json())
      .then((j: { items?: Array<{ id: string; name: string; role_label: string }> }) => {
        const items = Array.isArray(j.items) ? j.items : [];
        setStaff(items.map((s) => ({ id: s.id, name: s.name, role_label: s.role_label })));
      })
      .catch(() => { /* silent — typeahead is best-effort */ });
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = staff.slice();
    if (!q) return base.slice(0, 8);
    return base.filter((s) => s.name.toLowerCase().includes(q)).slice(0, 8);
  }, [staff, query]);

  // Keep refs in sync so the DOM listeners read fresh state without
  // re-attaching on every keystroke.
  const filteredRef = useRef(filtered);
  filteredRef.current = filtered;
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => { stateRef.current.open = open; }, [open]);

  function insert(s: StaffLite) {
    const ta = document.querySelector<HTMLTextAreaElement>('.chat-input');
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
    const ta = document.querySelector<HTMLTextAreaElement>('.chat-input');
    if (!ta) return;
    function recompute() {
      if (!ta) return;
      const cursor = ta.selectionStart ?? ta.value.length;
      const before = ta.value.slice(0, cursor);
      const at = before.lastIndexOf('@');
      // valid trigger: @ at start OR preceded by whitespace; no whitespace
      // between @ and cursor.
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
    function onInput() { recompute(); }
    function onClick() { recompute(); }
    function onKeyDown(ev: KeyboardEvent) {
      if (!stateRef.current.open) return;
      const list = filteredRef.current;
      if (list.length === 0) return;
      if (ev.key === 'ArrowDown') {
        ev.preventDefault();
        setActive((i) => (i + 1) % list.length);
      } else if (ev.key === 'ArrowUp') {
        ev.preventDefault();
        setActive((i) => (i - 1 + list.length) % list.length);
      } else if (ev.key === 'Enter') {
        const pick = list[activeRef.current] ?? list[0];
        if (!pick) return;
        ev.preventDefault();
        ev.stopPropagation();
        insert(pick);
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        setOpen(false);
        setQuery('');
        stateRef.current.mentionStart = -1;
      }
    }
    // capture: assistant-ui's composer also listens for Enter to submit;
    // we need first crack at it when the dropdown is open.
    ta.addEventListener('input', onInput);
    ta.addEventListener('click', onClick);
    ta.addEventListener('keyup', onClick);
    ta.addEventListener('keydown', onKeyDown, true);
    return () => {
      ta.removeEventListener('input', onInput);
      ta.removeEventListener('click', onClick);
      ta.removeEventListener('keyup', onClick);
      ta.removeEventListener('keydown', onKeyDown, true);
    };
  }, []);

  if (!open) return null;
  if (filtered.length === 0) {
    return (
      <div className="mention-menu" role="listbox" aria-label="No matching team members">
        <div className="mention-empty">No team members match “{query}”</div>
      </div>
    );
  }
  return (
    <div className="mention-menu" role="listbox" aria-label="Team members">
      {filtered.map((s, i) => (
        <button
          key={s.id}
          type="button"
          role="option"
          aria-selected={i === active}
          className={`mention-item${i === active ? ' active' : ''}`}
          onMouseDown={(ev) => { ev.preventDefault(); insert(s); }}
          onMouseEnter={() => setActive(i)}
        >
          <span className="mention-name">{s.name}</span>
          <span className="mention-role">{s.role_label}</span>
        </button>
      ))}
    </div>
  );
}

/* ── Voice input via local STT, with Web Speech API fallback ──────────
 *
 * No on-screen button per user "那个语音如果是长时间按主或者某个快捷键就行
 * 而不需要那个 micro 标志". Two triggers:
 *   - Cmd+M / Ctrl+M  → toggle (tap once to start, again to stop)
 *   - Hold Space      → push-to-talk (when composer NOT focused)
 *
 * When recording / transcribing, a small floating pill at bottom of chat
 * shows the current state so the user knows what the mic path is doing.
 *
 * Transcribed text is injected into the composer textarea via a native
 * input event so assistant-ui's controlled state picks it up.
 */

interface SpeechRecognitionResultLike { transcript: string; isFinal: boolean }
interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: ((ev: { results: ArrayLike<ArrayLike<SpeechRecognitionResultLike> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((ev: { error?: string }) => void) | null;
}

type VoiceMode = 'idle' | 'browser' | 'local-recording' | 'local-transcribing';

interface LocalTranscribeResponse {
  text?: string;
  error?: string;
  message?: string;
}

function getSpeechRecognitionCtor() {
  type SRCtor = new () => SpeechRecognitionInstance;
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

function injectTranscript(transcript: string) {
  if (!transcript) return;
  const ta = document.querySelector<HTMLTextAreaElement>('.chat-input');
  if (!ta) return;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
  const next = (ta.value ? ta.value + ' ' : '') + transcript;
  setter?.call(ta, next);
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  ta.focus();
}

/** Maps Web Speech API error codes → an i18n key (resolved in-component to the
 * active language only — no bilingual concatenation). */
function voiceErrorKey(code: string): string {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'voice.err_not_allowed';
    case 'no-speech':
      return 'voice.err_no_speech';
    case 'audio-capture':
      return 'voice.err_audio_capture';
    case 'network':
      return 'voice.err_network';
    default:
      return 'voice.err_unknown';
  }
}

// True when ANY STT engine is configured — including cloud OpenAI. All of them
// go through the /transcribe BFF (MediaRecorder records the full hold-Space clip
// → one transcription), which is correct for OpenAI too. Only with NO engine
// configured do we fall back to the browser SpeechRecognition (which cuts off on
// a pause and can't do long utterances — the bug the owner hit when provider=openai
// was wrongly excluded here).
function localSttConfigured(provider: string | undefined): boolean {
  return !!provider;
}

function recorderMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  const preferred = 'audio/webm;codecs=opus';
  return MediaRecorder.isTypeSupported(preferred) ? preferred : undefined;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Unable to read recorded audio.'));
    reader.onloadend = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const [, base64 = ''] = result.split(',', 2);
      if (base64) {
        resolve(base64);
      } else {
        reject(new Error('Recorded audio was empty.'));
      }
    };
    reader.readAsDataURL(blob);
  });
}

function VoiceListening() {
  const { t, tFmt, lang } = useT();
  const { owner } = useOwner();
  const [listening, setListening] = useState(false);
  const [voiceMode, setVoiceMode] = useState<VoiceMode>('idle');
  const [interimText, setInterimText] = useState('');
  const [statusMsg, setStatusMsg] = useState('');
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const localChunksRef = useRef<Blob[]>([]);
  const localStartingRef = useRef(false);
  const localStopPendingRef = useRef(false);
  const localFallbackHintShownRef = useRef(false);
  // spaceHeld: tracks whether Space is currently being held for push-to-talk.
  // null = not held; number = timestamp when hold started (used for the 300ms
  // debounce guard so a quick tap doesn't accidentally arm the mic).
  const spaceHeldRef = useRef<number | null>(null);
  // Whether voice was triggered from a focused textarea (so we know to strip
  // the trailing space that may have been typed before the hold threshold).
  const spaceFromFocusedRef = useRef(false);
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gotFinalRef = useRef(false);
  const useLocalStt = localSttConfigured(owner?.stt_provider);
  const transcribeLanguage = lang === 'zh-CN' ? 'zh' : 'en';
  const useLocalSttRef = useRef(useLocalStt);
  const transcribeLanguageRef = useRef(transcribeLanguage);
  const appLangRef = useRef(lang);
  useLocalSttRef.current = useLocalStt;
  transcribeLanguageRef.current = transcribeLanguage;
  appLangRef.current = lang;

  function showStatus(msg: string) {
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    setStatusMsg(msg);
    statusTimerRef.current = setTimeout(() => {
      setStatusMsg('');
      statusTimerRef.current = null;
    }, 4000);
  }

  function showLocalFallbackHint() {
    if (localFallbackHintShownRef.current) return;
    localFallbackHintShownRef.current = true;
    showStatus(t('voice.local_fallback_hint'));
  }

  function stopLocalStream() {
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
  }

  function startBrowserRecognition(options: { preserveStatus?: boolean } = {}) {
    if (listening || recognitionRef.current) return;
    const SR = getSpeechRecognitionCtor();
    if (!SR) {
      alert('Voice input needs a Chromium-based browser (Chrome / Edge).');
      composerMicButtonState.set('idle');
      return;
    }
    gotFinalRef.current = false;
    setInterimText('');
    if (!options.preserveStatus) setStatusMsg('');
    const rec = new SR();
    rec.continuous = false;
    rec.interimResults = true;
    // Recognition language follows the APP's configured language, not the
    // browser UI language — an English-UI Edge would otherwise try to recognize
    // Chinese speech as English and fail. zh-CN → 'zh-CN', en → 'en-US'.
    rec.lang = appLangRef.current === 'zh-CN' ? 'zh-CN' : 'en-US';
    rec.onresult = (ev) => {
      // Accumulate all result segments; show interim live, inject on final.
      let interim = '';
      let finalText = '';
      const results = ev.results;
      for (let i = 0; i < (results as unknown as { length: number }).length; i++) {
        const r = results[i] as ArrayLike<SpeechRecognitionResultLike> & { isFinal: boolean };
        const text = r[0]?.transcript ?? '';
        if (r.isFinal) {
          finalText += text;
        } else {
          interim += text;
        }
      }
      if (finalText) {
        gotFinalRef.current = true;
        setInterimText('');
        injectTranscript(finalText);
        composerMicButtonState.markDone();
      } else {
        setInterimText(interim);
      }
    };
    rec.onend = () => {
      setListening(false);
      setVoiceMode('idle');
      setInterimText('');
      recognitionRef.current = null;
      if (!gotFinalRef.current) {
        showStatus(t('voice.no_speech'));
        composerMicButtonState.set('idle');
      }
    };
    rec.onerror = (ev) => {
      const code = ev.error ?? 'unknown';
      setListening(false);
      setVoiceMode('idle');
      setInterimText('');
      recognitionRef.current = null;
      const key = voiceErrorKey(code);
      showStatus(key === 'voice.err_unknown' ? tFmt('voice.err_unknown', { code }) : t(key));
      composerMicButtonState.set('idle');
    };
    recognitionRef.current = rec;
    rec.start();
    setListening(true);
    setVoiceMode('browser');
    composerMicButtonState.set('recording');
  }

  function startBrowserFallback() {
    showLocalFallbackHint();
    startBrowserRecognition({ preserveStatus: true });
  }

  function handleLocalFailure(error: unknown) {
    console.warn('[voice] local STT failed; falling back to browser SpeechRecognition', error);
    setListening(false);
    setVoiceMode('idle');
    setInterimText('');
    mediaRecorderRef.current = null;
    stopLocalStream();
    composerMicButtonState.set('idle');
    startBrowserFallback();
  }

  async function postLocalRecording(blob: Blob, mime: string) {
    setVoiceMode('local-transcribing');
    composerMicButtonState.set('transcribing');
    setStatusMsg(t('voice.transcribing'));
    const base64 = await blobToBase64(blob);
    const res = await fetch('/api/v1/connectors/voice/transcribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ base64, mime, language: transcribeLanguageRef.current }),
    });
    if (!res.ok) {
      throw new Error(`POST /api/v1/connectors/voice/transcribe → HTTP ${res.status}`);
    }
    const data = await res.json() as LocalTranscribeResponse;
    if (data.error) {
      if (data.error === 'no_stt_provider') {
        setListening(false);
        setVoiceMode('idle');
        startBrowserFallback();
        return;
      }
      throw new Error(data.message ? `${data.error}: ${data.message}` : data.error);
    }
    const text = typeof data.text === 'string' ? data.text.trim() : '';
    if (text) {
      injectTranscript(text);
      setStatusMsg('');
      composerMicButtonState.markDone();
    } else {
      showStatus(t('voice.no_speech'));
      composerMicButtonState.set('idle');
    }
  }

  function finishLocalRecording(blob: Blob, mime: string) {
    void postLocalRecording(blob, mime)
      .catch((error: unknown) => {
        handleLocalFailure(error);
      })
      .finally(() => {
        if (!recognitionRef.current) {
          setListening(false);
          setVoiceMode('idle');
        }
      });
  }

  function startLocalRecording() {
    if (listening || localStartingRef.current || mediaRecorderRef.current) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      startBrowserFallback();
      return;
    }

    localStartingRef.current = true;
    localStopPendingRef.current = false;
    setInterimText('');
    setStatusMsg('');

    void navigator.mediaDevices.getUserMedia({ audio: true })
      .then((stream) => {
        mediaStreamRef.current = stream;
        localChunksRef.current = [];
        const mimeType = recorderMimeType();
        const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
        mediaRecorderRef.current = recorder;
        recorder.ondataavailable = (ev) => {
          if (ev.data.size > 0) localChunksRef.current.push(ev.data);
        };
        recorder.onerror = (ev) => {
          const recorderError = (ev as unknown as { error?: DOMException }).error;
          handleLocalFailure(new Error(recorderError?.message ?? 'MediaRecorder error'));
        };
        recorder.onstop = () => {
          const chunks = localChunksRef.current;
          localChunksRef.current = [];
          mediaRecorderRef.current = null;
          stopLocalStream();
          if (chunks.length === 0) {
            showStatus(t('voice.no_speech'));
            setListening(false);
            setVoiceMode('idle');
            composerMicButtonState.set('idle');
            return;
          }
          const mime = recorder.mimeType || mimeType || 'audio/webm';
          finishLocalRecording(new Blob(chunks, { type: mime }), mime);
        };
        recorder.start();
        localStartingRef.current = false;
        setListening(true);
        setVoiceMode('local-recording');
        composerMicButtonState.set('recording');
        if (localStopPendingRef.current) {
          localStopPendingRef.current = false;
          recorder.stop();
        }
      })
      .catch((error: unknown) => {
        localStartingRef.current = false;
        handleLocalFailure(error);
      });
  }

  function start() {
    if (useLocalSttRef.current) {
      startLocalRecording();
    } else {
      startBrowserRecognition();
    }
  }

  function stop() {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      return;
    }
    if (localStartingRef.current) {
      localStopPendingRef.current = true;
      return;
    }
    recognitionRef.current?.stop();
  }
  function toggle() {
    if (listening) stop(); else start();
  }

  useEffect(() => {
    function onComposerMicToggle() {
      toggle();
    }
    window.addEventListener(COMPOSER_MIC_TOGGLE_EVENT, onComposerMicToggle);
    return () => window.removeEventListener(COMPOSER_MIC_TOGGLE_EVENT, onComposerMicToggle);
  }, [listening]);

  useEffect(() => {
    // Returns true when the active element is a text-entry field where a
    // Space keypress should type a space, NOT trigger voice. Covers:
    //   - any <input> or <textarea> (including the chat composer)
    //   - any element with contentEditable="true"
    function isTextFieldFocused(): boolean {
      const ae = document.activeElement as HTMLElement | null;
      if (!ae) return false;
      const tag = ae.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
      if (ae.isContentEditable) return true;
      return false;
    }

    function onKeyDown(ev: KeyboardEvent) {
      // Space hold → push-to-talk.
      //
      // Two modes depending on whether a text field is focused:
      //
      // A. NOT focused — existing behavior, unchanged:
      //    First keydown (ev.repeat=false) arms the hold timer (300ms). The
      //    autorepeat keydowns (ev.repeat=true) are ignored. If the Space is
      //    released before the threshold fires, spaceHeldRef is cleared by
      //    onKeyUp with no voice start (quick tap → no-op). The page-scroll
      //    default is suppressed so the viewport doesn't jump.
      //
      // B. Focused textarea / input (e.g. the chat composer):
      //    - Quick tap (< 300ms hold): Space types normally. We do NOT
      //      preventDefault, so the browser inserts the space character.
      //    - Long hold (≥ 300ms): the hold timer fires, we call start(), and
      //      then — before injecting the transcript — we strip the one space
      //      that may have been inserted at the beginning of the hold. We call
      //      preventDefault on the FIRST keydown so no further spaces are
      //      typed after the threshold is crossed. Autorepeat keydowns
      //      (ev.repeat=true) are also suppressed once the hold is live so the
      //      browser doesn't keep appending spaces while the user is speaking.
      //
      // Modifiers (Meta/Ctrl/Alt+Space) are always left alone — system shortcuts.

      if (
        ev.code === 'Space' &&
        !ev.metaKey && !ev.ctrlKey && !ev.altKey
      ) {
        const focused = isTextFieldFocused();

        // Once a hold is live (voice has started from a focused field), block
        // autorepeat keydowns so extra spaces aren't typed into the composer.
        if (spaceHeldRef.current !== null && ev.repeat && focused) {
          ev.preventDefault();
          return;
        }

        // Ignore autorepeat on the first keydown — we handle timing ourselves.
        if (ev.repeat) return;

        // Only arm if not already held.
        if (spaceHeldRef.current !== null) return;

        if (!focused) {
          // NOT focused: prevent page scroll and arm the hold timer.
          ev.preventDefault();
          spaceHeldRef.current = Date.now();
          spaceFromFocusedRef.current = false;
          // 300 ms debounce: don't open the mic on a quick tap (accidental).
          setTimeout(() => {
            if (spaceHeldRef.current !== null && Date.now() - spaceHeldRef.current >= 300) {
              start();
            }
          }, 320);
        } else {
          // Focused text field: let this keydown pass (types a space normally).
          // Arm a hold timer; if the user holds ≥ 300ms we'll start voice and
          // strip the leading space that was just typed.
          spaceHeldRef.current = Date.now();
          spaceFromFocusedRef.current = true;
          setTimeout(() => {
            if (spaceHeldRef.current === null) return; // already released
            if (Date.now() - spaceHeldRef.current < 300) return; // too short
            // Suppress further space keydowns (handled above via ev.repeat guard).
            // Strip the trailing space that was inserted at the very first keydown.
            const ta = document.querySelector<HTMLTextAreaElement>('.chat-input');
            if (ta && ta.value.endsWith(' ')) {
              const setter = Object.getOwnPropertyDescriptor(
                window.HTMLTextAreaElement.prototype, 'value'
              )?.set;
              setter?.call(ta, ta.value.slice(0, -1));
              ta.dispatchEvent(new Event('input', { bubbles: true }));
            }
            start();
          }, 320);
        }
      }
    }

    function onKeyUp(ev: KeyboardEvent) {
      if (ev.code === 'Space' && spaceHeldRef.current !== null) {
        spaceHeldRef.current = null;
        spaceFromFocusedRef.current = false;
        stop();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listening]);

  const transcribing = voiceMode === 'local-transcribing';
  const showPill = listening || transcribing || !!statusMsg;
  if (!showPill) return null;
  return (
    <div className={`voice-listening-pill${statusMsg ? ' voice-listening-pill--status' : ''}`} role="status" aria-live="polite">
      {listening && !transcribing && <span className="voice-listening-dot" />}
      {transcribing
        ? <span className="voice-status-msg">{t('voice.transcribing')}</span>
        : listening && statusMsg
          ? <span className="voice-status-msg">{statusMsg}</span>
        : listening
          ? (interimText
              ? <span className="voice-interim-text">{interimText}</span>
              : <span>{t('voice.listening_hint')}</span>)
        : <span className="voice-status-msg">{statusMsg}</span>
      }
    </div>
  );
}

/* ── Composer prefill bridge ──────────────────────────────────────────
 * Other components (e.g. Today's "+ New handoff" button, until a
 * dedicated handoff modal lands) dispatch `holon:prefill-composer`
 * with a starter prompt. We listen at the chat surface, push the text
 * into the textarea, and focus. Live submit is intentionally left to
 * the user — handoffs need clarification before they fire. */
function ComposerPrefillBridge() {
  useEffect(() => {
    function onPrefill(ev: Event) {
      const ce = ev as CustomEvent<{ text?: string; focus?: boolean }>;
      const text = typeof ce.detail?.text === 'string' ? ce.detail.text : '';
      if (!text) return;
      const ta = document.querySelector<HTMLTextAreaElement>('.chat-input');
      if (!ta) return;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(ta, text);
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      if (ce.detail?.focus !== false) ta.focus();
    }
    window.addEventListener('holon:prefill-composer', onPrefill);
    return () => window.removeEventListener('holon:prefill-composer', onPrefill);
  }, []);
  return null;
}

/* ── Top-level chat surface ───────────────────────────────────────────── */

export function ChatSurface() {
  return (
    <aside className="chat-surface" aria-label="Chat with desk AI">
      <ThreadView />
      <ComposerPrefillBridge />
    </aside>
  );
}

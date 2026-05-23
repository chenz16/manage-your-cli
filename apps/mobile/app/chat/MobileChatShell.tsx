'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { deskApi } from '../_lib/desk-api';
import { deskFetch } from '../_lib/desk-cache';
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useLocalRuntime,
  type ChatModelAdapter,
  type ThreadMessageLike,
} from '@assistant-ui/react';
import { TodayStrip, type TodayStripHandle } from '../_components/TodayStrip';
import { PullToRefresh } from '../_components/PullToRefresh';

// Minimal mirror of apps/web ChatSurface — streams from the proxied
// /api/v1/chat/owner/stream (rewritten to desk port 3000). Persistence,
// slash commands, voice, refusal copy: deferred past Pass #3.

interface StreamEvent {
  type: 'text' | 'done' | 'error' | string;
  text?: string;
  finalText?: string;
  message?: string;
}

// Pass #2 — localStorage-backed persistence. Mobile users switch tabs
// constantly; sessionStorage gets cleared on Capacitor wrap nav and on
// browser-PWA tab close. localStorage survives both. Cap last 100
// messages so the 5-10MB quota isn't a concern. Key is mobile-scoped
// so it doesn't collide with the desk's `holon.chatMessages`.
const STORAGE_KEY = 'holon.chatMessages.mobile';
const MAX_MESSAGES = 100;
// M-L-069 — cap per-message content before serialize so one long assistant
// reply can't blow up the synchronous JSON.stringify on the main thread.
// ~2KB keeps a recap-able tail while bounding the worst case to ~200KB blob.
const MAX_CONTENT_LEN = 2048;

interface StoredMessage { role: 'user' | 'assistant'; content: string }

function readStored(): StoredMessage[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((m): m is StoredMessage =>
      typeof m === 'object' && m !== null &&
      (m.role === 'user' || m.role === 'assistant') &&
      typeof m.content === 'string',
    );
  } catch {
    return [];
  }
}

// Guard against rewriting an identical blob: serialize once, compare to the
// last persisted payload, and skip the localStorage.setItem when unchanged.
let lastWrittenBlob: string | null = null;

// M-L-074 — a write failure must never silently end persistence. One-time
// module flag so the surfacing fires once (not on every subsequent turn);
// the chat header reads it on mount + listens for the event below.
export const CHAT_PERSIST_FAILED_EVENT = 'holon:chat-persist-failed';
let persistFailed = false;
export function chatPersistFailed(): boolean { return persistFailed; }

// One write attempt. Returns true on success; on failure reports false so the
// caller can retry smaller or surface — never swallows. (Engineering Rule #4.)
function trySetStored(blob: string): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, blob);
    lastWrittenBlob = blob;
    return true;
  } catch (err) {
    // Quota overflow (QuotaExceededError) or a disabled/locked store
    // (SecurityError, private mode). Either way the blob didn't land — log for
    // diagnostics and report the failure up; writeStored decides what to do.
    console.warn('[mobile-chat] localStorage write failed', (err as Error)?.name ?? err);
    return false;
  }
}

function writeStored(messages: StoredMessage[]): void {
  if (typeof window === 'undefined') return;
  const capped = messages.length > MAX_MESSAGES ? messages.slice(-MAX_MESSAGES) : messages;
  const bounded = capped.map((m) =>
    m.content.length > MAX_CONTENT_LEN ? { role: m.role, content: m.content.slice(0, MAX_CONTENT_LEN) } : m,
  );
  const blob = JSON.stringify(bounded);
  if (blob === lastWrittenBlob) return; // no-op turn — don't rewrite the whole blob

  if (trySetStored(blob)) return;

  // Retry once after shedding the oldest half — old turns are cheapest to drop
  // and this reclaims quota when the blob simply outgrew the budget.
  if (bounded.length > 1) {
    const trimmed = bounded.slice(-Math.ceil(bounded.length / 2));
    if (trySetStored(JSON.stringify(trimmed))) return;
  }

  // Both attempts failed — surface once, non-blocking. No silent drop.
  if (!persistFailed) {
    persistFailed = true;
    window.dispatchEvent(new CustomEvent(CHAT_PERSIST_FAILED_EVENT));
  }
}

function clearStored(): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* nothing to clear if storage is unavailable */ }
  lastWrittenBlob = null;
  persistFailed = false; // store cleared → quota reclaimed; allow the notice to re-arm
}

function flattenToText(content: ReadonlyArray<{ type: string; text?: string }>): string {
  return content
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text' && typeof p.text === 'string')
    .map((p) => p.text)
    .join('');
}

function makeMobileAdapter(): ChatModelAdapter {
  return {
    async *run({ messages, abortSignal }) {
      const payload = messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: flattenToText(m.content) }));

      let assembled = '';
      try {
        const res = await fetch(deskApi('/api/v1/chat/owner/stream'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: payload }),
          signal: abortSignal,
        });
        if (!res.ok || !res.body) {
          const text = await res.text().catch(() => '');
          yield { content: [{ type: 'text', text: `⚠️ 错误 ${res.status}：${text.slice(0, 200) || '未知错误'}` }] };
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let sep = buf.indexOf('\n\n');
          while (sep !== -1) {
            const frame = buf.slice(0, sep);
            buf = buf.slice(sep + 2);
            sep = buf.indexOf('\n\n');
            for (const line of frame.split('\n')) {
              if (!line.startsWith('data:')) continue;
              const json = line.slice(5).trim();
              if (!json) continue;
              let ev: StreamEvent;
              try { ev = JSON.parse(json) as StreamEvent; } catch { continue; }
              if (ev.type === 'text' && typeof ev.text === 'string') {
                assembled = ev.text;
                yield { content: [{ type: 'text', text: assembled }] };
              } else if (ev.type === 'done' && ev.finalText && ev.finalText !== assembled) {
                assembled = ev.finalText;
                yield { content: [{ type: 'text', text: assembled }] };
              } else if (ev.type === 'error') {
                yield { content: [{ type: 'text', text: `⚠️ 错误：${ev.message ?? '流式中断'}` }] };
              }
            }
          }
        }
      } catch (err) {
        // Thrown fetch() (desk unreachable / DNS fail) or thrown reader.read()
        // (mid-stream connection drop) — surface, never a silent empty bubble.
        // Intentional aborts (user hit stop / navigated away) are not errors.
        if (abortSignal?.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
          return;
        }
        yield { content: [{ type: 'text', text: '⚠️ 连接桌面失败，请重试' }] };
        return;
      }

      // Persist the completed turn: prior history + new user turn + assistant reply.
      const finalAssistant = assembled.trim();
      if (finalAssistant) {
        const next: StoredMessage[] = [
          ...payload.map((m) => ({ role: m.role, content: m.content })),
          { role: 'assistant', content: finalAssistant },
        ];
        writeStored(next);
      }
    },
  };
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className="m-chatmsg m-chatmsg-user">
      <MessagePrimitive.Parts />
    </MessagePrimitive.Root>
  );
}
function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="m-chatmsg m-chatmsg-assistant">
      <MessagePrimitive.Parts />
    </MessagePrimitive.Root>
  );
}

// Outer/Inner split mirrors apps/web ChatRuntimeProvider — mountKey
// bumps on `holon:reset` (or `/clear` slash from desk) to drop the
// runtime's stale message buffer along with localStorage.
export function MobileChatShell() {
  const [mountKey, setMountKey] = useState(0);
  useEffect(() => {
    function onReset() {
      clearStored();
      setMountKey((k) => k + 1);
    }
    window.addEventListener('holon:reset', onReset);
    return () => window.removeEventListener('holon:reset', onReset);
  }, []);
  return <MobileChatShellInner key={mountKey} />;
}

function MobileChatShellInner() {
  const adapter = useMemo(() => makeMobileAdapter(), []);
  const initialMessages = useMemo<ThreadMessageLike[]>(
    () => readStored().map((m) => ({ role: m.role, content: m.content })),
    [],
  );
  const runtime = useLocalRuntime(adapter, { initialMessages });
  // Gate ComposerPrimitive behind mount flag — assistant-ui flips
  // aria/data attrs on hydration, which trips React's mismatch warning.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // M-L-074 — surface a non-blocking notice when chat-history persistence has
  // given up (quota/disabled store), so the owner knows history won't survive a
  // reopen instead of silently losing it. Init from the module flag (a failure
  // may have fired before this remount) + listen for later failures.
  const [persistNotice, setPersistNotice] = useState(false);
  useEffect(() => {
    setPersistNotice(chatPersistFailed());
    const onFail = () => setPersistNotice(true);
    window.addEventListener(CHAT_PERSIST_FAILED_EVENT, onFail);
    return () => window.removeEventListener(CHAT_PERSIST_FAILED_EVENT, onFail);
  }, []);

  // Pass #1 — hydrate composer from `/chat?prompt=...&autosubmit=1`.
  // Landing chips (MobileLandingChips) route here with the prompt encoded.
  // M-L-017 — also hydrate `?staff=<name>` from /staff/detail delegation.
  const searchParams = useSearchParams();
  const initialPrompt = searchParams?.get('prompt') ?? '';
  const staffMention = searchParams?.get('staff') ?? '';
  const autoSubmit = searchParams?.get('autosubmit') === '1';
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (!mounted || hydratedRef.current) return;
    if (!initialPrompt && !staffMention) return;
    hydratedRef.current = true;
    const text = staffMention
      ? `@${staffMention} ${initialPrompt}`.trim()
      : initialPrompt;
    if (autoSubmit && text) {
      runtime.thread.append({ role: 'user', content: [{ type: 'text', text }] });
    } else if (text) {
      runtime.thread.composer.setText(text);
    }
  }, [mounted, initialPrompt, staffMention, autoSubmit, runtime]);

  // M-L-023 / M-L-030 — empty-state suggest chips. M-L-030 makes them
  // context-aware: query /api/v1/staff + /api/v1/jobs on mount; if user
  // has 0 staff lead with recruitment, if jobs running lead with status,
  // else generic founder vocabulary. Same auto-send-on-tap interaction.
  const [contextChips, setContextChips] = useState<ReadonlyArray<string>>([
    '今天有什么在跑？',
    '最近交付了什么？',
    '我想招个 ...',
    '看一下收件',
  ]);
  useEffect(() => {
    let cancelled = false;
    async function loadContext() {
      try {
        // M-L-066 — share staff/jobs with TodayStrip + useTabBadges via the
        // dedupe cache: on first paint these endpoints would otherwise be
        // fetched 2×/3× within a second across the 3 mounted consumers.
        const [sr, jr] = await Promise.all([
          deskFetch<{ items: { name?: string; status?: string }[] }>('/api/v1/staff'),
          deskFetch<{ items: { status?: string }[] }>('/api/v1/jobs'),
        ]);
        const sb = sr.ok ? (sr.data ?? { items: [] }) : { items: [] };
        const jb = jr.ok ? (jr.data ?? { items: [] }) : { items: [] };
        const activeStaff = (sb.items || []).filter((s) => s.status === 'active');
        const activeJobs = (jb.items || []).filter((j) => j.status === 'running' || j.status === 'queued');
        if (cancelled) return;
        if (activeStaff.length === 0) {
          setContextChips([
            '我想招个文案 staff',
            '帮我看看怎么招人',
            '内置专家都有哪些？',
            '看一下收件',
          ]);
        } else if (activeJobs.length > 0) {
          const firstName = activeStaff[0]?.name ?? 'staff';
          setContextChips([
            `${activeJobs.length} 个任务进度如何？`,
            `${firstName} 在忙啥？`,
            '最近交付了什么？',
            '看一下收件',
          ]);
        } else {
          const firstName = activeStaff[0]?.name ?? 'staff';
          setContextChips([
            `@${firstName} 帮我 ...`,
            '今天有什么计划？',
            '最近交付了什么？',
            '看一下收件',
          ]);
        }
      } catch { /* fallback chips remain */ }
    }
    void loadContext();
    return () => { cancelled = true; };
  }, []);
  const sendChip = (text: string) => {
    runtime.thread.append({ role: 'user', content: [{ type: 'text', text }] });
  };

  // M-L-043 — wrap the chat shell in PullToRefresh so the owner's pull-down
  // gesture (works on every other surface) re-loads the TodayStrip metrics.
  const todayStripRef = useRef<TodayStripHandle>(null);
  const refreshStrip = useCallback(async () => {
    await todayStripRef.current?.refresh();
  }, []);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <PullToRefresh onRefresh={refreshStrip}>
      <div className="mobile-shell m-chat-shell">
        <header className="mobile-header">
          <div className="mobile-brand">工作台</div>
          <div className="mobile-subtitle">desk AI · 派活 + 进度合并视图</div>
          {persistNotice ? (
            <div className="m-chat-persist-warn" role="status">聊天记录无法保存</div>
          ) : null}
        </header>

        <TodayStrip ref={todayStripRef} />

        <ThreadPrimitive.Root className="m-chat-thread">
          <ThreadPrimitive.Viewport className="m-chat-viewport">
            <ThreadPrimitive.Empty>
              <div className="m-chat-empty">
                <div className="m-chat-empty-title">问问你的桌面 AI</div>
                <div className="m-chat-empty-hint muted">点下面任意一条直接发，或自己输入</div>
                <div className="m-chat-empty-chips" role="list" aria-label="建议话题">
                  {contextChips.map((c) => (
                    <button
                      key={c}
                      type="button"
                      role="listitem"
                      className="m-chat-empty-chip"
                      onClick={() => sendChip(c)}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>
            </ThreadPrimitive.Empty>
            <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
          </ThreadPrimitive.Viewport>

          {mounted ? (
            <ComposerPrimitive.Root className="m-chat-composer">
              <ComposerPrimitive.Input rows={1} placeholder="给桌面 AI 留个话…" className="m-chat-input" />
              <ComposerPrimitive.Send className="m-chat-send" aria-label="发送">↑</ComposerPrimitive.Send>
            </ComposerPrimitive.Root>
          ) : (
            <div className="m-chat-composer" aria-hidden="true">
              <textarea className="m-chat-input" rows={1} placeholder="给桌面 AI 留个话…" readOnly tabIndex={-1} />
              <button type="button" className="m-chat-send" tabIndex={-1} disabled>↑</button>
            </div>
          )}
        </ThreadPrimitive.Root>
      </div>
      </PullToRefresh>
    </AssistantRuntimeProvider>
  );
}

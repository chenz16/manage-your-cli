'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AssistantRuntimeProvider, useLocalRuntime, type ThreadMessageLike } from '@assistant-ui/react';
import {
  makeOwnerAdapter,
  loadInitialMessages,
  fetchInitialMessagesFromApi,
  fetchTranscriptFromDesk,
  clearStoredMessages,
} from './owner-adapter';

/**
 * Lives at the root layout level (above AppShell + nav) so the
 * assistant-ui runtime survives route changes. iter-007 fix
 * 2026-05-16:
 *
 *   1. Hoisted from ChatSurface — prevents nav-tab re-mount wipe.
 *   2. Listens for `holon:reset` (dispatched by /me DebugControls)
 *      so wiping runtime state also clears stored client messages.
 *   3. Reads `initialMessages` from sessionStorage so a browser
 *      refresh restores the conversation.
 *
 * L-050 (2026-05-18): when sessionStorage is empty (first load /
 * post-reset), hydrate the runtime from the persona's seeded
 * `/api/v1/chat/threads` starter greeting so Pass #4's per-persona
 * starter_greeting becomes visible — previously this was dead code
 * with no UI surface. Render the inner runtime only after the async
 * fetch resolves; warm reloads stay synchronous.
 *
 * `key={mountKey}` forces a clean remount when reset fires, so the
 * runtime drops its stale message buffer along with sessionStorage.
 */
export function ChatRuntimeProvider({ children }: { children: ReactNode }) {
  const [mountKey, setMountKey] = useState(0);

  useEffect(() => {
    function onReset() {
      clearStoredMessages();
      setMountKey((k) => k + 1);
    }
    window.addEventListener('holon:reset', onReset);

    // Pre-warm the Secretary on mount — spawns the warm-agent process so
    // the first user message doesn't pay the cold-start latency.
    fetch('/api/v1/chat/warm').catch(() => {/* best effort */});

    return () => window.removeEventListener('holon:reset', onReset);
  }, []);

  return (
    <ChatRuntimeInner key={mountKey}>{children}</ChatRuntimeInner>
  );
}

function ChatRuntimeInner({ children }: { children: ReactNode }) {
  const stored = useMemo(() => loadInitialMessages(), []);
  // chat-sync: always try to hydrate from the desk transcript (shared source of
  // truth) so messages sent from mobile show up here. Strategy:
  //   1. Paint immediately with sessionStorage (stored) if non-empty — zero
  //      extra latency for warm reloads.
  //   2. In background, fetch /api/v1/chat/history?thread=owner (the desk
  //      transcript). If it's longer than sessionStorage (i.e. messages sent
  //      from mobile that haven't hit this session), re-mount with the full set.
  //      If not longer, keep the stored view (avoids unnecessary re-render).
  //   3. If sessionStorage was empty, fall back to /api/v1/chat/threads
  //      (persona starter greeting — existing L-050 path).
  const [hydrated, setHydrated] = useState<ThreadMessageLike[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchTranscriptFromDesk().then((deskMsgs) => {
      if (cancelled) return;
      if (deskMsgs.length > 0) {
        // Desk transcript is the primary source. Use it if it has more messages
        // than what sessionStorage holds (catches messages from other devices).
        if (deskMsgs.length > stored.length) {
          setHydrated(deskMsgs);
        }
        // If stored already covers everything (same or more), no re-mount needed.
        return;
      }
      // Desk transcript empty (first use / cleared). Fall back to persona greeting.
      if (stored.length > 0) return; // sessionStorage has content, no need to fetch
      fetchInitialMessagesFromApi().then((msgs) => {
        if (!cancelled && msgs.length > 0) setHydrated(msgs);
      });
    }).catch(() => {
      // Desk fetch failed — fall through to persona greeting if no sessionStorage.
      if (stored.length > 0) return;
      fetchInitialMessagesFromApi().then((msgs) => {
        if (!cancelled && msgs.length > 0) setHydrated(msgs);
      });
    });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const initialMessages = hydrated ?? (stored.length > 0 ? stored : []);
  const remountKey = hydrated ? 'desk-transcript' : (stored.length > 0 ? 'stored' : 'empty');

  return (
    <ChatRuntimeBound key={remountKey} initialMessages={initialMessages}>
      {children}
    </ChatRuntimeBound>
  );
}

function ChatRuntimeBound({
  initialMessages,
  children,
}: {
  initialMessages: ThreadMessageLike[];
  children: ReactNode;
}) {
  const adapter = useMemo(() => makeOwnerAdapter(), []);
  const runtime = useLocalRuntime(adapter, { initialMessages });
  return (
    <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>
  );
}

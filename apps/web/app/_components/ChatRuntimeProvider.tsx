'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AssistantRuntimeProvider, useLocalRuntime, type ThreadMessageLike } from '@assistant-ui/react';
import {
  makeOwnerAdapter,
  loadInitialMessages,
  fetchInitialMessagesFromApi,
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
  // L-050 follow-up: always render the bound runtime (Provider must be
  // present in the tree from first paint, otherwise descendants like
  // ThreadPrimitiveEmpty throw "requires an AuiProvider"). When stored
  // is empty we fire the /chat/threads fetch and, once it resolves,
  // bump remountKey so ChatRuntimeBound re-mounts with the hydrated
  // initialMessages. Warm reloads (stored.length > 0) skip the fetch
  // entirely and never remount.
  const [hydrated, setHydrated] = useState<ThreadMessageLike[] | null>(null);

  useEffect(() => {
    if (stored.length > 0) return;
    let cancelled = false;
    fetchInitialMessagesFromApi().then((msgs) => {
      if (!cancelled && msgs.length > 0) setHydrated(msgs);
    });
    return () => { cancelled = true; };
  }, [stored]);

  const initialMessages = stored.length > 0 ? stored : (hydrated ?? []);
  const remountKey = stored.length > 0 ? 'stored' : (hydrated ? 'hydrated' : 'empty');

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

'use client';

import { useRouter, usePathname } from 'next/navigation';
import { useState, useRef, useEffect, type ReactNode } from 'react';
import clsx from 'clsx';
import { Nav } from './Nav';
import { ChatSurface } from './ChatSurface';
import { useOwner } from '../../lib/hooks/useOwner';

/**
 * Shell layout (L-014 · 2026-05-18 — Copilot-style left rail):
 *
 *   ┌──────────┬──────────────────────────────────────┐
 *   │ rail     │  chat-surface  |div|  main           │  ← split mode
 *   │ (Nav     │              OR                       │
 *   │  vert    │  chat-surface (full-width)            │  ← chat-only
 *   │  + ≡)    │                                       │
 *   └──────────┴──────────────────────────────────────┘
 *      200px expanded / 56px collapsed (icons only)
 *
 * Variants on the chat row:
 *   - chat-only (route /): full-width chat fills viewport.
 *   - split     (other routes): chat (resizable) + draggable divider +
 *                                page panel.
 *
 * Drag-resize behavior on the inner divider (unchanged from pre-L-014):
 *   - Drag left  → chat shrinks (min 240px).
 *   - Drag right → chat grows (max 720px).
 *   - Drag below COLLAPSE_THRESHOLD (120px) → navigate to /.
 *   - Width persists in sessionStorage.
 *
 * Rail collapse:
 *   - Toggle button at top of rail; persists in localStorage
 *     `holon-rail-collapsed-v1`. ≤900px viewport defaults to collapsed.
 *
 * Chat-shell collapse (split routes only):
 *   - Chevron button overlaid at the chat-surface's right edge collapses
 *     the chat-surface to a 44px icon rail; clicking the icon rail
 *     expands it back. Persists in localStorage `holon-chat-collapsed-v1`.
 *     Same Copilot-style pattern the left rail uses, applied to chat.
 */
const CHAT_MIN = 240;
const CHAT_MAX = 720;
const CHAT_DEFAULT = 380;
const COLLAPSE_THRESHOLD = 120;
const STORAGE_KEY = 'holon.chatWidth';
const RAIL_STORAGE_KEY = 'holon-rail-collapsed-v1';
const CHAT_COLLAPSED_KEY = 'holon-chat-collapsed-v1';
const MAIN_COLLAPSED_KEY = 'holon-main-collapsed-v1';
// L-052 · onboarding-gate covers every non-onboarding route. Prior code
// guarded only `/`; bookmarks/external links to /today, /me, etc. let an
// un-onboarded user into the app. Session flag prevents re-fetch per nav.
const ONBOARDED_KEY = 'holon-onboarded-v1';
const ONBOARD_CHECK_KEY = 'holon-onboarded-checked-v1';

export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const isChatOnly = path === '/' || path === '';
  // iter-012 Pass #3 — /onboarding is a full-bleed wizard surface: no
  // left rail, no chat panel, no nav distractions. The wizard owns the
  // viewport. Skip the rest of AppShell scaffolding when active.
  const isOnboarding = path?.startsWith('/onboarding') ?? false;

  const [chatWidth, setChatWidth] = useState<number>(CHAT_DEFAULT);
  const [railCollapsed, setRailCollapsed] = useState<boolean>(isChatOnly);
  const [chatCollapsed, setChatCollapsed] = useState<boolean>(false);
  const [mainCollapsed, setMainCollapsed] = useState<boolean>(false);
  const draggingRef = useRef(false);
  // bug-20260522-052159 — guard so the nav-reset effect below skips its first
  // run (mount), letting the localStorage restore win on a same-page reload.
  const navResetRef = useRef(true);

  // Restore persisted state on mount.
  useEffect(() => {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored) {
      const n = Number(stored);
      if (Number.isFinite(n) && n >= CHAT_MIN && n <= CHAT_MAX) setChatWidth(n);
    }
    // Chat-shell collapse: only persisted on explicit toggle.
    if (localStorage.getItem(CHAT_COLLAPSED_KEY) === '1') setChatCollapsed(true);
    // Main panel collapse (bug-20260519-204037): only persisted on explicit toggle.
    if (localStorage.getItem(MAIN_COLLAPSED_KEY) === '1') setMainCollapsed(true);
  }, []);

  // Chat-first mode: Today (`/`) always starts with the sidebar collapsed,
  // independent of the persisted rail preference used by the rest of the app.
  useEffect(() => {
    if (isChatOnly) {
      setRailCollapsed(true);
      return;
    }

    // Rail collapse: explicit user choice wins; otherwise default to
    // collapsed on narrow viewports (≤900px) for mobile-friendliness.
    const railStored = localStorage.getItem(RAIL_STORAGE_KEY);
    if (railStored === '1') setRailCollapsed(true);
    else if (railStored === '0') setRailCollapsed(false);
    else setRailCollapsed(window.innerWidth <= 900);
  }, [isChatOnly]);

  // bug-20260522-052159 — clicking a left-nav item is a "show me this" intent:
  // the right content panel must open to its DEFAULT (expanded) position on
  // navigation, not restore the last-remembered collapsed state. The mount
  // restore above still honors persistence on a same-page reload (first run
  // here is skipped via navResetRef); every subsequent client-side navigation
  // resets the panel to default so the clicked content is actually visible.
  useEffect(() => {
    if (navResetRef.current) { navResetRef.current = false; return; }
    if (!isChatOnly && !isOnboarding) setMainCollapsed(false);
  }, [path, isChatOnly, isOnboarding]);

  // L-052 · onboarding gate. Run once per session per app load. /onboarding
  // itself is excluded so the wizard can render. The session flag avoids
  // re-evaluating the gate on every client-side navigation; the shared
  // useOwner() cache avoids re-fetching /api/v1/me across components.
  // L-052 · onboarding gate. Blocks rendering until the check completes so
  // the user never sees a flash of the normal UI before redirecting to
  // /onboarding on first install.
  const { owner } = useOwner();
  const [onboardCheckDone, setOnboardCheckDone] = useState(false);
  useEffect(() => {
    if (isOnboarding) { setOnboardCheckDone(true); return; }
    let alreadyChecked = false;
    try { alreadyChecked = sessionStorage.getItem(ONBOARD_CHECK_KEY) === '1'; } catch { /* private mode */ }
    if (alreadyChecked) { setOnboardCheckDone(true); return; }
    let onboarded = false;
    try { onboarded = localStorage.getItem(ONBOARDED_KEY) === '1'; } catch { /* ignore */ }
    if (onboarded) {
      try { sessionStorage.setItem(ONBOARD_CHECK_KEY, '1'); } catch { /* ignore */ }
      setOnboardCheckDone(true);
      return;
    }
    if (owner === null) return; // Still loading — wait for hook to resolve.
    try { sessionStorage.setItem(ONBOARD_CHECK_KEY, '1'); } catch { /* ignore */ }
    if (!owner.owner_name || !owner.owner_name.trim()) {
      router.replace('/onboarding');
    } else {
      setOnboardCheckDone(true);
    }
  }, [isOnboarding, owner, router]);

  function toggleRail() {
    setRailCollapsed((v) => {
      const next = !v;
      try { localStorage.setItem(RAIL_STORAGE_KEY, next ? '1' : '0'); } catch { /* quota */ }
      return next;
    });
  }

  function toggleChat() {
    setChatCollapsed((v) => {
      const next = !v;
      try { localStorage.setItem(CHAT_COLLAPSED_KEY, next ? '1' : '0'); } catch { /* quota */ }
      return next;
    });
  }

  function toggleMain() {
    setMainCollapsed((v) => {
      const next = !v;
      try { localStorage.setItem(MAIN_COLLAPSED_KEY, next ? '1' : '0'); } catch { /* quota */ }
      return next;
    });
  }

  function onDividerPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (isChatOnly) return;
    // The chat-shell starts at viewport x = rail width. The drag math
    // needs chat-shell-relative coords (chatWidth is measured inside
    // the shell), so anchor on the shell's bounding rect at pointerdown
    // — otherwise the divider lags the cursor by the rail width and
    // drags to the left feel broken (bug-20260518-010730-2vzjffqr).
    const shellEl = e.currentTarget.parentElement;
    const shellLeft = shellEl ? shellEl.getBoundingClientRect().left : 0;
    const startX = e.clientX;
    let moved = false;
    draggingRef.current = true;

    function relX(clientX: number) { return clientX - shellLeft; }

    function onMove(ev: PointerEvent) {
      if (!draggingRef.current) return;
      const x = ev.clientX;
      if (Math.abs(x - startX) > 3) {
        if (!moved) {
          moved = true;
          document.body.style.cursor = 'col-resize';
          document.body.style.userSelect = 'none';
        }
        const rx = relX(x);
        if (rx < COLLAPSE_THRESHOLD) {
          setChatWidth(CHAT_MIN);
        } else {
          setChatWidth(Math.max(CHAT_MIN, Math.min(CHAT_MAX, rx)));
        }
      }
    }
    function onUp(ev: PointerEvent) {
      draggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      if (!moved) {
        router.push('/');
        return;
      }
      if (relX(ev.clientX) < COLLAPSE_THRESHOLD) {
        router.push('/');
      } else {
        sessionStorage.setItem(STORAGE_KEY, String(chatWidth));
      }
    }
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  const splitStyle: React.CSSProperties = isChatOnly
    ? {}
    : { ['--chat-width' as 'width']: `${chatWidth}px` };

  // Block rendering until onboarding check completes — prevents flash of
  // normal UI before redirect on first install.
  if (!onboardCheckDone && !isOnboarding) {
    return null;
  }

  if (isOnboarding) {
    // iter-012 Pass #3 — render onboarding children directly, full-bleed.
    return <div className="onboarding-shell">{children}</div>;
  }


  return (
    <div className={clsx('app-shell-row', isChatOnly && 'chat-first-mode', railCollapsed && 'rail-collapsed')}>
      <aside className="left-rail" aria-label="Sidebar">
        <button
          type="button"
          className="rail-toggle"
          onClick={toggleRail}
          aria-label={railCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={railCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <Nav collapsed={railCollapsed} />
      </aside>

      <div className="main-col">
        <div
          className={clsx(
            'chat-shell',
            isChatOnly
              ? 'mode-chat-only'
              : chatCollapsed
              ? 'mode-chat-collapsed'
              : mainCollapsed
              ? 'mode-main-collapsed'
              : 'mode-split',
          )}
          style={splitStyle}
        >
          {isChatOnly ? (
            <ChatSurface />
          ) : chatCollapsed ? (
            <>
              {/* Chat collapsed: rail shows ▶ — "click right to bring chat
                * back" (bug-20260519-210400-cbrypn2l direction semantics). */}
              <button
                type="button"
                className="chat-expand-rail"
                onClick={toggleChat}
                aria-label="Expand chat"
                title="Expand chat"
              >
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
              <main className="main">
                <div className="main-inner">{children}</div>
              </main>
            </>
          ) : mainCollapsed ? (
            <>
              <ChatSurface />
              {/* Main collapsed: chat-surface fills, main becomes 44px rail
                * on the right. Rail shows ▶ — "click right to bring main
                * back" (bug-20260519-210400-cbrypn2l direction semantics).
                * chat-collapse-btn is hidden in this mode (see globals.css)
                * since only one chevron is meaningful here. */}
              <button
                type="button"
                className="main-expand-rail"
                onClick={toggleMain}
                aria-label="Expand content panel"
                title="Expand content panel"
              >
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
            </>
          ) : (
            <>
              <ChatSurface />
              {/* Stacked chevrons on divider (bug-20260519-210429-jae1tarl):
                * chat-collapse on top, main-collapse below.
                * Direction (bug-20260519-210400-cbrypn2l): both expanded
                * panels show ◀ ("click left to fold/hide me"); collapsed
                * states show ▶ ("click right to bring me back"). */}
              <div className="chevron-stack">
                <button
                  type="button"
                  className="chat-collapse-btn"
                  onClick={toggleChat}
                  aria-label="Collapse chat"
                  title="Collapse chat to icon"
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="main-collapse-btn"
                  onClick={toggleMain}
                  aria-label="Collapse content panel"
                  title="Collapse content panel"
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              </div>
              <div
                className="chat-shell-divider"
                role="separator"
                aria-orientation="vertical"
                aria-label="Drag to resize chat (drag far left to collapse)"
                onPointerDown={onDividerPointerDown}
              >
                <div className="chat-shell-divider-grip" />
              </div>
              <main className="main">
                <div className="main-inner">{children}</div>
              </main>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Root `/` — chat-only mode (full-screen chat). The AppShell detects this
 * path and hides the right panel; children render nothing.
 *
 * iter-007 redesign: user wanted chat as primary surface, right panel
 * appears only when navigating to /today, /inbound, /connections, etc.
 *
 * L-052 (2026-05-18): the client-side onboarding redirect previously lived
 * here. It now lives in `AppShell.tsx` so it guards every route, not just
 * `/`. This page is therefore inert again.
 */
export default function HomePage() {
  return null;
}

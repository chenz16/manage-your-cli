import { deskApi } from './desk-api';

// M-L-071 — every loader fetch was bare `fetch(deskApi(path), {cache:'no-store'})`
// with NO timeout/abort. On a flaky phone network where the desk ACCEPTs the TCP
// connection but never responds (captive portal / dead backend behind a live
// proxy), `fetch` never settles, so a surface stays pinned on its "加载中…"
// branch FOREVER — the error/重试 branch can never fire because no rejection ever
// occurs. fetchWithTimeout aborts after `ms` (default 8s); the abort REJECTS the
// promise so each surface's existing catch flips to its error state (Eng Rule #4
// no silent failure). AbortController + setTimeout (not AbortSignal.timeout) for
// broad WebView compatibility and explicit timer cleanup on settle.
export function fetchWithTimeout(path: string, ms = 8000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(deskApi(path), { cache: 'no-store', signal: ctrl.signal }).finally(
    () => clearTimeout(timer),
  );
}

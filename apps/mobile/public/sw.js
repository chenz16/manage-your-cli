// Holon mobile — minimal service worker (M-M004 Pass #5).
// Purpose: satisfy PWA install criteria + cache the app shell so the
// installed home-screen icon can boot offline to a "no connection" page.
// We deliberately keep this thin in V1: network-first for navigations,
// cache-first for hashed Next.js static assets. No background sync,
// no push, no API caching — the desk BFF is the source of truth.

// CACHE_VERSION includes the build SHA (injected via build script
// substitution at SW publish time). Each build gets a unique cache name so
// the SW's activate handler deletes the previous build's caches — without
// this, WKWebView persists cached /_next/static across .ipa installs and the
// new bundle never gets seen, leaving the phone running yesterday's code.
const CACHE_VERSION = 'holon-shell-a34881b';
// M-L-049 — the PWA start_url is `/chat/` (trailing-slash form chosen in
// M-L-047 → `/chat/index.html`). Pre-cache it AND keep `/` so the installed
// home-screen icon boots its real start page offline instead of a cache miss.
const SHELL_ASSETS = [
  '/',
  '/chat/',
  '/manifest.json',
  '/icon.svg',
  '/icon-192.png',
  '/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(SHELL_ASSETS)),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Never cache the BFF — owner state must be live.
  if (url.pathname.startsWith('/api/')) return;

  // Cache-first for hashed Next.js static assets.
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
            return res;
          }),
      ),
    );
    return;
  }

  // Network-first for navigations; fall back to the cached start page
  // (`/chat/`), then `/`, so the offline launch lands on the real shell.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() =>
        caches
          .match('/chat/')
          .then((r) => r || caches.match('/'))
          .then((r) => r || Response.error()),
      ),
    );
  }
});

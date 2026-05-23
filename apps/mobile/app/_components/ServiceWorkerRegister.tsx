'use client';

import { useEffect } from 'react';

// M-M004 Pass #5 — register /sw.js on first mount so PWA install criteria
// are met and the installed app boots offline to the cached shell.
// M-L-019 — Skip in dev. The SW caches /_next/static/ cache-first, but Next
// dev rebuilds chunks with new hashes on every HMR, so the SW served
// yesterday's chunks → "新旧来回切". In dev we actively unregister any
// prior SW + purge caches so users who already loaded the old SW recover.
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;
    if (window.location.protocol === 'file:') return;

    const isProd = process.env.NODE_ENV === 'production';
    if (!isProd) {
      void navigator.serviceWorker.getRegistrations().then((regs) => {
        regs.forEach((r) => void r.unregister());
      });
      if (typeof caches !== 'undefined') {
        void caches.keys().then((keys) => {
          keys.forEach((k) => void caches.delete(k));
        });
      }
      return;
    }

    navigator.serviceWorker.register('/sw.js').catch((err) => {
      // No silent failure (Engineering Rule #4): surface to console so
      // Lighthouse / DevTools shows the registration error.
      console.error('[holon] service worker registration failed', err);
    });
  }, []);
  return null;
}

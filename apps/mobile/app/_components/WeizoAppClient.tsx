'use client';

// WeizoAppClient — client-only wrapper around the WeizoApp SPA.
//
// Why this exists: with `output: 'export'` (Capacitor static export) Next.js
// prerenders every page to HTML at build time. WeizoApp + @assistant-ui + the
// Capacitor TTS plugin touch `window` / browser-only APIs at module-evaluation
// time, which crashes the export prerender ("window is not defined"). Loading
// WeizoApp via `next/dynamic` with `{ ssr: false }` defers its evaluation to
// the browser, so the export emits a thin shell that hydrates client-side.
//
// `ssr: false` requires the importer to be a Client Component (Next 15), hence
// the 'use client' directive above.

import dynamic from 'next/dynamic';

const WeizoApp = dynamic(
  () => import('./WeizoApp').then((m) => m.WeizoApp),
  { ssr: false },
);

export default function WeizoAppClient() {
  return <WeizoApp />;
}

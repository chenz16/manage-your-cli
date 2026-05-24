'use client';

// M-L-062 — Boot component rendered inside RootLayout. On mount:
//   1. Installs the fetch proxy (rewrites same-origin /api/v1/* to the paired desktop).
//   2. If no pairing is stored, redirects to /pairing so the user can connect.
// Once paired, every existing route's data fetches flow through the proxy unchanged.

import { useEffect } from 'react';
import {
  installMobileApiFetchProxy,
  readDesktopConnection,
} from '../_lib/mobile-runtime';

export function MobileBootstrap() {
  useEffect(() => {
    // Install proxy first (no-op if not paired yet).
    installMobileApiFetchProxy();

    // Guard: if no connection stored and we're not already on /pairing, go there.
    const connection = readDesktopConnection();
    if (!connection && !window.location.pathname.startsWith('/pairing')) {
      window.location.href = '/pairing';
    }

    // Listen for successful pairing (fired by PairingForm) to re-install the
    // proxy and return to the app without a full reload loop.
    function onPaired() {
      installMobileApiFetchProxy();
    }
    window.addEventListener('holon:mobile-paired', onPaired);
    return () => window.removeEventListener('holon:mobile-paired', onPaired);
  }, []);

  return null;
}

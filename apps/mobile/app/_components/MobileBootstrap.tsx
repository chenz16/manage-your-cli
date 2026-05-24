'use client';

// M-L-062 — Boot component rendered inside RootLayout. On mount:
//   1. Installs the fetch proxy (rewrites same-origin /api/v1/* to the paired desktop).
//   2. No longer force-redirects to /pairing when unpaired; pairing is on-demand
//      (a non-blocking banner in the app shell prompts the user instead).
// Once paired, every existing route's data fetches flow through the proxy unchanged.

import { useEffect } from 'react';
import {
  installMobileApiFetchProxy,
} from '../_lib/mobile-runtime';

export function MobileBootstrap() {
  useEffect(() => {
    // Install proxy first (no-op if not paired yet).
    installMobileApiFetchProxy();

    // Listen for successful pairing (fired by PairingForm) to re-install the
    // proxy without a full reload loop.
    function onPaired() {
      installMobileApiFetchProxy();
    }
    window.addEventListener('holon:mobile-paired', onPaired);
    return () => window.removeEventListener('holon:mobile-paired', onPaired);
  }, []);

  return null;
}

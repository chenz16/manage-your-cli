'use client';

import { useEffect } from 'react';

// Hide the iOS WKWebView keyboard accessory bar (the ◀ ▶ Done toolbar that
// iOS adds above the keyboard for web form fields). The owner finds it
// useless for a single-textarea chat composer (ChatGPT's native input shows
// no such bar). Native-only; a no-op on web/Android. Dynamic import so the
// Capacitor plugin never runs during SSR / static export.
export function NativeKeyboardInit() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let cancelled = false;
    void (async () => {
      try {
        const { Capacitor } = await import('@capacitor/core');
        if (!Capacitor.isNativePlatform()) return;
        const { Keyboard } = await import('@capacitor/keyboard');
        if (cancelled) return;
        // iOS only: drop the accessory bar. Wrapped — Android throws "not
        // implemented" which we ignore rather than swallow silently elsewhere.
        await Keyboard.setAccessoryBarVisible({ isVisible: false }).catch(() => undefined);
      } catch (err) {
        console.error('[holon] keyboard accessory-bar init failed', err);
      }
    })();
    return () => { cancelled = true; };
  }, []);
  return null;
}

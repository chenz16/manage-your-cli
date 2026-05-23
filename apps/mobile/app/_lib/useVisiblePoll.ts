'use client';

// M-L-065 — shared Page-Visibility-gated polling hook. Runs `load` once on
// mount, then on a `ms` interval, but PAUSES the interval whenever the tab is
// hidden (phone locked / app backgrounded) and re-arms + loads immediately on
// becoming visible again — so polling never wakes the radio off-screen.
// Dedupes the gating logic that lived inline in TodayView (M-L-064) /
// TodayStrip (M-L-063); used by /staff, /staff/detail, /inbound, /me.

import { useEffect } from 'react';

export function useVisiblePoll(load: () => void, ms: number): void {
  useEffect(() => {
    let h: ReturnType<typeof setInterval> | null = null;

    const stop = () => {
      if (h !== null) { clearInterval(h); h = null; }
    };
    const start = () => {
      if (h === null) h = setInterval(() => load(), ms);
    };
    const onVisibility = () => {
      if (typeof document !== 'undefined' && document.hidden) {
        stop();
      } else {
        load();
        start();
      }
    };

    load();
    if (typeof document === 'undefined' || !document.hidden) start();
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility);
    }
    return () => {
      stop();
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility);
      }
    };
  }, [load, ms]);
}

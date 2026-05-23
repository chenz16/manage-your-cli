'use client';

// M-L-Pass#3 — pull-to-refresh wrapper for mobile work lists.
// 2026 mobile work-app pattern (Linear/Notion): user drags down at the top
// of a scrollable list, sees a progress spinner build, releases past the
// trigger threshold to fire onRefresh, then the indicator snaps back.
//
// Only the touch path is wired (mobile-first; desktop devs can use the
// existing Retry button). When the page isn't actually scrolled to the top
// the pull is ignored so vertical scroll-up gestures still work normally.

import { useCallback, useRef, useState, type ReactNode } from 'react';

const TRIGGER_PX = 64; // distance the user must drag past to fire refresh
const MAX_PULL_PX = 96; // visual cap so the indicator never runs away
const DAMPING = 0.55; // rubber-band — user finger moves faster than indicator

type Props = {
  onRefresh: () => Promise<void> | void;
  children: ReactNode;
};

export function PullToRefresh({ onRefresh, children }: Props) {
  const [pullY, setPullY] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef<number | null>(null);
  const armed = useRef(false);

  const onTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (refreshing) return;
    // Only arm if the page is at the very top — otherwise let the browser
    // handle the scroll. window.scrollY is what matters because the mobile
    // shell scrolls the document body, not this wrapper.
    if (window.scrollY > 0) {
      armed.current = false;
      return;
    }
    armed.current = true;
    startY.current = e.touches[0]?.clientY ?? null;
  }, [refreshing]);

  const onTouchMove = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (!armed.current || refreshing || startY.current === null) return;
    const dy = (e.touches[0]?.clientY ?? startY.current) - startY.current;
    if (dy <= 0) {
      setPullY(0);
      return;
    }
    const damped = Math.min(MAX_PULL_PX, dy * DAMPING);
    setPullY(damped);
  }, [refreshing]);

  const onTouchEnd = useCallback(async () => {
    if (!armed.current) return;
    armed.current = false;
    const shouldFire = pullY >= TRIGGER_PX;
    startY.current = null;
    if (!shouldFire) {
      setPullY(0);
      return;
    }
    setRefreshing(true);
    setPullY(TRIGGER_PX);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
      setPullY(0);
    }
  }, [onRefresh, pullY]);

  const progress = Math.min(1, pullY / TRIGGER_PX);

  return (
    <div
      className="ptr-root"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
    >
      <div
        className="ptr-indicator"
        style={{ height: pullY, opacity: progress }}
        aria-hidden={!refreshing && pullY === 0}
      >
        <div
          className={`ptr-spinner${refreshing ? ' ptr-spinner-spin' : ''}`}
          style={{ transform: refreshing ? undefined : `rotate(${progress * 270}deg)` }}
        />
      </div>
      <div
        className="ptr-content"
        style={{
          transform: pullY ? `translateY(${pullY}px)` : undefined,
          transition: armed.current ? 'none' : 'transform 220ms ease',
        }}
      >
        {children}
      </div>
    </div>
  );
}

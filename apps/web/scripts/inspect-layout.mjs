#!/usr/bin/env node
/**
 * Dump computed geometry of the chat-shell elements so the coordinator
 * can see where the unwanted empty space is coming from.
 */

import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://localhost:3000/today', { waitUntil: 'networkidle' });
await page.waitForTimeout(400);

const dims = await page.evaluate(() => {
  const sels = [
    'html', 'body',
    '.chat-shell', '.chat-shell > .topbar', '.chat-shell > .chat-surface',
    '.chat-shell > .chat-shell-panel', '.chat-shell .nav', '.chat-shell .main',
    '.chat-shell .main-inner', '.chat-shell .main-inner > .page-strip',
    '.chat-shell .main-inner > .hero-stats',
  ];
  return sels.map((s) => {
    const el = document.querySelector(s);
    if (!el) return { sel: s, found: false };
    const r = el.getBoundingClientRect();
    const cs = window.getComputedStyle(el);
    return {
      sel: s,
      found: true,
      x: Math.round(r.x),
      y: Math.round(r.y),
      w: Math.round(r.width),
      h: Math.round(r.height),
      display: cs.display,
      maxWidth: cs.maxWidth,
      marginLeft: cs.marginLeft,
      marginRight: cs.marginRight,
      paddingLeft: cs.paddingLeft,
      paddingRight: cs.paddingRight,
    };
  });
});

console.log(JSON.stringify(dims, null, 2));
await browser.close();

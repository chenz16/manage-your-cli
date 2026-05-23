#!/usr/bin/env node
/**
 * Mobile screenshots (375x812 — iPhone 12-15 viewport).
 * Output: /tmp/holon-screenshots/mobile-{slug}.png
 *
 * Usage:
 *   node apps/web/scripts/screenshot-mobile.mjs
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const OUT = '/tmp/holon-screenshots';
mkdirSync(OUT, { recursive: true });

const ROUTES = [
  { slug: 'home-chat-only', path: '/' },
  { slug: 'today',       path: '/today' },
  { slug: 'inbound',     path: '/inbound' },
  { slug: 'deliverables', path: '/deliverables' },
  { slug: 'members',     path: '/members' },
  { slug: 'connections', path: '/connections' },
  { slug: 'me',          path: '/me' },
];

const VIEWPORT = { width: 375, height: 812 };

async function run() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();

  for (const r of ROUTES) {
    const url = `http://localhost:3000${r.path}`;
    console.log(`→ mobile-${r.slug.padEnd(20)} ${url}`);
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    const out = join(OUT, `mobile-${r.slug}.png`);
    await page.screenshot({ path: out, fullPage: false });
    console.log(`  saved ${out}`);
  }

  await browser.close();
  console.log(`\ndone — ${ROUTES.length} mobile screenshots in ${OUT}`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

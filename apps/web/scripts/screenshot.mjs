#!/usr/bin/env node
/**
 * Visual review: take screenshots of every React route so the
 * coordinator can `Read` them and critique the design.
 *
 * Output: /tmp/holon-screenshots/{route-slug}.png
 *
 * Usage: node apps/web/scripts/screenshot.mjs
 *
 * Prereq: `pnpm -F web dev` running on :3000.
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
  { slug: 'meetings',    path: '/meetings' },
  { slug: 'members',     path: '/members' },
  { slug: 'connections', path: '/connections' },
  { slug: 'me',          path: '/me' },
];

const VIEWPORT_DESKTOP = { width: 1440, height: 900 };

async function run() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: VIEWPORT_DESKTOP });
  const page = await ctx.newPage();

  for (const r of ROUTES) {
    const url = `http://localhost:3000${r.path}`;
    console.log(`→ ${r.slug.padEnd(22)} ${url}`);
    await page.goto(url, { waitUntil: 'networkidle' });
    // Wait for chat threads fetch to settle so tabs render.
    await page.waitForTimeout(400);

    if (r.action === 'click-first-mission') {
      // Click the first mission row to trigger inline detail.
      const row = page.locator('.mission-row').first();
      if (await row.count() > 0) {
        await row.click();
        await page.waitForTimeout(500);
      }
    }
    if (r.action === 'click-first-connection') {
      const row = page.locator('.conn-row').first();
      if (await row.count() > 0) {
        await row.click();
        await page.waitForTimeout(700); // drawer fetches detail
      }
    }

    const out = join(OUT, `${r.slug}.png`);
    await page.screenshot({ path: out, fullPage: false });
    console.log(`  saved ${out}`);
  }

  await browser.close();
  console.log(`\ndone — ${ROUTES.length} screenshots in ${OUT}`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

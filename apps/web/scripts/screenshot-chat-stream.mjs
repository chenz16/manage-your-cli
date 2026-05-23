#!/usr/bin/env node
/**
 * Visual smoke for iter-007 step 3: open /, type a message into the
 * Holon chat composer, wait for the streaming reply to land, screenshot.
 *
 * Usage: node apps/web/scripts/screenshot-chat-stream.mjs
 * Prereq: pnpm -F web dev running on :3000.
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const OUT = '/tmp/holon-screenshots';
mkdirSync(OUT, { recursive: true });

const PROMPT = 'Who is on my team? List names + roles.';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

await page.goto('http://localhost:3000/', { waitUntil: 'networkidle' });
await page.waitForTimeout(400);

// Type into the composer + submit.
const input = page.locator('.chat-input');
await input.fill(PROMPT);
await input.press('Enter');

// Wait for assistant text to appear and grow.
const reply = page.locator('.chatmsg-assistant').last();
await reply.waitFor({ state: 'visible', timeout: 60_000 });
// Poll until text has settled (no growth for 2s AND length > 20 chars).
let last = '';
let stableSince = 0;
for (let i = 0; i < 80; i++) {
  await page.waitForTimeout(700);
  const text = (await reply.textContent()) ?? '';
  if (text.length > 20 && text === last) {
    stableSince += 1;
    if (stableSince >= 3) break;
  } else {
    stableSince = 0;
  }
  last = text;
}

const out = join(OUT, 'chat-stream-smoke.png');
await page.screenshot({ path: out, fullPage: false });
console.log(`saved ${out}\nreply text:\n${last}`);

await browser.close();

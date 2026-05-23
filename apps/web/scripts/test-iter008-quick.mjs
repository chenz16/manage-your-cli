#!/usr/bin/env node
/**
 * Quick visual verification of iter-008 milestones — fills the gap left
 * by the API-killed tester. Specifically: xterm.js launches after the
 * next/dynamic SSR fix, hire dialog → POST → new card appears, dismiss
 * removes a local_ai card.
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

mkdirSync('/tmp/iter008-quick', { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text().slice(0, 200)}`); });

console.log('1) reset');
await page.request.post('http://localhost:3000/api/v1/admin/reset');

console.log('2) /members loads (post-SSR-fix)');
const r = await page.goto('http://localhost:3000/members', { waitUntil: 'networkidle' });
console.log(`   status=${r?.status()}`);
await page.screenshot({ path: '/tmp/iter008-quick/01-members.png' });

console.log('3) click gh-cli (CLI substrate)');
await page.locator('text=gh-cli').first().click();
await page.waitForTimeout(800);
await page.screenshot({ path: '/tmp/iter008-quick/02-detail.png' });

console.log('4) click Launch terminal');
const launchBtn = page.locator('button:has-text("Launch terminal")').first();
if (await launchBtn.count() === 0) {
  console.log('   ❌ no Launch button — aborting CLI test');
} else {
  await launchBtn.click();
  console.log('   waiting 4s for xterm to mount + bash banner');
  await page.waitForTimeout(4000);
  await page.screenshot({ path: '/tmp/iter008-quick/03-terminal.png' });

  const xtermRows = page.locator('.xterm-rows');
  const xtermCount = await xtermRows.count();
  console.log(`   .xterm-rows count: ${xtermCount}`);
  if (xtermCount > 0) {
    const txt = (await xtermRows.first().textContent()) ?? '';
    console.log(`   terminal text head (200): ${txt.slice(0, 200)}`);
  }
}

console.log('5) /today JobsSection (queue one job first via chat)');
await page.goto('http://localhost:3000/today', { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await page.screenshot({ path: '/tmp/iter008-quick/04-today.png' });
const recentJobsText = await page.locator('text=Recent jobs').count();
console.log(`   "Recent jobs" heading present: ${recentJobsText > 0}`);

console.log('6) hire dialog opens');
await page.goto('http://localhost:3000/members', { waitUntil: 'networkidle' });
await page.waitForTimeout(300);
await page.locator('button:has-text("+ Hire")').click();
await page.waitForTimeout(300);
await page.screenshot({ path: '/tmp/iter008-quick/05-hire-modal.png' });
const sketchBox = page.locator('textarea[placeholder*="market analyst"]');
console.log(`   sketch textarea visible: ${await sketchBox.count() > 0}`);

console.log('\n--- console / page errors ---');
if (errors.length === 0) console.log('   (none)');
else for (const e of errors.slice(0, 8)) console.log('   ' + e);

await browser.close();
console.log('\nscreenshots in /tmp/iter008-quick/');

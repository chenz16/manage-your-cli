#!/usr/bin/env node
/**
 * Smoke: /me inline-edit actually saves.
 *   1. Reset to clean baseline.
 *   2. Open /me, click "Owner name" field, type a value, blur.
 *   3. Check that the rendered field shows the new value (not the empty placeholder).
 *   4. Hit the GET endpoint to verify the server persisted it.
 *   5. Capture network calls for the PATCH to diagnose any failure.
 */

import { chromium } from 'playwright';

const TEST_NAME = `TestUser_${Date.now().toString(36)}`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

// Capture network calls to /api/v1/me
const meCalls = [];
page.on('response', async (resp) => {
  const url = resp.url();
  if (url.endsWith('/api/v1/me')) {
    const method = resp.request().method();
    let bodyText = '';
    try { bodyText = (await resp.text()).slice(0, 300); } catch {}
    meCalls.push({ method, status: resp.status(), bodyHead: bodyText });
  }
});
page.on('console', (msg) => {
  const t = msg.text();
  if (/error|fail|patch|me\b/i.test(t)) console.log(`  [console.${msg.type()}] ${t.slice(0, 200)}`);
});

console.log('1) reset to clean baseline');
const resetResp = await page.request.post('http://localhost:3000/api/v1/admin/reset');
console.log(`   reset → ${resetResp.status()}`);

console.log('2) open /me');
await page.goto('http://localhost:3000/me', { waitUntil: 'networkidle' });
await page.waitForTimeout(500);

console.log('3) find the "Owner name" InlineField + click into it');
// Each InlineField renders a labeled div above the value/input.
// The value div (clickable) is the sibling of the label div with "Owner name".
const ownerNameLabel = page.locator('text=Owner name').first();
await ownerNameLabel.waitFor({ state: 'visible', timeout: 10000 });
// The clickable value is the next sibling-ish div with dashed border bottom.
// Easiest: find a div whose textContent is the placeholder or the value, near the label.
const ownerNameField = page.locator('text=Owner name').locator('..').locator('div').last();
await ownerNameField.click();
await page.waitForTimeout(200);

console.log(`4) type new value: ${TEST_NAME}`);
// Find the now-active input (text type, just appeared)
const input = page.locator('input[type=""], input:not([type]), input[type="text"]').last();
await input.fill(TEST_NAME);

console.log('5) blur the input (Tab)');
await input.press('Tab');
await page.waitForTimeout(1500); // let PATCH round-trip + state update

console.log('6) inspect /me network calls');
for (const c of meCalls) {
  console.log(`   ${c.method} /api/v1/me → ${c.status}  body: ${c.bodyHead}`);
}

console.log('7) check what the rendered field shows now');
const visibleText = await ownerNameField.textContent();
console.log(`   rendered: ${JSON.stringify(visibleText)}`);

console.log('8) GET /api/v1/me to check server state');
const getResp = await page.request.get('http://localhost:3000/api/v1/me');
const owner = await getResp.json();
console.log(`   server owner_name: ${JSON.stringify(owner.owner_name)}`);

const persisted = owner.owner_name === TEST_NAME;
console.log(`\n${persisted ? '✅ PASS' : '❌ FAIL'} — owner_name persisted on server: ${persisted}`);
if (!persisted) {
  await page.screenshot({ path: '/tmp/holon-screenshots/me-edit-fail.png' });
  console.log('   screenshot: /tmp/holon-screenshots/me-edit-fail.png');
}

await browser.close();
process.exit(persisted ? 0 : 1);

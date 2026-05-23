#!/usr/bin/env node
/**
 * Smoke for iter-007 chat-persistence fix: verify the chat thread
 * survives nav-tab clicks (the bug: every route change was creating a
 * new adapter, which reset the assistant-ui thread).
 *
 * 1. Open /, send a recognizable message, wait for the reply.
 * 2. Click the Today nav tab → navigates to /today (split mode).
 * 3. Assert both the user message AND the assistant reply are still
 *    visible in the left chat panel.
 * 4. Click the Members nav tab → navigates to /members.
 * 5. Re-assert chat content survived.
 */

import { chromium } from 'playwright';

const TAG = 'PERSIST_PROBE_42';
const PROMPT = `Reply with exactly: ${TAG} and nothing else.`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

console.log('1) open /');
await page.goto('http://localhost:3000/', { waitUntil: 'networkidle' });
await page.waitForTimeout(400);

console.log('2) send probe message');
const input = page.locator('.chat-input');
await input.fill(PROMPT);
await input.press('Enter');

console.log('3) wait for assistant reply containing tag');
const reply = page.locator('.chatmsg-assistant').last();
await reply.waitFor({ state: 'visible', timeout: 60_000 });
let lastText = '';
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(700);
  const t = (await reply.textContent()) ?? '';
  if (t.includes(TAG) && t === lastText) break;
  lastText = t;
}
if (!lastText.includes(TAG)) {
  await page.screenshot({ path: '/tmp/holon-screenshots/persist-step3-fail.png' });
  const inner = await page.locator('.chat-surface').innerHTML().catch(() => '(missing)');
  console.error(`❌ assistant never said the tag. got: ${JSON.stringify(lastText)}`);
  console.error(`   screenshot: /tmp/holon-screenshots/persist-step3-fail.png`);
  console.error(`   .chat-surface inner (first 800):\n${inner.slice(0, 800)}`);
  process.exit(1);
}
console.log(`   ✓ reply: "${lastText}"`);

async function assertSurvived(label) {
  const userMsgs = await page.locator('.chatmsg-user').allTextContents();
  const asstMsgs = await page.locator('.chatmsg-assistant').allTextContents();
  const userOk = userMsgs.some((t) => t.includes(TAG));
  const asstOk = asstMsgs.some((t) => t.includes(TAG));
  console.log(`   user=${userMsgs.length} (probe present=${userOk}) · assistant=${asstMsgs.length} (probe present=${asstOk})`);
  if (!userOk || !asstOk) {
    // Dump DOM debug snapshot before failing.
    const slug = label.replace(/\//g, '-') || 'root';
    const path = `/tmp/holon-screenshots/persist-fail${slug}.png`;
    await page.screenshot({ path });
    const surfaceHtml = await page.locator('.chat-surface').innerHTML().catch(() => '(no .chat-surface)');
    console.error(`❌ chat got wiped after ${label} nav`);
    console.error(`   screenshot: ${path}`);
    console.error(`   .chat-surface inner (first 600):\n${surfaceHtml.slice(0, 600)}`);
    process.exit(2);
  }
}

for (const target of ['/today', '/members', '/deliverables']) {
  console.log(`4) navigate to ${target}`);
  // Click the nav link rather than goto() so it's a soft client-side nav
  // (which is what the user reported triggers the bug).
  const link = page.locator(`a[href="${target}"]`).first();
  await link.click();
  await page.waitForURL(`**${target}`, { timeout: 20000 });
  await page.waitForTimeout(800); // let any rerender settle
  await assertSurvived(target);
}

// Hard refresh (F5 / browser reload). Tests sessionStorage rehydration.
console.log('5) hard reload page');
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1500); // let the rehydrated thread settle
await assertSurvived('reload');

console.log('\n✅ PASS — chat content survives nav (3 routes) AND hard refresh');
await browser.close();

#!/usr/bin/env node
/**
 * Phase 1 UX audit — captures screenshots + tries obvious user actions on
 * each route. Output: /home/chenz/project/holon-engineering/tmp/qa-20260517-v1/<route>.png
 *
 * Findings JSON: /home/chenz/project/holon-engineering/tmp/qa-20260517-v1/findings.json
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = '/home/chenz/project/holon-engineering/tmp/qa-20260517-v1';
mkdirSync(OUT, { recursive: true });

const findings = {};

function log(slug, key, val) {
  findings[slug] = findings[slug] || {};
  findings[slug][key] = val;
  console.log(`  [${slug}] ${key}: ${typeof val === 'string' ? val.slice(0, 120) : JSON.stringify(val).slice(0, 120)}`);
}

async function shot(page, slug, suffix = '') {
  const out = join(OUT, `${slug}${suffix}.png`);
  try {
    await page.screenshot({ path: out, fullPage: false });
    console.log(`  saved ${out}`);
  } catch (e) {
    console.log(`  shot failed ${out}: ${e.message}`);
  }
}

async function run() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (err) => log('_pageerrors', String(page.url()), err.message));

  // --- /  (home / chat) ---
  console.log('\n→ /');
  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await shot(page, 'home');
  // Try sending a chat message
  try {
    const input = page.locator('.chat-input').first();
    const hasInput = (await input.count()) > 0;
    log('home', 'has_chat_input', hasInput);
    if (hasInput) {
      await input.click();
      await input.fill('show me my deliverables');
      await shot(page, 'home', '-typed');
      const sendBtn = page.locator('.chat-send').first();
      if (await sendBtn.count() > 0) {
        await sendBtn.click();
        await page.waitForTimeout(2500);
        await shot(page, 'home', '-sent');
        // Detect if a new user message appeared
        const userMsgs = await page.locator('.chatmsg-user').count();
        log('home', 'user_messages_after_send', userMsgs);
        const asstMsgs = await page.locator('.chatmsg-assistant').count();
        log('home', 'assistant_messages_after_send', asstMsgs);
      } else {
        log('home', 'no_send_button', true);
      }
    }
  } catch (e) {
    log('home', 'error', e.message);
  }

  // --- /inbound ---
  console.log('\n→ /inbound');
  await page.goto('http://localhost:3000/inbound', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await shot(page, 'inbound');
  log('inbound', 'mission_rows', await page.locator('.mission-row').count());
  log('inbound', 'h1_text', (await page.locator('h1').first().textContent().catch(() => '')) || '');

  // --- /deliverables ---
  console.log('\n→ /deliverables');
  await page.goto('http://localhost:3000/deliverables', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await shot(page, 'deliverables');
  log('deliverables', 'h1_text', (await page.locator('h1').first().textContent().catch(() => '')) || '');
  log('deliverables', 'visible_text_sample', (await page.locator('main, body').first().innerText().catch(() => '')).slice(0, 300));

  // --- /members ---
  console.log('\n→ /members');
  await page.goto('http://localhost:3000/members', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await shot(page, 'members');
  log('members', 'h1_text', (await page.locator('h1').first().textContent().catch(() => '')) || '');
  log('members', 'staff_cards', await page.locator('[class*="staff"], [class*="member"]').count());
  // Look for hire / + new CTA
  const hireBtnCount = await page.locator('text=/hire|招|\\+ ?new|create/i').count();
  log('members', 'hire_cta_count', hireBtnCount);
  log('members', 'visible_text_sample', (await page.locator('main, body').first().innerText().catch(() => '')).slice(0, 400));

  // --- /skills ---
  console.log('\n→ /skills');
  await page.goto('http://localhost:3000/skills', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await shot(page, 'skills');
  // Click + New
  try {
    const newBtn = page.locator('button:has-text("+ New")').first();
    log('skills', 'has_new_btn', (await newBtn.count()) > 0);
    if (await newBtn.count() > 0) {
      await newBtn.click();
      await page.waitForTimeout(500);
      await shot(page, 'skills', '-modal');
      // Describe tab is default per code
      const textarea = page.locator('[role="dialog"] textarea').first();
      if (await textarea.count() > 0) {
        await textarea.fill('skill that takes a meeting transcript and produces a 1-page exec summary');
        await shot(page, 'skills', '-modal-typed');
        // Find generate button
        const genBtn = page.locator('button:has-text("Generate")').first();
        if (await genBtn.count() > 0) {
          await genBtn.click();
          // Long wait for LLM
          await page.waitForTimeout(25000);
          await shot(page, 'skills', '-modal-generated');
          // Modal may auto-close on success; check if a new card appeared
          const yoursCount = await page.locator('text=Yours').count();
          log('skills', 'yours_after_gen', yoursCount);
        } else {
          log('skills', 'no_generate_btn', true);
        }
      }
    }
    // Try to find a × delete on the newly-added card and click it
    await page.waitForTimeout(500);
    const delBtns = page.locator('button:has-text("×")');
    const delCount = await delBtns.count();
    log('skills', 'delete_btn_count', delCount);
  } catch (e) {
    log('skills', 'error', e.message);
  }

  // --- /references ---
  console.log('\n→ /references');
  await page.goto('http://localhost:3000/references', { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await shot(page, 'references');
  try {
    const newBtn = page.locator('button:has-text("+ New")').first();
    log('references', 'has_new_btn', (await newBtn.count()) > 0);
    if (await newBtn.count() > 0) {
      await newBtn.click();
      await page.waitForTimeout(400);
      await shot(page, 'references', '-modal');
      const textarea = page.locator('[role="dialog"] textarea').first();
      if (await textarea.count() > 0) {
        await textarea.fill('WCAG 2.1 — older browser compatibility');
        const genBtn = page.locator('button:has-text("Generate")').first();
        if (await genBtn.count() > 0) {
          await genBtn.click();
          await page.waitForTimeout(25000);
          await shot(page, 'references', '-modal-generated');
        }
      }
    }
  } catch (e) {
    log('references', 'error', e.message);
  }

  // --- /templates ---
  console.log('\n→ /templates');
  await page.goto('http://localhost:3000/templates', { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await shot(page, 'templates');
  try {
    const newBtn = page.locator('button:has-text("+ New")').first();
    log('templates', 'has_new_btn', (await newBtn.count()) > 0);
    if (await newBtn.count() > 0) {
      await newBtn.click();
      await page.waitForTimeout(400);
      await shot(page, 'templates', '-modal');
      const textarea = page.locator('[role="dialog"] textarea').first();
      if (await textarea.count() > 0) {
        await textarea.fill('Quarterly OKR check-in template');
        const genBtn = page.locator('button:has-text("Generate")').first();
        if (await genBtn.count() > 0) {
          await genBtn.click();
          await page.waitForTimeout(25000);
          await shot(page, 'templates', '-modal-generated');
        }
      }
    }
  } catch (e) {
    log('templates', 'error', e.message);
  }

  // --- /me ---
  console.log('\n→ /me');
  await page.goto('http://localhost:3000/me', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await shot(page, 'me');
  // Capture persona picker presence + current persona text
  log('me', 'h1_text', (await page.locator('h1').first().textContent().catch(() => '')) || '');
  const personaTextarea = page.locator('textarea').first();
  const beforeText = (await personaTextarea.textContent().catch(() => '')) || (await personaTextarea.inputValue().catch(() => ''));
  log('me', 'before_persona_text_sample', (beforeText || '').slice(0, 200));
  try {
    // PersonaPicker has a button to open
    const picker = page.locator('button:has-text("Persona"), button:has-text("persona"), .persona-picker button').first();
    if (await picker.count() > 0) {
      await picker.click();
      await page.waitForTimeout(400);
      await shot(page, 'me', '-picker-open');
      // pick a persona option that isn't current — find any persona button with "Engineering" or "Founder"
      const opt = page.locator('button:has-text("Engineering"), button:has-text("Founder"), button:has-text("Finance"), button:has-text("Product Manager")').first();
      if (await opt.count() > 0) {
        await opt.click();
        await page.waitForTimeout(400);
        await shot(page, 'me', '-confirm');
        // Confirm
        const applyBtn = page.locator('button:has-text("Apply"), button:has-text("apply")').first();
        if (await applyBtn.count() > 0) {
          await applyBtn.click();
          await page.waitForTimeout(2500);
          await shot(page, 'me', '-applied');
        }
      } else {
        log('me', 'no_persona_option', true);
      }
    } else {
      log('me', 'no_persona_picker', true);
    }
  } catch (e) {
    log('me', 'error', e.message);
  }

  // --- Mobile viewport ---
  console.log('\n→ mobile pass 390x844');
  await ctx.close();
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const mpage = await mctx.newPage();
  for (const route of ['', 'inbound', 'deliverables', 'members', 'skills', 'references', 'templates', 'me']) {
    const slug = route || 'home';
    await mpage.goto(`http://localhost:3000/${route}`, { waitUntil: 'networkidle' });
    await mpage.waitForTimeout(500);
    await shot(mpage, `mobile-${slug}`);
  }

  await browser.close();

  writeFileSync(join(OUT, 'findings.json'), JSON.stringify(findings, null, 2));
  console.log(`\nDONE. findings → ${join(OUT, 'findings.json')}`);
}

run().catch((err) => {
  console.error('AUDIT FAILED:', err);
  process.exit(1);
});

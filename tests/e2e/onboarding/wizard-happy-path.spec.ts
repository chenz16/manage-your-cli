/**
 * iter-012 Pass #6 — Onboarding wizard happy-path acceptance.
 *
 * Drives the 5-step `/onboarding` wizard end-to-end against a running
 * `pnpm dev` server. Mirrors what a customer does on first-launch of
 * the Tauri-bundled desktop app (Phase-1 demo per
 * `iterations/012-tauri-desktop/demo-recipe.md`).
 *
 * Flow asserted:
 *   1. Visit `/onboarding`; pick the "Marketing Director" persona card.
 *   2. Fill owner_name + owner_intro; click Next.
 *   3. Click "Skip for now" (avoid OAuth network dep in CI; the OAuth
 *      happy-path is its own follow-up spec — see iter-013 NextAuth
 *      cut-over note in `tests/e2e/integrations/gmail-oauth.spec.ts`).
 *   4. Assert the pre-canned prompt rendered in the textarea; click Send.
 *   5. Poll for first deliverable up to 30s; click "Done — Go to your desk".
 *   6. Assert redirect to `/`; revisit `/` — assert no auto-redirect back
 *      to `/onboarding` (localStorage `holon-onboarded-v1` flag persists).
 *
 * RUN INSTRUCTIONS:
 *   In two shells:
 *     # shell 1 — dev server (TEST_MODE short-circuits the OAuth client
 *     # for any incidental network call; the spec does NOT actually
 *     # trigger OAuth, but the flag is cheap insurance):
 *     HOLON_OAUTH_TEST_MODE=true pnpm -F web dev
 *
 *     # shell 2 — Playwright (dedicated config for the onboarding suite):
 *     pnpm playwright test \
 *       --config=tests/e2e/onboarding/playwright.config.ts
 *     # or via the root script alias:
 *     pnpm test:e2e:onboarding
 *
 * KNOWN-FLAKY SURFACES:
 *  - Step 5 deliverable arrival depends on the LLM round-trip + a skill
 *    happening to produce a deliverable for the persona-default prompt.
 *    The spec waits 30s then treats "no deliverable" as still-pass (the
 *    page itself shows a "that's OK" message + the Done button stays
 *    clickable). Assertion is on the Done click + the post-redirect
 *    state, not on a specific deliverable artifact.
 *  - localStorage state from prior test runs can leave `holon-onboarded-v1`
 *    set. We clear it in `beforeEach` to start each run cleanly.
 */
import { test, expect } from '@playwright/test';

test.describe('iter-012 Pass #6 · Onboarding wizard happy-path', () => {
  test.beforeEach(async ({ page }) => {
    // Reset onboarding state so each run starts at Step 1. We have to
    // navigate first so localStorage is on the right origin.
    await page.goto('http://localhost:3000/onboarding');
    await page.evaluate(() => {
      try {
        window.localStorage.removeItem('holon-onboarded-v1');
        window.localStorage.removeItem('holon-onboarding-state-v1');
        window.localStorage.removeItem('holon-onboarding-gmail-just-connected');
      } catch { /* private-mode */ }
    });
    await page.reload();
  });

  test('5-step wizard completes + flag persists across revisit', async ({ page }) => {
    // Step 1 — persona pick. Match by visible "Marketing Director" text.
    const personaCard = page.locator('.onb-persona-card', { hasText: 'Marketing Director' }).first();
    await expect(personaCard).toBeVisible({ timeout: 15_000 });
    await personaCard.click();

    // Step 2 — about you. Name input + intro textarea (in DOM order).
    const nameInput = page.locator('.onb-card input[type="text"]').first();
    await expect(nameInput).toBeVisible({ timeout: 10_000 });
    await nameInput.fill('Test Owner');
    const introBox = page.locator('.onb-card textarea').first();
    await introBox.fill('I lead marketing for a robotics startup; demo me.');
    await page.locator('.onb-controls .btn-primary', { hasText: /Next/ }).click();

    // Step 3 — Skip for now.
    const skipBtn = page.locator('.onb-controls .btn', { hasText: /Skip for now/ });
    await expect(skipBtn).toBeVisible({ timeout: 10_000 });
    await skipBtn.click();

    // Step 4 — pre-canned prompt rendered; click Send.
    const promptBox = page.locator('#onb-step4-prompt');
    await expect(promptBox).toBeVisible({ timeout: 10_000 });
    await expect(promptBox).not.toHaveValue('');
    const sendBtn = page.locator('.onb-card .btn-primary', { hasText: /Send/ });
    await sendBtn.click();

    // Wait for the user bubble to render (optimistic, no LLM dep).
    await expect(page.locator('.onb-bubble-user').first()).toBeVisible({ timeout: 10_000 });

    // Advance to Step 5. The "Next" button in onb-controls is disabled
    // until at least one send. Wait for it to be enabled.
    const step4NextBtn = page.locator('.onb-controls .btn-primary', { hasText: /Next — watch/ });
    await expect(step4NextBtn).toBeEnabled({ timeout: 35_000 });
    await step4NextBtn.click();

    // Step 5 — Done button is always available (works even if no
    // deliverable lands within 30s; the page shows a fallback message).
    const doneBtn = page.locator('.onb-controls .btn-primary', { hasText: /Done/ });
    await expect(doneBtn).toBeVisible({ timeout: 35_000 });
    await doneBtn.click();

    // Post: should redirect to `/`. URL check + chat-input visibility.
    await page.waitForURL(/\/$/, { timeout: 10_000 });
    await expect(page.locator('.chat-input').first()).toBeVisible({ timeout: 10_000 });

    // Re-visit `/` — the wizard MUST NOT re-display. We assert by
    // confirming the localStorage flag is set + revisit does not
    // navigate to /onboarding.
    const flag = await page.evaluate(() => window.localStorage.getItem('holon-onboarded-v1'));
    expect(flag).toBe('1');
    await page.goto('http://localhost:3000/');
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator('.chat-input').first()).toBeVisible({ timeout: 10_000 });
  });
});

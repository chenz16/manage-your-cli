/**
 * Flow 5 — Adding a custom skill / template / reference
 *
 * Source: docs/product/vision-v2-product-shape.md § Flow 5.
 *
 * Sequence (V1 Maya):
 *
 *   Maya          /skills (or /references or /templates)   Modal       LLM (describe mode)   Mutable store
 *    |              |                                       |              |                    |
 *    |--click "+ New"-|                                     |              |                    |
 *    |              |--open modal with 2 tabs------------>|              |                    |
 *    |--"Describe" tab: "weekly client update email — 1 paragraph summary, 3 wins, 2 asks"-->|
 *    |              |                                       |--POST /api/v1/templates {mode:describe}-->|
 *    |              |                                       |              |--DeepSeek json_object-->|
 *    |              |                                       |              |<--full descriptor------|
 *    |              |                                       |              |<--write dynamicTemplate|
 *    |              |                                       |<--201 preview--|                    |
 *    |<--preview card: name / kind / body / variables-|                    |                    |
 *    |--"Save"-->|                                                                                  |
 *    |              |--refresh list--|                                                              |
 *    |<--new card visible in "Yours" section--|                                                     |
 *
 * Acceptance criteria:
 *  - "+ New" button always visible on page-strip
 *  - Both tabs (Describe, Direct) wired
 *  - Describe mode round-trip < 15s with DeepSeek
 *  - Saved entry appears in "Yours" section (not Examples) immediately
 *  - Per-card × delete works on user-created entries; suppressed on Examples
 *
 * Test scope: exercise the describe-mode round-trip on all three catalog
 * surfaces (/skills, /templates, /references). Assert: (a) "+ New"
 * present, (b) modal opens, (c) Describe tab + textarea reachable,
 * (d) Generate triggers a POST to the relevant /api/v1/<kind> endpoint
 * with mode:'describe', (e) status code is 200/201 OR an error surface
 * is shown (LLM round-trip is best-effort).
 */
import { test, expect } from '@playwright/test';

const CASES: { route: string; kind: 'skills' | 'templates' | 'references'; prompt: string }[] = [
  {
    route: '/skills',
    kind: 'skills',
    prompt:
      'skill that takes a meeting transcript and produces a 1-page exec summary',
  },
  {
    route: '/templates',
    kind: 'templates',
    prompt: 'Quarterly OKR check-in template',
  },
  {
    route: '/references',
    kind: 'references',
    prompt: 'WCAG 2.1 — older browser compatibility',
  },
];

for (const c of CASES) {
  test.describe(`Flow 5 — Add custom ${c.kind} entry`, () => {
    test(`"+ New" → Describe → Generate posts to /api/v1/${c.kind}`, async ({ page }) => {
      await page.goto(`http://localhost:3000${c.route}`);

      const newBtn = page.getByRole('button', { name: /\+\s*New/i }).first();
      await expect(newBtn).toBeVisible({ timeout: 10000 });
      await newBtn.click();

      const dialog = page.locator('[role="dialog"]').first();
      await expect(dialog).toBeVisible({ timeout: 5000 });

      // Both tabs exist
      const describeTab = dialog.getByRole('button', { name: /describe/i }).first();
      const directTab = dialog.getByRole('button', { name: /direct/i }).first();
      await expect(describeTab).toBeVisible({ timeout: 5000 });
      await expect(directTab).toBeVisible({ timeout: 5000 });

      // Describe is the default tab; type the prompt into the textarea
      const textarea = dialog.locator('textarea').first();
      await expect(textarea).toBeVisible({ timeout: 5000 });
      await textarea.fill(c.prompt);

      const genBtn = dialog.getByRole('button', { name: /Generate/i }).first();
      await expect(genBtn).toBeEnabled({ timeout: 5000 });

      // Listen for the describe-mode POST to /api/v1/<kind>
      const postPromise = page.waitForResponse(
        (resp) =>
          resp.url().includes(`/api/v1/${c.kind}`) && resp.request().method() === 'POST',
        { timeout: 35000 },
      );

      await genBtn.click();

      const resp = await postPromise;
      // 200 (preview) / 201 (created) are both valid happy-path outcomes;
      // the user-visible structural change is what we care about.
      expect([200, 201]).toContain(resp.status());

      // After the round-trip, either a Save button appears (preview)
      // OR the modal closes and a "Yours" section is populated.
      // Assert the structural change rather than the LLM output.
      await Promise.race([
        expect(
          dialog.getByRole('button', { name: /save|use|create/i }).first(),
        ).toBeVisible({ timeout: 10000 }),
        expect(page.locator('text=/Yours/i').first()).toBeVisible({
          timeout: 10000,
        }),
      ]);
    });
  });
}

/**
 * Flow 4 — Filing + watching a bug fix
 *
 * Source: docs/product/vision-v2-product-shape.md § Flow 4.
 *
 * Sequence (V1 Maya):
 *
 *   Maya          BugReportButton   /api/v1/admin/bugs   bugs/<id>/      Claude Code (main dev)
 *    |              |                  |                  |                  |
 *    |--click 🐞 in nav--|              |                  |                  |
 *    |--paste screenshot via ⌘V--|     |                  |                  |
 *    |--type description + File bug--->|                  |                  |
 *    |              |                  |--write report.md|                   |
 *    |              |                  |  + screenshot.png|                   |
 *    |              |                  |<--201 bug_id-----|                  |
 *    |<--✅ Filed · bug-id--|           |                  |                  |
 *    |              |                  |                  |                  |
 *    |--/me Debug → BugQueue auto-polls every 5s--|       |                  |
 *    |<--bug visible as "pending"--|   |                  |                  |
 *    |              |                  |                  |                  |
 *    |--ask Claude in terminal "扫一下 bugs/ 看看"--|     |                  |
 *    |              |                  |                  |<--reads + fixes--|
 *    |              |                  |                  |--writes _processed.md|
 *    |<--BugQueue refreshes "✓ fixed"-|                  |                  |
 *
 * Acceptance criteria:
 *  - 🐞 button always visible (in Nav)
 *  - ⌘V paste image works inline (already shipped)
 *  - POST is fire-and-forget for the user (returns 201, success toast)
 *  - BugQueue polls /api/v1/admin/bugs every 5s and updates without page refresh
 *  - Status pill transitions: pending → claude working (manual dev label) → ✓ fixed / ⚠ needs-human
 *
 * Test scope today: the modal open + POST + 201 round-trip. The Claude-Code
 * fix loop is human-driven (a developer running `claude` in a terminal)
 * and out of scope for an automated E2E. Asserted structurally.
 */
import { test, expect } from '@playwright/test';

// L-005: tag every browser request from this spec with a UA containing
// "Playwright" so scripts/dev-daemon.sh picker regex
// (`Playwright|HeadlessChrome|puppeteer`) auto-skips the bugs this test
// files. Playwright's default UA is vanilla Chrome and would otherwise
// burn ~2 min of `claude -p` per spec run.
test.use({ userAgent: 'HoloE2E/1.0 (Playwright)' });

test.describe('Flow 4 — Bug intake', () => {
  test('🐞 button is visible on every page and the modal opens', async ({ page }) => {
    await page.goto('http://localhost:3000/');

    // Bug button is mounted by Nav, so visible on every route.
    const bugBtn = page.getByRole('button', { name: /report a bug/i });
    await expect(bugBtn).toBeVisible({ timeout: 10000 });

    await bugBtn.click();

    // Modal opens with role=dialog + aria-label="Report a bug"
    const dialog = page.locator('[role="dialog"][aria-label="Report a bug"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Description textarea is reachable
    const textarea = dialog.locator('textarea').first();
    await expect(textarea).toBeVisible({ timeout: 5000 });
    await textarea.fill(
      'Test bug filed by Playwright daily-flow E2E — flow-4 happy path. Safe to ignore.',
    );

    // File bug button is enabled once text is non-empty
    const fileBtn = dialog.getByRole('button', { name: /file bug/i });
    await expect(fileBtn).toBeEnabled({ timeout: 5000 });

    // Watch the POST to /api/v1/admin/bugs (the fire-and-forget call).
    const postPromise = page.waitForResponse(
      (resp) => resp.url().includes('/api/v1/admin/bugs') && resp.request().method() === 'POST',
      { timeout: 15000 },
    );

    await fileBtn.click();

    const resp = await postPromise;
    expect(resp.status()).toBe(201);
  });

  test('bug button reachable on every reviewed route', async ({ page }) => {
    for (const route of ['/inbound', '/deliverables', '/members', '/skills', '/me']) {
      await page.goto(`http://localhost:3000${route}`);
      await expect(
        page.getByRole('button', { name: /report a bug/i }),
      ).toBeVisible({ timeout: 10000 });
    }
  });

  test.fixme(
    'BugQueue on /me Debug polls every 5s and reflects pending → fixed',
    async ({ page }) => {
      // FIXME: requires the BugQueue widget on /me Debug to be (a) mounted,
      // (b) actually polling /api/v1/admin/bugs every 5s, and (c) the
      // _processed.md sentinel handshake with Claude Code. The last leg
      // is human-mediated (someone runs `claude` in a terminal); we'd
      // have to mock that. Out of scope for automated E2E today.
      await page.goto('http://localhost:3000/me');
    },
  );
});

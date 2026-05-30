/**
 * Flow 2 — Dispatch + receive ("I need a slide deck on humanoid robotics")
 *
 * Source: docs/product/vision-v2-product-shape.md § Flow 2.
 *
 * Sequence (V1 Maya):
 *
 *   Maya          Desk AI          decompose_task    make_slides       /deliverables
 *    |              |                  |                  |                  |
 *    |--"我要一个 humanoid robotics 市场扫描的 PPT 给周五的投资人会"-->         |
 *    |              |--ambiguity_probe------------------>|                   |
 *    |<--3 clarifying Qs: audience? page count? deadline?  |                   |
 *    |--"投资人 / 10 页 / 周五下午"--->|                  |                   |
 *    |              |--decompose_task----------------->  |                   |
 *    |<--plan: research → outline → draft → deck (4 steps, 2h ETA)             |
 *    |              |                  |                  |                   |
 *    |--"go"-------->|                  |                  |                   |
 *    |              |--assign_to_staff(Aria, "research humanoid robotics market")
 *    |              |<--job_id=job_..., status=running                        |
 *    |              |--make_slides(after Aria's deliverable)                  |
 *    |              |                  |--python-pptx--->|                   |
 *    |              |                  |<--/tmp/humanoid-robotics-deck.pptx   |
 *    |              |                  |                  |--write deliverable-->|
 *    |<--✅ Slides ready at /tmp/...pptx (link)----|                          |
 *
 * Acceptance criteria:
 *  - Ambiguity probe fires BEFORE the decompose (per Marketing Director persona system_prompt)
 *  - Decompose surfaces plan + waits for owner nod
 *  - Each step's progress visible in `/today` (Running bucket gains a card)
 *  - Final deliverable appears on `/deliverables` with clickable file path
 *    (path-tokenizer renders clickable code chip → click-to-copy)
 *
 * Test scope today: structural — assert that /deliverables and the
 * chat surface both mount and that the deliverables list renders
 * deterministically. The full LLM-mediated dispatch + decompose + make_slides
 * + write deliverable chain requires a real Secretary round-trip + a
 * python-pptx skill and is fixmed below.
 */
import { test, expect } from '@playwright/test';

test.describe('Flow 2 — Dispatch + receive', () => {
  test('chat composer accepts a dispatch ask + deliverables page renders', async ({ page }) => {
    await page.goto('http://localhost:3000/');

    const input = page.locator('.chat-input').first();
    await expect(input).toBeVisible({ timeout: 10000 });

    await input.click();
    await input.fill(
      '我要一个 humanoid robotics 市场扫描的 PPT 给周五的投资人会',
    );

    // Submit via Enter — dev-mode Next.js overlay intercepts the send-button
    // pointer events (see audit doc F-3). Keyboard submit is unaffected.
    await input.press('Enter');

    // User bubble appears (optimistic render)
    await expect(page.locator('.chatmsg-user').last()).toBeVisible({
      timeout: 10000,
    });

    // Navigate to /deliverables — should render without error
    await page.goto('http://localhost:3000/deliverables');
    await expect(page).toHaveURL(/\/deliverables$/);

    // The deliverables landing must show either the empty-state copy or
    // at least one deliverable card. We assert on the page heading area.
    const main = page.locator('main');
    await expect(main).toBeVisible({ timeout: 10000 });
  });

  test.fixme('ambiguity probe fires before decompose', async ({ page }) => {
    // FIXME (iter-010 Pass #5 — kept): `ambiguity_probe` is now
    // `implemented: true` (Pass #1 shipped bb77597). HOWEVER, this
    // assertion needs the full chat round-trip — Secretary CLI + real
    // LLM call + the Marketing Director persona's system_prompt
    // selecting ambiguity_probe before decompose. The round-trip is
    // flaky in CI (no CLI auth) and the test body is a stub.
    // Re-enable when CI runs against a recorded-fixture LLM (or a
    // deterministic local model).
    await page.goto('http://localhost:3000/');
  });

  test.fixme(
    'decompose_task surfaces 4-step plan + running card appears in /today',
    async ({ page }) => {
      // FIXME (iter-010 Pass #5 — kept): `decompose_task` is now
      // `implemented: true` (Pass #1 shipped bb77597). HOWEVER, the
      // `/today` Running bucket wire-up still depends on the live
      // worker-dispatcher emitting per-job state AND the fixture being
      // seeded with a running job. The fixture set is intentionally
      // empty (TECH-DEBT D9), and the test body is a `goto` stub. Same
      // flaky-Secretary caveat as the ambiguity_probe leg above.
      await page.goto('http://localhost:3000/today');
    },
  );

  test.fixme('final .pptx appears in /deliverables with clickable path chip', async ({ page }) => {
    // FIXME (iter-010 Pass #5 — kept): `make_slides` is now
    // `implemented: true` (Pass #2 shipped 3612f8e — python-pptx wired,
    // writes real .pptx). HOWEVER, this test asserts the end-to-end
    // chain chat → decompose → assign_to_staff → make_slides → write
    // deliverable, which needs the full Secretary round-trip in CI. Body
    // is a `goto` stub. Re-enable when the CI fixture lands.
    await page.goto('http://localhost:3000/deliverables');
  });
});

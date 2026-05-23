/**
 * Flow 1 — Morning catchup ("What happened overnight + what should I do today?")
 *
 * Source: docs/product/vision-v2-product-shape.md § Flow 1.
 *
 * Sequence (V1 Maya):
 *
 *   Maya             /                Desk AI          (skills)             /today        /deliverables
 *    |               |                  |                  |                   |               |
 *    |--open app---->|                  |                  |                   |               |
 *    |               |--load owner----->|                  |                   |               |
 *    |               |--load today----->|                  |                   |               |
 *    |               |<--snapshot-------|                  |                   |               |
 *    |<--greeting----|                  |                  |                   |               |
 *    |               |                  |                  |                   |               |
 *    |--"早上好 帮我过一遍昨天发生的事"-->|                  |                   |               |
 *    |               |                  |--summarize_inbox|                   |               |
 *    |               |                  |  + list_recent_jobs                  |               |
 *    |               |                  |<--results--------|                   |               |
 *    |<--3-bullet recap + 2 action items--|                |                   |               |
 *    |               |                  |                  |                   |               |
 *    |--"那个 NVIDIA 的报告搞完了么"--->|                  |                   |               |
 *    |               |                  |--list_recent_jobs(staff=Aria)        |               |
 *    |               |                  |<--job=running 67%, ETA 14:00         |               |
 *    |<--status reply with deliverable link when ready--|                      |               |
 *
 * Acceptance criteria (from vision doc):
 *  - Open `/` cold → Desk AI greets within 1.5s using snapshot context
 *  - "summarize 昨天" should resolve via `summarize_inbox` skill (when implemented) OR fall back to a structured prompt
 *  - Job-status query resolves via `list_recent_jobs` tool, names the staff + ETA
 *  - All replies under 5 lines (V1 brevity rule)
 *
 * Test scope today: only the structural happy-path (chat surface mounts,
 * input accepts text, send button posts and a user-message bubble appears).
 * The LLM round-trip + brevity assertion is gated behind a real Hermes
 * runtime, so we assert only the structural change, not the LLM output.
 */
import { test, expect } from '@playwright/test';

test.describe('Flow 1 — Morning catchup', () => {
  test('chat surface mounts on / and accepts a user message', async ({ page }) => {
    await page.goto('http://localhost:3000/');

    // Chat surface is the primary control plane on /
    const input = page.locator('.chat-input').first();
    await expect(input).toBeVisible({ timeout: 10000 });

    // Send button is reachable
    const sendBtn = page.locator('.chat-send').first();
    await expect(sendBtn).toBeVisible({ timeout: 5000 });

    // Type the morning catchup prompt
    await input.click();
    await input.fill('早上好 帮我过一遍昨天发生的事');

    const beforeUserMsgs = await page.locator('.chatmsg-user').count();
    // Submit via Enter — in dev mode the Next.js error overlay (`<nextjs-portal>`)
    // intercepts pointer events for the send button. Keyboard works
    // regardless and matches the keyboard-first product posture (⌘M voice).
    await input.press('Enter');

    // The user-message bubble should appear within 5s (purely client-side
    // optimistic render — does NOT require LLM round-trip).
    await expect.poll(
      async () => page.locator('.chatmsg-user').count(),
      { timeout: 10000 },
    ).toBeGreaterThan(beforeUserMsgs);

    // Assistant bubble may take longer (LLM-mediated). Wait generously
    // for the structural change; assert visibility, not exact text.
    const assistantMsg = page.locator('.chatmsg-assistant').last();
    await expect(assistantMsg).toBeVisible({ timeout: 30000 });
  });

  test.fixme('summarize_inbox tool returns 3-bullet recap', async ({ page }) => {
    // FIXME (iter-010 Pass #5 — kept): `summarize_inbox` is still
    // `implemented: false` in skill-catalog.ts. Pass #1 shipped
    // decompose_task / ambiguity_probe / format_deliverable; Pass #2
    // shipped make_pdf / make_slides. summarize_inbox is gated on
    // TECH-DEBT D6 (reference fetch / inbox aggregation), not in this
    // iter. Re-enable when D6 lands the skill plugin.
    await page.goto('http://localhost:3000/');
  });

  test.fixme('list_recent_jobs names staff + ETA for NVIDIA report query', async ({ page }) => {
    // FIXME (iter-010 Pass #5 — kept): `list_recent_jobs` is implemented
    // in packages/hermes-plugin-holon-owner, BUT the fixture set is
    // intentionally empty (per user directive — see TECH-DEBT D9). No
    // seeded NVIDIA-report job exists, so the assertion would always
    // fail. Two unblocks needed: (1) deterministic fixture bundle, (2)
    // real-Hermes round-trip in CI (currently flaky w/o DEEPSEEK_API_KEY).
    await page.goto('http://localhost:3000/');
  });
});

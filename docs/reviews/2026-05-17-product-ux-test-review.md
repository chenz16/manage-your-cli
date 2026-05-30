# Holon Product / UX / Test Review

> **Status: Historical record.** This document captures a point-in-time
> snapshot. References to **Hermes** / `hermes-acp` /
> `hermes_profile_generic_v1` describe the runtime used by the sister
> repo [`holon-engineering`](https://github.com/chenz16/holon-engineering)
> at the time of writing. `manage-your-cli` does not bundle, link to, or
> depend on Hermes — its live substrate is a direct multi-CLI adapter
> (`claude` / `codex` / `gemini` / `qwen`) under
> [`packages/core/src/cli-adapters.ts`](../../packages/core/src/cli-adapters.ts)
> and [`apps/web/lib/warm-agent.ts`](../../apps/web/lib/warm-agent.ts).
> The body below is preserved unedited for history.

Date: 2026-05-17
Reviewer role: picky product engineer + test engineer
Target: `http://localhost:3000/`

## Evidence Collected

- Desktop screenshots: `tmp/ux-review-20260517-0300/desktop-*.png`
- Mobile screenshots: `tmp/ux-review-20260517-0300/mobile-*.png`
- Interaction screenshots: `tmp/ux-review-20260517-0300/interactions/*.png`
- Browser interaction log: `tmp/ux-review-20260517-0300/interactions/events.json`
- Routes manually exercised through Playwright: `/`, `/today`, `/inbound`, `/members`, `/connections`, `/deliverables`, `/me`, `/meetings`
- Interaction attempts: chat command `show missions`, `+ Hire`, `Pair new connection`, `+ New handoff`, owner-name editing on `/me`, panel collapse
- Engineering checks:
  - `pnpm -F @holon/web typecheck`: passed
  - `pnpm -F @holon/core test`: failed, 28 failed / 17 passed

## Product Engineer View: Top-Down Control Flow

### Intended product flow

Holon should feel like a chat-first local AI workforce console:

1. Owner states intent in chat.
2. Desk AI understands context from members, missions, connections, deliverables, and jobs.
3. Desk AI routes work to local staff, CLI executor, owner queue, or peer connection.
4. Right-side panels show the current operational state and let the owner inspect/control details.
5. Returned work becomes durable deliverables, not transient chat text.

This means the first-screen product promise is not "a dashboard with a chat box." It is "chat is the control plane, panels are inspection and confirmation surfaces."

### P0: The chat-first product promise currently fails on first impression

Evidence:

- `/` screenshot: `tmp/ux-review-20260517-0300/desktop-root.png`
- `/today` screenshot: `tmp/ux-review-20260517-0300/desktop-today.png`
- `show missions` interaction: `tmp/ux-review-20260517-0300/interactions/02-chat-show-missions.png`

Observed:

- Empty chat state is just centered "Holon" with no sample conversation, no visible capabilities, no recent context, no suggested actions.
- On split pages, the left chat region is mostly blank beige space. It reads as a dead sidebar, not the primary control surface.
- Typing `show missions` creates a user bubble and a small loading dot, but does not navigate to `/inbound` and does not produce a useful assistant reply within the observed wait.
- The assistant-ui hydration warning appears repeatedly around the chat textarea.

Why this matters:

- The core iteration goal says chat should drive panels. A first-time user cannot infer what to type, whether the system is thinking, or whether it can act.
- Product-level trust is damaged because the main affordance looks inactive.

Fix direction:

- Restore a high-signal empty chat state: 3-5 actionable suggestions such as "show inbound missions", "who is on my team?", "delegate market research to 市场专员", "open deliverables".
- Show a compact context header in chat: active desk, available staff count, recent job status.
- Make command responses deterministic and fast. `show missions` must visibly reply and navigate to `/inbound`.
- Keep a visible assistant response even when routing fails: explain failure and offer next action.
- Fix the hydration mismatch before further UX polish; it affects trust and can cause controlled textarea weirdness.

### P0: The app state is empty because core fixture data is broken

Evidence:

- `pnpm -F @holon/core test` failed with 28 failures.
- Failures show fixture-backed entities returning empty arrays: chat threads `[]`, connections `[]`, missions `[]`, Today queue/events `[]`.
- UI evidence: `/connections` says "All connections healthy · 0 active · 0 revoked"; `/inbound` and Today buckets are empty; `/members` has only 2 staff.

Why this matters:

- The product cannot demonstrate the MVP control loop if missions, connections, chat threads, and Today data disappear.
- Empty states hide the real design. This is not a valid demo surface for evaluating the product.

Fix direction:

- Treat fixture restoration as a release blocker.
- Restore expected fixture coverage from tests: 3 chat threads, 8 connections across 6 health states, 12 missions, 5 owner queue items, 15 recent events.
- Add a smoke test that boots the web app and verifies non-empty fixture counts on `/today`, `/inbound`, `/connections`, and `/deliverables`.

### P0: Core action buttons look clickable but do not open workflows

Evidence:

- `+ Hire` interaction screenshot: `tmp/ux-review-20260517-0300/interactions/03-members-hire.png`
- `Pair new connection` interaction screenshot: `tmp/ux-review-20260517-0300/interactions/04-connections-pair.png`
- `+ New handoff` interaction timed out in Playwright despite visible text.

Observed:

- Clicking `+ Hire` left the page unchanged; no modal appeared.
- Clicking `Pair new connection` left the page unchanged; no pairing sheet appeared.
- `+ New handoff` was visible, but role lookup timed out and no composer opened.

Why this matters:

- These are the three primary growth/control actions: create staff, pair peers, dispatch work.
- If these do not work reliably, the product is currently read-only and cannot prove the workforce loop.

Fix direction:

- Create a single E2E test for each primary CTA:
  - `/members` -> click `+ Hire` -> modal with role sketch textarea appears.
  - `/connections` -> click `Pair new connection` -> pairing step 1 appears.
  - `/today` -> click `+ New handoff` -> handoff composer appears.
- Check z-index / overlay / pointer-event conflicts from chat composer, collapse button, bug widget, and portals.
- Use stable accessible names and test IDs for primary CTAs.

### P1: The desktop visual hierarchy is too sparse and not operational enough

Evidence:

- `desktop-today.png`, `desktop-members.png`, `desktop-connections.png`, `desktop-deliverables.png`

Observed:

- The layout has large blank areas with low information density.
- Cards are visually clean but repetitive; most panels use similar beige/white boxes without strong operational hierarchy.
- Today's six buckets all show zero, so the page gives no sense of urgency, state, or work in flight.
- Members page hides the page title and compresses the roster into two wide rows. It feels unfinished and does not communicate "local team management."
- Connections page with zero rows is a dead end; there is no pairing guidance or explanation.

Why this matters:

- The product thesis is a "workforce system", not a minimalist notes app. The UI should surface accountability, state, routing, and next action.

Fix direction:

- Use realistic fixture data by default.
- Give each primary page one clear next action and one clear operational state.
- Today should show "what needs owner attention" before neutral zero cards.
- Members should show role, substrate, autonomy, tools, current job, and quick open/chat terminal actions in a scan-friendly card/list.
- Connections should show degraded/retrying/revoked examples in fixtures so the health vocabulary is visible.

### P1: Mobile is not a valid V1 review surface yet

Evidence:

- `tmp/ux-review-20260517-0300/mobile-root.png`
- `tmp/ux-review-20260517-0300/mobile-today.png`

Observed:

- Top nav horizontally overflows. `Members` is cut off; `Connections` is not immediately visible.
- Mobile split mode stacks nav, huge chat empty area, composer, then panel. The user must scroll through dead chat space before getting work done.
- Bug/report floating badge overlaps content around the left side of the mobile page.
- Chat input placeholder is too long for mobile and wraps awkwardly.

Why this matters:

- MVP acceptance explicitly requires realistic rendering at 375px.
- Phone is supposed to be a review/approval surface. Current mobile layout is not efficient for reviewing inbound missions or connection health.

Fix direction:

- On mobile, use a true bottom tab bar for the 5 primary screens or a compact horizontally scrollable nav with clear scroll affordance.
- Collapse empty chat height aggressively on panel routes. If there are no messages, show a compact command row, not a 50vh blank area.
- Shorten placeholder to "Message desk AI..." on mobile.
- Move the bug widget away from primary content or hide it behind a small topbar icon on mobile.

### P1: Chinese content is visually broken in multiple surfaces

Evidence:

- `desktop-today.png`
- `desktop-deliverables.png`
- `desktop-members.png`

Observed:

- Chinese text in Recent jobs and deliverables appears as square glyph boxes in screenshots.
- Members card with Chinese staff name also loses readability in metadata/body.

Why this matters:

- The owner is actively using Chinese instructions. If Chinese rendering is broken, the product cannot be trusted by this user.

Fix direction:

- Add a CJK-capable font fallback after Inter, e.g. system UI plus `Noto Sans CJK SC`, `Microsoft YaHei`, `PingFang SC`, `Hiragino Sans GB`, `sans-serif`.
- Screenshot-test Chinese fixture text on desktop and mobile.

### P1: `/me` exposes implementation internals too heavily

Evidence:

- `desktop-me.png`
- Interaction `06-me-edit-owner-name.png`

Observed:

- The page exposes a long raw system prompt as the main visible content.
- Tool names (`assign_to_staff`, `dispatch_handoff`, `cli_exec`) are shown in an engineer-facing way.
- Owner identity fields look like placeholder text until clicked; editing is not visually obvious enough.

Why this matters:

- Owner config is a product control surface. It should make the desk AI's behavior understandable without showing an intimidating prompt wall first.

Fix direction:

- Split `/me` into "Profile", "Desk AI behavior", "Tools", "Debug" sections.
- Default to concise behavioral controls: tone, language matching, delegation posture, approval threshold.
- Put raw system prompt behind "Advanced / Raw prompt".
- Make inline fields look editable: pencil icon, hover state, save state, validation feedback.

## Test Engineer View: Bottom-Up Issues

### Functional failures found

1. Chat command `show missions` did not complete the expected command-response-navigation loop.
2. `+ Hire` did not open the hire dialog in the observed browser run.
3. `Pair new connection` did not open the pairing sheet in the observed browser run.
4. `+ New handoff` was visible but Playwright could not activate it by accessible role/name.
5. `core` fixture-backed tests fail because data providers return empty results.
6. React hydration mismatch repeats on the chat textarea.

### Visual / accessibility failures found

1. Mobile nav cuts off primary destinations.
2. Chat empty state is not actionable.
3. Floating bug badge overlaps content on mobile and chat input area.
4. Chinese glyph rendering is broken in screenshots.
5. Primary panel close button is visually too close to page controls and can be confused with modal close.
6. The app relies on icons plus small text, but there is no clear "current workflow" breadcrumb beyond active nav.

### Test coverage to add now

- E2E: first-run `/` has actionable chat suggestions.
- E2E: `show missions` changes right panel route to `/inbound`.
- E2E: `+ Hire` opens modal and can create a mocked local AI staff without network LLM dependency.
- E2E: `Pair new connection` opens step 1 and validates a sample code.
- E2E: `+ New handoff` opens composer and can choose a recipient/form.
- Visual regression: desktop 1440x900 and mobile 390x844 for `/`, `/today`, `/members`, `/connections`, `/deliverables`.
- Data smoke: fixture counts are non-zero and match contract expectations.
- Console smoke: fail test on hydration mismatch or pageerror.

## Repair Priority

### Must fix before next design review

1. Restore fixture data and make core tests pass.
2. Fix chat command loop for `show missions` and at least four other canned commands.
3. Make `+ Hire`, `Pair new connection`, and `+ New handoff` reliably open their flows.
4. Fix Chinese font rendering.
5. Fix mobile nav and mobile chat height.

### Should fix after P0

1. Redesign empty chat state into a useful control surface.
2. Add realistic non-empty fixture states for missions, connection health, staff jobs, and returned deliverables.
3. Rework `/me` from raw prompt page into owner-friendly behavior controls.
4. Improve Today hierarchy so attention states dominate neutral zero states.
5. Add visual tests using the screenshot paths above as the baseline.

## Product Acceptance Gate For Next Round

The next version should be judged against this concrete demo script:

1. Open `/`.
2. See a useful desk AI chat state with suggested commands and current context.
3. Type `show missions`.
4. The assistant replies and the right panel opens `/inbound`.
5. From `/members`, click `+ Hire` and see a hire flow.
6. From `/connections`, click `Pair new connection` and see step 1 of the pairing flow.
7. From `/today`, click `+ New handoff` and see the composer.
8. On mobile 390px, all five primary destinations are reachable without clipped labels.
9. Chinese task/job/deliverable text renders as readable Chinese, not square boxes.
10. `pnpm -F @holon/web typecheck` and `pnpm -F @holon/core test` pass.

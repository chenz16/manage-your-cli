# Daily-Flow E2E Tests

Playwright E2E coverage for the 5 V1 daily-activity flows in
`docs/product/vision-v2-product-shape.md` § "User daily-activity sequence diagrams".

Each test file embeds its source sequence diagram as a header comment.

## The 5 flows

| # | File | Flow | Surface |
|---|---|---|---|
| 1 | `flow-1-morning-catchup.spec.ts`   | Morning catchup — chat-driven daily recap | `/` (chat) |
| 2 | `flow-2-dispatch-receive.spec.ts`  | Dispatch + receive a deliverable          | `/` + `/deliverables` |
| 3 | `flow-3-build-team.spec.ts`        | Hire a new virtual staff                  | `/members` (+ Hire dialog) |
| 4 | `flow-4-bug-intake.spec.ts`        | File a bug via the floating 🐞 button     | global Nav + `/me` BugQueue |
| 5 | `flow-5-add-catalog-entry.spec.ts` | Add a custom skill / template / reference | `/skills`, `/templates`, `/references` |

## How to run

Dev server must be running on `http://localhost:3000`:

```bash
# from repo root
pnpm dev               # or: pnpm -F web dev
```

Then in another terminal:

```bash
pnpm test:e2e:daily                                  # convenience script (added to root package.json)
# or, equivalently:
npx playwright test tests/e2e/daily-flows/           # default project (chromium)
npx playwright test tests/e2e/daily-flows/ --ui      # interactive UI mode
npx playwright test tests/e2e/daily-flows/flow-5-add-catalog-entry.spec.ts  # single file
```

First-time setup (only if `@playwright/test` or the chromium browser is missing):

```bash
pnpm add -Dw @playwright/test
pnpm exec playwright install chromium
```

## Coverage posture

Each flow exercises one **happy-path structural assertion** plus
`test.fixme()` markers for legs that need:

- Real Hermes / DeepSeek runtime round-trip (Flows 1, 2 LLM-mediated steps)
- Wired skill plugins (Flow 1 `summarize_inbox`, Flow 2 `decompose_task` / `make_slides`, Flow 3 `create_agent` from chat)
- Deterministic fixtures (Flow 1 NVIDIA-job, Flow 2 deliverable path)
- Out-of-process human work (Flow 4 — Claude Code reads `bugs/` and writes `_processed.md`)

The fixmes have inline rationale. Each links back to TECH-DEBT IDs
(D1 = skill plugin wiring, D7 = budget tracking, D9 = daily-flow fixtures).

When a fixme's blocker lands, flip `test.fixme` → `test` and assert on the
real-world output. **Don't fake it** — the fixme is the marker that we
should NOT pretend the gap is closed.

## LLM-mediated assertions — what we check

For describe-mode catalog entry (Flow 5) and the Hire dialog (Flow 3), the
tests assert on **structural change** (POST status code, modal state
transition, "Yours" section visibility), not exact LLM output. This is
deliberate — LLM outputs vary run-to-run; the structural contract does not.

Generous timeouts (30s) wrap the LLM round-trips. If you see flaky
failures on slow links, bump them rather than tightening.

## Local debugging tips

- Take a screenshot at any point in a test: `await page.screenshot({ path: '/tmp/foo.png' })`
- Open the trace viewer after a failure: `npx playwright show-trace test-results/.../trace.zip`
- Run headed to watch what happens: `npx playwright test ... --headed`

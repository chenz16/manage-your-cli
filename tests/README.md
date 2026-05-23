# Tests

The cumulative test suite for Holon. **Every Test Agent run executes the full historical suite, not just the current iteration's tests.** A previously-passing test that now fails is a regression and blocks iteration close (per `agents/test-agent.md` § "Cumulative Test Suite Discipline").

## Layout

```
tests/
├── README.md            (this file — infrastructure overview)
├── COVERAGE.md          living coverage map; updated by Test Agent each iteration
├── package.json         test runner config (Vitest for unit/integration; Playwright for e2e)
├── vitest.config.ts     Vitest config (created when first unit test lands)
├── playwright.config.ts Playwright config (created when first e2e test lands)
│
├── unit/                per-package unit tests — pure functions, isolated modules
│   └── iteration-NNN-{slug}/   tests added in this iteration
│       └── *.test.ts
│
├── integration/         cross-package tests — service-to-service with real DB
│   └── iteration-NNN-{slug}/
│       └── *.test.ts
│
├── e2e/                 browser tests via Playwright
│   └── iteration-NNN-{slug}/
│       └── *.spec.ts
│
├── conformance/         spec-conformance suites
│   ├── runtime-adapter/   against docs/architecture/runtime-adapter-interface.md
│   ├── wire-protocol/     against docs/architecture/peer-communication-architecture.md
│   └── handoff-form/      against docs/architecture/handoff-taxonomy.md
│
├── chaos/               chaos scenarios per docs/architecture/reliability-and-testing.md § 7.5
│
├── adversarial/         security-shaped tests per docs/architecture/reliability-and-testing.md § 7.7
│
└── fixtures/            shared test data; reused across layers
```

## Test Organization By Iteration (Within Each Layer)

Tests are organized by **layer first, then iteration**. Example: `tests/integration/iteration-005-runtime-adapter/` holds the integration tests that iteration 005 added. They all run as part of the global `tests/integration/` suite — the per-iteration subdirectory only exists for traceability ("which iteration added this test?").

Renaming or moving tests during refactors is allowed. **Never DELETE a test without recording the reason in `tests/COVERAGE.md` § "Removed Coverage In Iter-NNN"** — removed coverage is a downgrade signal.

## Iteration Integration

Per `agents/test-agent.md` § "Continuous loop":

1. When a new iteration's `requirements.md` lands, Test Agent writes new tests under `tests/{layer}/iteration-{NNN}-{slug}/`.
2. On every Dev Agent commit, Test Agent runs the full cumulative suite.
3. Failures classified as either **regression** (was passing, now fails — P0, blocks iteration close) or **new test** (just added, expected to fail until Dev catches up).
4. Results land in `iterations/{current}/test-results.md`; coverage map updates land in `tests/COVERAGE.md`.
5. At iteration close, Test Agent runs the full suite one more time and writes `iterations/{current}/test-summary.md`.

## Test Runners

| Layer | Runner | Why |
|---|---|---|
| `unit/` | **Vitest** | Fast; TS-native; matches the pnpm/Turbo TS stack chosen in `docs/architecture/implementation-architecture.md` § 5. |
| `integration/` | **Vitest** | Same runner as unit; can spin up real Postgres via testcontainers. |
| `e2e/` | **Playwright** | Cross-browser (Chrome, Safari, Firefox) including mobile viewports. Per `agents/test-agent.md` § "How To Verify A UI Mock". |
| `conformance/` | **Vitest** | Driven by spec fixtures; a conformance test is just a typed assertion against a serialized spec example. |
| `chaos/` | **Vitest** + custom harness | Each scenario in `docs/architecture/reliability-and-testing.md` § 7.5 is one test file; harness injects the fault. |
| `adversarial/` | **Vitest** | Same runner; security cases are typed assertions like conformance. |

Runner config lives at `tests/package.json` (created when the first test lands; do not pre-create empty config).

## How To Run

(Once `tests/package.json` exists.)

```bash
pnpm -C tests test:unit          # unit only
pnpm -C tests test:integration   # integration only
pnpm -C tests test:e2e           # browser (requires Playwright install)
pnpm -C tests test:conformance   # spec-conformance
pnpm -C tests test:chaos         # chaos (long-running; opt-in)
pnpm -C tests test:all           # the cumulative gate — must pass before iteration close
```

For the iteration-001 UI-mock pass (no test runner yet — it's a static-page mock):

```bash
cd src/ui-mock && python3 -m http.server 8001
# Then visit each page; check console errors; click each interactive element per requirements
```

## Continuous Mode (For Parallel Iteration)

The Test Agent can be run in continuous mode in a separate terminal so it picks up Dev Agent commits as they land:

```bash
scripts/start-test-watcher.sh
# Prints the prompt to paste into a new Claude Code window. The continuous Test
# Agent polls for new commits every ~5 minutes and re-runs the full suite.
```

See `scripts/start-test-watcher.sh` and `agents/test-agent.md` § "Continuous loop" for details.

## Boundaries

- Tests live here. Production code does not. (Per `agents/test-agent.md` § Boundaries.)
- Fixtures and harnesses are shared across layers via `tests/fixtures/`.
- Test Agent owns this directory. Dev Agent reads it (to understand expected behavior) but does not write here.
- The Requirements Agent never writes here.

## Cross-References

- `agents/test-agent.md` — full Test Agent role definition.
- `agents/README.md` § "Continuous Test Suite (Critical For Parallel)" — the parallel-mode discipline.
- `docs/architecture/reliability-and-testing.md` — the test strategy contract (failure modes table, SLOs, conformance requirements).
- `tests/COVERAGE.md` — current coverage map, updated each iteration.

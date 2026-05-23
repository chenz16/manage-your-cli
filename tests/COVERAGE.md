# Coverage Map

Living test-coverage map. Updated by the Test Agent at the end of every iteration. Format and discipline per `agents/test-agent.md` § "COVERAGE.md Discipline".

## Current State (as of iter-000 — pre-iteration baseline)

No production code, no tests yet. The table below seeds the structure that future iterations fill in.

| Component | Unit | Integration | E2E | Conformance | Notes |
|---|---|---|---|---|---|
| ui-mock (iter-001) | 0/0 | 0/0 | 0/0 | n/a | Static-page mock; e2e via Playwright planned in iter-001 close |
| handoff-engine | 0/0 | 0/0 | 0/0 | 0/0 | M1 target |
| peer-protocol | 0/0 | 0/0 | 0/0 | 0/0 | M2 target |
| runtime-adapter | 0/0 | 0/0 | 0/0 | 0/0 | M1 target; Hermes adapter |
| local-team-registry | 0/0 | 0/0 | 0/0 | n/a | M1 target |
| connection-registry | 0/0 | 0/0 | 0/0 | 0/0 | M2 target |
| mission-inbox | 0/0 | 0/0 | 0/0 | n/a | M2 target |
| deliverable-store | 0/0 | 0/0 | 0/0 | 0/0 | M1–M2 |
| context-pack | 0/0 | 0/0 | 0/0 | 0/0 | M2 |
| audit-log | 0/0 | 0/0 | 0/0 | n/a | M1; audit-emit-before-state-change is rule #4 |
| auth-and-identity | 0/0 | 0/0 | 0/0 | 0/0 | M2; pairing flow |
| cloud-relay | 0/0 | 0/0 | 0/0 | 0/0 | M4 |
| chaos scenarios | n/a | n/a | n/a | 0/10 | 10 scenarios from `reliability-and-testing.md` § 7.5; M3 |
| adversarial | n/a | n/a | n/a | 0/0 | Security cases from `reliability-and-testing.md` § 7.7; M3 |

Legend: counts are `passing/total`. `n/a` = layer not applicable to component. `0/0` = no tests written yet.

## New In Iter-000

(Pre-iteration baseline; no tests added yet.)

## Gaps Identified In Iter-000

- **Everything.** No tests exist. This is the baseline; iter-001 onward begins filling in.
- Test runner config (`tests/package.json`, `vitest.config.ts`, `playwright.config.ts`) not yet created — will land when the first test does.
- Conformance test scaffolds against the spec set are not yet built; first conformance work will land alongside the corresponding implementation iteration (e.g., runtime-adapter conformance during M1).

## Removed Coverage In Iter-000

(none — baseline)

## Regressions In Iter-000

(none — baseline)

---

## Update Discipline

Each iteration's Test Agent run MUST:

1. Append a new section `## Current State (as of iter-NNN)` (or update the existing one inline if more readable) reflecting new counts.
2. Append `## New In Iter-NNN` listing tests added.
3. Append `## Gaps Identified In Iter-NNN` listing what is NOT covered and why (V2 feature, no implementation yet, etc.).
4. Append `## Removed Coverage In Iter-NNN` if any tests were deleted; each removal needs a reason.
5. Append `## Regressions In Iter-NNN` listing any previously-passing tests that now fail. **MUST be empty before iteration closes.**

If `Regressions In Iter-NNN` is non-empty at iteration close, the iteration is NOT complete; Dev Agent must fix.

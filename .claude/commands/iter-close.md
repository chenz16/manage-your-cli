---
description: Close the current iteration. Spawns the Requirements Agent to archive completed requirements and (optionally) open the next iteration based on feedback.
argument-hint: (no arguments — operates on the latest iteration folder)
allowed-tools: Read, Bash, Task
---

# /iter-close

Close out the most recent iteration: archive its requirements to `requirements/completed/`, fold any feedback / questions into `requirements/current.md` + `backlog.md`, and (if appropriate) seed the next iteration.

## Steps for the model

1. **Identify the current iteration.** Run `ls iterations/` and pick the highest-numbered folder (across sub-iterations like `001a`/`001b`/`001c`). Verify it has a non-empty `feedback.md` — if empty, **stop and tell the human** that they need to write feedback first (the iteration cannot be closed without human review).

2. **Verify iteration is close-ready (read these in parallel):**
   - `iterations/{current}/requirements.md` — what was promised
   - `iterations/{current}/deliverables/README.md` — what was produced (Dev Agent's manifest)
   - `iterations/{current}/test-results.md` — what passed / failed (Test Agent's report)
   - `iterations/{current}/test-summary.md` — Test Agent's final summary
   - `iterations/{current}/feedback.md` — human's review
   - `iterations/{current}/dev-questions.md` and `test-questions.md` (if they exist) — surfaced ambiguities
   
   If `test-results.md` shows unresolved P0 regressions or `test-summary.md` says `Iteration close-ready: no`, **stop and tell the human** — Dev Agent must fix first per `agents/test-agent.md` § "COVERAGE.md Discipline".

3. **Spawn the Requirements Agent** via the `Task` tool. Use the `requirements` subagent (defined at `.claude/agents/requirements.md`). Prompt:

   > "Close iteration `{current}` per `agents/requirements-agent.md` § 'Closing a previous iteration'.
   >
   > Inputs to read first:
   > - `iterations/{current}/feedback.md`
   > - `iterations/{current}/test-results.md` and `test-summary.md`
   > - `iterations/{current}/dev-questions.md` and `test-questions.md` (if they exist)
   > - `iterations/{current}/deliverables/README.md`
   >
   > Outputs:
   > - Archive `iterations/{current}/requirements.md` to `requirements/completed/{current}.md` (copy, don't delete the original)
   > - Update `requirements/current.md` with carry-over and new asks the human surfaced in feedback
   > - Update `requirements/backlog.md` with newly-deferred or reprioritized items
   > - For any Dev/Test question that points to a real spec gap, draft an ADR proposal in `docs/decisions/NNN-{slug}.md` per the Spec Update Flow (status: proposed; awaiting human review)
   >
   > End with the standard summary block per `agents/requirements-agent.md` § 'Output Format', plus a recommendation: should the human start the next iteration immediately (use `/iter-start <slug>`), wait for spec-update ADR review, or pause for further input?"

4. **After the Requirements Agent returns**, print a concise human-readable summary: what was archived, any new ADRs drafted (with paths), next suggested action.

5. **Do NOT automatically run `/iter-start`.** Even if everything looks ready, the human decides when to begin the next iteration — they may want to review the ADRs or rewrite `requirements/current.md` first.

## Boundaries

- Do not write code, tests, or specs from this command. Delegate to the Requirements Agent.
- Do not delete the closed iteration's folder — it stays as a historical record.
- Do not modify `docs/architecture/*.md` directly; spec changes flow through ADRs (see `agents/requirements-agent.md` § "Spec Update Flow").

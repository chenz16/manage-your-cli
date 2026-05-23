---
description: Start a new iteration. Spawns the Requirements Agent to draft requirements.md + plan.md from current.md + last iteration's feedback.md.
argument-hint: <slug> (e.g., bff-contract, cultivation-editor)
allowed-tools: Read, Bash, Task
---

# /iter-start

Begin a new iteration named `iterations/NNN-$ARGUMENTS/`.

## Steps for the model

1. **Validate the argument.** `$ARGUMENTS` must be a non-empty kebab-case slug (lowercase, hyphens, no spaces). If empty or malformed, stop and ask the human for one (e.g., `bff-contract`, `cultivation-editor`, `pairing-flow-spike`).

2. **Determine the iteration number `NNN`.** Run `ls iterations/` and find the highest existing `NNN` (across all sub-iterations like `001a`, `001b`, etc.). The new iteration's number is the next sequential 3-digit value. Examples: if highest is `001c`, next is `002`. If highest is `005`, next is `006`. Zero-pad to three digits.

3. **Gather context (read these in parallel before spawning the agent):**
   - `requirements/current.md` — what the human says is needed.
   - `requirements/backlog.md` — deferred items that may now be ready.
   - The most recent iteration's `feedback.md` (find via `ls iterations/`; pick the highest-numbered one with a non-empty `feedback.md`). If none exists or all are empty, note that there is no feedback yet.
   - `docs/product/roadmap-mvp-to-enterprise.md` — to confirm the next slice is on-roadmap.

4. **Spawn the Requirements Agent** via the `Task` tool. Use the `requirements` subagent (defined at `.claude/agents/requirements.md`). Prompt:

   > "Start iteration `NNN-$ARGUMENTS` per `agents/requirements-agent.md` § 'Starting a new iteration'.
   >
   > Inputs to read first:
   > - `requirements/current.md`
   > - `requirements/backlog.md`
   > - The latest iteration's `feedback.md` (path: `iterations/{latest}/feedback.md`) — fold any feedback into this iteration's plan
   >
   > Outputs to produce:
   > - `iterations/NNN-$ARGUMENTS/requirements.md` (the WHAT — verifiable, bounded, linked, sized)
   > - `iterations/NNN-$ARGUMENTS/plan.md` (the HOW — step-ordered, spec-anchored, time-budgeted, testable)
   > - `iterations/NNN-$ARGUMENTS/deliverables/README.md` (placeholder for Dev Agent to populate)
   > - `iterations/NNN-$ARGUMENTS/feedback.md` (empty template per existing iteration convention)
   > - Update `requirements/current.md` and `requirements/backlog.md` per the close-iteration workflow if anything spilled over
   >
   > End with the standard summary block per `agents/requirements-agent.md` § 'Output Format'."

5. **After the Requirements Agent returns**, print a concise human-readable summary: iteration folder created, item count, next suggested action (typically "spawn Dev Agent and Test Agent in parallel per agents/README.md § Parallel Mode; or run `scripts/start-test-watcher.sh` in a second terminal for continuous Test Agent").

## Boundaries

- Do not write code, tests, or specs from this command. Delegate to the Requirements Agent.
- Do not modify `docs/architecture/*.md` from this command.
- If the slug collides with an existing iteration folder, stop and ask the human (do not silently overwrite).

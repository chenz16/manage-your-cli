#!/usr/bin/env bash
# start-test-watcher.sh
#
# ┌─────────────────────────────────────────────────────────────────────────┐
# │ DEPRECATED 2026-05-16 — DO NOT USE.                                     │
# │                                                                         │
# │ The continuous-watcher mode silently stalls (the very failure mode that │
# │ heartbeat-watchdog was designed to detect). Across iter-001a → iter-003 │
# │ the watcher logged 25 Runs but never wrote a real Vitest/Playwright     │
# │ test; coordinator + autonomous-loop covered the actual work.            │
# │                                                                         │
# │ Replacement pattern: on-demand sub-agent dispatch at iteration close,   │
# │ with heartbeat-watchdog wired into the dispatch call. See               │
# │ docs/architecture/agent-heartbeat-watchdog.md.                          │
# │                                                                         │
# │ Self-retired by the watcher itself; coordinator confirmed in iter-003.  │
# └─────────────────────────────────────────────────────────────────────────┘
#
# Auto-launches Claude Code as the Test Agent in continuous-watcher mode.
# Run this in a SECOND terminal (next to your main Dev Agent terminal).
# It verifies you're in the holon-engineering repo, then EXEC's claude with
# the watcher prompt pre-loaded — no copy-paste needed.
#
# Usage (from a fresh terminal):
#   cd /home/chenz/project/holon-engineering
#   ./scripts/start-test-watcher.sh
#
# Stop the watcher with Ctrl-C (or by typing exit / quit in the Claude window).

set -euo pipefail

echo "ERROR: scripts/start-test-watcher.sh was retired on 2026-05-16." >&2
echo "       Use on-demand Test Agent dispatch at iteration close instead." >&2
echo "       See agents/test-agent.md § 'On-demand dispatch (post-2026-05-16)'." >&2
exit 1


# --- Repo identity check --------------------------------------------------
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
README="${REPO_ROOT}/README.md"

if [[ ! -f "${README}" ]]; then
  echo "ERROR: ${README} not found." >&2
  echo "  This script must run from the holon-engineering repo." >&2
  exit 1
fi

if ! grep -q "^# Holon Engineering$" "${README}"; then
  echo "ERROR: ${README} does not look like the holon-engineering README." >&2
  echo "  Expected first heading '# Holon Engineering'." >&2
  exit 1
fi

if ! command -v claude >/dev/null 2>&1; then
  echo "ERROR: 'claude' command not found in PATH." >&2
  echo "  Install Claude Code first, then re-run." >&2
  exit 1
fi

cd "${REPO_ROOT}"

# --- Banner ---------------------------------------------------------------
cat <<'BANNER'

================================================================================
  Holon — Test Watcher (Continuous Test Agent)
================================================================================

Launching Claude Code in this terminal as the Test Agent...

What it will do:
  - Poll for new git commits on origin/main every ~5 minutes
  - When a new commit appears: pull, run the full cumulative test suite,
    append results to iterations/{current}/test-results.md, flag any
    regression as P0, update tests/COVERAGE.md
  - Exit when iterations/{current}/feedback.md becomes non-empty
    (signals the human is closing the iteration)

To stop early: Ctrl-C, or type 'exit' / 'quit' inside Claude.

Starting in 2 seconds...
================================================================================

BANNER

sleep 2

# --- The watcher prompt ---------------------------------------------------
# Concise — the .claude/agents/test.md wrapper loads the full agent definition.
PROMPT='Run in continuous-watcher mode per agents/test-agent.md (especially §§ "Continuous loop", "Cumulative Test Suite Discipline", "COVERAGE.md Discipline").

Identify the ACTIVE iteration (do not just pick the alphabetically-highest folder — that targets the wrong one when later sub-iterations are queued ahead of time):
  - From `ls iterations/`, consider only iteration folders (e.g. 001a-*, 001b-*, 002-*).
  - For each, check `iterations/{folder}/feedback.md`. An iteration is ACTIVE if its feedback.md is missing OR has size < 500 bytes (template-only / not yet closed by the human).
  - Of all ACTIVE folders, pick the alphabetically EARLIEST. That is the active iteration; later ones are queued.
  - Example: with 001a, 001b, 001c all template-only, the active one is 001a. Once the human fills 001a/feedback.md (size grows past ~500 bytes), the watcher will switch to 001b on its next loop iteration — re-evaluate the active iteration at the top of each loop, not just once at startup.
Note the active iteration name; you will write to iterations/{that}/test-results.md.

Then loop:
  0. Re-identify the active iteration using the rule above (the active iteration may shift mid-session as the human closes the current one and the next becomes active).
  1. Run: git log -1 --format=%H. Compare to last hash you ran on (track in memory).
     - If unchanged: sleep 5 minutes (300s), then re-check.
     - If changed: pull (git pull --ff-only origin main) and continue to step 2.
  2. Run the full cumulative suite per tests/README.md § "How To Run". For iter-001a (UI mock, no backend), the suite may be near-empty — that is OK; report zero tests as zero, do not fabricate.
  3. Append results to iterations/{current}/test-results.md with the commit hash so it traces back.
  4. If any test that was passing on the previous run now fails: flag P0 REGRESSION in test-results.md — that blocks iteration close.
  5. Update tests/COVERAGE.md if coverage materially changed.
  6. Loop.

Exit cleanly when:
  - iterations/{current}/feedback.md becomes non-empty (human is closing the iteration), OR
  - the user types stop / exit / quit.

Boundaries:
  - DO NOT write production code.
  - DO NOT auto-fix bugs (report in test-results.md; Dev Agent fixes).
  - DO NOT modify docs/ (file test-questions.md instead).

Acknowledge once you have read agents/test-agent.md, then enter the loop.'

# --- Launch ---------------------------------------------------------------
# `exec` replaces this shell process with claude — when claude exits,
# the terminal is freed normally.
# Using --agent to load the test-agent role wrapper from .claude/agents/test.md
# (falls back to plain claude if --agent is unsupported in your version).

if claude --help 2>&1 | grep -q -- '--agent '; then
  exec claude --agent test "${PROMPT}"
else
  exec claude "${PROMPT}"
fi

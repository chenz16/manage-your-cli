# scripts/

One-off / supporting shell scripts. Not part of the production runtime — these are operator helpers for running iterations, setting up dependencies, and similar housekeeping.

## Inventory

| Script | Purpose | When to run |
|---|---|---|
| `start-test-watcher.sh` | **DEPRECATED 2026-05-16** — long-running watcher stalled silently, never wrote real tests across 25 Runs. Replaced by on-demand Test Agent dispatch (with heartbeat-watchdog) at iteration close. Script now exits 1 with a pointer message. | Never. |
| `agent-watchdog.sh` | Polls a background subagent's JSONL output file every 60s; emits HEARTBEAT / STALL / TIMEOUT events. Used by the coordinator via Monitor tool to detect stalled subagents that would otherwise burn hours of time + tokens. See `docs/architecture/agent-heartbeat-watchdog.md` for the pattern. | EVERY background subagent dispatch in autonomous-loop mode. Wraps each on-demand Test Agent dispatch. |

## Conventions

- All scripts live at the repo root in `scripts/`.
- All scripts use `#!/usr/bin/env bash` and `set -euo pipefail`.
- Scripts that mutate the filesystem MUST verify they're in the holon-engineering repo first (look for the `# Holon Engineering` heading in `README.md`).
- Scripts are documented here in this file's Inventory table when they land — add a row whenever you add a script.
- Scripts do NOT bypass the agent process model. They help the human orchestrate agents; they don't do the agents' work.

## Anti-patterns

- Do not put production logic here (e.g., the runtime adapter). Production code lives in `src/` per `docs/architecture/implementation-architecture.md` § 5.
- Do not put test fixtures here. Those live in `tests/fixtures/`.
- Do not put database migrations here. Those will live in the package that owns the schema (V1: TBD; see `docs/architecture/data-model.md`).

# ADR: Memory recall as a Claude Code Skill (not a persona prompt)

- Status: Accepted (2026-05-30; install hook landed in commit 50e3b8e via `installRecallSkill`)
- Date: 2026-05-30
- Context owner: Chen Zhang

## Context

Today the secretary's progressive-disclosure recall ("read `INDEX.md` first,
then open the detail file you need") lives in the persona system prompt.

Two problems:

1. **Prompt bloat.** Every warm-secretary turn pays the recall instructions in
   tokens even when the question doesn't need memory. Per-turn cost; persistent.
2. **Soft obedience.** Persona instructions are advisory. The model sometimes
   answers from prior context without reading the index, especially under
   pressure or in long turns — silent drift, hard to detect.

Skills (`SKILL.md` with frontmatter `name` + `description`) are auto-triggered
by the Claude Code harness based on the description. Model fires them as a
reflex rather than by prompt-obedience. That's the right shape for recall.

## Decision

Lift the recall protocol out of the persona prompt and into two skills:

- **`holon-memory-recall`** — secretary variant; covers System 2 (owner) +
  System 1 (project). Installed on every per-project secretary.
- **`holon-owner-recall`** — owner-CLI variant; owner scope only. Installed on
  the owner-CLI.

Canonical copies live in-repo at `skills/<name>/SKILL.md` and
are mirrored to `~/.claude/skills/` at agent boot.

The transport stays the same: the `read_memory` MCP tool from
`packages/holon-mcp` (`packages/holon-mcp/src/tools.ts`,
`packages/holon-mcp/src/server.ts`). Skills only change *who decides to fire
recall* — not how reads happen.

## Consequences

**Wins**

- Persona prompts shrink: the ~progressive-disclosure block + index-file
  rules come out. Token saving per warm turn, plus a clearer persona.
- Trigger reliability goes up: skill descriptions are matched by the harness
  regardless of prompt length.
- Owner can tune trigger phrasing in one place (the `description` field)
  without touching persona templates.

**Costs / requirements**

- **Install step at agent boot.** Skills must be present in `~/.claude/skills/`
  before the secretary spawns. Track-of-record for wiring this:
  `packages/core/src/cli-memory-scaffold.ts` (the same place `CLAUDE.md` /
  `AGENTS.md` get materialized per the matrix from commit `44be633`). This
  ADR does **not** modify that file — wiring is a follow-up.
- **Employees do NOT install these skills.** Employees are ephemeral; their
  boss already injects the relevant memory slice at dispatch time. Installing
  recall on an employee would re-fetch memory the boss already paid for.
- The owner-CLI gets `holon-owner-recall` only; per-project secretaries get
  `holon-memory-recall`. Don't install both on the same agent — the broader
  one supersedes.
- Skill files are read at CLI startup; edits don't hot-reload. Document this
  in the wiring follow-up.

## Alternatives considered

1. **Keep recall in the persona prompt (status quo).**
   Rejected: bloat + soft obedience, see Context.

2. **RAG / vector index over `~/holon-agents/`.**
   Rejected on North Star grounds (`CLAUDE.md` § North Star, README § "Where we
   are alone"): markdown-only memory, no vector DB. Adds infra without solving
   the trigger-reliability problem (still needs *something* to decide when to
   query).

3. **Move recall into the MCP tool itself** — e.g., a single `recall(question)`
   tool that auto-walks the index.
   Rejected for now: hides the budgeting decision from the model, makes
   debugging "why did it read X" harder, and the model still needs a trigger
   reason to call the tool — so we'd be back to a skill or a persona line.
   Revisit if skill triggering proves unreliable in practice.

## Related

- `~/.claude/projects/-home-chenz-project/memory/project_myc_system_0_1_2.md`
- `skills/holon-memory-recall/SKILL.md`
- `skills/holon-owner-recall/SKILL.md`
- `packages/holon-mcp/src/tools.ts` — `read_memory`
- `packages/core/src/cli-memory-scaffold.ts` — install hook (future wiring)
- commit `44be633` — per-binary memory file matrix

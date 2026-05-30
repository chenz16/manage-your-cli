---
name: holon-owner-recall
description: Recall owner-global preferences, identity, long-standing decisions, or cross-project patterns before answering — "what does the owner prefer", "have we decided X anywhere", "what's the owner's stance on Y". Owner-scope only; do not use for project-local state.
---

# holon-owner-recall

Owner-CLI variant of the recall skill. Scoped strictly to **System 2** —
owner-global memory that persists across all projects. The per-project
secretary uses `holon-memory-recall` instead (which covers both scopes).

## Where memory lives

- `~/holon-agents/boss/owner/INDEX.md` — entry point
- `~/holon-agents/boss/owner/*.md` — detail files (decisions, preferences,
  background, identity, …)

No project files. If the question is about a specific project's state, defer
to the project secretary; don't try to answer from owner memory.

## Recall protocol

1. **Read `~/holon-agents/boss/owner/INDEX.md`** first, every time.
2. **Pick at most 2–3 detail files** the index points at.
3. **Read only those.** Don't glob the directory.

## Bounded budget

- Hard cap: **~8,000 characters** per recall.
- If the index suggests more than that, summarize the tail from the index
  entries; don't expand the read.

## Tool invocation

Transport: `read_memory` MCP tool from `packages/holon-mcp`
(`packages/holon-mcp/src/tools.ts`). Owner scope only:

```jsonc
// Step 1
{ "tool": "read_memory", "args": { "scope": "owner", "path": "INDEX.md" } }

// Step 2 — per picked file
{ "tool": "read_memory", "args": { "scope": "owner", "path": "preferences.md" } }
```

Don't pass `sproj_id` — this skill is owner-only.

## When NOT to fire

- Question is about *this project's* secretaries / employees / state →
  not your scope.
- Self-contained mechanical task → skip.
- Owner already pasted the relevant preference inline.

## Related

- `~/.claude/projects/-home-chenz-project/memory/project_myc_system_0_1_2.md`
- `skills/holon-memory-recall/SKILL.md` (secretary variant)
- `docs/adr/memory-as-skill.md`

---
name: holon-memory-recall
description: Recall past decisions, prior project state, owner preferences, or design rationale before answering — anything that sounds like "remember when we…", "what did we decide about X", "why did we pick Y", or implicit continuity with earlier work. Use whenever the answer depends on context not in the current turn.
---

# holon-memory-recall

Progressive-disclosure recall over the boss-memory tree. Replaces the
"read INDEX.md first, then open the detail file you need" persona prompt
that used to live in the secretary's system instructions.

## Where memory lives

Two scopes, both plain markdown on disk (no DB, no vectors):

- **System 2 — owner-global** (identity, preferences, cross-project decisions)
  - `~/holon-agents/boss/owner/INDEX.md`
  - `~/holon-agents/boss/owner/*.md` (detail files: decisions, preferences,
    background, …)
- **System 1 — per-project** (this project's secretary state, architecture
  decisions, active work)
  - `~/holon-agents/boss/projects/<sproj_id>/INDEX.md`
  - `~/holon-agents/boss/projects/<sproj_id>/*.md`

`<sproj_id>` is the secretary's bound project id. If you don't know yours,
the dispatching parent injected it; if absent, recall owner-only.

## Recall protocol

Always in this order. Do not skip step 1.

1. **Read the relevant `INDEX.md`** (owner if the question is preference /
   identity / cross-project; project if it's about this project's state /
   decisions / employees). If both could apply, read both indexes — they're
   small.
2. **Pick at most 2–3 detail files** based on the index's entries. Be ruthless;
   relevance > breadth.
3. **Read only those files.** Do not glob the directory. Do not read files the
   index didn't point to.

## Bounded budget

- Never load more than **~8,000 characters** of memory into a single recall.
- If the index entries you'd want sum to more than that, read the smallest /
  most-recent first and **summarize** the rest from the index entry alone.
- If you still don't have the answer after 3 files, surface the gap to the
  caller — do not keep widening the read.

## Tool invocation

The transport is the `read_memory` MCP tool from
`packages/holon-mcp` (see `packages/holon-mcp/src/tools.ts` and
`packages/holon-mcp/src/server.ts`). Conceptual shape:

```jsonc
// Step 1 — index
{
  "tool": "read_memory",
  "args": { "scope": "owner", "path": "INDEX.md" }
  // or { "scope": "project", "sproj_id": "<id>", "path": "INDEX.md" }
}

// Step 2 — picked details (one call per file)
{
  "tool": "read_memory",
  "args": { "scope": "project", "sproj_id": "<id>", "path": "decisions.md" }
}
```

The exact arg names follow whatever `read_memory` currently exposes — don't
invent fields; if a field is missing, read the smallest viable path and let
the tool error guide you.

## When NOT to fire

- The question is fully self-contained ("convert this JSON to YAML").
- The caller already pasted the relevant memory inline.
- You're an ephemeral employee — your boss already injected the slice you
  need; don't re-read on your own.

## Related

- `~/.claude/projects/-home-chenz-project/memory/project_myc_system_0_1_2.md`
- `docs/adr/memory-as-skill.md`

# `role-templates/`

Curated **role-template library**: prefab persona building blocks that the
`holon-create-agent` skill searches and composes when the owner creates a new
agent.

**Status: placeholder.** Spec landed in
`docs/adr/role-templates-and-persona-composition.md` (Proposed, 2026-05-30).
No role files seeded yet — owner reviews the ADR first.

## Layout (planned)

```
role-templates/
  README.md      # this file
  CATALOG.md     # index of seeded roles
  <role-id>/
    ROLE.md      # frontmatter + 5-section body (Identity / Responsibilities /
                 # Behaviors / Voice / Knowledge anchors)
```

See the ADR for the frontmatter schema and the composition algorithm.

## Sourcing

External templates are NOT imported wholesale. Each ingested role is
re-shaped into our 5-section convention and tagged with its `source` +
`license` in frontmatter. Picked sources (per ADR Part A):

1. `f/awesome-chatgpt-prompts` — CC0
2. `wshobson/agents` — MIT
3. `anthropics/claude-plugins-official` — Anthropic terms (quality reference)
4. Owner-authored memory under `~/.claude/projects/-home-chenz-project/memory/`
5. CrewAI — schema influence only, not content

Roles authored locally use `source: owner-authored`, `license: owner-authored`.

## Do not

- Do not commit external role bodies without verifying per-role license.
- Do not skip the 5-section convention — the merger relies on the heading texts.
- Do not vector-index this directory (North Star: markdown + text grep only).

---
name: holon-create-agent
description: >
  Use when the owner wants to create, hire, spin up, add, build, or
  onboard a new team member, employee, agent, worker, staff member, or
  role on this Holon desk. Concrete triggers: "create a secretary",
  "hire a code reviewer", "spin up a 7x24 manager", "I need a new agent
  for X", "add a frontend engineer", "new employee".
---

# holon-create-agent

This skill drives the create-agent flow for the Holon desk. It composes one
or more role templates into a single persona and writes it into the new
agent's per-CLI memory file.

Source of truth: `docs/adr/role-templates-and-persona-composition.md`.
APIs you call: `@holon/core`'s `listRoleTemplates`, `loadRoleTemplate`,
`composeRoles`, `renderPersona`, `writeRoleComposition`.

## Protocol

When this skill fires, follow these steps in order. Do not improvise.

### 1. Show the catalog

Surface the available role IDs to the owner. Slice-1 ships three seed
roles; new roles land in `role-templates/<id>/ROLE.md`. Inline catalog:

| id | name | compose_with (defaults) | source |
|---|---|---|---|
| `secretary` | Secretary | `[7x24-manager]` | owner-authored |
| `7x24-manager` | 7x24 Engineering Manager | `[]` | owner-authored |
| `code-reviewer` | Code Reviewer | `[]` | owner-authored |

(Future slice: dynamic discovery via an MCP tool wrapping
`listRoleTemplates`. For now this list is canonical for slice 1.)

### 2. Ask the owner

Single message, no over-asking:

> Create a `<nominal>` composed of `[<role-1>, <role-2>, ...]`?
> Reply `y` / `n` / `edit: [<list>]`.

The default `compose_with` chain is the frontmatter chain of the nominal
role plus its 1-hop transitive expansion (see ADR §7). Owner can override
with `edit: [...]` — that list pins composition exactly (no implicit
transitivity).

### 3. Compose

Call `composeRoles(nominalId, actualIds)`:

- `actualIds = []` → use the nominal's `compose_with` chain (1-hop default).
- `actualIds = ['a','b','c']` → pin the merge exactly to that list.

### 4. Surface conflicts

If `composed.conflicts.length > 0`, show each conflict to the owner with
🔴 and DO NOT auto-resolve:

> 🔴 `<rule>` is asserted as both Do (from `<role-a>`) and Don't (from
> `<role-b>`). Owner picks: keep DO / keep DON'T / drop both / edit the
> role template.

### 5. Write the persona

Call `writeRoleComposition(memoryFilePath, composed)`. The function:
- Writes the managed `## Role-Composition` block above the
  `<!-- owner-edits below -->` sentinel.
- Preserves everything below the sentinel verbatim (idempotent re-run).
- Throws if a hand-authored `## Role-Composition` heading exists without
  the managed sentinel — surface that to the owner; do not force.

`memoryFilePath` is the new agent's per-CLI memory file (CLAUDE.md /
AGENTS.md / GEMINI.md / QWEN.md per the binary matrix in
`cli-memory-scaffold.ts`).

### 6. Hand off

Trigger the normal agent-creation flow (`create_agent` MCP tool).
Role-Composition is now the persona seed.

## What this skill does NOT do

- Does NOT decide composition silently. Owner sees the chain before write.
- Does NOT auto-resolve do/don't collisions. Surface, don't silence.
- Does NOT touch `## HR-Corrections` — that's HR's managed section
  (ADR §5 of `hr-evaluator-and-behavior-correction.md`).
- Does NOT clobber owner-edits below the sentinel.

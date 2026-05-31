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

You drive this flow by calling THREE MCP tools on the `holon-mcp` server:
`list_role_templates`, `compose_role_persona`, `create_agent_with_role`.
Do not call the core APIs (`composeRoles`, `writeRoleComposition`, …)
directly — the MCP tools are the only stable surface for the skill.

Each composed persona follows the 5-section schema from the ADR §1:
Identity / Responsibilities / Behaviors (Do / Don't) / Voice / Tone /
Knowledge anchors.

## Protocol

When this skill fires, follow these steps in order. Do not improvise.

### 1. Discover the catalog

Call `list_role_templates`. Pass an optional `tag` filter when the owner's
intent narrows naturally — e.g. "I need a code reviewer" → `tag: "review"`;
"hire an engineer" → `tag: "engineering"`. Omit the tag when the request is
broad ("create an agent for me").

The tool returns `[{ id, name, description, tags, compose_with }, ...]`.
Use `compose_with` to preview each role's default 1-hop chain.

### 2. Present + ask the owner

Show the matched roles to the owner with their `compose_with` defaults.
Single ask, no over-asking:

> Create a `<nominal>` composed of `[<role-1>, <role-2>, ...]`?
> Reply `y` / `n` / `edit: [<list>]`.

The default chain is the nominal's `compose_with` plus its 1-hop
transitive expansion (ADR §7). Owner can override with `edit: [...]` —
that list pins composition exactly (no implicit transitivity).

### 3. Preview the composed persona

Call `compose_role_persona` with `nominal: "<role-id>"` and optionally
`actual_ids: [...]` (only when the owner overrode the chain). The tool
returns:

- `persona` — structured `{ identity, responsibilities, behaviors,
  voice, knowledge, conflicts, actualIds }`
- `rendered_markdown` — the exact `## Role-Composition` block that will
  land in the new agent's memory file

### 4. Surface conflicts

If `persona.conflicts.length > 0`, show each conflict to the owner with
🔴 and DO NOT auto-resolve:

> 🔴 `<rule>` is asserted as both Do (from `<role-a>`) and Don't (from
> `<role-b>`). Owner picks: keep DO / keep DON'T / drop both / edit the
> role template.

### 5. Materialize

On owner confirm, call `create_agent_with_role`:

- `role_id` — the nominal role id
- `name` — display name for the new staff
- `compose_with` — pass when the owner overrode the chain in step 2
- `binary` — usually OMIT; the server defaults to the first INSTALLED
  CLI in priority order **claude → codex → gemini → qwen** (per the
  desk's CLI-priority policy). Override only when the owner explicitly
  names a CLI ("create a codex worker", "use gemini").
- `cwd` — usually OMIT; the staff-management service picks the cwd.

The tool creates the staff (long lifecycle so the memory file is
scaffolded), writes the composed persona into the per-binary memory file
(`CLAUDE.md` / `AGENTS.md` / `GEMINI.md` / `QWEN.md`), and launches the
CLI session.

## What this skill does NOT do

- Does NOT decide composition silently. Owner sees the chain before write.
- Does NOT auto-resolve do/don't collisions. Surface, don't silence.
- Does NOT touch `## HR-Corrections` — that's HR's managed section
  (ADR §5 of `hr-evaluator-and-behavior-correction.md`).
- Does NOT clobber owner-edits below the sentinel.

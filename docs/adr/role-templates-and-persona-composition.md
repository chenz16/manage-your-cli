# ADR: Role-template library + persona composition

- Status: Proposed (2026-05-30; spec only — no implementation, owner to review before any code lands)
- Date: 2026-05-30
- Context owner: Chen Zhang
- Branch: `feat/role-templates-spec`

## Context

Today, creating a new agent in this repo means hand-writing a persona prompt
from scratch (or copy-pasting from the previous secretary). Two problems:

1. **No reuse.** Each new "frontend engineer" or "secretary" is re-invented.
   Drift across instances is the default; consistency is manual labour.
2. **Roles aren't atomic.** Owner's mental model: a real-world "secretary" is
   actually `[secretary + 7×24-manager]`; a real-world "tech lead" is
   `[backend-engineer + code-reviewer + people-manager]`. A single flat
   persona file can't represent that — we need **composition primitives**.

Owner's framing:

> Search the web for role templates. Use as prefab building blocks. Each
> agent has a *nominal* role (what we call them) and an *actual composition*
> = a fit of multiple roles. Aggregate first, then merge at create-time.

This ADR specs (A) the curated library, (B) the storage + composition
mechanics, (C) how the create-agent flow uses it, and (D) how composition
interacts with HR (`hr-evaluator-and-behavior-correction.md`) and memory
recall (`memory-as-skill.md`).

## Decision

Introduce a **role-template library** (`role-templates/<role-id>/ROLE.md`,
mirroring the existing `skills/<skill-id>/SKILL.md` shape) plus a **merger**
that composes N roles into one persona at agent-create time. A new skill
`holon-create-agent` is the create-flow entry point.

### 1. Template storage layout

Repo-root directory `role-templates/`, parallel to `skills/`. One subdir per
role.

```
role-templates/
  README.md                  # explains the directory; placeholder until seeded
  CATALOG.md                 # the curated index (Part C below)
  secretary/
    ROLE.md
  7x24-manager/
    ROLE.md
  frontend-engineer/
    ROLE.md
  ...
```

Frontmatter shape on every `ROLE.md`:

```yaml
---
id: secretary
name: Secretary
description: >
  Owner-facing project secretary. Dispatches work to employees, owns the
  weekly digest, never writes code itself.
compose_with: [7x24-manager]      # roles this one routinely fuses with
tags: [ops, communication, project-management]
source: owner-authored            # or: anthropic | f/awesome-chatgpt-prompts | crewai | ...
source_url: ""                    # populated for external sources
license: CC0 | MIT | owner-authored
version: 1                        # bump on body changes; merger keys against this
---
```

Body sections (fixed convention — the merger relies on these heading texts):

- `## Identity` — one paragraph. "I am ...". First-person.
- `## Responsibilities` — markdown bullet list. One responsibility per bullet.
- `## Behaviors (do / don't)` — two sub-lists: `### Do` and `### Don't`.
- `## Voice / Tone` — one short paragraph.
- `## Knowledge anchors` — markdown bullets pointing to memory paths,
  `[[wikilinks]]`, doc URLs, or skill IDs.

Anything outside these sections is ignored by the merger (free-form notes
allowed but not composed).

### 2. Composition rule

Inputs: a `nominal_role: <role-id>` and `actual_roles: [<role-id>, ...]`
(the nominal role is always implicitly included in actual_roles).

Outputs: a single rendered persona markdown block.

Merge per-section:

| Section | Rule |
|---|---|
| `## Identity` | **Nominal role wins.** One source of truth on "who am I". |
| `## Responsibilities` | **Union, de-duped.** Hash each bullet via `stableRuleHash` from `packages/core/src/hr-path-a.ts` (the same hash HR uses for rule idempotence in §4.3 Path A); collapse same-hash bullets. Stable order: nominal-first, then `compose_with` chain. |
| `## Behaviors (do / don't)` | Union, de-duped (same hash). `Do` and `Don't` merged independently. **Conflict detection**: a `Do` bullet whose hash matches a `Don't` bullet from a different role → flagged. |
| `## Voice / Tone` | **Nominal role wins.** One voice. |
| `## Knowledge anchors` | Union, de-duped by exact text match (anchors are URLs/paths — string equality is enough). |

Conflicts (any do/don't collision, or two `Identity` blocks if owner forces a
multi-nominal composition) get appended into a managed section:

```markdown
## Composition-conflicts
<!-- managed by holon-create-agent; owner resolves manually -->

- (2026-05-30) `behaviors.do` (from `7x24-manager`) vs `behaviors.dont`
  (from `frontend-engineer`):
  - DO: "Dispatch heavy implementation work to employees."
  - DON'T: "Never delegate code-writing to a sub-agent."
  - Resolution: __TODO owner__
```

Owner reads, picks a winner, deletes the conflict block. No auto-resolution.

**Worked example.** Nominal `secretary` + actual `[secretary, 7x24-manager]`:

- Identity: secretary's ("I am your project secretary…").
- Responsibilities: secretary's bullets + 7x24-manager's bullets, hash-deduped.
  ("Dispatch don't do" exists in both — appears once.)
- Behaviors.Do: union; "surface only 🔴 decisions" comes in from
  7x24-manager.
- Voice / Tone: secretary's.
- Knowledge anchors: union.

### 3. `holon-create-agent` skill (outline only)

New skill at `skills/holon-create-agent/SKILL.md`. **Do not write the body
in this ADR** — that's a follow-up. Spec the contract:

**Trigger.** Description targets phrasings like "create a <role>", "new
<role> agent", "spin up a <role>", "I need a <role>".

**5-step protocol** the skill must run:

1. **Parse nominal role.** Extract `<role>` from the trigger. If it doesn't
   match an existing `role-templates/<id>/`, do a fuzzy match over CATALOG.md
   tags + IDs and present top-3 candidates to owner.
2. **Search the library.** Text-grep `role-templates/` (frontmatter `tags`
   + body keyword scan, no vector search — North Star). Build the suggested
   `compose_with` set = role's own `compose_with` ∪ any roles whose tags
   strongly overlap.
3. **Propose to owner.** Single message: "Create `<nominal>` composed of
   `[<role-1>, <role-2>, ...]`? Reply `y` / `n` / `edit: [<list>]`."
4. **Merge.** On confirm, run the §2 algorithm. Write output into the new
   agent's per-binary memory file (`CLAUDE.md` / `AGENTS.md` / `GEMINI.md` /
   `QWEN.md`, per the matrix in `packages/core/src/cli-memory-scaffold.ts`)
   under a managed section:

   ```markdown
   ## Role-Composition
   <!-- managed by holon-create-agent — owner-edits below the sentinel -->
   <!-- nominal: secretary; actual: [secretary, 7x24-manager]; merged: 2026-05-30 -->

   ## Identity
   ...

   ## Responsibilities
   ...

   <!-- owner-edits below -->
   ```

5. **Hand off to scaffold.** Trigger the normal agent-creation flow
   (`create_agent` MCP tool) — `Role-Composition` is the persona seed.

### 4. Update model (re-running create on an existing agent)

Owner says "update <agent>'s composition" (or the cron picks up a `version`
bump in any `role-templates/*/ROLE.md`).

- Re-run §2 merge with the current `nominal` + `actual` + freshest template
  bodies.
- **Diff** against the existing `## Role-Composition` section content (the
  managed block above the `owner-edits below` sentinel).
- Apply the diff. Hash-collisions are deduped silently. New behavioral
  conflicts go into `## Composition-conflicts` (same shape as §2).
- **Preserve everything below `<!-- owner-edits below -->`** verbatim. Those
  are owner annotations; they are sacred.

Owner-edits sentinel is the same mechanism HR's `## HR-Corrections` uses
(managed-section convention). Composition and HR coexist as two separate
managed sections in the same memory file.

### 5. HR interaction

- `## Role-Composition` is **persona ground truth** (who the agent is).
- `## HR-Corrections` is **behavior nudges** (how the agent should adjust).
- HR (`hr-evaluator-and-behavior-correction.md` §4.3 Path A) writes only to
  `HR-Corrections`. It never touches `Role-Composition`.

**Conflict-detection rule** (HR must run before writing a Path-A rule):

- Compute `stableRuleHash` of the new HR rule text.
- Scan every bullet in the target's `## Role-Composition` Responsibilities +
  Behaviors. If any bullet's hash equals the HR rule's hash → exact-overlap
  conflict.
- Substring-containment fallback: if HR's rule text is a substring of any
  composition bullet (case-insensitive, whitespace-normalized) → soft
  conflict.
- On either conflict, HR does **not** write the rule. Instead it surfaces:

  > 🔴 HR wanted to write rule "<rule>" on `<agent>`, but it conflicts
  > with the existing Role-Composition responsibility "<bullet>". Update the
  > role template instead, or vet a Role-Composition override.

Rationale: HR silently shadowing a role's defining responsibility would
make agent behavior debugging impossible. The role library is the
slow-moving canon; HR is the fast-moving patch layer; canon wins by default
and owner adjudicates.

### 6. Open questions (flagged, not decided)

1. **Bilingual roles.** Owner uses 中文 + English mixed. Do `ROLE.md` files
   ship bilingual (both languages inline), pick one canonical (probably EN,
   per `feedback_myc_ui_language` — desk apps EN), or ship parallel
   `ROLE.zh.md` / `ROLE.en.md` files?
2. **Mixed-license `compose_with` chains.** A nominal under MIT composed
   with an `f/awesome-chatgpt-prompts` (CC0) and an owner-authored role
   produces a derived persona under what license? Need a propagation rule
   and per-frontmatter `license` enforcement at merge time.
3. **Library versioning.** Pin a `role-templates/` snapshot per app release
   (reproducible), or roll forward continuously (templates improve under
   live agents)? §4's `version: N` field assumes per-role versioning;
   library-wide pinning is separate.
4. **Conflict resolution UX.** `## Composition-conflicts` blocks require
   owner attention. Should the create-agent flow refuse to ship until
   resolved, or ship with conflicts visible and let HR flag drift later?
5. **Catalog seed scope.** Seed 10–15 generic roles (current plan) vs.
   seed only the 3–5 owner immediately needs (secretary, 7x24-manager,
   frontend, backend) and grow on demand?
6. **External sync.** When `f/awesome-chatgpt-prompts` updates upstream,
   how do we know? Manual periodic re-import vs. a `role-templates/.sources`
   manifest with upstream hashes?

### 7. Open question surfaced by this ADR

7. **Composition transitivity.** If role A's `compose_with: [B]` and B's
   `compose_with: [C]`, does creating an A-agent transitively pull in C?
   Owner intent is unclear. Default proposed: **one-hop only** (A pulls B
   but stops there); transitive composition tends to balloon personas. But
   "secretary → 7x24-manager → settle-watcher" is a plausible real chain
   the owner might want.

## Part A — Curated source list (web research output)

Six lookups across the major candidate sources. Findings:

| Source | URL | License | Format | Coverage | Role-decomposition? | Verdict |
|---|---|---|---|---|---|---|
| `f/awesome-chatgpt-prompts` | https://github.com/f/awesome-chatgpt-prompts | CC0 1.0 (prompts.csv content; MIT code) | CSV + markdown, single-string `act_as` prompts | Very broad (~200 roles: linguist, interviewer, doctor, accountant, etc.) | No — flat single-role prompts | **Seed.** Largest public corpus, CC0 = no friction, breadth is exactly what catalog needs. Convert to our 5-section schema on import. |
| `wshobson/agents` + `VoltAgent/awesome-claude-code-subagents` | https://github.com/wshobson/agents · https://github.com/VoltAgent/awesome-claude-code-subagents | MIT (verify per-file) | Markdown + frontmatter (Claude Code subagent shape) | ~100–150 dev-leaning roles (frontend, security, DevOps, ML) | Partial — each subagent has tool/permission scope, not behavioral composition | **Seed.** Already matches our `ROLE.md` shape (frontmatter + markdown). Best fit for engineering coverage. License check per-role required. |
| Anthropic `claude-plugins-official` | https://github.com/anthropics/claude-plugins-official | Anthropic-managed (terms per-plugin) | Plugin manifests | Curated, small | No | **Seed (small).** Use as quality bar / format reference. Don't fork wholesale — terms vary per plugin. |
| CrewAI built-in role examples | https://docs.crewai.com/en/concepts/agents · https://github.com/crewaiinc/crewai | MIT | YAML (`role` / `goal` / `backstory`) | Narrow — examples are docs samples, not a catalog | Partial — `goal` is responsibility-shaped | **Reject as bulk seed; cite for schema design.** CrewAI's `role/goal/backstory` triple maps cleanly to our `Identity/Responsibilities/Voice`. Steal the shape, skip the content (it's docs samples, not a real library). |
| Owner's existing memory under `~/.claude/projects/-home-chenz-project/memory/` | (local) | owner-authored | Markdown | Narrow but high-signal: `7x24-manager`, `manager-orchestrate-only`, `secretary-not-doer` patterns | Yes — already role-shaped | **Seed.** These are the **canonical** owner-authored roles for this project. Lift `7x24-manager`, `secretary`, `manager` directly. |
| Microsoft Semantic Kernel `prompt_template_samples` | https://github.com/microsoft/semantic-kernel/tree/main/prompt_template_samples | MIT | Handlebars/Liquid templates | Task templates, not personas | No | **Reject.** Task-prompt scaffolding, not role personas. Wrong abstraction layer. |
| LangChain Hub / LangSmith Hub | https://smith.langchain.com/hub | Mixed (user-uploaded) | Prompt strings | Broad but quality-variable | No | **Reject.** No license discipline (per-prompt), no role-shape convention; ingestion-cost high vs. signal. |
| AutoGen examples + `memenow/persona-agent` | https://github.com/memenow/persona-agent | MIT (per-repo) | YAML personas | Small set of demo personas | Partial | **Reject as seed.** Too small + too research-demo-flavored to be a useful catalog. |
| LinkedIn / Indeed job descriptions | — | proprietary / scraping-hostile | — | Real-world roles | — | **Reject explicitly.** ToS-hostile to scraping, no clean license path. Note for future: if we want JD grounding, source via public job-postings APIs from companies that publish open careers feeds (e.g., GitHub Jobs successors), not LinkedIn/Indeed. |

**Seed picks (5):**

1. `f/awesome-chatgpt-prompts` (breadth, CC0)
2. `wshobson/agents` (engineering depth, format match)
3. Anthropic `claude-plugins-official` (quality reference)
4. Owner's `~/.claude/projects/-home-chenz-project/memory/` (canonical owner roles)
5. CrewAI schema (design influence only — not content)

### Part A addendum (owner ask 2026-05-30) — Karpathy + dev-leaning community + role-play coverage

Owner flagged two gaps after the first pass:

> 特别关注 Andrew Karpathy 啥的那个 Tesla 的那个以前的 CTO 相关的 还有网友总结的那些 可能主要针对开发者的; 但是应该也有针对不同角色扮演的.

**Karpathy as architectural reference (NOT a role-template source).** Karpathy's
April 2026 [LLM Wiki Gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)
proposes a plain-markdown agent-maintained personal knowledge base that pre-
compiles knowledge into structured interlinked entity pages — explicitly
anti-RAG. **Our boss-memory layout is architecturally a multi-agent + hierarchical
generalization of this.** Cite him as kindred-art prior work in marketing /
positioning, not in the source library. Same for his persona-prompting commentary
("review from senior code reviewer perspective" raises quality) — that's an
inspiration for composition's `compose_with`-mode roles, not content to import.

**Additional community-curated seed candidates (dev-leaning).** Three repos
worth weighing against `wshobson/agents` for the engineering layer:

| Source | URL | Scale | Verdict |
|---|---|---|---|
| `VoltAgent/awesome-claude-code-subagents` | https://github.com/VoltAgent/awesome-claude-code-subagents | 154+ subagents, 10 categories | **Seed (dev layer).** Already listed alongside `wshobson` in the main table; keep both. |
| `rohitg00/awesome-claude-code-toolkit` | https://github.com/rohitg00/awesome-claude-code-toolkit | 135 agents, 35 skills, 42 commands | **Watch.** Largest aggregate, but mixed quality and license discipline (per-entry check needed). Use as discovery, not bulk-import. |
| `GetBindu/awesome-claude-code-and-skills` | https://github.com/GetBindu/awesome-claude-code-and-skills | Community-curated | **Watch.** Smaller; complementary to VoltAgent / wshobson rather than additive. |
| `sub-agents.directory` | https://sub-agents.directory | 100+ subagent prompts + MCP servers | **Watch.** Lookup surface, not a forkable corpus. |

Lesson: the developer-focused supply is **abundant and overlapping** — picking
one canonical seed (wshobson) + watch-list for new entries beats merging four
catalogs into noise. Cull aggressively at import.

**Role-play coverage (non-dev).** `f/awesome-chatgpt-prompts` already carries
the role-play long tail (interviewer, linguist, doctor, life coach, language
tutor, etc.) — most are CC0 single-string `act_as` prompts. The conversion
from `act_as` → our 5-section schema is mechanical. Treat as a separate import
pass after the dev layer ships, since role-play personas need light
domain-prefix curation (e.g., "doctor" → "medical thinking partner — not
clinical advice" framing) to avoid liability/scope drift. Note this as an
import-pipeline filter, not a per-template hand-edit.

## Part C — Catalog seed

See `role-templates/CATALOG.md` (sibling file in this commit) for the full
table. Role IDs:

- `secretary`
- `7x24-manager`
- `product-manager`
- `frontend-engineer`
- `backend-engineer`
- `mobile-engineer`
- `designer`
- `qa-tester`
- `code-reviewer`
- `security-auditor`
- `writer-editor`
- `marketer`
- `legal-reviewer`
- `finance-analyst`
- `customer-support`

## Alternatives considered

1. **Flat single-persona files (status quo, no composition).**
   Rejected: owner explicitly asked for composition; real roles are
   compound. Single-file forces every combination to be hand-written.

2. **Persona-as-skill (use `skills/` for roles too).**
   Rejected for now: skills are *capabilities the model triggers*; roles
   are *who the model is*. Conflating them muddies trigger semantics —
   `holon-create-agent` should fire on "create a secretary", but the
   secretary itself shouldn't have a `secretary` skill auto-firing on
   every owner message. Keep skills and roles as separate directories.

3. **Vector-search the role library.**
   Rejected on North Star grounds. Text grep over frontmatter `tags` +
   body is enough at 10–100 roles. Revisit at 1000+.

4. **Auto-resolve composition conflicts (e.g., last-role-wins).**
   Rejected: silent override of a defining behavior is the worst failure
   mode for agent debugging. Surface, don't silence.

5. **Bulk-import f/awesome-chatgpt-prompts at spec time.**
   Rejected: licenses are clean but each role still needs conversion to
   our 5-section schema. Curate-on-demand from the source list; don't
   commit a 200-role wall of imported text.

## Related

- `docs/adr/memory-as-skill.md` — recall mechanism the composed persona depends on.
- `docs/adr/hr-evaluator-and-behavior-correction.md` — HR layer that writes `## HR-Corrections` alongside `## Role-Composition`.
- `packages/core/src/hr-path-a.ts` — `stableRuleHash` reused by the merger.
- `packages/core/src/cli-memory-scaffold.ts` — per-binary memory file matrix that receives the merged persona.
- commit `44be633` — per-binary memory file naming.
- `~/.claude/projects/-home-chenz-project/memory/feedback_myc_ui_language.md` — bilingual question (§6.1).
- `~/.claude/projects/-home-chenz-project/memory/project_holon_724_manager.md` — canonical `7x24-manager` source for the seed.

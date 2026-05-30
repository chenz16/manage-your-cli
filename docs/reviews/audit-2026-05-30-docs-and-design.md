# Audit — docs & design on `main` (2026-05-30)

Branch under review: `main` at `df1abad` (head after the wave merges).
Auditor: independent pass; did not write any of these docs.

This is a **critical** read — owner explicitly asked for "系统检查",
not a victory lap. Two things genuinely good are in §10 so the report
isn't 100% negative.

---

## 1. Verdict

**Mostly-clean at the surface, contradictory underneath.**

The newly-landed product story (README + the two new architecture
docs `memory-update-flow.md` + `hr-evaluator.md` + the two ADRs +
the role-templates spec) is internally consistent, well-cross-linked,
and reads coherently — that work is genuinely solid.

The problem is the *layer below* it. The pre-existing
`docs/architecture/` tree (`local-agent-management.md`,
`owner-assistant-tools.md`, `runtime-adapter-interface.md`,
`admin-surfaces.md`, `owner-config-service.md`) was **not** swept
during the architecture sync wave — it still describes the system in
the old Hermes-runtime / owner_assistant vocabulary, and treats
ADR-013/015/019 as live spec. A reader of the README who clicks
through to those docs lands in a different product. Two real
cross-doc contradictions (CHANGELOG self-contradicts on what shipped;
ADR-053 (memory-as-skill) self-contradicts on whether install hook is
landed or "future wiring") and one filesystem-path drift between the
skill files and every other doc that names the same paths.

Verdict in one word: **messy, mostly at the seams between the new
work and the pre-existing architecture tree.**

---

## 2. Top 5 Things to Fix Before Talking to Outsiders

### #1 — CHANGELOG self-contradicts on what shipped

`CHANGELOG.md:11-41` (the `### Added (post-CHANGELOG-init)` block)
documents settle-watch + synthetic-producer registry, harvest-on-retire
via HR's "harvest hook also feeds HR", and the Path A/B correction
machinery as **shipped**.

Then `CHANGELOG.md:150-160` lists, under "Owner-gated (not in this
release)":

> - Event-driven secretary follow-up (settle-watch on dispatch → push
>   synthetic msg to warm secretary)
> - Harvest-on-retire (reclaim dying employee memory into boss store)

Both **are** in the codebase
(`apps/web/lib/settle-watch.ts`,
`packages/core/src/boss-memory-harvest-service.ts` referenced from
`staff-management-service.ts:318` and `secretary-projects-service.ts:427`)
and **are** documented in the new architecture docs as live.

A new reader hits this page and cannot tell what state the product is
in.

**Edit:** delete the two stale bullets from `CHANGELOG.md:155-159`;
move them to `### Added (post-CHANGELOG-init)` if they are not
already covered there (they essentially are).

### #2 — memory-as-skill ADR contradicts itself on install hook

`docs/adr/memory-as-skill.md:3`:

> Status: Accepted (2026-05-30; **install hook landed in commit 50e3b8e
> via `installRecallSkill`**)

`docs/adr/memory-as-skill.md:54-58`:

> Track-of-record for wiring this:
> `packages/core/src/cli-memory-scaffold.ts` (the same place `CLAUDE.md`
> / `AGENTS.md` get materialized per the matrix from commit `44be633`).
> **This ADR does not modify that file — wiring is a follow-up.**

`docs/adr/memory-as-skill.md:92`:

> `packages/core/src/cli-memory-scaffold.ts` — **install hook (future
> wiring)**

The install hook is in fact present —
`packages/core/src/cli-memory-scaffold.ts:108` exports
`installRecallSkill`, `cli-memory-scaffold.ts:191` invokes it.

**Edit:** delete the "future wiring" lines at `memory-as-skill.md:54-58`
and `memory-as-skill.md:92`; replace "This ADR does not modify that
file" with "Wired in `cli-memory-scaffold.ts:191` (see status line)".
ADRs need to either describe a proposal cleanly or describe an
accepted-and-landed reality cleanly — not both at once.

### #3 — Filesystem layout drift: `MEMORY/` subdir vs flat `*.md`

`docs/architecture/memory-update-flow.md:28-42` (the new spec) and
`docs/architecture/data-model.md:761-781` both place detail files
under `~/holon-agents/boss/owner/MEMORY/*.md` and
`~/holon-agents/boss/projects/<sproj_id>/MEMORY/*.md` — a `MEMORY/`
subdirectory.

`skills/holon-memory-recall/SKILL.md:18-23` and
`skills/holon-owner-recall/SKILL.md:14-16` describe **flat**:

> - `~/holon-agents/boss/owner/INDEX.md`
> - `~/holon-agents/boss/owner/*.md` (detail files: decisions,
>   preferences, background, …)

The skill file is what the Claude Code harness actually reads at
runtime; if the recall protocol expects a flat directory and the
write side puts files under `MEMORY/`, recall sees an empty list.

**Edit:** pick one. Recommendation: keep the `MEMORY/` subdir (spec
docs win — it's cleaner separation from `hr/`, `secretary/`, etc.).
Update both `SKILL.md` files to say `MEMORY/*.md` and update the
tool-invocation examples (`"path": "MEMORY/decisions.md"`).

### #4 — `docs/architecture/local-agent-management.md` is half-old-world

This file is listed in the audit's "read in this order" set and is
the linked-from "Core 1 deep dive" — but it still carries:

- `local-agent-management.md:740` — "Per ADR-013, the chat surface
  is a UI exposure of Hermes's natural conversational form."
- `local-agent-management.md:808` — "ADR-013 already routes desk
  control through the owner_assistant chat surface (the Hermes loop
  exposed as UI)."
- `local-agent-management.md:812` — "Three tools are added to the
  `hermes-acp` toolset surface…"
- `local-agent-management.md:830` —
  `agent_profile_id = "hermes_profile_generic_v1"`
- `local-agent-management.md:861-866` — `Hermes tool handlers HTTP into
  the BFF`; tools registered "on the owner desk-AI's `hermes-acp`
  session"
- `local-agent-management.md:878` — "ADR-013 — chat surface as Hermes
  loop"

These are spec text, not historical notes. The "Earlier drafts
named the runtime 'Hermes.'" disclaimer at `local-agent-management.md:204`
does not absolve the rest of the document — `hermes-acp` is named as a
live tool surface and `hermes_profile_generic_v1` is named as a live
default value.

**Edit:** § 14, § 14.5, § 14.6 need a real sweep — replace `hermes-acp`
with whatever the current MCP surface is (`packages/holon-mcp`?), strip
`hermes_profile_generic_v1` from the defaults block, and reframe ADR-013
references either as "superseded by [current ADR]" or rewrite the
sections in current vocabulary. This file should not list ADR-013/019 in
its "Cross-References" as if they were normative when the rest of `main`
treats them as superseded.

### #5 — Two competing INSTALL files

`README.md:449` links **"Full install guide: `INSTALL.md`"** (the
top-level one — 120 lines).

`README.md:540` links **"For the full guide … `docs/INSTALL.md`"** (a
different 403-line file).

Same word "full"; different files. New reader doesn't know which to
read.

**Edit:** decide which is canonical, delete the other (or convert the
top-level to a 5-line pointer at `docs/INSTALL.md`). My read:
`docs/INSTALL.md` is more complete; the top-level should be either the
canonical and `docs/INSTALL.md` deleted, or the top-level reduced to
"see docs/INSTALL.md".

---

## 3. Vocabulary Audit

| Term | Definition (best-fit) | Where it appears | Drift? |
|---|---|---|---|
| **Secretary** | Owner-facing warm CLI process; one per project | README §Architecture, §How it works; arch/local-agent §14.7; ADR memory-as-skill | No drift in new docs. But never reconciled with the older "owner_assistant" / "owner desk-AI" naming below. |
| **owner_assistant** / **owner desk-AI** | Older name for the same Secretary concept (Hermes era) | arch/local-agent-management.md:740-878; arch/owner-assistant-tools.md (entire file); arch/owner-config-service.md | **Yes — major.** Nowhere does any doc say "owner_assistant = the Secretary". A reader who clicks `local-agent-management.md` thinks they're reading about a different agent. |
| **owner-CLI** | The owner-facing CLI on which `holon-owner-recall` installs (System 2 reader) | README §"Memory update flow"; ADR memory-as-skill §Decision; skills/holon-owner-recall/SKILL.md:8 | Used freely without ever being defined. Implied = "the Secretary running as owner-scope-only"? Reader has to infer. |
| **Holon** | Internal codename — appears in MCP package name, filesystem path `~/holon-agents/`, doc-tree title "Holon Architecture", `local_attach_cmd: tmux a -t holon-<id>` | All docs; README mermaid §lines 113, 124, 152; arch/README.md:1 | The project is named "Manage Your CLI". "Holon" leaks in but is never explained. Mild confusion only — but worth a one-line note in README. |
| **Path A / Path B** | Persistent memory patch / next-turn synthetic nudge | README §HR; arch/hr-evaluator.md; arch/memory-update-flow.md; ADR hr-evaluator | Consistent across all four. ✅ |
| **harvest-on-retire** | Distill-then-discard memory at container destruction | README §Architecture, §"Memory update flow"; arch/local-agent §14.9; arch/memory-update-flow.md §4; ADR hr-evaluator §4.2 | Consistent. ✅ |
| **System 0 / 1 / 2** | Session / project / owner-global memory layers | README §134-220; arch/memory-update-flow.md §1; ADR hr-evaluator §4.5 | Consistent. ✅ |
| **boss-memory** | The on-disk markdown memory store at `~/holon-agents/boss/` | Used everywhere | Consistent. ✅ |
| **Hermes** | Removed runtime | "Historical note" at funcarch.md:109-113, local-agent §204-207, impl-arch §568. **But also active spec language** in owner-assistant-tools.md, admin-surfaces.md, local-agent §14.6 | **Yes — major.** Disclaimers in three places do not protect from live spec text using `hermes-acp` / `hermes_profile_generic_v1` as current values. See §5 below. |
| **secretary-HR / owner-HR** | Two HR tiers | README §HR; arch/hr-evaluator.md; ADR hr-evaluator | Consistent. ✅ |
| **"micromanagement" / "attach to any worker's tmux"** | README §1 bullet 6 + comparison table row 1 | `attach to any worker's tmux, watch, intervene` — exists as **a copy-pasteable `tmux attach` command** in the Members drawer (`apps/web/app/members/_components/MembersClient.tsx:388`), not an in-app attach. | Defensible (the README does say "your own tmux session: `attach` and drive it directly"), but the comparison table phrasing "supports micromanagement" oversells what is essentially "we don't hide tmux from you." Marketing-not-lying. |

---

## 4. Cross-doc Consistency

**Contradictions found:**

1. **CHANGELOG vs CHANGELOG** — `CHANGELOG.md:11-41` ships
   settle-watch + harvest-on-retire; `CHANGELOG.md:155-159` lists
   them as "Owner-gated (not in this release)". See §2 #1.

2. **memory-as-skill ADR vs itself** — `memory-as-skill.md:3` says
   install hook landed; `:54-58` and `:92` say it's "future wiring".
   See §2 #2.

3. **memory-update-flow.md / data-model.md (use `MEMORY/`) vs
   `SKILL.md` (uses flat `*.md`)** — filesystem path drift. See §2 #3.

4. **CHANGELOG vs README port numbers** — `README.md:480` dev mode
   binds `:3110`. `README.md:510` Windows port-proxy example uses
   `-Port 3000`. `README.md:530` Android build sets
   `NEXT_PUBLIC_DESK_ORIGIN=…:3000`. If the recommended (dev) setup
   uses 3110, the phone-pairing section should mention "use the port
   you bound" instead of hardcoding 3000. Minor but trips first-run.

5. **`docs/architecture/README.md` index lists 10 docs; the directory
   has 26.** 16 doc files in `docs/architecture/` are not linked from
   the index. Several of them (`admin-surfaces.md`,
   `owner-assistant-tools.md`, `runtime-adapter-interface.md`,
   `worker-dispatcher.md`, `peer-communication-architecture.md`,
   `cli-passthrough.md`) are referenced as canonical from the
   indexed docs. If they're canonical, the index should list them;
   if they're stale-and-deferred, the index should say so and the
   referencing docs should stop pointing at them.

6. **`docs/architecture/README.md:32-43` and the implementation
   architecture spec set table** — `implementation-architecture.md:36-51`
   lists 13 specs as "done" including `auth-and-identity.md`,
   `peer-communication-architecture.md`, `context-pack.md`,
   `deliverable-spec.md`, `reliability-and-testing.md`,
   `handoff-taxonomy.md`. None of those are in the `architecture/README.md`
   index. Two indexes, two different conceptions of "what's canonical".

**Checked and OK:**

- README's memory-update flow diagram (`README.md:237-296`) matches
  the `memory-update-flow.md` deeper version on directions, filenames,
  budget cap (8k), and Path A/B semantics.
- README's HR section (`README.md:297-343`) matches the
  `hr-evaluator-and-behavior-correction.md` ADR on tiers, paths,
  3-in-24h threshold, rubric items.
- Per-binary memory matrix (`CLAUDE.md/AGENTS.md/GEMINI.md/QWEN.md`)
  matches across `local-agent-management.md:886-898`,
  `memory-update-flow.md:44-46`, `hr-evaluator.md:88-94`,
  `data-model.md:787-793`, ADR `memory-as-skill.md`, ADR
  `hr-evaluator §4.3 Path A`. ✅
- `secretary-HR is a loop step, not a process` is stated identically
  in README §306-312, ADR §4.1, `hr-evaluator.md` §1,
  `local-agent-management.md` §14.8. ✅

---

## 5. Stale Hermes Residue — Verdict: **Sweep, don't keep**

The owner's sub-agent reported leaving "~174" Hermes refs as
"ADR-013/019 historical" in `runtime-adapter-interface.md` and
`owner-assistant-tools.md`.

Reality (`grep -ric hermes docs/ README.md CHANGELOG.md` → 624
hits across 60 files):

| File | hermes-refs | Verdict |
|---|---|---|
| `docs/architecture/owner-assistant-tools.md` | 78 | **Sweep or delete.** Entire doc is spec for the Hermes-era owner_assistant. Not protected by any disclaimer. |
| `docs/architecture/runtime-adapter-interface.md` | 45 | **Sweep or mark deprecated.** Cross-referenced as canonical by `impl-arch.md:41`. |
| `docs/architecture/local-agent-management.md` | 9 | **Sweep**, despite the "historical" disclaimer at line 204. Live spec text still uses `hermes-acp`, `hermes_profile_generic_v1`. See §2 #4. |
| `docs/architecture/admin-surfaces.md` | 8 | **Sweep.** Uses Hermes as live spec ("Destructive. Kills the Hermes ACP subprocess…" at line 55). |
| `docs/architecture/functional-architecture.md` | 3 | **Keep.** All three are inside the disclaimer block at 109-113. Clean. |
| `docs/architecture/implementation-architecture.md` | 3 | **Keep.** Lines 14, 353, 568 are explicitly "no Hermes runtime" / "RESOLVED: Hermes removed." Honest. |
| `README.md` | 3 | **Keep.** All in the comparison-table row that's literally about Hermes the project. Honest. |

**Why "keep historical" is the wrong call here:**

A disclaimer at the top of a 900-line spec doc does not cover the
specifics inside. A reader who Ctrl-F's `hermes-acp` to figure out
what tool surface they should call cannot tell whether `hermes-acp`
is (a) a thing they need to plug in, (b) the predecessor of
`packages/holon-mcp`, or (c) the predecessor of nothing because the
whole subsystem is gone. The disclaimer says "treat 'Hermes' as a
stand-in for 'the CLI adapter'" but `hermes-acp` is a *tool surface*,
not a runtime. The mapping is not clean.

**Recommendation:** in the four "sweep" files above, do a real
find-and-replace pass. For terms with a clean current replacement
(Hermes runtime → CLI adapter, hermes-acp → packages/holon-mcp,
owner_assistant chat → Secretary chat), replace. For terms that
genuinely don't have a current analogue (`hermes_profile_generic_v1`,
the entire `hermes-acp` toolset surface), either delete the section
or mark **the section** "deprecated; superseded by [new ADR]" — not
the document. Disclaimers attached to whole documents are documentation
smell; they signal "we should have rewritten this but didn't."

---

## 6. Reader-workflow Trace

I pretended to be a new reader. Started at `README.md:1`.

**Step 1 — "what does this do for me"** (README §1-99)
Works. Crisp pitch, honest table, no surprises. ✅

**Step 2 — "what's the memory model"** (README §134-296)
Works. The System 0/1/2 section is one of the best parts of the
repo — clean Kahneman framing, clean table, clean diagram, clean
"why this matters as differentiation" paragraph. The
memory-update-flow ASCII diagram (`:237-278`) is the right level of
detail for a README. ✅

**Step 3 — "how does HR work"** (README §297-343)
Works for the conceptual layer. ✅ But the cross-link at `:342` to
`docs/adr/hr-evaluator-and-behavior-correction.md` is the right
target; the architectural counterpart (`docs/architecture/hr-evaluator.md`)
is not linked from the README — a reader who wants "how does it
actually wire" has to discover it via `docs/architecture/README.md`.
Minor.

**Step 4 — "how do I install and run it"** (README §447-540)
Confusing. Two issues:

- **Two INSTALL files** with overlapping "full guide" claims. §2 #5.
- The **`HOLON_OPEN_DEMO` / `HOLON_LAN_ACCESS` table** at `:497-500`
  is helpful but doesn't say "you need one of these for desk
  to work at all." A new reader on localhost-only with neither set
  may hit the device-token gate and not know why.

**Step 5 — "how is this architected, really"** (clicks the
"Architecture" deep-link or navigates to `docs/architecture/README.md`)
Breaks. Three problems compound:

1. `docs/architecture/README.md:32-37` says
   `memory-update-flow.md` is the depth version of the README diagram —
   true and good.
2. Then `:38-43` says `hr-evaluator.md` is the implementation-level
   companion to the HR ADR — true and good.
3. Then `:27-30` says `local-agent-management.md` is the Core 1 deep
   dive — and the reader clicks through to a document that talks
   about Hermes, `hermes-acp`, `owner_assistant`, ADR-013, ADR-019,
   `agent_profile_id: "hermes_profile_generic_v1"`. None of which
   the reader has any context for. The disclaimer at line 204 does
   not help because the live spec text at lines 740, 808, 812, 830,
   861-866, 878 keeps using these terms as if they're current.

A new reader concludes one of: (a) the doc is stale, (b) the project
is in transition and they should come back later, (c) they're missing
ADR-013 context and should go find it. Any of these is bad.

**Step 6 — "where do I find ADR-013, ADR-015, ADR-019?"**
`docs/decisions/` exists with 040+ files but the audit list doesn't
cover those; meanwhile `docs/adr/` (which the README and arch
sync docs link to) only has 6 files. **There are two ADR
directories** with overlapping purposes — `docs/adr/` and
`docs/decisions/`. ADR-013 is in `docs/decisions/`. The audit
target ADRs (memory-as-skill, hr-evaluator, role-templates) are in
`docs/adr/`. Pure cross-doc inconsistency on where ADRs live. Worth
fixing or at least documenting in `docs/architecture/README.md`.

---

## 7. Style Nits (only the ones I'd defend)

1. **README §381 (the comparison table)** — primary-purpose column
   for "This project" is a single 80-word run-on listing four
   different things separated by em-dashes. The row would beat
   paragraphs as a 3-bullet list ("boss/manager view", "mobile-first
   management", "thin shell"). Read-aloud test fails.

2. **README §31-78 ("Why" + "Architecture")** — the word
   "harness" appears 7 times in 30 lines (§44-54). On second read it
   is doing a lot of work — sometimes "the planner/tool-router/memory
   layer the CLI itself ships", sometimes "what we don't build",
   sometimes "what new agent frameworks ship". One clean definition
   ("harness = planner + tool router + memory + prompt-stack + agent
   loop, all bundled") at first use would let the rest stay terse.

3. **`docs/architecture/local-agent-management.md` 912 lines** is
   the largest doc in the audit set. Sections 14.5 / 14.6 / 14.7 /
   14.8 / 14.9 are five sequential numbered sub-headings; that's a
   sign the doc was patched-by-append rather than re-organized. The
   reader cannot tell from the TOC that 14.7 (per-binary memory
   matrix) and 14.8 (HR loop step) are the two most important new
   sections.

4. **ADR `memory-as-skill.md`** doesn't surface the "this changed
   secretary persona templates" consequence cleanly — the consequences
   list at `:42-66` mixes "the win" with "the cost" without separating
   them visually. A `### Wins` / `### Costs` split (which the
   role-templates ADR §"Consequences" *almost* does) would make the
   accept/reject decision easier to re-evaluate later.

5. **`agent-heartbeat-watchdog.md §11.5`** is excellent content
   buried at the bottom of an unrelated-named file. The doc is
   about heartbeat-and-watchdog; settle-watch is a different signal
   (settle, not stall). Reader looking for "where does Path B's
   transport live" has to know to grep, not navigate. Either rename
   the file or extract §11.5 to its own doc.

---

## 8. Honesty Audit (claims vs code spot-checks)

| Claim | Where | Code reality | Verdict |
|---|---|---|---|
| "supports micromanagement (attach to any worker's tmux, watch, intervene)" | `README.md:21-23` + comparison table `:383` | `MembersClient.tsx:386-410` displays a copy-paste `tmux attach -t holon-<id>` command in a drawer with instructions on `Ctrl-b d` to detach. There is no in-app "attach" button; the user has to copy the command to their own terminal. | **Lightly oversold.** The README phrasing implies an in-app capability ("attach to any worker's tmux, watch"); the actual UX is "we don't hide tmux, here's the command, run it yourself". Defensible; "supports" is doing the work. Suggest soften: "every worker has a tmux session you can attach to from any terminal — copy-paste command exposed in the UI." |
| "harvest-on-retire" works end to end | `README.md:185-211` + CHANGELOG §Added | `packages/core/src/boss-memory-harvest-service.ts` exists and is invoked from `staff-management-service.ts:318` (employee retire) and `secretary-projects-service.ts:427` (project retire). Both invocations are `void import(...)` fire-and-forget; "errors here MUST [not break the retire]" per the call-site comment. | **Real, with a caveat.** Implementation exists. The fire-and-forget pattern means a silent harvest failure during retire is possible. Owner explicitly cares about no-silent-failure per the North Star; flag for follow-up but the README claim is true. |
| "install hook for memory-recall skill" | `memory-as-skill.md:3`  | `cli-memory-scaffold.ts:108` defines `installRecallSkill`; `:191` calls it. ADR's own "future wiring" lines at `:54-58, :92` are stale. | **True.** ADR-internal contradiction is the only problem. See §2 #2. |
| Per-binary memory matrix (claude→CLAUDE.md, codex→AGENTS.md, gemini→GEMINI.md, qwen→QWEN.md) | every doc | `cli-memory-scaffold.ts` (the recall-skill install lives here too) is the materializer. Code matches matrix. | ✅ |
| Multi-CLI employee support | `README.md:387` comparison row, `impl-arch §7.5` | `packages/core/src/cli-adapters.ts` exists; employees can be any of the 4. Secretary is claude-pinned (honestly disclosed in same row). | ✅ Honestly scoped. |
| "settle-watch idle detection on warm secretaries; producer registry; non-preemptive prepend queue" | CHANGELOG §Added (post-CHANGELOG-init) | `apps/web/lib/settle-watch.ts`, `apps/web/lib/synthetic-producers.ts`, `apps/web/lib/warm-agent.ts` all exist; tests cited at `agent-heartbeat-watchdog.md:208-210`. | ✅ |
| Owner-HR cron + settle-watch trigger | `README.md:328-331`, ADR §4.2 | Process file `packages/core/src/hr-paths.ts` (Path B producer hookup) and `hr-promotion.ts` (B→A bookkeeping) exist. I did not verify the cron timer scheduling — flagged for the impl. | Probably true; not fully verified in this audit. |

---

## 9. Org Recommendations

1. **Merge or kill duplicate INSTALL files.** §2 #5.
2. **Decide where ADRs live.** Pick `docs/adr/` or `docs/decisions/`,
   not both. If both must exist, name them differently (e.g.
   `docs/decisions/` → `docs/iteration-decisions/`) and have
   `docs/architecture/README.md` point at both with the distinction
   spelled out.
3. **`docs/architecture/README.md` should list all 26 files in the
   directory** — or move the unlisted ones to
   `docs/architecture/_archive/`. Half-listing is worse than either.
4. **Extract `agent-heartbeat-watchdog.md §11.5` into a sibling doc**
   `settle-watch-pipeline.md`. It's load-bearing for HR Path B and
   nothing about it belongs in "heartbeat & watchdog."
5. **README should add a 1-line glossary** at the top of the
   "Architecture" section: "Holon = internal codename for this
   project (you'll see it in package names and `~/holon-agents/`
   paths). Secretary = the warm CLI process you chat with."
6. **owner-assistant-tools.md should be either swept or moved to
   `_archive/`**. As it stands it pollutes search results with
   Hermes-era spec.

---

## 10. Two Strong Points (don't break these)

1. **README's System 0/1/2 section (lines 134-220) is the single
   sharpest piece of writing in the repo.** It takes a known
   framework (Kahneman + VLA fast/slow), applies it to a non-obvious
   domain (agent memory), uses a clean table to ground each layer in
   a concrete filesystem path + lifecycle, gives the reader a
   diagram, then closes with a one-sentence "why this is
   differentiation" paragraph. Marketing and engineering both work
   off the same paragraph — that's hard to do.

2. **The two new architecture docs (`memory-update-flow.md`,
   `hr-evaluator.md`) and the three new ADRs (`memory-as-skill`,
   `hr-evaluator-and-behavior-correction`, `role-templates-and-persona-composition`)
   form a tight, well-cross-linked cluster.** They name the same
   things the same way (Path A/B, rule-hash, sentinel-bracketed,
   System 0/1/2), they point at code by file:line, they flag open
   questions explicitly with a `§` callout, and they cite commit
   SHAs for what landed when. This is what good ADR hygiene looks
   like. The architecture sync wave that produced them is genuinely
   the best documentation work in `docs/`. The reason this audit
   reads negative is that *those new docs sit on top of a layer that
   didn't get the same treatment* — not that the new work is bad.

---

*End of audit.*

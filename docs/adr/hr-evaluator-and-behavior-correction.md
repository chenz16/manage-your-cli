# ADR: HR evaluator + two-path behavior correction

- Status: Accepted (2026-05-30; slice 1+2 landed in commits 9649f74 / 2714d7a / e8281a7)
- Date: 2026-05-30
- Context owner: Chen Zhang

## Context

Secretaries drift. Owner currently corrects them manually mid-conversation —
canonical example: a secretary starts *doing* the work itself instead of
dispatching, and the owner types "Stop. You're the 7×24 manager. Dispatch
this." That pattern recurs. Owner wants the loop automated:

> 干活评估 + 定期注入机制: 后台对每个 agent 秘书都要做随时评估. 行为矫正:
> (A) 通过记忆注入 CLI 的 memory 文档; (B) 直接在会话中注入 synthetic message.

Two decisions to specify: who evaluates, and how corrections land.

## Decision

Add an **HR layer** with two tiers and **two correction paths** (A persistent
memory edit; B live conversation nudge), with auto-promotion B→A on repeat.

### 4.1 Tier architecture

Two tiers; both reuse existing pieces — no new runtime.

- **owner-HR (System 2, fixed).** One HR agent living at
  `~/holon-agents/boss/owner/hr/`. Evaluates **secretaries** across all
  projects. Its job is cross-project drift detection: the same mistake showing
  up in N projects becomes an owner-level signal (rule lives in System 2,
  applies everywhere).
- **secretary-HR (per secretary, inline capability — NOT a separate agent).**
  Each secretary self-evaluates its **employees** as part of its normal
  dispatch loop. Reuse: the secretary already dispatches and reads employee
  output; HR is just "after dispatch, score the result" — one extra loop step,
  not a new process.

No third tier. Employees do not get HR (ephemeral, evaluated by their boss).

### 4.2 Evaluation triggers

Periodic + event-driven, layered.

| Trigger | Tier | Cadence / event | Why |
|---|---|---|---|
| Cron tick | owner-HR | ~30 min | Drift detection is statistical — needs a sample of cross-project behavior, not real-time. 30 min ≈ a few dispatch cycles per project; under that the signal is noisy, over that delays auto-promotion past owner patience. |
| Per-dispatch completion | secretary-HR | every employee return | Cheap (secretary is already reading the output) and immediate; catches per-employee drift before it ships. |
| Employee retirement | both | harvest hook from Task #15 | Retirement = last chance to score; feeds the harvest distillation. |
| Settle-watch fire | both | Task #20 event | The same "quiet window" signal #20 uses for synthetic nudges is also when behavior summaries are stable. |
| Owner explicit "review X" | both | on demand | Manual override; bypasses cadence. |

Cadence numbers are starting points; tune from owner-HR token cost (§4.6).

### 4.3 Two correction paths

#### Path A — Persistent (memory file injection)

- **When**: rule-shaped, recurring patterns. "Always dispatch, never do."
  "Never modify `apps/` from a spec branch." Role-definition corrections.
- **How**: HR emits a markdown patch into the target's **per-CLI memory file**
  (`CLAUDE.md` / `AGENTS.md` / `GEMINI.md` / `QWEN.md` — per the matrix from
  commit `44be633`, materialized by
  `packages/core/src/cli-memory-scaffold.ts`). Patch lands under a managed
  section:

  ```markdown
  ## HR-Corrections
  <!-- managed by owner-HR — do not hand-edit; owner can revert via the 🔴 line -->

  - (2026-05-30) Always dispatch heavy work; do not execute it yourself.
  - (2026-05-29) Use [[wikilinks]] for cross-references in memory files.
  ```

- **Properties**: Survives respawn. **Idempotent** — HR keys each rule by a
  stable hash (rule text normalized), re-runs replace the dated entry in place
  rather than appending duplicates.
- **Scope**: secretary-HR writes into employee memory; owner-HR writes into
  secretary memory.

#### Path B — Next-turn nudge (non-preemptive injection)

- **When**: behavioral deviation observed in the just-completed turn. The
  canonical case is the owner's manual "Stop. You're the 7×24 manager." —
  but HR does **not** interrupt the running turn. Owner clarification
  2026-05-30: 不要打断 就是下一次提醒.
- **How**: HR enqueues a synthetic system-or-user message that gets
  **prepended to the next inbound message** (either the owner's next turn,
  or the next dispatch result return). Reuses Task #20's settle-watch →
  synthetic-message pipeline as transport; HR becomes a new producer on
  that channel. The trigger semantics differ from #20's other producers:
  HR's nudge waits for the NEXT input boundary rather than firing on
  settle. No new transport, no preemption.
- **Properties**: **Not persistent on its own** — vanishes with the
  conversation. Non-preemptive: the current turn finishes regardless, even
  if mid-turn behavior was the trigger. Rationale: a single drifted turn is
  usually already committed by the time HR scores it; preemption would
  break execution continuity for no recovery gain. Next-turn correction is
  cheap, low-risk, and matches how the owner manually intervenes.

#### When to pick which

| Situation | Path |
|---|---|
| Single-turn slip, agent has the right rule but missed it | B |
| Recurring pattern, agent doesn't seem to have the rule | A |
| Rule lives in owner-global ("always dispatch") | A on every secretary |
| New project quirk ("for this project, use Codex not Claude") | A on that secretary only |

### 4.4 Promotion rule (A from B)

If HR fires the **same Path-B nudge ≥3 times in a rolling 24h window** for the
same target, auto-promote to Path A.

- "Same nudge" = identical normalized rule text (same hash used for
  idempotence in §4.3 Path A).
- Auto-promotion writes the rule into the target's HR-Corrections section
  **and** surfaces a 🔴 line to the owner:

  > 🔴 HR auto-promoted on `<agent>`: "<rule>". Accept / edit / revert.

- Owner can revert; revert deletes the entry AND marks the rule as
  "promotion-vetoed" so future B-fires don't re-promote it. Veto lives
  in owner-global System 2 boss-memory
  (`~/holon-agents/boss/owner/hr-promotion-vetoes.json`), **not** in
  HR-scoped state and **not** in the target's memory — see §4.9 for
  rationale and migration.
- Threshold 3 and window 24h are tunable; start there because:
  - 1× is noise (one bad turn); 2× could be the same turn re-tried; 3× is the
    smallest "this is a pattern" signal.
  - 24h window matches a typical owner workday — if owner watches the same
    drift across a day, they'd correct it themselves anyway; HR pre-empts.

### 4.5 What HR does NOT do

- **Not a separate runtime tier.** owner-HR is just one CLI agent in
  `~/holon-agents/boss/owner/hr/` (same shape as any other agent).
  secretary-HR is a loop step, not a process.
- **Doesn't evaluate the owner.** Owner is terminal (per
  `project_myc_system_0_1_2.md` harvest table — no layer above).
- **Doesn't write code, doesn't dispatch work.** Pure observe-score-correct.
  All correction goes through Path A (memory patch) or Path B (synthetic
  message). No direct mutation of agent state otherwise.
- **Doesn't read user content beyond what the secretary already read.** No
  separate transcript ingestion — reuses settle-watch / dispatch-completion
  signals.

### 4.6 Evaluation inputs (what HR reads)

Pure read-only. HR never touches the secretary's process.

| Source | Tier | Status |
|---|---|---|
| Secretary warm-agent stream-json log | owner-HR | ✅ already captured by `apps/web/lib/warm-agent.ts` |
| Employee tmux pane history | secretary-HR | ✅ `tmux capture-pane` |
| Boss-memory writes (git diff `~/holon-agents/boss/projects/<sproj_id>/`) | owner-HR | ✅ filesystem |
| `process-registry` status changes / heartbeat events | both | ✅ `apps/web/lib/heartbeat.ts` emits |
| settle-watch event | both | ⏳ Task #20 |
| Per-agent token counter | both (budget cap, §4.8) | ✅ `project_myc_token_usage` instrumentation |

owner-HR pulls these on cron tick + settle event; secretary-HR reads its
employee's tmux + dispatch return as part of its normal loop step.

### 4.7 Rubric (markdown checklist, not numeric)

Each evaluation pass appends one checklist row per scored turn to the
evaluation log at
`~/holon-agents/boss/owner/hr/evaluations/<sproj_id>/YYYY-MM-DD.md`.
Unchecked items are drift signals; counted toward §4.4 promotion threshold.

```markdown
## 2026-05-30 secretary=acme-ceo
- [x] dispatched-not-DIY     — heavy work went to a sub-agent
- [x] respected-north-star   — no RAG/vector/abstraction proposals
- [ ] read-INDEX-before-act  — wrote memory without reading INDEX.md
- [x] role-fidelity          — manager persona maintained
- [ ] memory-hygiene         — boss-memory diff is clean and INDEX'd
```

Rubric items are checked off by HR via stream-json + tmux-history scan;
each item maps to a normalized rule hash (§4.4) so repeats key correctly.
Default rubric ships with the five items above (manager-role, north-star,
INDEX-discipline, role-fidelity, memory-hygiene); owner can extend by
editing owner-HR's persona.

### 4.8 Open questions (flagged, not decided)

- **Who reviews the reviewer?** owner-HR can drift too. No layer above it
  (System 2 is terminal). Options: periodic owner spot-check via a 🔴 weekly
  digest; or a thin "HR-of-HR" loop that only checks owner-HR's idempotence
  and promotion-veto hygiene, not its judgement. Defer.
- **Cross-CLI HR.** Is owner-HR claude-only, or can it be any CLI? Per-binary
  memory matrix (commit `44be633`) means HR-Corrections lands in
  `CLAUDE.md` vs `AGENTS.md` vs `GEMINI.md` vs `QWEN.md` depending on the
  *target*'s binary — that's independent of what binary HR itself runs on.
  Default: HR runs on whatever the owner-CLI runs on; revisit if owner moves.
- **Token budget impact.** Every dispatch-completion adds a secretary-HR
  scoring pass; every 30 min adds an owner-HR cross-project sweep. Need a
  measurement pass before scaling cadence. Suggest: instrument with the
  existing per-agent token counter (`project_myc_token_usage`) and set a soft
  budget; if HR exceeds N% of secretary tokens, halve its cadence.

### 4.9 Owner-veto persistence across re-installs

**Resolved 2026-05-30.**

Original concern (kept for history): promotion-veto previously lived under
`ownerHrRoot()` at `~/holon-agents/boss/owner/hr/promotion-vetoes.json`. HR
is an agent and agents can be re-scaffolded from scratch, so vetoes stored
in HR-scoped memory are lost on rebuild and HR re-promotes
previously-rejected rules. Either vetoes must live in owner System 2
boss-memory (not HR's own scratch), or scaffolding must preserve them.

**Decision.** Move vetoes out of `ownerHrRoot()` and into owner-global
System 2 boss-memory root. Vetoes are **owner-authored decisions**; owner
decisions live in `~/holon-agents/boss/owner/` by definition (System 2 is
terminal — there is no layer above the owner). HR-scoped state is for
HR's own scratch (evaluation logs, rubric prompts) — not for things that
must survive HR being thrown away.

**New path.**

```
~/holon-agents/boss/owner/hr-promotion-vetoes.json
```

Sibling to other owner-global files (`INDEX.md`, `MEMORY/*.md`), **not**
inside the `hr/` subdir. The `hr-` filename prefix preserves topical
grouping without re-introducing the HR-scoped directory.

**Format unchanged:**

```json
{
  "vetoes": [
    {
      "rule_hash": "a3f9c0…",
      "target_agent": "secretary-acme",
      "rule_text": "…",
      "vetoed_at": "2026-05-30T14:22:01.000Z"
    }
  ]
}
```

**Migration rule.** On first HR boot after this change: if the legacy
path `~/holon-agents/boss/owner/hr/promotion-vetoes.json` exists, move it
(atomic rename) to the new path. One-time, idempotent — a second run with
the file already at the new location is a no-op. No deduplication needed
since only one file can pre-exist.

**Scope of this ADR amendment.** Resolved 2026-05-30; implementation
landed on branch `feat/hr-veto-persistence-impl`. Code points:

- `packages/core/src/hr-paths.ts` — `hrVetoPath()` now under owner System 2
  root; `legacyHrVetoPath()` exported for migration only.
- `packages/core/src/hr-promotion.ts` — `migrateLegacyVetoesIfNeeded()`
  one-shot atomic rename, lazy-invoked on first veto read; emits
  `hr.veto.migrated` audit line on success, `hr.veto.migrate.failed` on
  error (HR never fails on migration error).
- `packages/core/tests/hr-veto-migration.test.ts` — covers
  migrated / noop / skipped_new_exists / idempotent.

## Alternatives considered

1. **One global HR agent, no secretary-HR loop step.**
   Rejected: every dispatch would round-trip through owner-HR, adding latency
   and tokens to the hot path. secretary-HR-as-loop-step is free (it's already
   reading the output).

2. **Path A only (no live nudge).**
   Rejected: memory patches only land on respawn / re-read; an active
   conversation has no signal to re-load. Path B is the in-conversation
   correction channel — applied at the next input boundary (not as a
   preemptive interrupt; see §4.3 Path B).

3. **Path B only (no persistent memory).**
   Rejected: every respawn loses every correction. Path A is what makes
   learning stick.

4. **Have HR dispatch its own corrective work.**
   Rejected: blurs HR with the secretary; HR-judges-and-does is a new role
   no one asked for. Keep observe-score-correct.

## Related

- `~/.claude/projects/-home-chenz-project/memory/project_myc_system_0_1_2.md`
- `docs/adr/memory-as-skill.md` (sibling ADR; recall mechanism HR depends on)
- `packages/core/src/cli-memory-scaffold.ts` — per-binary memory matrix
- commit `44be633` — per-binary memory file naming
- Task #15 — harvest-on-retire hook (HR trigger)
- Task #19 — implement §4.9 veto-path migration (move
  `promotion-vetoes.json` from `ownerHrRoot()` to owner System 2 root +
  one-shot legacy migration). **Landed** on
  `feat/hr-veto-persistence-impl`.
- Task #20 — settle-watch → synthetic-message pipeline (Path B transport)

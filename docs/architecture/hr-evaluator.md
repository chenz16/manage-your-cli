# HR Evaluator — Wire-Up

Status: draft v0.1
Date: 2026-05-30
Owner: design
Position: Implementation-level companion to ADR
[`../adr/hr-evaluator-and-behavior-correction.md`](../adr/hr-evaluator-and-behavior-correction.md).
The ADR carries the **rationale** (why two tiers, why two paths, why
auto-promotion, why non-preemptive). This doc tracks **how it actually
wires** in the codebase.

For the broader memory picture, see
[`memory-update-flow.md`](memory-update-flow.md) § "Flow 3 — Write-Down".

## 1. Two Tiers

| Tier | Lives at | Process |
|---|---|---|
| **owner-HR** | `~/holon-agents/boss/owner/hr/` | One persistent CLI agent — same shape as any other agent. Owns its own tmux session. |
| **secretary-HR** | Inside each secretary's loop | **Not a separate process.** A scoring step inside the secretary's existing dispatch-completion handler. |

owner-HR sweeps **across projects** (so it needs its own context window);
secretary-HR's input is already in hand at dispatch completion (so a
separate process would round-trip for no gain). Per ADR § 4.1.

## 2. Scheduling

### owner-HR

| Trigger | Cadence / source | Wire path |
|---|---|---|
| Cron tick | ~30 min (ADR § 4.6) | Systemd timer or `setInterval` in desk server; sends inbound to owner-HR tmux |
| settle-watch event | secretary settle (`apps/web/lib/settle-watch.ts`) | owner-HR registered as producer; producer's `onSettle` enqueues "evaluate X" |
| Owner `review <agent>` | manual | Owner CLI command; same inbound shape as cron |

Cron + settle hybrid: cron catches statistical drift; settle catches
"this secretary just finished a noisy turn, score it now."

### secretary-HR

Single trigger: dispatch completion. Inside the secretary's normal loop:

```
secretary dispatches employee
  → employee returns (tmux capture + deliverable draft)
  → secretary normalizes the result (existing step)
  → ⬇ NEW: secretary-HR.score(employee, result, rubric)
  →   Path A: enqueue patch on employee's per-binary memory file
  →   Path B: enqueue synthetic message on the employee's channel
  → secretary returns to owner
```

No new process, no extra round-trip, no measurable token overhead beyond
the rubric scoring pass over text the secretary already read.

## 3. Producer Registration

Path B rides the synthetic-producers channel (see
`agent-heartbeat-watchdog.md` § 11.5 for the pipeline shape). HR is **a
producer on that channel**, registered at agent boot:

| Producer | Registered by | Emits on |
|---|---|---|
| `hr-path-b` (owner-HR) | owner-HR boot writes to the desk-server producer registry | settle of a secretary owner-HR is scoring |
| `hr-path-b` (secretary-HR) | each secretary's boot | dispatch completion + (optional) settle of its employees |

Same producer name across tiers because the *channel contract* is the
same (`SyntheticMessage` with `role: 'user'`, `sourceProducer:
'hr-path-b'`, `enqueuedAt: epoch_ms`). The differentiating signal is the
target — promotion bookkeeping (§ 5) keys by `(target, rule_hash)`.

Wiring source:

- Types: `apps/web/lib/synthetic-producers.ts`
- Settle trigger: `apps/web/lib/settle-watch.ts → collectOnSettle(entry)`
- Drain on next inbound: `apps/web/lib/warm-agent.ts → drainSyntheticQueue`
  inside `sendWarmTurn`, prepending drained messages to the new inbound

The **prepend-invariant** in `warm-agent.ts` is HR Path B's only
correctness dependency — drained messages must always land before the new
inbound, never interleaved into a running turn.

## 4. Path A — Persistent Patch

### Where it writes

Picks the file by the **target**'s binary:

| Target CLI | File |
|---|---|
| `claude` | `<target_cwd>/CLAUDE.md` |
| `codex` | `<target_cwd>/AGENTS.md` |
| `gemini` | `<target_cwd>/GEMINI.md` |
| `qwen` | `<target_cwd>/QWEN.md` |

The author's binary is irrelevant. See
[`local-agent-management.md`](local-agent-management.md) § 14.7 for the
matrix.

### Managed section

```markdown
## HR-Corrections
<!-- managed by owner-HR — do not hand-edit; owner can revert via the 🔴 line -->

- (2026-05-30) Always dispatch heavy work; do not execute it yourself.
- (2026-05-29) Use [[wikilinks]] for cross-references in memory files.
```

If a `## HR-Corrections` heading exists **without** the sentinel, the
writer refuses to clobber it (protects hand-written sections from silent
overwrite).

### Code path

`packages/core/src/hr-path-a.ts`:

- `normalizeRuleText(text)` — lowercase, collapse whitespace, strip
  trailing punctuation. Same normalization used for § 5 promotion keys.
- `ruleHash(text)` — SHA-256 prefix (12 hex chars) of normalized text.
- `applyRule(targetFile, rule)` — read → parse managed section → find or
  insert by rule-hash → write atomically (`renameSync` from temp).

### Idempotence

Same rule re-emitted: dated entry refreshes in place (new date, same hash,
same position). Different rule, same target: appended chronologically.

### Owner revert

Hand-edit the managed section to delete a rule, OR — cleaner — use the 🔴
promotion line (§ 5) which records a veto so HR never re-promotes.

## 5. Path B → Path A Promotion

### Counting

owner-HR tracks per-target Path-B emissions in a rolling 24h window with
key `(target_agent, rule_hash)` and threshold 3. Storage:
`packages/core/src/hr-promotion.ts` + state under
`~/holon-agents/boss/owner/hr/`.

### Auto-promote

On the 3rd B-fire of the same `(target, rule_hash)`:

1. Call Path A writer with the rule text.
2. Emit 🔴 line into owner chat:

   > 🔴 HR auto-promoted on `<agent>`: "<rule>". Accept / edit / revert.

3. Suppress further B-fires of the same rule for this target.

### Owner action

- **Accept** — no-op.
- **Edit** — owner provides new text; HR calls Path A writer with the
  edited text (new rule-hash; old hash effectively orphaned for future
  B-fires of the original text).
- **Revert** — HR removes the entry from the target's `## HR-Corrections`
  AND appends to `~/holon-agents/boss/owner/hr-promotion-vetoes.json`
  (owner-global System 2 root, **not** the HR-scoped subdir; format in
  [`data-model.md`](data-model.md) § 4.99.3).

Future B-fires whose `(target, rule_hash)` matches a vetoed entry never
auto-promote again.

### Veto persistence — Resolved (ADR § 4.9, 2026-05-30)

Vetoes live at `~/holon-agents/boss/owner/hr-promotion-vetoes.json`
(owner-global System 2 root). Previously stored under `ownerHrRoot()` at
`…/owner/hr/promotion-vetoes.json`; moved out so owner-authored decisions
survive HR re-scaffolding. On first boot after the change, HR migrates
the legacy file (atomic rename, idempotent). See ADR § 4.9 for full
rationale; [`memory-update-flow.md`](memory-update-flow.md) § 7 mirrors
the resolution.

## 6. Rubric

Markdown checklist per ADR § 4.7. Default ships in
`~/holon-agents/boss/owner/hr/persona.md`:

- `dispatched-not-DIY`
- `respected-north-star`
- `read-INDEX-before-act`
- `role-fidelity`
- `memory-hygiene`

Each scoring run appends one checklist row to
`~/holon-agents/boss/owner/hr/evaluations/<sproj_id>/YYYY-MM-DD.md`:

```markdown
## 2026-05-30 secretary=acme-ceo
- [x] dispatched-not-DIY
- [x] respected-north-star
- [ ] read-INDEX-before-act
- [x] role-fidelity
- [ ] memory-hygiene
```

Each rubric item normalizes to a rule-hash so repeat unchecks key
correctly into § 5's promotion counter. Owner extends the rubric by
editing the owner-HR persona. No schema lock; pure markdown.

## 7. Token Budget

Per ADR § 4.8: instrumented via the per-agent token counter
(`project_myc_token_usage`). Soft budget: HR ≤ a small fraction of
secretary tokens. If exceeded, halve cadence (30 min → 60 min). The budget
check is a periodic pass, not a per-call gate.

## 8. What HR Cannot Do

Per ADR § 4.5, as runtime checks:

- Never spawns processes the owner didn't authorize.
- Never writes outside `~/holon-agents/boss/` or the target agent's
  per-binary memory file. No `apps/` writes, no SQL writes, no MCP tool
  calls except `read_memory`.
- Never preempts a running turn. Only delivery for Path B is the
  prepend-on-next-inbound invariant in `warm-agent.ts` (§ 3).
- Never scores the owner. System 2 is terminal.

## 9. Cross-References

- ADR `../adr/hr-evaluator-and-behavior-correction.md` — rationale
- ADR `../adr/memory-as-skill.md` — recall mechanism HR reads through
- README § "HR evaluator + two-path behavior correction" — owner view
- [`memory-update-flow.md`](memory-update-flow.md) § 5 — Path A / B flow
- [`local-agent-management.md`](local-agent-management.md) § 14.7 + § 14.8
- [`data-model.md`](data-model.md) § 4.99.2 + § 4.99.3
- [`agent-heartbeat-watchdog.md`](agent-heartbeat-watchdog.md) § 11.5
- `packages/core/src/hr-path-a.ts` — Path A writer
- `packages/core/src/hr-paths.ts` — Path B producer hookup
- `packages/core/src/hr-promotion.ts` — B→A bookkeeping
- `apps/web/lib/settle-watch.ts`, `apps/web/lib/synthetic-producers.ts`,
  `apps/web/lib/warm-agent.ts` — pipeline

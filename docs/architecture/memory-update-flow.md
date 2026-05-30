# Memory Update Flow

Status: draft v0.1
Date: 2026-05-30
Owner: design
Position: Implementation-level spec for the three memory flows in the
System 0/1/2 hierarchy. The product-side one-screen view lives in
[`README.md`](../../README.md) § "Memory update flow"; this is the depth
version — filesystem layout, idempotence, Skill triggers, distillation
prompt shape, promotion + veto, edge cases.

Companion: [`hr-evaluator.md`](hr-evaluator.md) covers HR wire-up;
ADR `../adr/memory-as-skill.md` covers why recall is a Skill.

## 1. Layers (Recap)

| Layer | Filesystem root | Lifecycle |
|---|---|---|
| **System 0** session | inside the warm CLI process | ephemeral; ends with the turn |
| **System 1** per-project | `~/holon-agents/boss/projects/<sproj_id>/` | hours → weeks |
| **System 2** owner-global | `~/holon-agents/boss/owner/` | months → years |

System 0 has no on-disk presence. System 1 and System 2 share the same
tree shape (`INDEX.md` + `MEMORY/*.md`) and the same Skill-based recall.

## 2. Filesystem Layout

```
~/holon-agents/boss/
├── owner/                          # System 2
│   ├── INDEX.md
│   ├── MEMORY/*.md
│   └── hr/
│       ├── persona.md              # owner-HR role + rubric
│       ├── evaluations/<sproj_id>/YYYY-MM-DD.md
│       └── promotion-vetoes.json
├── projects/<sproj_id>/            # System 1
│   ├── INDEX.md
│   ├── MEMORY/*.md
│   └── secretary/<binary>.md       # CLAUDE.md / AGENTS.md / ...
└── _archived/<sproj_id>/           # retired projects, fadeable
```

Per-employee memory files live **at the employee's cwd**. File name
depends on the binary backing the employee: `claude → CLAUDE.md`,
`codex → AGENTS.md`, `gemini → GEMINI.md`, `qwen → QWEN.md`.
Materialization: `packages/core/src/cli-memory-scaffold.ts`.

## 3. Flow 1 — Read-On-Demand (Skill-Triggered)

### Trigger

Two Claude Code Skills, installed at agent boot: `holon-memory-recall` on
every per-project secretary (System 2 + own System 1) and
`holon-owner-recall` on the owner-CLI (System 2 only). The harness matches
a Skill's `description` against current intent and fires as a reflex — not
prompt obedience. See ADR `../adr/memory-as-skill.md`.

### Protocol

```
1. read INDEX.md (one I/O)
2. pick at most 2–3 detail files based on INDEX + question
3. read those (≤ 3 I/O)
4. hard cap total at ~8k chars; drop lowest-priority if over
```

No RAG, no vector DB. Transport: the `read_memory` MCP tool
(`packages/holon-mcp/src/tools.ts`). The Skill decides *when* + *what*;
MCP is the *how*.

### Idempotence

Reads are pure; no state changes. The Skill is stateless.

Employees do NOT get recall Skills — they're ephemeral; their boss
injects the relevant memory slice at dispatch time.

## 4. Flow 2 — Write-Up (Harvest-On-Retire)

### Trigger

Container destruction:

| Container | Who harvests | Bubbles up to |
|---|---|---|
| CLI employee retires | The owning secretary | Project memory (System 1) |
| Project retires | Owner (or optional super-agent) | Owner memory (System 2) |

Owner is terminal — no layer above. The same hook feeds HR (last-chance
scoring per ADR § 4.2).

### Implementation

`packages/core/src/boss-memory-harvest-service.ts`. The harvester runs a
CLI agent (on the boss's own binary) with a distillation prompt:

```
You are a memory curator. Read this retiring employee's per-CLI memory
file and recent dispatches. Output ONE markdown patch for INDEX.md or
MEMORY/*.md:

- KEEP: durable contributions, role-shape lessons, decisions, hard-won
  facts the project will reuse.
- DROP: per-turn chat scaffolding, resolved threads, time-bound minutiae.

Limits: ≤ 2k chars; cite source assignment ids; use [[wikilinks]] for
cross-references; do NOT include scratch/TODO state.
```

Output is appended (or merged into an existing same-topic file), `INDEX.md`
is updated to point at it, and the employee's per-CLI memory file is
hard-deleted at the end of the harvest.

### Idempotence

Harvest runs at most once per retire. On replay (crash recovery): the
harvester re-emits a patch with the same content-hash; the writer skips
the append if a matching content-hash is already present. Source delete
is the *last* step so mid-harvest crash can re-try without losing input.

## 5. Flow 3 — Write-Down (HR Correction)

### Trigger

Two HR tiers — see `hr-evaluator.md` for scheduling.

- **owner-HR** scores secretaries on ~30 min cron + settle-watch.
- **secretary-HR** scores employees at every dispatch completion (inline
  loop step, not a separate process).

### Path A — persistent memory patch

When the rubric finds a **rule-shaped, recurring** drift, HR writes a
markdown patch into the target's per-binary memory file under a managed
section:

```markdown
## HR-Corrections
<!-- managed by owner-HR — do not hand-edit; owner can revert via the 🔴 line -->

- (2026-05-30) Always dispatch heavy work; do not execute it yourself.
```

Implementation: `packages/core/src/hr-path-a.ts`.

**Idempotence (rule-hash).** Each rule is normalized
(`normalizeRuleText`: lowercase, collapse whitespace, strip trailing
punctuation) then SHA-256-hashed; the 12-char hex prefix is the rule's
stable id. Re-emitting refreshes the date in place — no duplicate lines.

**Sentinel-bracketed.** The HTML-comment sentinel lets the writer
distinguish its managed section from a hand-written `## HR-Corrections`
heading. Without the sentinel, the writer refuses to clobber.

**Survives respawn.** The patch is on disk; next CLI boot reads it.

### Path B — next-turn nudge (non-preemptive)

When the rubric finds a **single-turn deviation** (e.g., manager did work
instead of dispatching), HR enqueues a synthetic message on the
synthetic-producers channel:

- Producer registry: `apps/web/lib/synthetic-producers.ts`
- Settle trigger: `apps/web/lib/settle-watch.ts`
- Delivery: `apps/web/lib/warm-agent.ts` drains the queue and **prepends**
  drained messages to the next inbound owner turn or dispatch return.

**Non-preemptive.** The running turn finishes; the synthetic message
lands at the next input boundary. Rationale per ADR § 4.3 Path B: a
drifted turn is usually committed by the time HR scores it; preemption
breaks continuity for no recovery gain. **Vanishes with the
conversation.**

### B → A auto-promotion

If the same Path-B nudge fires **≥ 3 times in a rolling 24h window** for
the same target, HR auto-promotes:

1. Path A writer adds the rule to the target's `## HR-Corrections`.
2. 🔴 line surfaces to the owner:

   > 🔴 HR auto-promoted on `<agent>`: "<rule>". Accept / edit / revert.

3. Owner actions:
   - **Accept** — no-op.
   - **Edit** — owner provides new text; HR re-writes (new rule-hash).
   - **Revert** — HR deletes the entry AND records a promotion veto.

### Promotion-veto JSON

`~/holon-agents/boss/owner/hr/promotion-vetoes.json`:

```json
{
  "vetoes": [
    {
      "rule_hash": "a3f9c0…",
      "target_agent": "secretary-acme",
      "rule_text": "Always dispatch heavy work; do not execute it yourself.",
      "vetoed_at": "2026-05-30T14:22:01.000Z"
    }
  ]
}
```

Future B-fires whose rule-hash matches a vetoed entry skip auto-promotion
(Path B may still fire; just no re-promotion).

### Why 3 / 24h

Per ADR § 4.4: 1× is noise; 2× could be the same turn re-tried; 3× is the
smallest "pattern" signal. 24h matches a typical owner workday.

## 6. Cross-Flow Summary

| Property | Read | Write-up | Write-down |
|---|---|---|---|
| Frequency | Per turn | Per retire | Per scoring event |
| Persistence | None | Yes (MEMORY/) | Path A yes; Path B no |
| Owner-visible | No | No | Path A yes; Path B only via 🔴 |
| Idempotence key | n/a | Content-hash of patch | Rule-hash |

## 7. Edge Cases

- **Concurrent harvest + recall.** Recall might read the un-distilled source
  just before the harvester deletes it. Worst case: model sees the
  un-distilled version once. No corruption.
- **Path A write race.** Two HR runs, same rule, same second: both compute
  the same rule-hash; atomic `renameSync` commits; identical content either
  way.
- **Re-scaffold loses promotion-vetoes (ADR § 4.9 OPEN).** If owner-HR is
  rebuilt from scratch, `promotion-vetoes.json` is lost. Two options:
  (1) move vetoes into owner System 2 boss-memory proper; (2) make HR
  scaffolding preservation-aware. (1) cleaner; (2) closer to current code.
- **Skill edits don't hot-reload.** Skill files are read at CLI startup.
  Restart the secretary to pick up a description change.
- **Author/target CLI mismatch.** Path A picks the file by the **target**'s
  `substrate.cliBinary`, not the author's.

## 8. Cross-References

- README § "Memory update flow" — one-screen diagram
- ADR `../adr/memory-as-skill.md` · ADR `../adr/hr-evaluator-and-behavior-correction.md`
- [`hr-evaluator.md`](hr-evaluator.md) — HR wire-up
- [`data-model.md`](data-model.md) § 4.99 — filesystem-backed state
- [`local-agent-management.md`](local-agent-management.md) § 14.7 — per-binary memory matrix
- [`agent-heartbeat-watchdog.md`](agent-heartbeat-watchdog.md) § 11.5 — settle/synthetic pipeline
- `packages/core/src/boss-memory-harvest-service.ts` · `hr-path-a.ts` · `cli-memory-scaffold.ts`

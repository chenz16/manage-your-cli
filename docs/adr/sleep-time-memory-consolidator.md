# ADR: Sleep-Time Memory Consolidator

Status: accepted (slice 1 — plumbing + safety invariants)
Date: 2026-05-30
Companion: [memory-update-flow.md](../architecture/memory-update-flow.md),
[hr-evaluator.md](../architecture/hr-evaluator.md),
[harvest-on-retire (Flow 2)](../architecture/memory-update-flow.md#4-flow-2--write-up-harvest-on-retire)

## Context

Each long-lived per-agent memory file (`CLAUDE.md` / `AGENTS.md` /
`GEMINI.md` / `QWEN.md`) accumulates content over an agent's lifetime:

- `## Role-Composition` — managed by `holon-create-agent` (idempotent
  replace; owner-edits below the sentinel are preserved).
- `## HR-Corrections` — managed by `hr-path-a` (idempotent by rule-hash;
  re-emits refresh in place).
- **Everything else** — owner-pasted notes, conversation digests, ad-hoc
  scratch the owner or the agent itself dropped into the file. This part
  grows without bound and is what dominates token-cost-at-load over time.

`boss-memory-harvest-service` already consolidates at the **boss-memory**
layer (System 1 / System 2) when an employee retires. It does **not**
touch the per-agent file of a still-live agent. That's the gap.

## Decision

Ship `consolidateMemoryFile()` in `@holon/core/memory-consolidator` and a
periodic tick in `apps/web/lib/sleep-consolidator-tick.ts`. Per file:

1. **Sectionize** by `## ` headings.
2. **Classify** each section:
   - `## Role-Composition` → preserved verbatim (managed by another writer;
     owner-edits tail is inside this block).
   - `## HR-Corrections` → preserved verbatim (managed by `hr-path-a`).
   - Any section whose first non-blank body line matches
     `<!-- managed by ... -->` → preserved verbatim.
   - Everything else → passed through `options.distill()`.
3. **Reassemble** + atomic-write (temp + rename).
4. **Sidecar** `<file>.consolidated.json` records
   `{ ts, before_bytes, after_bytes }`; future ticks skip while the
   timestamp is within `minIntervalMs` (default 24h).

The heartbeat tick (`sleep-consolidator-tick.ts`) iterates
`list(kind === 'warm-secretary')` from the process-registry and applies
three gates before touching a file:

- **busy-probe** — same probe shape settle-watch uses; skip if the
  warm-agent for this key is busy right now.
- **minBytes** — skip files under 50KB by default (env
  `HOLON_CONSOLIDATOR_MIN_BYTES`).
- **sidecar cooldown** — skip files consolidated within the last 24h (env
  `HOLON_CONSOLIDATOR_MIN_INTERVAL_MS`).

Tick interval defaults to 6h, configurable via
`HOLON_CONSOLIDATOR_INTERVAL_MS`. Ticker is process-singleton (uses
`globalThis.__holonConsolidatorTimer`), idempotent on re-import.

## Rationale

- **Role-Composition and HR-Corrections are ground truth.** They are
  idempotent + audited writes; rewriting them through an LLM is strictly
  worse — best case it preserves them, worst case the LLM paraphrases a
  rule into a non-rule. Hard-skip them.
- **Owner-edits are sacred.** The `<!-- owner-edits below -->` sentinel
  marks the tail of `## Role-Composition` as owner-owned. Because the
  consolidator preserves the ENTIRE `## Role-Composition` body byte-for-
  byte, the owner-edits tail is preserved transitively. No special-case
  logic required.
- **Sentinel-managed sections** (`<!-- managed by X -->`) are
  future-proofed: any tool that registers itself with that pattern is
  protected without code changes here.
- **Sidecar (not in-file)** keeps the cooldown out of the file content so
  it survives `git diff` review and never affects the file's hash.
- **Slice 1 ships a stub distill** (`STUB_DISTILL`: returns
  `<!-- DISTILLED <name>: original N chars -->\n`). This proves the
  plumbing + invariants without spending tokens. Real LLM-backed distill
  via the warm-agent's own binary is the next slice — the function
  signature is already there to accept it.
- **6h tick × 24h per-file cooldown.** A single file gets distilled at
  most once a day; the 6h tick exists so files newly crossing `minBytes`
  don't wait the full day. Both knobs are env-tunable for ops.

## Hard invariants (enforced by tests)

- `## Role-Composition` block preserved byte-for-byte (incl. owner-edits tail).
- `## HR-Corrections` block preserved byte-for-byte.
- Any `<!-- managed by ... -->` sentinel-bracketed section preserved
  byte-for-byte.
- File under `minBytes` → no read, no write, no distill call.
- Sidecar timestamp within `minIntervalMs` → no read, no write, no
  distill call (returns `skipped:true, reason:"cooldown(...)"`).
- Distill is called ONLY for non-managed sections.
- Write is atomic (tempfile + rename).

## Open questions

- **Real distill impl.** Slice 1 stubs it. The next slice wires
  `streamSecretary` / `warm-agent` so the warm agent distills its own
  file (one warm-CLI call per non-managed section). For owner-CLI, the
  owner-HR persona drives it.
- **Token budget.** If a CLAUDE.md has N free-form sections and each
  distill is a separate LLM call, cost ~= N × (avg section tokens). At
  N≤5 and 24h cooldown, expected cost ≤ ~25k tokens / day / live agent.
  Re-validate when real-distill ships.
- **Harvest interaction.** If a file is consolidated AND the agent then
  retires within hours, `boss-memory-harvest-service` will read the
  already-distilled file. Distill must preserve fact-density; otherwise
  harvest will lose signal. Slice-1 stub does NOT preserve signal — only
  ship real distill alongside a harvest-round-trip test.

## Cross-references

- `packages/core/src/memory-consolidator.ts` — the module
- `packages/core/tests/memory-consolidator.test.ts` — invariant tests
- `apps/web/lib/sleep-consolidator-tick.ts` — schedule + busy gate
- `docs/architecture/memory-update-flow.md` — Flow 2 (harvest-on-retire)
- `docs/adr/hr-evaluator-and-behavior-correction.md` — HR-Corrections
  managed section
- `docs/adr/role-templates-and-persona-composition.md` — Role-Composition
  managed section + owner-edits sentinel

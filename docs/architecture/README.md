# Holon Architecture

Status: draft
Date: 2026-05-15 (refreshed 2026-05-30 — System 0/1/2 + HR + memory-as-skill)

Holon architecture is documented from several angles. The product-side
overview lives in the repo [`README.md`](../../README.md) (sections
"Architecture", "System 0 / System 1 / System 2", "Memory update flow",
"HR evaluator + two-path behavior correction"); this folder holds the
implementation-level detail.

1. [`functional-architecture.md`](functional-architecture.md)
   Abstract product architecture: core concepts, data flow, workflow, state transitions, and system boundaries.

2. [`implementation-architecture.md`](implementation-architecture.md)
   Engineering architecture: how to implement the MVP with a local desk app,
   cloud connector, database, protocol layer, and the multi-CLI adapter pattern
   (claude / codex / gemini / qwen — no Hermes runtime; intelligence comes from
   the user's CLI subscription).

3. [`ui-architecture.md`](ui-architecture.md)
   Product UI architecture: navigation, screen responsibilities, component model, visual system, and interaction rules for hybrid human-AI work.

4. [`handoff-design.md`](handoff-design.md)
   Handoff design: the core accountability transfer primitive between owners, local AI members, peer members, missions, assignments, and deliverables.

5. [`local-agent-management.md`](local-agent-management.md)
   Core 1 deep dive: secretary as warm `claude --print --input-format stream-json`
   process; tmux employees; the per-binary memory file matrix; HR loop step at
   dispatch completion; harvest-on-retire wiring.

6. [`memory-update-flow.md`](memory-update-flow.md)
   The three memory flows in depth — read-on-demand via Skill, write-up via
   harvest-on-retire, write-down via HR — with filesystem layout, idempotence
   semantics, and edge cases. The README's diagram is the one-screen version;
   this is the full spec.

7. [`hr-evaluator.md`](hr-evaluator.md)
   Implementation-level companion to
   [`../adr/hr-evaluator-and-behavior-correction.md`](../adr/hr-evaluator-and-behavior-correction.md):
   how owner-HR is scheduled, how secretary-HR plugs into dispatch completion,
   how producers register on the synthetic-producers channel, how Path A writes
   to per-binary memory files. The ADR carries the rationale; this is the wiring.

8. [`data-model.md`](data-model.md)
   Persistent data layer: relational schema for both Cores plus the
   filesystem-backed boss-memory tree under `~/holon-agents/boss/`.

9. [`agent-heartbeat-watchdog.md`](agent-heartbeat-watchdog.md)
   Heartbeat / watchdog pattern for background dispatches, plus the
   settle-watch + synthetic-producer pipeline that HR Path B and other
   non-preemptive injectors ride on.

10. [`diagrams.html`](diagrams.html)
    Standalone HTML/SVG diagrams for the functional architecture. Open it
    directly in a browser to view flow and sequence diagrams without a docs
    build step. (Not yet refreshed for System 0/1/2 — separate concern.)

The product principle is:

```text
Each desk can build a lightweight team.
Larger organization complexity comes from connected teams, not deep local agent hierarchy.
```

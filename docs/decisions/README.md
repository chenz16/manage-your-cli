# Architecture Decision Records (ADRs)

Significant decisions made during iteration that didn't exist in the original spec set, or that materially evolved a spec, get recorded here as ADRs.

## When To Write One

Write an ADR when:

- A spec was found wrong or insufficient and the team picked a new direction.
- A new pattern emerged from implementation that should be the project standard.
- A trade-off was made that future readers will want to understand the reasoning behind.
- A dependency or tool choice was made (e.g., "we picked Drizzle over Kysely because…").

Do NOT write an ADR for:

- Bug fixes (commit message suffices).
- Routine implementation choices that match an existing spec.
- Personal preferences that don't constrain future work.

## Format

```
# NNN — Short Title

Status: proposed | accepted | superseded by NNN
Date: YYYY-MM-DD
Authors: ...
Iteration: iterations/NNN-{slug} (if applicable)

## Context
What's the situation that called for a decision?

## Decision
What did we decide?

## Consequences
- Positive: ...
- Negative: ...
- Neutral: ...

## Alternatives Considered
- Option A: ... — rejected because ...
- Option B: ... — rejected because ...

## Spec Impact
Which specs in docs/ does this change or amend?
```

## Numbering

Three-digit zero-padded, sequential per acceptance order. Slug describes the decision in 2–4 words.

Examples:
- `001-runtime-adapter-jvm-bridge.md`
- `002-postgres-or-sqlite-default.md`

## Currently Accepted ADRs

(None yet — write the first one when the first non-spec decision arises.)

## Proposed ADRs (awaiting owner accept)

- `038-channel-bridge-asymmetric-io.md` — CEO chatbot as asymmetric bidirectional remote terminal; sender-routing (CEO→chat, 3rd-party→intake); outbound condense step. Status: proposed 2026-05-20.

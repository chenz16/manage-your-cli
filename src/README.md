# Source Code

Holon's own code lives here. Each iteration adds to or modifies these subdirectories per the package map in `docs/architecture/implementation-architecture.md` § 5.

## Layout (target — populated as iterations land)

```
src/
├── ui-mock/           Iteration 001 deliverable: clickable UI mock, no backend
│
├── (later iterations populate the package map from impl-arch.md § 5)
├── apps/web/          Next.js app — owner UI + API routes
├── packages/
│   ├── core/          Product domain services
│   ├── handoff-types/ Type defs from handoff-taxonomy.md
│   ├── handoff-engine/Form validation, state machine, composition
│   ├── peer-protocol/ JSON-RPC wire layer
│   ├── runtime-contract/  Adapter interface
│   ├── runtime-hermes/    Hermes implementation
│   ├── auth/          Identity & credentials
│   ├── db/            Schema + migrations
│   └── ...
```

## Current State

- `ui-mock/` — populated by Iteration 001 (Dev Agent's deliverable). See `iterations/001-ui-mock/`.
- Everything else: not yet started.

## Repo Discipline (per `docs/architecture/implementation-architecture.md` § 10)

- Specs are the contract; code is the implementation.
- The two cores (Core 1 / Core 2) stay separate — Core 1 code never imports from Core 2 except through the four declared seam crossings.
- No silent failure: every error path surfaces in audit + UI.
- Flat-roster invariant: no agent can spawn child agents.
- Audit-emit-before-state-change.

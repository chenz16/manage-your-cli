# Holon Engineering

[![CI](https://github.com/chenz16/holon-engineering/actions/workflows/ci.yml/badge.svg)](https://github.com/chenz16/holon-engineering/actions/workflows/ci.yml)

The development repository for Holon. Companion to the public marketing repo at <https://github.com/chenz16/Holon>.

## Installing Holon

**If you're a customer / non-developer / just got a `.exe` or `.apk` from someone — start at [`docs/install/`](docs/install/), not this file.** This README is dev-onboarding context; the install docs are the customer entry point.

- Windows desk app — [`docs/install/windows.md`](docs/install/windows.md)
- Android / iPhone mobile clients — see the matching files in `docs/install/` (mobile docs sync from the `mobile-v1` branch; if missing on `dev`, check `main`)

## Folder Map

```
.
├── docs/              All design documentation (product, architecture, decisions)
│   ├── product/       Product definition, MVP scope, roadmap
│   ├── architecture/  System map, component specs, contracts
│   └── decisions/     Architecture Decision Records (ADRs) — written as we go
│
├── requirements/      Requirements management (input to iterations)
│   ├── current.md     What this iteration is building
│   ├── backlog.md     What's queued
│   └── completed/     Snapshots of past iterations' requirements
│
├── iterations/        Iteration logs, plans, deliverables, feedback
│   ├── README.md      Process overview
│   └── NNN-name/      One folder per iteration
│       ├── requirements.md   What we agreed to build
│       ├── plan.md           How we'll build it
│       ├── deliverables/     What was produced
│       └── feedback.md       Human review at iteration end
│
├── agents/            Definitions of the three working agents
│   ├── dev-agent.md
│   ├── test-agent.md
│   └── requirements-agent.md
│
├── apis/              API specs / contracts (user-provided)
│
├── deps/              External dependencies vendored here
│   └── hermes/        Hermes runtime (gitignored; run scripts/setup-hermes.sh to clone)
│
└── src/               Our own code
    └── ui-mock/       The first iteration's deliverable
```

## How Iteration Works

```
You (human)
  ↓ provide requirements / give feedback (between iterations only)
  
Iteration N
  ├─ Requirements Agent  ── structures requirements; folds feedback into plan
  ├─ Dev Agent           ── implements
  └─ Test Agent          ── writes tests; verifies UI; checks human-reviewed criteria
  
  ↓ deliverable + iteration log
  
You review → feedback → Iteration N+1
```

Each iteration is meant to run with minimal human intervention in the middle. You review at the end; feedback becomes input to the next iteration via the Requirements Agent.

## Status

- **Design phase** — complete to commercial-grade. 14 architecture specs + 3 product docs in `docs/`.
- **Iteration 001 — UI Mock** — in progress, split into three sub-iterations: `iterations/001a-ui-mock-shell/`, `iterations/001b-ui-mock-inbox-conn/`, `iterations/001c-ui-mock-deliverables-composer/` (see `iterations/README.md` § Sub-Iterations for the convention).
- **Hermes integration** — `deps/hermes/` is the upstream clone (do not modify).

## How To Get Started

1. Read `docs/product/holon-product-definition.md` and `docs/architecture/functional-architecture.md` first.
2. Then jump to whichever spec matches your work area (see `docs/architecture/implementation-architecture.md` § 5.1 for the package → spec map).
3. For dev work, see `iterations/README.md` for the iteration process.

## Repo Discipline

- **Specs are the contract; code is the implementation.** When code disagrees with a spec, the bug is in the code unless the spec is wrong (in which case update the spec FIRST).
- **No silent failure** (per `docs/architecture/functional-architecture.md` § 7.3) — every error path surfaces in audit + UI.
- **Flat-roster invariant** for local agents (per `docs/architecture/local-agent-management.md` § 2) — no agent owns sub-agents.
- See `docs/architecture/implementation-architecture.md` § 10 for the full Engineering Rules.

## Public Marketing Site

The marketing landing page lives in a separate public repo: <https://github.com/chenz16/Holon> (deployed at <https://chenz16.github.io/Holon/>). Design docs stay here in private.

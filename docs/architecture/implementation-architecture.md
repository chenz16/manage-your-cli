# Implementation Architecture

Status: draft v0.2 (refreshed 2026-05-15 to align with Two Cores frame and the new spec set)
Owner: design
Position: This is the practical "how do we build the MVP" guide. It lives between the system map (`functional-architecture.md`) and the per-component specs. Where this doc was previously a one-stop reference, it is now a map of *which spec implements what part of the product* plus the still-relevant pragmatic decisions (tech stack, packaging, milestones).

## 1. Goal

Build the Holon MVP as a coherent app that:

- exposes both Cores cleanly (Core 1 = local agent management; Core 2 = hybrid employment interconnect, per `functional-architecture.md` § 2)
- ships Hermes as the only production runtime adapter (per `runtime-adapter-interface.md`)
- carries forward the working pieces of the mibusy V3 prototype (peer routing, facade pattern, explicit subagent creation)
- enforces the seven invariants from `functional-architecture.md` § 7 (especially flat-roster and no-silent-failure) at the code level

Build sequence (high-level):

```
M0  schema + skeleton           → 2 weeks
M1  Core 1: local AI execution  → 3 weeks
M2  Core 2: peer protocol       → 3 weeks
M3  reliability + chaos         → 2 weeks
M4  cloud relay (hosted mode)   → 3 weeks
─────────────────────────────────
~13 weeks to first commercial-grade single-user release
```

Detailed milestones in § 9.

## 2. The Spec Set This Doc Implements

| Spec | What it defines | Status |
|---|---|---|
| `product/holon-product-definition.md` | Vision, screens, success metrics | done |
| `product/mvp-scope.md` | What ships in V1 vs deferred | done |
| `architecture/functional-architecture.md` | The Two Cores system map | done |
| `architecture/local-agent-management.md` | Core 1 deep dive | done |
| `architecture/runtime-adapter-interface.md` | The local-execution contract | done |
| `architecture/handoff-design.md` | Handoff lifecycle, packet, context-pack overview | done |
| `architecture/handoff-taxonomy.md` | 14 forms × 8 axes for handoffs | done |
| `architecture/peer-communication-architecture.md` | Wire format, transport, multi-device routing | done |
| `architecture/auth-and-identity.md` | Credentials, pairing, token lifecycle, revocation | done |
| `architecture/data-model.md` | DB schema for all entities | done |
| `architecture/deliverable-spec.md` | Durable artifact schema | done |
| `architecture/context-pack.md` | Context bundle that travels with handoffs | done |
| `architecture/reliability-and-testing.md` | Error taxonomy, retries, test strategy, SLOs | done |
| `architecture/ui-architecture.md` | Screens, components, copy rules | done |
| `architecture/diagrams.html` | Rendered architecture diagrams | done |

When this doc says "implement X", the canonical X is in the corresponding spec.

## 3. MVP Boundary And Cases To Consider

Holon needs to support multiple future surfaces, but the MVP stays under Holon's control. These boundaries are unchanged from v0.1.

### 3.1 Phone

Phone is a control surface, not an execution surface in V1.

- review inbound missions
- accept/reject work
- check waiting proxy assignments
- submit short deliverables
- receive notifications
- monitor connection health

V1 build approach: mobile-responsive web (PWA). No native iOS/Android shell, no on-phone AI workers.

### 3.2 Desktop Local App

Primary V1 execution surface.

- packaged web app (Tauri preferred over Electron for footprint)
- local Hermes-based AI staff via the runtime adapter
- local Postgres or SQLite database
- exposes the same product API used by hosted nodes

This is where local team creation and execution start.

### 3.3 Desktop CLI Window Takeover

Out of V1. CLI takeover is hard to secure and normalize; provider CLIs are not Holon-controlled. Per `functional-architecture.md` Core 2 invariants, all execution flows through Holon's runtime adapter or a CLI executor *substrate* (per `local-agent-management.md` § 5.3) — a wrapped, controlled CLI is fine; arbitrary terminal scraping is not.

### 3.4 Cowork-Like External Agent Results

Out of V1. External agent products may later become runtime adapters if they expose stable APIs (per the abstract interface in `runtime-adapter-interface.md`). V1 ships Hermes only.

### 3.5 The MVP Execution Rule

MVP local agents are controlled by Holon end-to-end:

```
Holon assignment
  ↓ Core 1 router (per functional-architecture.md § 3.3)
Holon runtime adapter (per runtime-adapter-interface.md)
  ↓
Hermes local agent
  ↓ normalized RuntimeEvent stream (per runtime-adapter-interface.md § RuntimeEvent)
Holon deliverable (per deliverable-spec.md)
```

No V1 path requires a third-party agent CLI, a manually watched terminal, an external agent product's session semantics, or a mobile-native worker runtime.

## 4. Languages And Frameworks

### 4.1 Core stack

| Layer | Tech |
|---|---|
| App UI | TypeScript + React + Next.js |
| API routes | Next.js API or Hono on Node |
| Core domain | TypeScript (pure, framework-free where possible) |
| Protocol & types | TypeScript + Zod for runtime validation |
| Runtime adapter | TypeScript wrapper; Hermes integration in whichever language Hermes prefers (likely Python) — adapter exposes the TypeScript interface |
| Database access | Drizzle (preferred) or Kysely; TypeScript-first, schema reflection works in both Postgres and SQLite |
| Validation | Zod everywhere boundaries |
| Monorepo | pnpm workspace |

### 4.2 Database

- **Postgres 16+** for cloud-hosted and dev (per `data-model.md` § 2.1).
- **SQLite 3.40+** for packaged single-user installs (per `data-model.md` § 12 SQLite compatibility).
- One schema file per migration; forward-only migrations (per `data-model.md` § 13).

### 4.3 Desktop packaging

(Per ADR-005, 2026-05-15: Tauri promoted from V1.x to V1 packaged desktop.)

- V1: **Tauri shell** (lightweight, secure, Rust-based) — packaged desktop
  install for macOS / Windows / Linux. Web-tab access remains available as
  an alternate deployment mode (same web app, no install).
- V1.x: incremental Tauri shell improvements (auto-updater hardening, tray
  menu, native notifications via plugins).
- Electron is the **pre-authorized fallback** if M1.x packaging reveals a
  Tauri-specific blocker meeting the three-criteria test in ADR-005 § 2
  (cannot be worked around with an existing plugin; cannot be implemented
  as a custom plugin within ≤ 1 week; required for V1 launch). No
  additional ADR required to invoke the fallback; the trigger is
  documented in a follow-up ADR after the fact.

### 4.4 Mobile

- V1: responsive web + PWA
- V1.x: Capacitor for notifications and install feel
- V2+: native only if phone-specific workflows (push to talk, lock-screen actions) justify

## 5. Monorepo Structure

```
holon/
├── apps/
│   ├── web                    # Next.js — owner UI + API routes
│   └── (future) desktop       # Tauri shell wrapping web/
├── packages/
│   ├── core                   # product domain (Core 1 + Core 2 services)
│   ├── handoff-types          # HandoffPacket, HandoffAxes, HandoffForm types
│   ├── handoff-engine         # form validation, state machine, composition
│   ├── peer-protocol          # JSON-RPC client/server, signing, idempotency
│   ├── peer-relay-client      # SSE + HTTPS POST against the cloud relay
│   ├── runtime-contract       # RuntimeAdapter interface + RuntimeEvent types
│   ├── runtime-hermes         # Hermes implementation of RuntimeAdapter
│   ├── runtime-dummy          # Test/dev implementation of RuntimeAdapter
│   ├── runtime-conformance    # Conformance suite that runs against any adapter
│   ├── core1-types            # Staff, Role, Substrate, Autonomy types
│   ├── auth                   # JWT, signing keys, pairing, revocation
│   ├── db                     # schema, migrations, query helpers (Drizzle)
│   ├── deliverable            # body kinds, file storage abstraction
│   ├── context-pack           # ContextPack composition, freeze, hash
│   ├── observability          # logging, metrics, tracing
│   ├── ui                     # design tokens, primitives
│   └── adversarial-tests      # security-shaped test suite
├── examples/
│   └── two-node-demo          # local two-desk + relay demo
└── tests/
    ├── e2e                    # Playwright
    └── chaos                  # chaos engineering scenarios
```

### 5.1 Package → Spec Map

| Package | Implements |
|---|---|
| `apps/web` | `ui-architecture.md` screens; API routes that mirror service methods |
| `packages/core` | `functional-architecture.md` services + invariants (§ 7) |
| `packages/handoff-types` | TypeScript types from `handoff-taxonomy.md` § 11 + `handoff-design.md` packet shape |
| `packages/handoff-engine` | `handoff-taxonomy.md` form validation + revocation rules + composition |
| `packages/peer-protocol` | `peer-communication-architecture.md` § 5 wire format + § 9 idempotency |
| `packages/peer-relay-client` | `peer-communication-architecture.md` § 6 transport (POST + SSE) |
| `packages/runtime-contract` | `runtime-adapter-interface.md` |
| `packages/runtime-hermes` | `runtime-adapter-interface.md` § "First Implementation: Hermes Adapter" |
| `packages/runtime-dummy` | `runtime-adapter-interface.md` § "Test/Dummy Adapter" |
| `packages/runtime-conformance` | `runtime-adapter-interface.md` § "Acceptance Criteria" |
| `packages/core1-types` | `local-agent-management.md` § 11 schemas |
| `packages/auth` | `auth-and-identity.md` |
| `packages/db` | `data-model.md` (all tables, indexes, migrations) |
| `packages/deliverable` | `deliverable-spec.md` |
| `packages/context-pack` | `context-pack.md` |
| `packages/observability` | `reliability-and-testing.md` § 5 |
| `packages/adversarial-tests` | `reliability-and-testing.md` § 7.7 |

When a contributor asks "where does X live?", this table is the answer.

## 6. Deployment Modes

### 6.1 Local-Only Node

```
single web app process (Tauri shell or local browser)
local database (SQLite or Postgres)
Hermes runtime adapter
no cloud connection
```

Use case: one person wants a private local agent team without networking.

### 6.2 Local Node With Cloud Connector

```
local web app + local DB + local runtime
+ outbound SSE connection to Holon relay for inbound mission push
+ outbound HTTPS to relay for handoff dispatch
```

Use case: personal local team connected to other people's teams. The default expected setup.

### 6.3 Hosted Node

```
hosted web app behind an authenticated subdomain
managed Postgres
managed runtime workers
relay co-located in same cloud
```

Use case: company teams that don't want a local install; phone-only users; quick trial.

### 6.4 V1 Sequencing

V1 ships local + cloud connector together. Hosted Node is V1.x — uses the same code paths; just runs everything server-side. Local-Only is supported but the cloud connector is the recommended default.

## 7. Layer Responsibilities

### 7.1 App Layer (`apps/web`)

- render UI (Today, Inbound, Staff, Connections, Deliverables — per `ui-architecture.md`)
- expose node API (HTTP routes wrapping core services)
- handle owner interactions (form-aware handoff composer per `handoff-taxonomy.md` UI consent flows)
- stream live status updates (SSE-fed from audit bus)

Suggested URLs (owner-facing):

```
/today
/inbound
/staff
/connections
/deliverables
/settings
```

API routes mirror the services and adhere to the audit-emit-before-state-change pattern (per `reliability-and-testing.md` § 10.1).

### 7.2 Core Domain Layer (`packages/core`)

Services correspond 1:1 to the components in `functional-architecture.md` § 3. Each is in TypeScript, framework-free, with inputs/outputs as Zod-validated types.

```
desk-service             (Core 1 + Core 2)
person-service           (Core 1 + Core 2)
staff-service            (Core 1 — per local-agent-management.md)
role-service             (Core 1)
cultivation-service      (Core 1)
router-service           (Core 1 — per local-agent-management.md § 10)
runtime-adapter-service  (Core 1 — wraps any RuntimeAdapter)
handoff-service          (Core 2 — per handoff-design.md + handoff-taxonomy.md)
connection-service       (Core 2 — per peer-comms.md § 12)
mission-service          (Core 2 — inbox)
assignment-service       (Core 1 — local work)
deliverable-service      (cross-cutting — per deliverable-spec.md)
context-pack-service     (cross-cutting — per context-pack.md)
audit-service            (cross-cutting — per data-model.md § 4.11)
retry-service            (cross-cutting — per reliability-and-testing.md § 3.4)
auth-service             (per auth-and-identity.md)
```

The router decides:

```
target = local AI staff   → runtime adapter
target = role             → role-based dispatch (per local-agent-management.md § 10.3)
target = proxy staff      → handoff layer (Core 2 escape)
target = owner            → owner queue
target = unfulfillable    → blocked + surface
```

### 7.3 Protocol Layer (`packages/peer-protocol`)

Implements `peer-communication-architecture.md` end to end:

- JSON-RPC 2.0 client and server
- 13 method handlers (per spec § 5.2)
- HMAC-SHA256 signing + replay window enforcement
- Idempotency via UUIDv7 + 24h cache (relay-side; smaller cache desk-side)
- Stripe-pattern retry schedule integration with `retry-service`
- Multi-device routing policies (per spec § 8)

### 7.4 Wire Transport Layer (`packages/peer-relay-client`)

Implements `peer-communication-architecture.md` § 6:

- HTTPS POST for outbound RPC
- SSE for inbound push from cloud relay
- Heartbeat tracking (15s) and reconnect with `Last-Event-ID`
- (V2) WebRTC data channel for direct-peer

### 7.5 Runtime Adapter Layer (`packages/runtime-contract` + `packages/runtime-hermes`)

The contract is fully specified in `runtime-adapter-interface.md`. Implementation notes:

- `runtime-contract` is pure types + helpers; no dependencies.
- `runtime-hermes` lives in TypeScript; calls into Hermes via whatever language binding Hermes provides. The Holon side normalizes all events into `RuntimeEvent` before they cross the package boundary.
- `runtime-dummy` is the reference test implementation (per spec § "Test/Dummy Adapter").
- Hermes spike (per spec § "Open questions for Hermes integration spike") is a 1-week investigation that MUST happen before M1 starts.

### 7.6 Database Layer (`packages/db`)

Implements `data-model.md`:

- Drizzle schema generated from spec
- Migrations under `packages/db/migrations/0001_*.sql` onward
- Query helpers per service
- Both Postgres and SQLite drivers

The shape mirrors `data-model.md` § 4 tables. The next data-model revision will incorporate the `context_packs`/`context_pack_items`/`context_pack_templates` tables proposed in `context-pack.md` § 9.

### 7.7 Observability Layer (`packages/observability`)

Implements `reliability-and-testing.md` § 5:

- Structured JSON logger
- 11 named metrics with Prometheus-compatible exposition
- OpenTelemetry tracer with W3C Trace Context propagation
- Audit hooks fanning to UI / metrics / retry / V2 audit warehouse

### 7.8 Auth Layer (`packages/auth`)

Implements `auth-and-identity.md`:

- Ed25519 device key generation + OS keychain storage
- JWT issuance + 24h refresh against the relay
- Pairing handshake (initiate, accept, ECDH/HKDF derivation)
- Revocation propagation
- AI controller token verification

## 8. Cross-Cutting Concerns

### 8.1 Security (per `auth-and-identity.md`)

V1:

- Per-desk JWT, 24h lifetime, signed by relay
- Per-connection HMAC signing key derived via X25519/HKDF at pairing
- Two-sided explicit pairing; no auto-acceptance
- Revocation via SSE push (≤ 2s p95)
- HTTPS required outside localhost
- Connection-level rate limits

V2:

- E2E encryption of payload bodies (relay-blind)
- Step-up auth for high-value actions
- Hardware attestation
- SSO / OIDC issuer for the JWT

Detailed threat model: `auth-and-identity.md` § 11.

### 8.2 Reliability (per `reliability-and-testing.md`)

V1 must implement:

- Idempotency key on every cross-desk RPC (UUIDv7) + 24h dedup cache
- Stripe-pattern retry schedule for distributed operations
- Heartbeat tracking on connections; auto-reconnect on SSE drops
- Visible failed states in UI for every error code
- Token revoke path
- Audit-emit-before-state-change pattern in every service method
- Conformance suites for runtime adapter and wire protocol

V2:

- Compensation actions for revocation rollback
- Cross-desk audit aggregation for compliance
- Per-desk observability dashboards

### 8.3 Multi-Tenancy (per `data-model.md` § 9)

V1 ships single-desk-per-DB. V2 hosted variant adds `desk_id` filtering on every query plus Postgres row-level security policies for defense-in-depth.

### 8.4 Compliance Hooks

V1 produces append-only audit logs sufficient for after-the-fact reconstruction (per `functional-architecture.md` § 7.5). V2 adds:

- Audit log export per desk (signed bundles)
- GDPR-style "right to access" exports
- SOC2-friendly log retention controls
- Immutable audit storage backend option

## 9. Implementation Milestones

Each milestone names the specs whose `acceptance criteria` are the milestone's exit gate.

### M0 — Repo And Schema (2 weeks)

Goals:
- monorepo bootstrapped (Turbo or Nx for build, pnpm for deps)
- `packages/db` ships full schema from `data-model.md` § 4 + migrations
- `packages/handoff-types`, `packages/core1-types`, `packages/runtime-contract` ship pure types
- `apps/web` shell with stubs for the 5 primary screens
- seed data for one desk + owner + 2 standard staff

Exit gates:
- ✓ Schema migrations run end-to-end on both Postgres and SQLite
- ✓ Type packages compile with no `any`
- ✓ App shell renders the 5 nav items
- ✓ `data-model.md` § 15 acceptance criteria 1–8 pass

### M1 — Core 1 Local Runtime (3 weeks)

Goals:
- `packages/runtime-dummy` complete with 5 test scenarios
- `packages/runtime-hermes` minimum viable: spike findings doc landed; happy-path Hermes calls produce `RuntimeEvent` stream
- `packages/core` services for: desk, staff, role, router, assignment, deliverable, audit
- UI: create local AI staff, create assignment, watch event stream, view deliverable
- Cultivation profile basic plumbing (storage; cultivation logic per `local-agent-management.md` § 7 in M2)

Exit gates:
- ✓ Owner can create a desk, add an AI staff, give an assignment, see streamed events, get a deliverable — all in browser, all local
- ✓ Runtime conformance suite passes against `runtime-dummy`
- ✓ `runtime-adapter-interface.md` § "Acceptance Criteria" 1–7 pass against `runtime-hermes`
- ✓ Latency budget SLOs (`runtime-adapter-interface.md` § Latency Budget) met
- ✓ Flat-roster invariant enforced at DB + API + runtime

### M2 — Core 2 Peer Protocol (3 weeks)

Goals:
- `packages/auth` complete: JWT lifecycle, pairing handshake, signing keys
- `packages/peer-protocol` complete: 13 methods, signatures, idempotency
- `packages/peer-relay-client` complete: HTTPS + SSE
- `packages/handoff-engine` complete: form validation, state machine, composition for the V1 forms (start with Direct Order, Direct Takeover, Approval Chain, Watch Brief)
- `packages/context-pack` MVP: by-value + by-reference modes
- Cloud relay V1 (a small Hono service): person→desks routing, idempotency cache, retry queue
- UI: pair connections, send mission, receive mission, return deliverable

Exit gates:
- ✓ Two desks pair via UI; appears in both Connections screens
- ✓ Outbound mission delivered to remote desk; appears in their inbox
- ✓ Remote owner accepts, delegates to local AI, returns deliverable; sender sees it attached to original assignment
- ✓ All `peer-communication-architecture.md` § 16 acceptance criteria 1–11 pass
- ✓ All `auth-and-identity.md` § 15 acceptance criteria 1–10 pass
- ✓ Wire protocol conformance suite green

### M3 — Reliability And Chaos (2 weeks)

Goals:
- `packages/observability` complete with all 11 metrics
- `packages/adversarial-tests` covers the 10 chaos scenarios from `reliability-and-testing.md` § 7.5
- Connection health states + auto-retry per Stripe schedule
- All error codes surface correctly in UI
- Audit completeness check: replay audit log → reconstruct DB state in CI

Exit gates:
- ✓ All `reliability-and-testing.md` § 13 acceptance criteria pass
- ✓ Chaos scenarios all surface required observable
- ✓ `holon_invariant_violations_total = 0` over 7-day staging soak
- ✓ SLO dashboard live

### M4 — Cloud Connector (Hosted Mode) (3 weeks)

Goals:
- Hosted Node deployment topology stood up
- Cloud relay scaled with auth-issuer functionality
- Multi-tenant `desk_id` filtering + Postgres RLS
- Hosted onboarding flow (sign up → first desk created → first connection paired)
- Backups, monitoring, incident playbooks

Exit gates:
- ✓ A new user signs up at the hosted URL, creates a desk, pairs with a peer, sends and receives missions
- ✓ Multi-tenant isolation verified: tenant A cannot see tenant B's data even with malicious queries
- ✓ Backup + restore drill executed
- ✓ Public launch readiness review passes

## 10. Engineering Rules (The Discipline)

These are the rules that keep the architecture coherent over time.

1. **Product state lives above the runtime.** Holon decides what work exists, who owns it, who can receive it, and when it is done. Hermes (or any runtime) executes bounded local AI work — nothing more.
2. **The two cores stay separate.** Core 1 code never imports from Core 2 except through the four declared seam crossings (per `functional-architecture.md` § 2.3). Linter enforces.
3. **Specs are the contract; code is the implementation.** When code disagrees with a spec, the bug is in the code — open a PR to update the code. When the design is wrong, update the spec FIRST, then update the code.
4. **No silent failure (per `functional-architecture.md` § 7.3).** Every error path surfaces in audit + UI. No bare `catch` blocks.
5. **Flat-roster invariant (per `functional-architecture.md` § 7.1).** No staff record may own staff. Enforced at DB, API, runtime layers.
6. **Owner-mediated authority (per `functional-architecture.md` § 7.2).** External work always lands in the owner's mission inbox first.
7. **Authority attenuation (per `functional-architecture.md` § 7.4).** Sender cannot grant authority they don't hold.
8. **Audit completeness (per `functional-architecture.md` § 7.5).** State must be reconstructable from the audit log alone.
9. **Form is enforced, not advisory (per `functional-architecture.md` § 7.7).** Receiver validates form + axes consistency; refuses unsupported.
10. **Latency budgets are SLOs, not aspirations.** Per `runtime-adapter-interface.md` § Latency Budget and `peer-communication-architecture.md` § 11.
11. **PII-free, machine-portable defaults (per ADR-018).** Every default that ships in the codebase must be PII-free and machine-portable. No personal names, email addresses, biographical text, organization names, or other identifying details may appear in fixtures, schemas, default values, sample data, error messages, or build artifacts. No absolute paths anchored to a specific developer's home directory may appear as fallbacks; use `findRepoRoot()`-style discovery (walk up to `pnpm-workspace.yaml`, honor a `HOLON_REPO_ROOT` env override) or `process.cwd()`-relative resolution instead. Generic placeholders only — `"Acme"`, `"your-org"`, empty strings, `"owner@example.com"`, repo-relative paths. Scope, exclusions, and the planned CI grep hook are detailed in `docs/decisions/018-pii-free-defaults.md`.

## 11. Cross-References

This doc depends on, in roughly the order a new contributor should read:

1. `product/holon-product-definition.md` — what we're building and why
2. `functional-architecture.md` — the system map (READ THIS FIRST after the product def)
3. The detail spec for whatever component you're working on (per § 5.1 package map)
4. `reliability-and-testing.md` — how to know your code is correct
5. This doc — how it all gets built

## 12. Open Decisions

1. **Build tool: Turbo vs Nx vs Bazel.** Turbo is lightest; Nx is most TS-friendly; Bazel for hermetic. Recommend Turbo for V1 simplicity.
2. **Database access: Drizzle vs Kysely.** Both are TS-first and good with Postgres+SQLite. Recommend Drizzle for richer schema reflection.
3. **Cloud relay tech.** Hono on Bun? Express? Custom? The relay is small and stateful (idempotency cache, person→desk table); pick something operationally simple. Recommend Hono.
4. **Job/queue infrastructure.** For the retry queue. PostgreSQL-backed (e.g., pg-boss) is simplest in V1; Redis/BullMQ if scale demands.
5. **Object storage SDK.** AWS SDK for S3-compatible everywhere, or something abstraction-free. AWS SDK is fine; the deliverable layer abstracts the choice.
6. **Tracing backend default.** Jaeger? Tempo? Honeycomb? Default to OTel collector forwarding wherever the operator chooses; ship a docker-compose with Jaeger for local dev.
7. **Hermes language binding.** If Hermes is Python-first, the runtime-hermes adapter has a TypeScript ↔ Python boundary. gRPC? IPC over Unix socket? Direct subprocess with JSON streaming? Decide in the M1 spike.
8. **Tauri vs Electron commitment.** DECIDED (ADR-005, 2026-05-15): Tauri for V1 packaged desktop; Electron pre-authorized as fallback if a hard blocker emerges during M1.x packaging investigation (three-criteria test in ADR-005 § 2). See `docs/decisions/005-v1-desktop-tauri.md`.

These are tactical; resolve as we hit them. They do not block the spec set.

## 13. Acceptance Criteria For This Doc

This doc is "good enough to build the MVP" when:

1. ✅ Every component named in `functional-architecture.md` § 3 is mapped to a package in § 5
2. ✅ Every spec in the spec set (§ 2) has an implementation home in § 5.1
3. ✅ Milestones reference specific specs' acceptance criteria as exit gates
4. ✅ Engineering rules link back to declared invariants
5. ✅ MVP boundary cases are decided yes/no with rationale
6. ⬜ A new contributor can ship a small change end-to-end using this doc + one spec (verify in M0 onboarding)
7. ⬜ Build tool / DB / queue / storage decisions resolved (verify before M1)

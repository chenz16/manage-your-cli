# Mibusy → Holon Migration Plan

Status: draft v0.1
Date: 2026-05-15
Owner: design + dev
Position: The practical "how do we get from the mibusy V3 prototype to Holon V1" plan. The audit-style mapping tables in earlier specs (`local-agent-management.md` § 13, `peer-communication-architecture.md` § 13, `data-model.md` § 11) name the field-level translations; this doc sequences the work.

## 1. What We're Carrying Forward And What We're Replacing

### 1.1 Carrying forward

These mibusy V3 mechanisms work and Holon V1 should preserve them:

- **The facade/peer pattern** — `virtual_agents.agent_mode = 'facade'` becoming Holon's `peer` substrate type (per ADR-003; was `proxy` in earlier drafts)
- **Explicit subagent creation flow** — the `AgentForm.tsx` UX pattern
- **Async dispatch with peer_origin_id idempotency** — Holon formalizes as `X-Holon-Request-Id`
- **HTTP POST + callback shape** — Holon evolves to JSON-RPC 2.0 envelope but the shape is the same
- **Token-based peer auth** — Holon evolves to per-connection HMAC keys (more secure; same concept)
- **Inbound mission as first-class inbox** — Holon makes this the `Inbound` screen
- **Desk isolation via `desk_id`** — Holon makes desk_id mandatory on every row + adds RLS in V2
- **Bug reporting infrastructure** — Holon will reuse the patterns

### 1.2 Replacing entirely

These mibusy patterns don't fit Holon's V1 architecture:

- **`mission_source` packed string** for callback URL+token — replaced by proper `peer_callback_url` and `peer_callback_token` columns + connection FK
- **No retry logic** — Holon adds Stripe-pattern retry queue
- **No SSE / inbound push** — Holon adds SSE channel from desk to relay
- **`MIBUSY_DESK_ID` env var** — Holon makes desk identity a first-class `desks` table row + JWT claim
- **No multi-device routing** — Holon adds person → [desks] routing table
- **No signature verification** — Holon adds HMAC signing on every cross-desk RPC
- **Implicit handoff** (no first-class handoff record) — Holon makes handoffs a first-class entity with form + axes + lifecycle
- **`agent_mode = 'ai' | 'facade'` two-way enum** — Holon's substrate becomes a 3-way discriminated union (local_ai / cli / peer) per ADR-015; myself substrate removed, owner work goes to Today personal queue

### 1.3 Net new in Holon (not in mibusy)

- 14 named handoff forms with 8 axes
- Cultivation profile model
- Per-staff autonomy slider (Supervised / Bounded / Autonomous; per ADR-004)
- Role-based dispatch
- Audit-event-as-product-state (mibusy uses ad-hoc event records)
- Cloud relay layer with multi-device routing
- E2E ed25519 signature on cross-desk traffic
- Context pack as a typed entity
- Two Cores frame as the architectural organizing principle

## 2. Migration Sequence (Iterations)

The migration is interleaved with greenfield work; we don't do "lift mibusy then add features." Sequence:

### Iteration 001 — UI mock (no migration)

Build the UI mock from scratch per `iterations/001-ui-mock/`. No mibusy code touched. Establishes the visual language and screens.

### Iteration 002 — BFF contract (no migration)

Define API endpoints. Reference mibusy's `/api/v2/...` routes for shape inspiration, but the new contract is built fresh from Holon's spec set.

### Iteration 003 — Schema + DB skeleton (M0)

Per `implementation-architecture.md` § 9 M0:
- Stand up `packages/db` with Holon's schema from `data-model.md` § 4.
- Migration files in `packages/db/migrations/`.
- This is GREENFIELD — not migrating mibusy data, building new.
- mibusy lives on a separate DB; Holon is its own DB.

### Iteration 004 — Local team registry (M1 partial)

- Implement `staff-service`, `role-service`, `cultivation-service`.
- Port the mibusy `AgentForm.tsx` UX patterns into the new React component.
- Database is greenfield Holon schema, not mibusy.
- Borrow code where it transfers cleanly (the explicit-creation flow logic).

### Iteration 005 — Runtime adapter (M1 partial)

- `packages/runtime-dummy` first.
- Then `packages/runtime-hermes` per `runtime-adapter-interface.md` § Hermes section.
- mibusy doesn't have an abstract adapter — this is greenfield design.
- The Hermes integration spike (per `runtime-adapter-interface.md` § "Open questions for Hermes integration spike") happens here.

### Iteration 006 — Auth + pairing (M2 partial)

- `packages/auth` per `auth-and-identity.md`.
- mibusy's `peer_token` per-connection becomes the source-of-truth for the connection identity, but the derivation (now ECDH/HKDF instead of random UUID) is new.
- The pairing UX is new (mibusy uses manual token sharing).

### Iteration 007 — Wire protocol + relay (M2 partial)

- `packages/peer-protocol` and `packages/peer-relay-client`.
- The cloud relay is greenfield (mibusy has no relay; everything was direct HTTP).
- Direct-peer mode (mibusy's only mode) becomes a V2 optional optimization in Holon.
- mibusy's `/api/v2/missions` and `/api/v2/peer/done` shapes inform but don't dictate Holon's RPC method names.

### Iteration 008 — Handoff layer (M2 finale)

- `packages/handoff-engine` implementing the 14 forms from `handoff-taxonomy.md`.
- mibusy has no equivalent — entirely new.
- The mibusy facade pattern feeds into Direct Order / Direct Takeover form implementations.

### Iteration 009 — Reliability + observability (M3)

- `packages/observability` per `observability-and-metrics.md`.
- Retry queue per `reliability-and-testing.md` § 3.4.
- mibusy has no retry logic; new.

### Iteration 010 — Cloud relay deploy (M4)

- `apps/relay` (a new app) + Hosted deployment topology per `cloud-relay-architecture.md`.
- mibusy has no relay; new.

### Iteration 011 — Hosted onboarding + V1 GA

- Cloud-hosted Holon for non-local users.
- mibusy continues to run for any users still on the prototype until they migrate (separate from this plan).

## 3. Code-Level Carry-Forward Map

For developers actually doing the migration, file-by-file map of what to read in mibusy and what to build in Holon.

### 3.1 mibusy files worth reading first

```
mibusy/
├── packages/db/migrations/0005_worker_protocol.sql       → reference for Holon's staff schema
├── packages/db/migrations/0007_missions.sql              → reference for Holon's missions/inbound
├── packages/db/migrations/0010_connections.sql           → reference for Holon's connections
├── packages/db/migrations/0018_v3_peer_network.sql       → KEY — the peer routing patterns
├── packages/db/migrations/0019_peer_desk_seed.sql        → multi-desk seed pattern
├── apps/web/app/api/v2/missions/route.ts                 → mission ingest pattern
├── apps/web/app/api/v2/peer/done/route.ts                → callback handler pattern
├── apps/web/lib/v2-data.ts (lines 514–620)               → dispatchToPeer logic
├── apps/web/components/AgentForm.tsx                     → explicit subagent creation UX
├── apps/web/components/MissionInbox.tsx                  → inbox UI pattern
├── apps/web/components/MissionSheet.tsx                  → mission detail pattern
├── apps/web/components/InboxActions.tsx                  → accept/reject UX
├── apps/web/components/FacadeConfig.tsx                  → connection config UX
├── apps/web/components/MyWorkInbox.tsx                   → unified inbox pattern
└── MEMORY/WORK/v3-peer-network/HANDOFF-2026-05-14.md     → status of peer-network work
```

These are READ-ONLY references for the Holon dev. We don't import mibusy code; we read its patterns and reimplement against Holon's spec.

### 3.2 Translation table

| mibusy | Holon |
|---|---|
| `virtual_agents` table | `staff` table (`data-model.md` § 4.4) |
| `virtual_agents.agent_mode` enum | `staff.substrate.kind` discriminated union (3 kinds: local_ai / cli / peer; per ADR-015 myself removed — owner work in Today personal queue) |
| `assignments` table | `assignments` table (similar shape; new fields per `data-model.md` § 4.9) |
| `assignments.peer_origin_id` UNIQUE | `assignments.outbound_handoff_id` FK to `handoffs` |
| `assignments.origin = 'inbound'` | `missions.inbound_handoff_id` FK to `handoffs` (mission is the receiver-side record) |
| `agent_connections` table | `connections` table (`data-model.md` § 4.6) |
| `agent_connections.peer_token` | `connections.signing_key` (HMAC-derived from ECDH) |
| `agent_connections.kind` (task/chat/event/decision/stream) | (collapsed; Holon's per-connection policy lives in `connections.policy` JSONB) |
| `desks.upstream_token` | `connections.signing_key` (per-connection, not per-desk) |
| `MIBUSY_DESK_ID` env | `desks.id` row + JWT `sub` claim |
| `/api/v2/missions` POST | `holon.handoff.dispatch` JSON-RPC method |
| `/api/v2/peer/done` POST | `holon.handoff.deliver` JSON-RPC method |
| `getRunningAssignments(desk_id)` | `assignment-service.list({ deskId, state: ['running_local', 'waiting_remote'] })` |
| `getRecentHandoffs(desk_id)` | `handoff-service.list({ deskId, recent: true })` |
| `escalateStaleAssignments` (sketched, unused) | `retry-service` per `reliability-and-testing.md` § 3.4 |
| `configure_peer_agent` chat tool | (none in V1; Requirements Agent could compose a similar tool later) |

## 4. Specific Things To Watch For

### 4.1 Don't import mibusy as a dependency

Holon is a clean restart. We do not depend on mibusy's packages, schemas, or runtime artifacts. Reading code for inspiration is fine; importing is not.

### 4.2 Don't migrate mibusy data

Holon V1 ships with greenfield databases. Existing mibusy users can:
- Continue using mibusy until Holon V1 has the features they need
- Or manually re-create their staff and connections in Holon (deliberate friction; better than buggy auto-migration)

V1.x or V2 may ship a one-way mibusy→Holon import tool if there's demand. NOT a V1 commitment.

### 4.3 The handoff form gap

mibusy has no handoff forms. Every cross-desk task is implicitly "Direct Takeover" (receiver gets full authority, returns deliverable). When porting UX patterns, remember to add the form selector — it's not optional in Holon.

### 4.4 Cultivation is new

mibusy has no cultivation profile. Holon staff get cultivation from Day 1; cultivation hooks are part of the deliverable acceptance flow (per `deliverable-spec.md` § 11). Don't skip these in the early UI iterations even though there's no historical data to display yet.

### 4.5 Audit log is product state

mibusy uses ad-hoc event records. Holon's `audit_events` is load-bearing — UI subscribes to it; retry layer queries it; reconstruction depends on it. Don't treat it as an afterthought.

### 4.6 The "no silent failure" invariant is structural

mibusy has cases where a stuck assignment sits silently (e.g., `escalateStaleAssignments` is sketched but unused). Holon must enforce visibility. Per `reliability-and-testing.md` § 2, every error path emits both an audit event AND a UI-visible state change.

## 5. Risk / Mitigation

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Hermes integration discovery is harder than expected | Medium | High | Spike in Iteration 005; early honest assessment; budget for replan |
| Cloud relay introduces latency that violates SLOs | Low | Medium | Latency targets are realistic per industry; relay is small + simple |
| Migration of UX patterns introduces regression | Medium | Low | mibusy patterns are reference, not destination; we redesign per Holon's spec |
| Multi-device routing edge cases (UC-1 in peer-comms.md § 2) | Medium | Medium | Iteration test coverage focuses on multi-device flows |
| Backward incompatibility surprises (V1 → V2) | Low | Medium | ADR-001 + roadmap.md commit to additive-only schema evolution |

## 6. Acceptance Criteria

The migration plan is complete when:

1. ✅ Carry-forward and replace lists are explicit
2. ✅ Iteration sequence maps mibusy reading + new build per iteration
3. ✅ Translation table covers the major mibusy entities
4. ✅ Risk register identifies the major migration concerns
5. ⬜ Iteration 004 (Local team registry) ports the AgentForm UX successfully (verify in M1)
6. ⬜ Iteration 007 (Wire protocol) achieves the same desk-pairing flow mibusy supports (verify in M2)
7. ⬜ End-to-end smoke test passes a "send mission, get deliverable back" flow that mibusy can also do (verify in M2)

## 7. Cross-References

- mibusy field-level mappings: `local-agent-management.md` § 13, `peer-communication-architecture.md` § 13, `data-model.md` § 11
- Implementation milestones the iterations align with: `implementation-architecture.md` § 9
- Roadmap V1 → V2 → V3: `roadmap-mvp-to-enterprise.md`
- BFF + iteration shape: `docs/decisions/001-bff-and-iteration-shape.md`

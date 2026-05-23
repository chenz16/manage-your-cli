# Holon MVP Scope

Status: draft v0.2 (refreshed 2026-05-15 to align with full architecture spec set + ADR-001 iteration shape)
Owner: design + product

## 1. Goal

Build the smallest commercial-grade Holon app that proves the core loop:

```
local team → handoff → remote human/team → returned deliverable
```

The MVP is the V1 personal release per `roadmap-mvp-to-enterprise.md` § 2. It serves a single user with one or more desks, paired to other users' desks via the cloud relay, with Hermes as the only production runtime adapter.

## 2. MVP Boundary — What's In, What's Out

### In scope

- **One person, one or more desks.** A person owns one+ desks (V1.x adds polished multi-device UX; V1 supports it minimally).
- **Local AI staff via Hermes.** The runtime adapter abstraction exists (per `docs/architecture/runtime-adapter-interface.md`) but only Hermes ships in V1.
- **Myself substrate.** The desk owner doing work manually. Tasks routed to `myself` land in the owner's queue (Today screen). One desk = one owner; for V2 multi-person workspace, see ADR-010.
- **CLI executor substrate.** Wrapped CLI tools as flat staff members.
- **Peer identities.** Local mirrors of Core 2 connections (via the `peer` substrate per ADR-003).
- **All 14 handoff forms** at the protocol level (per `docs/architecture/handoff-taxonomy.md`).
- **Form-aware UI** for the 4 most common forms (Direct Order, Direct Takeover, Approval Chain, Watch Brief). Other forms are protocol-supported but UI is minimal in V1.
- **Three transport modes** (per ADR-008): cloud-relay (default), direct-peer (HTTPS LAN / known-IP), local-only (no network peers).
- **Cloud relay** as one of three transport modes; most common default for users without LAN adjacency.
- **Local-only mode.** Single desk, no peers, no relay dependency. Full Core 1 stack operational.
- **Direct-peer mode.** Two or more desks pair via LAN or known-IP. HTTPS POST transport; same JSON-RPC envelope as relay path; no relay intermediary.
- **Pairing handshake** with two-sided explicit consent.
- **Per-connection HMAC signing** + Stripe-pattern retries.
- **Audit log** as a comprehensive diagnostic record, owner-visible (per ADR-007 V1 posture).
- **Five primary screens** (Today, Inbound, Staff, Connections, Deliverables).
- **Mobile-responsive web** as the V1 surface.
- **BYOK (Bring Your Own Key).** Users supply their own LLM API key (Anthropic, OpenAI, DeepSeek, or other provider supported by the runtime adapter). Holon stores the key in local desk config (encrypted at rest); it is never transmitted to the relay or another desk. See ADR-011.

### Out of scope (deferred per `roadmap-mvp-to-enterprise.md`)

- Native mobile shells (Capacitor in V1.x)
- Tauri desktop packaging (V1.x)
- Multi-user-per-desk (V2 shared workspace — see ADR-010)
- Org / RBAC concepts (V2)
- SSO / OIDC (V3)
- E2E encryption of payloads (V3)
- Sandbox-mediated handoffs (V2)
- Direct-peer WebRTC / TURN (V2 — full NAT traversal; V1 ships LAN-only HTTPS direct-peer)
- Full UI for the 9 less-common handoff forms (V1.x → V2 phased)
- Cultivation profile editor UI (V1.x)
- Approval Chain drag-and-drop builder (V1.x)
- Negotiated handoff chat-style UI (V1.x)
- Mibusy data import tool (V1.x or V2)
- Multi-controller AI (V2)
- Federation / cross-org (V4+)
- Conversation / session primitive (task-only model is V1 invariant; see ADR-009)
- Payment processing / subscription management (V2 evaluates monetization; V1 is free — see ADR-011)
- Holon-managed LLM API keys / compute proxy (BYOK only in V1)

## 3. MVP User Story

As an individual owner, I can:

1. **Set up my desk** in under 5 minutes from a fresh install (web or local-app).
2. **Create local AI staff** with explicit role + autonomy level.
3. **Cultivate them over time** — corrections and approvals shape future work (basic version; full editor V1.x).
4. **Pair with other people's desks** via personal codes; both sides confirm.
5. **Send missions** with chosen handoff form to paired desks.
6. **Receive missions** in my inbox; accept / reject / delegate to local staff.
7. **Return deliverables** that attach back to the sender's original assignment.
8. **See connection health** at a glance and act on degraded ones.
9. **See an audit trail** of everything that happened.
10. **Trust that nothing fails silently** — every error surfaces in UI.

## 4. Acceptance Criteria

The MVP is acceptable for general release when:

1. ✓ A new user creates a desk and produces a first deliverable in under 10 minutes from a clean install.
2. ✓ Two desks pair successfully via the explicit handshake.
3. ✓ A mission sent from desk A reaches desk B and shows in B's Inbound screen within p95 < 600ms (per `docs/architecture/reliability-and-testing.md` § 6).
4. ✓ B's deliverable returns to A and attaches to A's original assignment.
5. ✓ All 6 connection health states are reachable and visually distinct in the UI.
6. ✓ The form composer shows at least 4 forms with their consent UI.
7. ✓ Autonomy slider with 6 levels works per staff; substrate ceilings honored.
8. ✓ A revoked connection propagates to the remote desk in p95 < 2s.
9. ✓ Stripe-pattern retry schedule visibly drives a temporarily-offline peer's queued mission to delivery on reconnection.
10. ✓ The owner can see an audit timeline reconstructing any entity's lifecycle.
11. ✓ `holon_invariant_violations_total = 0` over a 7-day staging soak.
12. ✓ Conformance suites pass against the dummy and Hermes runtime adapters.
13. ✓ Wire protocol conformance suite passes (per `docs/architecture/peer-communication-architecture.md` § 16).
14. ✓ A two-desk demo can be reproduced from a clean checkout in under 5 minutes.
15. ✓ The 5 primary screens render with realistic fixture data on web at 375px and 1280px widths.

## 5. Specs This MVP Implements

The MVP is implementation of the spec set. Per `docs/architecture/implementation-architecture.md` § 2:

| Spec | Coverage in V1 |
|---|---|
| `docs/product/holon-product-definition.md` | Full vision; 5 primary screens; success metrics tracked |
| `docs/architecture/functional-architecture.md` | Two Cores; all 4 seam crossings; all 7 invariants enforced |
| `docs/architecture/local-agent-management.md` | Flat-roster invariant + 4 substrates + 6 autonomy levels + cultivation skeleton |
| `docs/architecture/runtime-adapter-interface.md` | Full contract; Hermes + dummy adapters; conformance suite |
| `docs/architecture/handoff-design.md` | Full lifecycle, packet, context-pack overview |
| `docs/architecture/handoff-taxonomy.md` | All 14 forms supported in protocol; UI for 4 most common |
| `docs/architecture/peer-communication-architecture.md` | All 13 RPC methods; relay deployed; SSE inbound push; idempotency |
| `docs/architecture/auth-and-identity.md` | Pairing, JWT, HMAC-derived signing keys, revocation |
| `docs/architecture/data-model.md` | All 14 entities with full schema + indexes |
| `docs/architecture/deliverable-spec.md` | Markdown + structured + files_only body kinds (sandbox_export V2) |
| `docs/architecture/context-pack.md` | by_value + by_reference modes (shared_state + sandbox V2) |
| `docs/architecture/reliability-and-testing.md` | All retry schedules + 11 metrics + 10 chaos scenarios |
| `docs/architecture/cloud-relay-architecture.md` | V1 single-instance relay deployed |
| `docs/architecture/observability-and-metrics.md` | Logger + metrics + tracer libraries shipped |
| `docs/architecture/security-threat-model.md` | All threats with at least one V1 mitigation |
| `docs/architecture/ui-architecture.md` | 5 primary screens + form composer + autonomy slider |

## 6. Engineering Milestones

Per `docs/architecture/implementation-architecture.md` § 9. Each milestone has spec-anchored exit gates (see that doc for details).

```
M0  Schema + skeleton           ~2 weeks
M1  Core 1 local execution      ~3 weeks
M2  Core 2 peer protocol        ~3 weeks
M3  Reliability + chaos         ~2 weeks
M4  Cloud relay (hosted mode)   ~3 weeks
─────────────────────────────────────────
~13 weeks to V1 GA
```

## 7. What "Commercial-Grade" Means For V1

Not feature-complete; commercial-grade means:

- **Trustworthy.** No silent failures; every error visible. Audit completeness verified.
- **Documented.** The spec set + this scope + iteration logs let any new contributor understand what's built.
- **Secure.** All threats from `docs/architecture/security-threat-model.md` have V1 mitigations in place.
- **Observable.** SLOs measured continuously; dashboards exist; on-call playbook outline.
- **Backed up.** Database backups; cloud relay HA; recovery procedures documented.
- **Polished.** UI matches the marketing brand; no obvious cosmetic bugs.
- **Demo-able.** Two-desk end-to-end flow reproduces from clean checkout.
- **Testable.** Conformance suites for runtime adapter + wire protocol pass.

NOT required for V1:

- Every feature on the V2/V3 roadmap
- Every UI polish for every form
- Localization
- Advanced compliance certifications
- Enterprise admin features

## 8. Cross-References

- Vision: `docs/product/holon-product-definition.md`
- Phasing: `docs/product/roadmap-mvp-to-enterprise.md` (V1 → V2 → V3)
- Architecture map: `docs/architecture/functional-architecture.md`
- Build sequence: `docs/architecture/implementation-architecture.md` § 9
- Iteration mechanics: `iterations/README.md`
- Architecture decisions: `docs/decisions/`
- Threat posture: `docs/architecture/security-threat-model.md`

## 9. Open Decisions

Not blockers for V1 GA, but on the operator's mind:

1. **First commercial price point.** Per `roadmap-mvp-to-enterprise.md` § 2 open decisions.
2. **Default cloud relay region for hosted V1.** US-East default; when do we add EU?
3. **Default backup retention.** 30 days hot, 1 year cold? Per-desk override?
4. **Beta vs GA threshold.** What customer-facing milestones count as "ship V1"? Probably: 50 paid users with stable usage for 4 weeks.
5. **Mibusy users transition support.** Hand-hold the existing mibusy users to migrate? Document only? Defer until known interest level.

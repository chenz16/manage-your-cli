# Roadmap: MVP to Enterprise

Status: draft v0.1
Date: 2026-05-15
Owner: design + product

This document lays out the staged evolution from the V1 personal release to a multi-tenant enterprise product, with one rule: **V1's choices must not paint V2 or V3 into a corner.** Every architectural decision in V1 is sized against what V2 and V3 will need to add.

## 1. Phases At A Glance

```
V1  Personal    ─ single user, 1 desk per install, cloud-relay-mediated
V1.x Power user ─ same user, multiple desks, cross-device sync polish
V2  Small team  ─ multiple users in one org, RBAC, admin console, hosted-only
V3  Enterprise  ─ SSO, compliance, audit export, on-prem option, scale
V4+ Network     ─ federation between orgs, marketplace of capabilities
```

The interfaces (handoff packet, wire protocol, runtime adapter contract, data model) STAY the same across versions. New features are layered ON, not surgically inserted.

## 2. V1 — Personal (target: ~13 weeks per `implementation-architecture.md` § 1)

### Scope

- One person owns one or more desks.
- Each desk: local AI staff via the direct multi-CLI adapter (`packages/core/src/cli-adapters.ts` — claude / codex / gemini / qwen on the user's CLI subscription), optional manual work routed to the owner (`myself` substrate), CLI executors, proxy identities for paired peers. *Sister-repo lineage: earlier framing said "via Hermes"; `manage-your-cli` has no Hermes runtime — see ADR-040.*
- Cross-desk handoffs through a Holon-hosted cloud relay.
- Pair desks one-to-one via personal codes.
- The 13 named handoff forms work, but UI defaults to the simpler ones (Direct Order, Direct Takeover, Approval Chain, Watch Brief). Advanced forms (Dual Authorization, Negotiated, Conditional Engagement) work but UI is minimal.
- Local-first: works offline for local AI work; cross-desk needs the relay.

### Business model

- **Free.** V1 is completely free. No paid tier, no payment processing.
- **BYOK.** Users supply their own LLM API key. Holon does not proxy or charge for compute. Key stays in local desk config (encrypted at rest).
- **Cloud relay (when used):** operated by the Holon project on best-effort basis with per-desk rate caps (generous; normal V1 usage never hits them). No relay SLA promised.
- V2 evaluates monetization based on V1 usage data. Possibilities (not committed): BYOK + paid relay tier; managed compute + per-mission billing; subscription; freemium. See ADR-011.

### What V1 deliberately does NOT do

| Not in V1 | Why deferred |
|---|---|
| Multi-user per desk | Confuses "the desk's owner" identity model; V2 shared workspace (ADR-010) is the answer |
| RBAC | One-user-per-desk has no roles to govern |
| SSO | Personal Holon JWT issuer is sufficient |
| Audit export | Compliance needs come with V3 customers |
| Org admin | No org concept yet |
| Sandbox-mediated handoffs | Operational infrastructure cost too high; V2 |
| Direct peer WebRTC / TURN | V1 ships HTTPS LAN direct-peer; WebRTC for full NAT traversal is V2 (ADR-008) |
| Negotiated handoff full UI | Form supported in protocol; UX comes later |
| E2E encryption | TLS + trusted relay good enough; V2 hardens |
| Custom runtime adapters | Multi-CLI adapter only in V1; abstraction layer reserved for later (sister-repo lineage said Hermes-only — N/A here) |
| Conversation / session primitive | Task-only model is V1 invariant; V2 evaluates based on user research (ADR-009) |
| Payment processing | V1 is free + BYOK; V2 evaluates monetization (ADR-011) |

### Schema/protocol commitments V1 must honor

V1 must lock these to avoid forced rewrites later:

- Handoff packet shape (per `handoff-design.md` + `handoff-taxonomy.md`) — adds-only evolution
- Wire protocol method names + response shapes (per `peer-communication-architecture.md` § 5) — adds-only
- Runtime adapter interface (per `runtime-adapter-interface.md`) — adds-only at minor versions
- DB schema (per `data-model.md`) — additive migrations only; no field removals or type changes that require backfill
- JWT claims structure (per `auth-and-identity.md` § 3.2) — `iss` claim swap-able for V3 SSO

## 3. V1.x — Power User (target: ~6 weeks after V1)

### Added scope

- A person can pair multiple of their own devices to the same person identity (laptop + phone + work computer all known to be Alice).
- Cross-device sync of mission state (not just relay routing — the desks themselves see each other's view).
- Per-mission multi-device routing policies (`primary` / `most_recently_active` / `all_devices` per `peer-communication-architecture.md` § 8.2).
- Native iOS/Android shells via Capacitor (notifications, install prompt).
- Cultivation profile export/import for migrating a staff between desks.
- Dual Authorization handoff form gets full UI.
- **Auto-degrade autonomy triggers** (per ADR-006): 3 consecutive rejected
  deliverables demote one level; newly-added tools force the next
  assignment using that tool to Supervised; newly-paired peers force the
  first 5 handoffs to Supervised. Owner notified each time; standing
  autonomy preserved where the mechanism is the per-assignment override.

### What stays the same

- Wire protocol unchanged.
- Schema additive only: new `cross_device_sync_subscriptions` table; existing tables unchanged.
- Auth: same JWT shape; `person` claim now meaningful (was already there; V1 had only one device per person typically).

### What changes for users

- Cross-device experience matches modern messaging apps — see your missions wherever you are.
- Power users can organize work across devices intentionally.

### Risks

- Sync conflict resolution (two devices both accept a mission) — handled by `claimed_by` semantics in `peer-communication-architecture.md` § 8.3; needs UI polish.
- Battery / data usage on phones — heartbeat and SSE need careful tuning.

## 4. V2 — Small Team (target: ~3 months after V1.x)

### Added scope

- **Org concept.** A Person can belong to one or more Orgs. Orgs own connections in addition to (or instead of) Persons.
- **Multi-user per org.** Within an org, multiple Persons each with their own desks. Person A and Person B in the same org can pair their desks under "internal" trust (lighter pairing flow).
- **Shared Workspace (per ADR-010).** A multi-owner container above individual desks. Shared deliverable space, shared connection registry, shared audit log (workspace-level), and workspace-internal task assignment (lighter ceremony than cross-org handoffs). Each owner retains their private desk; the workspace is the shared layer above it. V1 desks are implicitly single-person workspaces. Full spec in `docs/architecture/workspace.md` (to be written in V2 planning).
- **Admin console.** Org admins manage org-wide settings: which forms are accepted from external desks; rate limits; allowed connections; audit visibility.
- **RBAC.** Org-level roles (admin, member, viewer). Org admin can see across all member desks (audit-only by default; with member's consent for live access).
- **Hosted-only mode.** V2 ships as cloud-hosted Holon for orgs (the "Holon for Teams" SKU). Local install remains for individuals.
- **Sandbox-mediated handoffs.** Ship the relay-managed sandbox provisioning per `handoff-taxonomy.md` Axis 7 + `peer-communication-architecture.md` § 6.5.
- **Compensation actions.** Forms with side effects can declare compensation; V2 enforces them on revocation.
- **Direct peer** via WebRTC for full NAT traversal (builds on V1's HTTPS LAN direct-peer; per ADR-008 V2 upgrade note).
- **Audit export** at the org level (signed bundles).
- **Search** across an org's deliverables (subject to disclosure rules).
- **Cultivation-driven autonomy suggestions** (per ADR-006): UI nudges
  prompt the owner to promote a staff when positive exemplar count crosses
  thresholds (starting heuristics: 10+ exemplars for Supervised→Bounded;
  25+ across ≥3 tools for Bounded→Autonomous). Never auto-applied;
  dismissal suppresses the suggestion for 30 days. Thresholds tunable via
  feature flag.
- **Mentor invocation as formal handoff + auto-route based on AI confidence (per ADR-016).** V1 records mentor consultations in the cultivation log only (informal). V2 upgrades to formal `Advisory`-form handoffs for mentor invocation, and enables the `ai_decides` invocation policy so the AI member routes to a mentor automatically when its confidence on a domain-specific task falls below a threshold.
- **Monetization evaluation (per ADR-011).** Assess BYOK + paid relay tier vs managed compute vs subscription based on V1 usage data and user interviews. V2 planning allocates 4–6 weeks for payment infrastructure if a paid tier is selected.
- **Conversation primitive evaluation (per ADR-009).** If V1 user research shows strong demand for exploration-mode interaction that doesn't fit the task model, V2 evaluates adding a conversation primitive. Evaluation criteria: is the gap large enough? Does it strengthen or dilute the structured-work positioning?

### What stays the same

- Handoff packet shape (form + axes unchanged).
- Wire protocol — extended with new methods (`holon.org.invite`, `holon.org.policy.update`) but existing methods unchanged.
- Runtime adapter interface unchanged.
- Single-user desks continue to work; orgs are an opt-in layer above.

### What changes structurally

- `persons` table grows `primary_org_id` nullable column (per `data-model.md` § 4.2 placeholder).
- New `orgs`, `org_members`, `org_policies` tables.
- Connections gain `org_scope` (intra-org vs cross-org) — affects pairing flow.
- JWT `capabilities` claim grows to include org-level capabilities for org admins.
- Database multi-tenancy enforcement (per `data-model.md` § 9) becomes mandatory in hosted V2.

### Schema migration for V2

Additive only:
- New tables: `orgs`, `org_members`, `org_policies`, `org_audit_subscriptions`
- New columns on existing tables (all nullable, default `NULL`):
  - `persons.primary_org_id`
  - `connections.org_scope`
  - `desks.org_id`
- New JWT claim handling — backwards-compatible (V1 desks ignore unknown claims).

V1 desks continue to work uninterrupted on a V2-upgraded relay; they just don't see org features.

### Business model V2

- Per-seat pricing for Holon for Teams ($Y / member / month)
- Org-level features (audit export, admin console, sandbox usage allowance)
- Custom integrations (paid services for connecting to org-internal tools)

## 5. V3 — Enterprise (target: ~6 months after V2)

### Added scope

- **SSO via OIDC.** Org admin connects an external IdP (Okta, Auth0, Google Workspace, Microsoft Entra). Holon's JWT `iss` swaps from `holon-relay` to the IdP per `auth-and-identity.md` § 9.
- **SCIM provisioning.** Auto-create/disable Holon Persons + desks based on IdP user lifecycle.
- **Compliance posture.** SOC 2 Type II readiness; GDPR data-residency options; regulated-industry add-ons.
- **On-prem option.** A self-hosted Holon relay + hosted nodes inside the customer's VPC. The whole stack containerized; Helm charts; reference observability dashboards.
- **Cross-org federation (limited).** Org A's admin can establish trust with Org B's admin; their members' desks then pair under inter-org policies (rate limits, audit sharing, allowed forms).
- **Step-up authentication.** High-value actions require fresh re-auth (per `auth-and-identity.md` § 11 / open decision #4).
- **E2E encryption** of payload bodies (per `auth-and-identity.md` § 11 open decision #5). Relay sees envelopes but not contents.
- **Hardware attestation** for desks (TPM / Secure Enclave) for highest-trust connections.
- **Compliance audit retention** with immutable storage backend.
- **Custom runtime adapters.** Customers can ship their own runtime adapters to integrate proprietary AI stacks. The adapter contract from V1 (`runtime-adapter-interface.md`) is the integration surface; conformance suite proves correctness.
- **Mentor skill distillation: cultivation profile absorbs mentor patterns; system suggests AI promotion (per ADR-016).** The cultivation pipeline reads the accumulated mentor consultation log and surfaces patterns from the mentor's past responses as standing context for the AI member. When the volume of absorbed patterns crosses a confidence threshold, the system suggests "AI may no longer need [mentor] for [domain]" and prompts the owner to confirm an autonomy promotion. Owner confirmation is always required; the system never auto-promotes.

### What stays the same

- Two Cores frame.
- Handoff taxonomy (no new forms required; existing forms cover enterprise use cases).
- Wire protocol shape (new auth claims; same RPC methods).
- Runtime adapter contract (now with multiple production implementations).

### What changes structurally

- JWT issuer is now external; relay validates JWTs but doesn't mint them.
- Desk audit logs may stream to customer-controlled storage in addition to local persistence.
- Multi-tenant isolation hardens (Postgres RLS becomes mandatory; no row escapes its `desk_id`).
- Pairing flow within an org can be auto-initiated by SCIM-discovered members.

### Schema migration for V3

Additive plus a few nullable column additions:
- `persons.external_idp_url`, `persons.external_id` (per `data-model.md` § 4.2)
- `desks.attestation` (nullable JSON for hardware attestation receipts)
- `audit_events.exported_to_external_storage_at` (nullable timestamp)
- New tables: `orgs.federation_trusts` (cross-org), `compliance_export_jobs`

V1 and V2 desks continue to work; V3 features are opt-in per org.

### Business model V3

- Enterprise license (custom pricing; per-org annual contracts)
- Premium support
- Compliance certifications as billable add-ons
- Professional services for SSO integration / runtime adapter custom builds

## 6. V4+ — Network (vision; not yet committed)

Speculative. Possibilities:

- **Federation between Holon-as-a-product instances.** Different companies running their own Holon platforms (cloud-hosted-by-vendor or on-prem) trust each other via DIDComm-style federation (per `peer-communication-architecture.md` § 3 deferred protocols).
- **Capability marketplace.** Desks publish capability descriptors (Agent Cards in A2A vocabulary); senders discover services across the network. Reputation, rating, and discovery.
- **Public-good handoffs.** Anonymous-acceptance handoffs to crowdsourced pools (e.g., research questions to a science network).
- **Composable handoff workflows.** A library of pre-built handoff compositions (Approval Chain templates, Subcontracting patterns) that orgs can customize.

Not committed. Stated here so V1–V3 decisions consider these possibilities (e.g., the DID-friendly identity hooks live in V2 SSO; cross-org federation in V3 lays groundwork for V4).

## 7. Anti-Goals — Things We're NOT Building Toward

These are deliberate exclusions across the roadmap:

| Not building | Reason |
|---|---|
| Holon as a chat app | Holon's primary surface is missions/handoffs, not conversation. Chat is a degenerate case. |
| Conversation primitive in V1 | Holon's value is structured workflow with accountability. Task-only model is V1 invariant; V2 evaluates if user research shows demand. See ADR-009. |
| Holon as an LLM training platform | Holon orchestrates AI work; it does not train models. Training is upstream. |
| Holon as a workflow builder (Zapier-style) | Workflows are owner intent; Holon doesn't ask the owner to author DAGs. |
| Holon as a marketplace from day one | Marketplaces require trust and reputation infrastructure that's V4+. V1 needs to nail one-to-one trust first. |
| Anonymous open inbox | "Anyone can send Alice a mission" is a spam attractor. Pairing is always two-sided. |
| Hierarchical agent management | Per `local-agent-management.md` § 2: flat-roster invariant forever. Even at enterprise scale, owners manage flat teams. |
| Building our own LLM/agent-loop runtime in V1 | We use the user's CLI subscriptions (claude / codex / gemini / qwen); we don't compete with them. Adapter contract reserves the option for V3+ if a strategic need emerges. *Sister-repo lineage row read "Replacing Hermes with our own runtime in V1"; `manage-your-cli` has no Hermes runtime to replace.* |

## 8. The "V1 Choices That Enable V2/V3" Audit

Every V1 architectural decision has been double-checked for forward-compatibility. The summary:

| V1 decision | V2/V3 implication | Cost if we got it wrong |
|---|---|---|
| Two Cores split | Org features (V2), federation (V4) layer cleanly into Core 2 | Refactor of cross-cutting concerns — large |
| UUIDv7 IDs | Sortable, sharding-friendly for V2 hosted scale | Migration to UUIDv7 from any other format — painful |
| Audit-emit-before-state-change | Compliance (V3) gets clean audit trail for free | Retrofit of every service method — very large |
| Per-connection HMAC keys | E2E (V3) layers on top by encrypting payload before HMAC | None; this is forward-compatible |
| `desk_id` on every row | Multi-tenant (V2) is "turn on RLS" not "redesign schema" | Refactor every query — very large |
| Forms as 6+2 axes (now 8) | New forms + sandbox modes (V2) just add enum values | None; expansion is built in |
| JWT issuer = "holon-relay" string | SSO (V3) just swaps the string | None; trivial |
| Runtime adapter as abstract interface | Custom adapters (V3) plug in | Lock-in to a single runtime (the sister-repo lineage feared Hermes lock-in; `manage-your-cli` mitigates by per-binary CLI adapters) — very large |
| Person → Desks routing on relay | Multi-device (V1.x), org membership (V2) build on this | Re-architect identity — very large |
| Cultivation profile separate from base staff | Owner cultivation portable across desks (V1.x) | None |

The audit shows: V1's design pays the upfront cost of forward-compatibility in exchange for V2 and V3 being layer-on, not redesign.

## 9. Migration Strategy

### V1 → V1.x

Pure additive: new tables, new optional features. Existing V1 desks continue to work; V1.x adds opt-in cross-device features.

### V1.x → V2

Additive plus a few nullable columns. V1 personal users see no change. Org users opt into the org concept (their existing personal desks remain personal until they choose to "join an org").

### V2 → V3

Mostly additive. The one significant change is the JWT issuer swap for SSO orgs — handled per-org, so non-SSO orgs keep V2 behavior.

The one place we may need a non-additive migration is V3 E2E encryption: existing connections may need to re-key. We address by making E2E opt-in per connection and supporting both modes during a transition window.

### Backward Compatibility Window

| Version | Backward-compatible with |
|---|---|
| V1.x | V1 |
| V2 | V1, V1.x |
| V3 | V2, V1.x (V1 deprecated 12 months after V3 launch) |

A V1 desk talking to a V3 desk: works for the V1 feature set, ignores V2/V3 capabilities it doesn't understand. This is by design — protocol evolves additively.

## 10. Customer Journey Across Versions

What a single customer might experience over time:

| Time | Customer | Holon stage |
|---|---|---|
| Day 1 | Alice, solo founder, installs Holon on her laptop | V1 personal |
| Month 2 | Alice pairs with three trusted advisors | V1, multi-connection |
| Month 4 | Alice adds her phone | V1.x |
| Month 8 | Alice's company grows; she invites her two co-founders to a Holon org | V2 small team |
| Year 2 | Company is now 50 people; IT requires SSO and audit export | V3 enterprise |
| Year 3 | Company federates with a partner company's Holon | V4 network |

The same product accompanies the customer end-to-end. They don't migrate platforms; the platform grows with them.

## 11. Open Decisions

1. **Pricing model details.** Per-person? Per-org? Per-mission? Hybrid? Affects what features should be paywalled.
2. **Hosted-only vs hybrid for V2.** Should V2 also support the "local + cloud connector" model from V1, or is V2 cloud-only? Cloud-only simplifies operations; hybrid keeps user choice.
3. **V1 → V2 timing.** Is 3 months after V1 too aggressive? Want enough V1 customer feedback to design V2 well.
4. **Compliance certifications.** Which to pursue first: SOC 2, HIPAA, FedRAMP, ISO 27001? Depends on first enterprise customer profile.
5. **Marketplace timing.** V4+ is speculative. Should we start surfacing capability descriptors (Agent Cards) in V2 for future use, or wait until needed?
6. **Federation protocol choice.** V4 federation: extend Holon's own protocol with org-trust constructs, or adopt DIDComm? Affects V3 identity decisions.
7. **Desktop install distribution.** App stores (Mac App Store, Microsoft Store) for V1.x or self-distribution? App stores ease installs but constrain runtime privileges.

## 12. Cross-References

- Architecture: this roadmap is what the architecture is *for*.
- All architecture docs in `architecture/` define V1; this doc says how V2/V3 layer on without breaking V1.
- `product/holon-product-definition.md` — V1 product definition.
- `product/mvp-scope.md` — what V1 specifically ships.
- `architecture/data-model.md` § 11 — V1 vs V2 retention table.
- `architecture/auth-and-identity.md` § 9 — V2 SSO migration sketch.
- `architecture/peer-communication-architecture.md` § deferred protocols — the V4 federation surface.

## 13. Acceptance Criteria

This roadmap is "good enough to plan business and architecture decisions" when:

1. ✅ V1 scope is concrete and matches the implemented spec set
2. ✅ V2/V3 add only — every change traces back to V1's forward-compatibility
3. ✅ Anti-goals are explicit
4. ✅ Customer journey across versions is plausible
5. ✅ Schema migration is additive across version boundaries
6. ⬜ Reviewed with any prospective enterprise customer; their must-haves are in V3 or earlier (to be done at first enterprise sales conversation)
7. ⬜ Pricing model has at least one customer-validated price point per tier (V1 and V2)

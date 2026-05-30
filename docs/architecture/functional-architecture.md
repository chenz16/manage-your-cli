# Functional Architecture

Status: draft v0.2 (rewritten 2026-05-15 around the Two Cores frame)
Owner: design
Audience: anyone who needs the system map before reading a detail doc.

## 1. Purpose

This document is the **single high-level map** of Holon. It says what the system is made of, how the pieces fit, and where to read more about each piece. It does not define wire formats, schemas, or runtime contracts in detail — those live in the dedicated docs cross-referenced at the bottom.

If you are about to read any other architecture document, read this one first.

## 2. The Two Cores

Holon is two products in one app, joined at a clean seam.

### 2.1 Core 1 — Local Agent Management

Each desk owns a small, flat, role-based team that it can dispatch work to. The team can include AI staff, the owner themselves (the `myself` substrate, for tasks the owner does manually), and CLI executors. The desk presents a uniform interface across all of them — the controller at the top can be a human owner, an AI assistant, or both, and Holon does not care which.

Core 1 is **organizationally simple by design**. It is a single-layer roster with a hard span-of-control cap (around 7) and no internal hierarchy. The detailed reasoning for the flat constraint, the resident-role pattern, the owner-cultivation model, and the autonomy-slider mechanism live in `local-agent-management.md` (to be written). This document only declares the architectural commitments that flow from those decisions.

What Core 1 owns:

- the local staff roster
- routing within the desk (assignment → staff → runtime)
- the runtime adapter that executes AI staff
- the local context store and policy
- the owner's view of in-flight local work

What Core 1 does NOT own:

- any cross-desk relationship
- any concept of "another person's desk"
- the inbox of inbound missions (those land at the Core 1 / Core 2 seam)
- nested agent hierarchies (forbidden by invariant — see § 7)

### 2.2 Core 2 — Hybrid Employment Interconnect

When a desk hands work to another desk, the relationship is a typed work arrangement (a *handoff*) carried over a typed *connection*. Connections are the enduring relationship between two desks; handoffs are individual engagements within those connections. Missions, assignments, and deliverables are the durable artifacts that record what was sent, what was done, and what came back.

The detailed taxonomy of handoff forms (Direct Order, Direct Takeover, Proxy Engagement, Dual Authorization, Approval Chain, Observer Brief, Advisory, Temporary Cover, Conditional Engagement, Subcontracting, Parallel Solicitation, Negotiated Handoff, Watch Brief, Escalation Ladder) lives in `handoff-taxonomy.md`. The lifecycle, packet format, context pack, and authority scope live in `handoff-design.md`. The wire-level transport, identity, and reliability live in `peer-communication-architecture.md` (to be written).

What Core 2 owns:

- the connection registry (per-peer-desk durable relationship)
- the handoff layer (constructing, sending, validating, acknowledging handoff packets)
- the mission inbox (incoming work surface for the owner)
- the outbound assignment tracker (what your desk sent, where it is, what came back)
- the deliverable callback path (returns plus storage)
- audit of every cross-desk event

What Core 2 does NOT own:

- the local execution of any work (that is Core 1's runtime adapter)
- the local roster (Core 2 sees other desks' members only as opaque peer identities)

### 2.3 The Seam Between The Two Cores

There are exactly four kinds of crossings:

1. **Outbound dispatch** — Core 1 router sees that an assignment's target is a peer identity. It hands the assignment off to Core 2's handoff layer. Core 2 takes it from there until a deliverable comes back.
2. **Inbound mission** — Core 2 receives a handoff packet from a remote desk, validates it, and lands it in the mission inbox. The owner reviews it. If accepted and routed to local AI staff, the mission becomes a Core 1 assignment.
3. **Deliverable return** — Core 2 receives a callback containing a deliverable; it attaches the deliverable to the originating assignment in Core 1's view. The owner sees "your assignment is done."
4. **Sub-handoff disclosure** — When Core 1 work is governed by a handoff that allows sub-delegation with disclosure, the receiver desk's Core 1 must surface "I plan to escalate this further" up to Core 2's handoff layer for outbound notice.

These four crossings are the only places the two cores touch. Everywhere else, they ignore each other. This separation is the architectural payoff for the conceptual split.

### 2.4 Why The Split Matters

- **Different optimization objectives.** Core 1 optimizes for owner clarity and execution simplicity. Core 2 optimizes for cross-boundary accountability and reliability.
- **Different failure modes.** Core 1 fails locally and is debuggable from the owner's desk. Core 2 fails across machines, networks, and identity systems — and must surface those failures in the owner's terms.
- **Different evolution rates.** Core 2's protocol freezes early (other desks depend on it). Core 1 can be reorganized often without breaking other desks.
- **Different mental models for users.** Core 1 = "my team." Core 2 = "my contracts." Mixing them in UI or docs makes both confusing.

## 3. System Components

Nine major components. Each lives in exactly one of the two cores, except where noted.

### 3.1 Desk Shell *(spans both cores)*

The application frame. Routes the owner between screens (Today, Inbound, Staff, Connections, Deliverables). Hosts the UI components for both cores. Manages session, auth, local DB connection, and event subscription.

Detailed: `ui-architecture.md`.

### 3.2 Local Team Registry *(Core 1)*

Holds the desk's member roster. Each member record is one of: local AI member, Myself (the owner doing the work manually), CLI executor, or peer identity (the peer mirror is Core 1's *view* of a Core 2 connection). Enforces the flat-roster invariant — members cannot themselves own members. Surfaces the per-member autonomy level set by the owner.

Detailed: `local-agent-management.md` (to be written).

### 3.3 Router *(Core 1)*

Decides where an assignment goes. Inputs: assignment + target member. Outputs: either a runtime job (target = local AI member), an owner queue entry (target = the owner themselves), or a handoff packet to the handoff layer (target = peer identity).

The router is small and policy-driven. It does not "plan" — the owner has already chosen the target.

### 3.4 Runtime Adapter *(Core 1)*

Converts an assignment targeted at local AI staff into an executable job in
the underlying runtime. In the current shipped product the "runtime" is an
**official CLI binary** (Claude Code, Codex, Gemini CLI, Qwen Code) driven via
the multi-CLI adapter (`packages/core/src/cli-adapters.ts`); the secretary
runs as a warm `claude --print --input-format stream-json` process and
employees run inside tmux. The abstract `RuntimeAdapter` interface is
preserved so other adapters can plug in later. Returns an event stream and a
deliverable draft.

> Historical note. Earlier drafts of this doc named "Hermes" as the V1
> runtime. The codebase no longer carries a Hermes adapter — intelligence
> comes entirely from the user's CLI subscription, per `CLAUDE.md` § North
> Star and the README's "How it works" section. Treat "Hermes" in older
> sub-docs as a stand-in for "the CLI adapter" until those docs are refreshed.

Detailed: `runtime-adapter-interface.md`.

### 3.5 Handoff Layer *(Core 2)*

Constructs handoff packets in one of the named forms (with axes), sends them to the connection layer, validates incoming packets against form/axes consistency, manages the lifecycle states, persists the handoff record, and emits audit events.

Detailed: `handoff-design.md`, `handoff-taxonomy.md`.

### 3.6 Connection Layer *(Core 2)*

Maintains the registry of peer connections (one per remote desk this desk talks to). Translates a handoff packet plus a target connection into a wire-level send. Manages credentials per connection (token, signing key, expiry). Surfaces connection health (healthy / degraded / offline / retrying / revoked).

The connection layer supports three transport modes in V1: **cloud-relay** (default — the Holon relay routes traffic between desks), **direct-peer** (HTTPS POST to a LAN/known-IP endpoint, no relay intermediary), and **local-only** (no outbound connections; desk operates fully offline). The handoff layer is transport-agnostic; it calls `ConnectionLayer.send()` regardless of mode. See ADR-008 and `peer-communication-architecture.md` § 6.

Detailed: `peer-communication-architecture.md` (to be written).

### 3.7 Mission Inbox *(Core 2 → Core 1 transition surface)*

Receives validated inbound handoffs and presents them to the owner as missions. The owner accepts, rejects, asks a question back, or delegates the mission to local AI staff (which makes it a Core 1 assignment). The inbox is the *only* way external work enters the desk; nothing bypasses it.

### 3.8 Deliverable Store *(cross-cutting)*

Durable storage for deliverables. Used by Core 1 (local AI staff produce deliverables here) and by Core 2 (returned deliverables from remote desks land here). Each deliverable has stable identity, attribution, parent assignment, optional file references, and citations.

Detailed: `deliverable-spec.md` (to be written).

### 3.9 Audit / Event Bus *(cross-cutting)*

Every important state change in either core emits an event. Subscribers: UI live updates; audit log; observability/metrics; reliability layer (uses events to detect stuck assignments). Events are append-only and entity-keyed.

Detailed: `reliability-and-testing.md` (to be written).

## 4. High-Level Interfaces

The contracts between components. Detailed schemas live in the dedicated docs; this section captures the SHAPE so the system fits together at a glance.

### 4.1 Desk Shell ↔ Owner

The UI surface. Owner sees:

- a unified Today view (in-flight local + in-flight remote work)
- five primary screens (Today, Inbound, Staff, Connections, Deliverables)
- handoff-form-aware composition surfaces
- per-staff autonomy controls

Detailed: `ui-architecture.md`.

### 4.2 Desk Shell ↔ Local Team Registry

```
StaffRegistry.list()           → Staff[]
StaffRegistry.create(spec)     → Staff               # explicit user creation only
StaffRegistry.update(id, spec) → Staff
StaffRegistry.archive(id)      → void
StaffRegistry.setAutonomy(id, level) → void          # owner-cultivated control
```

The registry rejects `create` if it would push count over the per-desk cap. Detailed: `local-agent-management.md`.

### 4.3 Router ↔ Runtime Adapter

Already fully specified. The router calls `adapter.start(jobConfig)` and consumes the returned `RuntimeJobHandle`'s event stream until terminal.

Detailed: `runtime-adapter-interface.md`.

### 4.4 Router ↔ Handoff Layer

```
HandoffLayer.dispatch(assignment, targetProxyStaff, formChoice)
  → PendingHandoff
HandoffLayer.cancel(handoffId, reason) → void
HandoffLayer.observe(handoffId)        → AsyncIterable<HandoffEvent>
```

The router invokes `dispatch` when an assignment's target is a peer identity. The form choice comes from the owner's UI selection (with sane defaults per connection type). The router does not see the wire format — it sees the `PendingHandoff` handle and observes lifecycle events.

### 4.5 Handoff Layer ↔ Connection Layer

```
ConnectionLayer.send(connectionId, handoffPacket)
  → SendReceipt
ConnectionLayer.callback(connectionId, callbackPayload)
  → CallbackReceipt
ConnectionLayer.health(connectionId)
  → ConnectionHealth
```

The handoff layer chooses the connection (based on which peer identity is the target). The connection layer handles transport, retries, signing, and idempotency.

### 4.6 Connection Layer ↔ Wire Transport

The wire layer is below the connection layer. It handles HTTP/SSE/WebRTC plumbing, JSON-RPC envelope, signature verification, and idempotency cache. The connection layer treats it as opaque transport.

Detailed: `peer-communication-architecture.md` (to be written).

### 4.7 Mission Inbox ↔ Owner

```
MissionInbox.list(filter)              → Mission[]
MissionInbox.accept(missionId)         → Mission
MissionInbox.reject(missionId, reason) → Mission
MissionInbox.askQuestion(missionId, question) → Question
MissionInbox.delegate(missionId, targetStaffId) → Assignment
MissionInbox.submit(missionId, deliverableDraft) → Deliverable
```

Every action emits an event consumed by Core 2's handoff layer to send appropriate replies upstream.

### 4.8 Deliverable Store ↔ All

```
DeliverableStore.write(draft, attribution, parentAssignmentId) → Deliverable
DeliverableStore.read(deliverableId)                           → Deliverable
DeliverableStore.attachFile(deliverableId, fileRef)            → void
DeliverableStore.listForAssignment(assignmentId)               → Deliverable[]
```

Detailed schema: `deliverable-spec.md` (to be written).

### 4.9 Audit Bus ↔ All

```
AuditBus.emit(event: AuditEvent)                  # any component can publish
AuditBus.subscribe(filter)  → AsyncIterable<AuditEvent>   # any component can read
AuditBus.query(filter, range)  → AuditEvent[]    # historical
```

Events are append-only. The audit bus is the substrate for live UI updates, retry logic, and the audit log all at once.

## 5. Canonical Data Flows

Four flows cover essentially all of Holon's runtime behavior. Each one is the "happy path"; failure handling is layered on per `reliability-and-testing.md`.

### 5.1 Pure Local (Core 1 only)

Owner creates an assignment for a local AI staff member. Router routes to runtime adapter. Adapter runs the job, streams events to the UI, returns a deliverable. Deliverable lands attached to the assignment.

```
Owner
  ↓ creates assignment (target: local AI staff)
Router
  ↓ runtime job
Runtime Adapter (CLI: claude / codex / gemini / qwen)
  ↓ event stream + deliverable draft
Deliverable Store ← attribution & parent assignment ←
Owner sees deliverable on Today view.
```

No Core 2 involvement.

### 5.2 Outbound To Peer (Core 1 → Core 2 → remote desk)

Owner creates an assignment whose target is a peer identity. Router escapes to Core 2's handoff layer. Handoff layer constructs a packet (with form chosen by owner UI) and asks the connection layer to send. Connection layer dispatches over the wire. Remote desk's connection layer receives, validates, and lands it in *their* mission inbox.

```
Owner (sender desk)
  ↓ creates assignment (target: peer identity "Wang")
Router
  ↓ "this is a peer identity — escape to Core 2"
Handoff Layer
  ↓ builds packet (form, axes, context pack, authority scope)
Connection Layer
  ↓ sends to "Wang's desk" over wire
[wire boundary]
Remote Connection Layer (Wang's desk)
  ↓ validates token, signature, form consistency
Remote Handoff Layer
  ↓ creates inbound mission record
Remote Mission Inbox
  ↓ surfaces to Wang's owner
```

Sender desk's view: assignment status = `waiting_remote`. Awaiting deliverable callback (flow 5.4 below for the return).

### 5.3 Inbound Mission (Core 2 → Core 1)

Already shown as the receiving half of 5.2. The remote owner accepts the mission and may route it to their own local AI staff — at that point the mission becomes a local assignment (flow 5.1 inside that desk).

The seminal rule: **an inbound mission never bypasses the owner's queue**. There is no protocol path that lets a remote desk directly create a local assignment on this desk without owner mediation. (Exception: when the handoff is `direct_order` form AND the connection's policy designates the sender as having organizational authority — e.g., enterprise admin → managed desk. Even then, the action is logged to the audit bus.)

### 5.4 Deliverable Return / Callback

Remote owner submits a deliverable. Remote handoff layer constructs a completion-callback packet. Remote connection layer sends it to sender's connection layer. Sender's handoff layer matches it to the original outbound assignment (via `peer_origin_id` / handoff id). Sender's deliverable store records it. Sender's assignment status moves to `completed`. Sender's owner sees the returned deliverable attached to the original assignment.

```
Remote owner
  ↓ submits deliverable for the inbound mission
Remote Handoff Layer
  ↓ constructs completion callback
Remote Connection Layer
  ↓ wire send
[wire]
Sender Connection Layer
  ↓ validates signature + idempotency
Sender Handoff Layer
  ↓ matches to outbound handoff record
Deliverable Store ← write + attribute + attach to parent assignment ←
Sender Owner sees "deliverable returned for assignment X."
```

### 5.5 Multi-Hop (Cascade)

When a mission accepted on one desk produces an outbound handoff to another desk, this is just flow 5.2 nested inside flow 5.3. Each hop is independently accountable: each desk owns its own inbound and its own outbound, with its own audit trail. The flat-roster invariant means cascades happen across DESK boundaries, never within a desk's local staff.

The protocol surfaces multi-hop visibility through:

- the disclosed `subDelegation` declaration in the outer handoff
- the `parentHandoffId` field linking child handoffs to their parent
- audit events that let the sender of the outermost handoff query "where is my work right now?" all the way down the chain (within the limits of what each intermediate desk's policy reveals)

### 5.6 Memory Flows (System 0 / 1 / 2)

A fifth class of canonical flow, orthogonal to 5.1–5.5: memory movement
between the three layers (System 0 = session, System 1 = per-project, System
2 = owner). The README's "Memory update flow" diagram is the canonical
one-screen view; the spec lives in `memory-update-flow.md`. Three flows:

1. **Read-on-demand (lateral / downward read).** Secretaries and the owner-CLI
   pull from boss-memory by triggering a Claude Code **Skill**
   (`holon-memory-recall` on secretaries, `holon-owner-recall` on the
   owner-CLI). The Skill reads `INDEX.md` first, opens 2–3 detail files, caps
   at ~8k chars. No RAG, no vector DB. See ADR
   `../adr/memory-as-skill.md`.
2. **Write-up (harvest-on-retire).** When an employee retires, its owning
   secretary distills the per-CLI memory file into project boss-memory and
   discards the original. When a project retires, the owner distills project
   memory into owner-global. Implementation:
   `packages/core/src/boss-memory-harvest-service.ts`. Knowledge bubbles up,
   dross goes away.
3. **Write-down (HR correction).** HR (owner-HR or secretary-HR) emits either
   a Path-A persistent rule into the target's `## HR-Corrections` managed
   section (`packages/core/src/hr-path-a.ts`) or a Path-B non-preemptive
   synthetic message via the settle-watch + synthetic-producers pipeline
   (`apps/web/lib/settle-watch.ts` + `apps/web/lib/synthetic-producers.ts`).
   Repeated B-fires auto-promote to A with owner accept/edit/revert. See
   ADR `../adr/hr-evaluator-and-behavior-correction.md` and
   `hr-evaluator.md`.

These flows do not cross Core 1 / Core 2 — memory is a Core 1 concern. Cross-
desk handoffs carry their own context-pack (per `context-pack.md`) and do
not read another desk's boss-memory.

## 6. State Machines

These have not changed from prior versions. Reproduced here for completeness.

### Assignment

```
draft → queued → running_local | waiting_remote | retrying | blocked → completed | cancelled | failed
```

### Mission

```
queued → accepted → in_progress → submitted → returned_to_origin
queued → rejected
in_progress → blocked
queued → expired
```

### Connection

```
unconfigured → healthy → degraded | offline | retrying → revoked | invalid_token
```

### Handoff

Detailed in `handoff-design.md` § Handoff States. Briefly: `draft → proposed → sent → received → accepted → in_progress → submitted → returned → done` plus error branches and the dual-authorization `pending_cosign` substate (per `handoff-taxonomy.md`).

## 7. Invariants

Architectural rules the system must enforce. Violation is a defect, not a configuration choice.

### 7.1 Flat-roster invariant

No staff record may itself own staff records. The local team is one level deep, period. Implementation: foreign-key constraint plus runtime validation in the staff registry. Scaling demand for "more agents" must be met by adding sibling staff, by involving real humans, or by handoff to another desk's staff. Detailed reasoning: `local-agent-management.md`.

### 7.2 Owner-mediated authority

No external action originates work directly on local staff. Inbound work always lands in the mission inbox; the local owner (human or designated AI controller) decides what to route. Exception (logged): hierarchical Direct Order from a connection with declared org authority. Even then, the action and the auto-acceptance are audit-emitted.

### 7.3 No silent failure

Every error path in either core must surface in the audit bus and in the owner's UI. The runtime adapter contract enforces this for Core 1 (typed `ErrorEvent`); the handoff layer enforces it for Core 2 (typed handoff error states). The reliability layer's job is to ensure every transient failure becomes either a recovery or a visible blocked state — never silence.

### 7.4 Authority attenuation

A handoff packet cannot grant authority the sender does not itself hold. The handoff layer validates this on construction; the connection layer's idempotency cache cannot be used to "smuggle" authority through replay. (This is the object-capability principle and prevents the confused-deputy class of bug.)

### 7.5 Audit completeness

The audit log is a comprehensive diagnostic record: every significant state change in either core emits an audit event. The log is append-only and queryable. In V1, state tables are the canonical source of truth; the audit log is not currently used for state reconstruction. A subsequent observer can inspect the audit log to understand what happened, but cannot necessarily replay it to rebuild state from scratch. V3 enterprise may upgrade to full event-sourcing (outbox pattern or WAL replication) when compliance requirements demand it. See ADR-007.

### 7.8 Task-only model (V1 invariant)

V1 has exactly two work object types: missions (inbound from another desk) and assignments (local work). There is no conversation, session, or thread primitive in V1. The UI surfaces both object types as "tasks" with a provenance chip (per ADR-003) but the underlying data model is unchanged. V2 evaluates adding a conversation primitive based on V1 user research. See ADR-009.

### 7.6 No agent self-modification of authority

A runtime adapter — including any CLI adapter — cannot change the authority scope or handoff form mid-job. The form was set when the handoff was constructed; the runtime is bound by it. Tools the runtime calls run within the form's authority; if a tool would exceed it, the adapter returns `PERMISSION_DENIED` per `runtime-adapter-interface.md` § Error Model.

### 7.7 Handoff form is enforced, not advisory

Receiver desk validates form + axes consistency on receipt. Forms the receiver does not support yield `form_unsupported` errors and refusal — never silent downgrade.

## 8. Doc Map

Where the details live for each topic introduced here.

| Topic | Doc |
|---|---|
| Local agent management deep dive (flat roster, autonomy slider, role-based dispatch, owner cultivation, mibusy carry-forward) | `local-agent-management.md` *(to be written — next-after-comms)* |
| Runtime adapter contract, RuntimeEvent types, lifecycle, latency budget, CLI-adapter mapping | `runtime-adapter-interface.md` ✅ |
| System 0/1/2 memory hierarchy + the three memory flows (read / harvest / HR correct) | `memory-update-flow.md` ✅ (+ README "Memory update flow") |
| HR evaluator + Path A / Path B correction (wire-up) | `hr-evaluator.md` ✅ (+ ADR `../adr/hr-evaluator-and-behavior-correction.md`) |
| Memory recall lifted to Claude Code Skills | ADR `../adr/memory-as-skill.md` |
| Handoff lifecycle, packet format, context pack, authority scope | `handoff-design.md` ✅ |
| Handoff form taxonomy, axes, composition, revocation rules per form, UI consent flows | `handoff-taxonomy.md` ✅ |
| Wire format, transport, identity, idempotency, retries, multi-device routing | `peer-communication-architecture.md` *(next)* |
| Deliverable schema, file model, citations, retention | `deliverable-spec.md` *(later)* |
| UI screens, components, copy rules, route badges | `ui-architecture.md` ✅ |
| Implementation: tech stack, deployment topologies, layer breakdown, milestones | `implementation-architecture.md` ✅ *(may need refresh after this rewrite)* |
| Reliability, error taxonomy, retry policy, observability, test strategy | `reliability-and-testing.md` *(later)* |
| Database schema (entities, fields, indexes, FKs, idempotency keys) | `data-model.md` *(later)* |
| Auth, identity, token rotation, multi-device | `auth-and-identity.md` *(later)* |
| MVP scope and milestones | `product/mvp-scope.md` ✅ |
| Product definition (vision, screens, success metrics) | `product/holon-product-definition.md` ✅ |

✅ = exists today. *(to be written)* = on the roadmap; this doc is consistent with what they will say.

## Acceptance Criteria For This Doc

This rewrite is "good enough to navigate by" when:

1. ✅ Every component named in §3 has either a full sub-doc or a placeholder in the doc map
2. ✅ Every interface in §4 is summarized in shape; full schemas are in the sub-docs (linked)
3. ✅ The two cores are introduced clearly, the seam is enumerated (4 crossings), and the components are unambiguously assigned to one or the other (or marked cross-cutting)
4. ✅ All seven invariants are stated as enforceable rules, not aspirations
5. ✅ A new engineer can read this doc and know where to read next for any concrete question
6. ⬜ A real-world product story (e.g., "Alice asks Wang to research X, Wang's AI does it, Wang reviews, sends back") can be traced through §5 with no gap (verify in next pass)

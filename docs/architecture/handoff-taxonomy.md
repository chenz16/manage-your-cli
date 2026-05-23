# Handoff Taxonomy and Authorization Forms

Status: draft v0.1
Date: 2026-05-15
Owner: design
Sibling docs: `handoff-design.md` (lifecycle, packet, context pack, authority scope), `peer-communication-architecture.md` (wire/transport — to be written next), `runtime-adapter-interface.md` (local execution).

## Position In The Product

Holon has two product cores. This document is about Core 2.

**Core 1 — Local agent management.** A desk is itself a meta-agent that owns a roster of local agents (AI staff, CLI executors, peer identities) and routes local work to them. Owner manual work routes to Today's personal queue (per ADR-015: the `myself` substrate was removed). The thing controlling the desk may be a human owner, an AI assistant, or both. Holon does not care which — the desk exposes the same surface either way. Core 1 is mechanically simple; the design problems are UX and the runtime adapter contract (handled in `runtime-adapter-interface.md`).

**Core 2 — Interconnect, handoff, hybrid employment relationships.** When a desk hands work to another desk, the relationship between them is not merely "request → response." It is a formalized **work arrangement** with authority, scope, duration, reporting, revocation, and accountability semantics. This is the load-bearing concept of Holon. Get this wrong and the connected workforce idea collapses to "two chatbots talking." Get it right and Holon expresses the actual richness of how humans organize work — and lets AI agents participate in that richness as first-class workers.

A handoff is the smallest unit of cross-desk hybrid employment. Every Holon mission, deliverable, and proxy assignment is built on top of one or more handoffs. This document enumerates the forms a handoff can take, defines the architecture for representing them, and specifies the interface for declaring, observing, and revoking them.

## Why "Hybrid Employment", Not "API Call"

The instinct from a software-engineering background is to model handoff as RPC or message-passing. That instinct is wrong here. Three reasons:

1. **Agents on both sides may be human, AI, or hybrid.** A protocol designed only for machines collapses on the human side; one designed only for humans is too unstructured for machines. Employment relationships are the existing, time-tested vocabulary for "work performed by one entity on behalf of another, regardless of substrate."

2. **Holon's value proposition is accountability across the boundary.** Every handoff has a real human owner on each side. A pure API model loses this — APIs are anonymous. Employment models foreground "who is responsible if this goes wrong."

3. **Authority is rich and conditional in real work.** A real boss can revoke instructions; a real contractor cannot revoke after acceptance. A real employee must report; a real proxy lawyer must not disclose. These are not bonus features — they are the SHAPE of work. Modeling them properly is necessary, not aspirational.

So: Holon's handoffs are typed as **work arrangements**. The taxonomy below is what types those work arrangements can take.

## Prior Art Surveyed

Several mature domains have grappled with "one party performing work on behalf of another with constrained authority." Holon synthesizes from all of them rather than inventing fresh. Brief summary of what each contributes:

| Domain | Concepts borrowed |
|---|---|
| **Agency law / Power of Attorney** | General vs Limited POA; Durable vs Springing; Co-agents (dual key); Revocability vs Irrevocability; Successor agents |
| **Corporate governance / RACI** | Responsible (does work), Accountable (owns outcome), Consulted (input before decision), Informed (notified after). Many handoffs are best understood as moving between RACI roles |
| **Military mission command** | DIRCOM / OPCON / TACON command-authority levels; mission-type orders (give intent, not method) vs centralized control (give exact method) |
| **Principal-agent theory (economics)** | Information asymmetry; monitoring intensity; performance-based vs effort-based contracts; moral hazard; the cost of delegation |
| **Object-capability security / OAuth** | Capability tickets; *attenuation* (delegated authority can only narrow, never widen); revocation by chain; the confused-deputy problem |
| **Distributed systems / sagas** | Compensation actions (undo paths); long-running transactions; idempotency under retry; choreography vs orchestration |
| **Multi-agent AI frameworks (2024–2026)** | Supervisor/worker (LangGraph), group chat (AutoGen), hierarchical task decomposition (CrewAI), planner/executor split |

Dominant insight across all of these: **authority is multi-dimensional.** The common "forms" people recognize (boss-subordinate, contractor, proxy, observer) are recurring combinations of a smaller axis set. So we define the axes first, then name the combinations.

## The Six Axes That Define a Handoff Form

A handoff form is a position in this 6-dimensional space. Two handoffs at the same position behave identically; two at different positions need different UI, different protocol fields, and different audit policies.

### Axis 1 — Authority Distribution

Who has the right to make decisions about the work?

- **Sender-retained** — sender keeps decision authority; receiver executes mechanically. *("Do this exactly.")*
- **Receiver-delegated** — full authority transfers to receiver. *("Handle it. You decide.")*
- **Mutual / dual-key** — neither side can act without the other's confirmation. *("Both must sign.")*
- **Receiver-with-veto** — receiver acts unless sender objects within a window. *("Going ahead unless you stop me.")*
- **Conditional** — authority shifts based on a runtime predicate. *("You decide for routine; escalate for exceptions.")*

### Axis 2 — Receiver Role

What is the receiver actually expected to DO?

- **Executor** — performs the work
- **Proxy** — performs work but as agent for some third party (with fiduciary duty to that third party, not to the sender)
- **Reporter / Observer** — only watches and reports; no action authority
- **Approver / Gatekeeper** — does not perform work themselves; approves or rejects work performed elsewhere
- **Advisor / Consultant** — produces recommendations; sender retains final decision
- **Sub-delegator** — re-distributes the work to others; coordinates an aggregate result

A handoff selects exactly one role. The receiver may not unilaterally re-cast itself — an Advisor handoff cannot quietly become an Executor handoff.

### Axis 3 — Authority Duration

When is the authority valid?

- **Single-use** — one task, then expires
- **Bounded** — valid until a count, time, token, or cost cap is hit
- **Open / perpetual** — valid until explicitly revoked
- **Conditional / springing** — activates on a trigger predicate, deactivates on counter-predicate
- **Standby / on-call** — perpetual authority but only invoked on request

### Axis 4 — Reporting Requirement

What must the receiver surface back to the sender?

- **Silent / outcome-only** — sender sees only the terminal deliverable
- **Summary / milestone** — key state changes (started, blocked, finished)
- **Verbose / itemized** — every action and tool call surfaced
- **Real-time / streaming** — live event stream; sender's UI can spectate
- **On-deviation** — silent unless something unexpected happens

This axis is orthogonal to authority. A Receiver-delegated handoff can still require Verbose reporting — receiver decides freely but must show the work.

### Axis 5 — Revocation Rules

How and by whom can the handoff be ended before completion?

- **Sender-instant** — sender unilaterally revokes with no notice
- **Sender-with-grace** — sender revokes; receiver gets a defined wind-down period
- **Mutual-only** — both must agree to terminate (used for binding commitments)
- **Auto-expires** — terminates by Axis-3 duration; no manual revocation needed
- **Irrevocable until completion** — neither party can stop; only outcome ends it (rare; for bridges-burned commitments)

### Axis 6 — Sub-Delegation Permission

Can the receiver re-handoff to others?

- **Forbidden** — receiver must execute personally
- **Allowed silent** — receiver may sub-delegate without notice (avoid; violates "no silent failure")
- **Allowed with disclosure** — receiver may sub-delegate but must declare each sub-handoff
- **Allowed with pre-approval** — receiver must request sender's approval before each sub-handoff
- **Allowed within budget** — receiver may sub-delegate freely up to N children, then requires approval

Interaction with Axis 1 matters: Sender-retained + Sub-delegation Forbidden = tight chain of command. Receiver-delegated + Sub-delegation Allowed Silent = "outsource entirely; I don't care how."

### Axis 7 — Payload Mode

How does work content (instructions, attachments, deliverables) actually move between desks?

- **By-value** — full payload travels inside the handoff packet itself. Self-contained; receiver can act offline once received. Suitable for small/medium content (≤ 1 MB).
- **By-reference** — the packet carries a pointer (signed URL, peer file handle, content hash); receiver fetches when needed. Suitable for large files, lazy-loaded context, or content the sender wants to revoke later.
- **Shared-state** — both desks subscribe to a live shared store (CRDT-backed document, event stream, or live folder). Changes from either side propagate near-realtime. Suitable for ongoing collaboration, observer briefs, and any case where "the deliverable" is actually a living artifact.
- **Sandbox-mediated** — both desks share access to a neutral third-party isolated environment (ephemeral container, signed workspace, isolated VM). Neither side exposes its own broader system; all data, files, and tool execution happen inside the sandbox. Suitable when (a) receiver needs to run code or use tools on data the sender provides but the sender will not give direct access to its own machine, (b) sensitive material must not leave a controlled boundary, or (c) the work product is itself a runnable artifact (a configured environment, a deployed service, a notebook with executed cells). The sandbox identity, lifecycle, and provisioning live below the protocol — see `peer-communication-architecture.md` § Payload Modes.

Interaction with Axis 5 (revocation): by-reference makes Sender-instant revocation truly effective (revoke the URL → receiver can no longer fetch). By-value cannot be retracted once delivered. Shared-state revocation = remove receiver's access to the store. Sandbox-mediated revocation = tear down the sandbox or evict the receiver; cleanest of the four because the sandbox is ephemeral by construction.

Wire-level mechanics (chunking, signed-URL exchange, CRDT transport) live in `peer-communication-architecture.md` § Payload Modes.

### Axis 8 — Timeliness

When must the work actually happen? (Distinct from Axis 3 Duration, which says how long the *authority* is valid; Axis 8 says when *execution* must occur.)

- **Synchronous** — both parties must be online together; receiver acts immediately on receipt; sender expects near-realtime turnaround. Latency-sensitive. (E.g., live consult during an incident.)
- **Windowed** — receiver must complete within a defined time window from acceptance (e.g., "within 4 hours"). Receiver can defer briefly but cannot park indefinitely.
- **Long-running** — open-ended; receiver works at their own pace; sender does not assume specific completion timing. (Default for Direct Takeover, Subcontracting, etc.)
- **Scheduled-segment** — work is only active during specific time windows (e.g., business hours; on-call rotation; during an event). Outside the segment, the receiver does not act and the sender does not expect action.
- **Triggered** — work happens only when an external predicate fires; otherwise silent. Pairs with Axis 3 conditional/standby.

Interactions:
- **Synchronous + by-value + Sender-retained** = "do this exact thing right now"; lowest tolerance for lag.
- **Long-running + by-reference + Receiver-delegated** = "here's the work; pull what you need; finish whenever"; highest tolerance for lag, lowest synchronization burden.
- **Scheduled-segment** requires the receiver desk to publish its availability windows in its Agent Card so senders see the schedule before composing.

Wire-level scheduling mechanics in `peer-communication-architecture.md` § Timeliness Handling.

## Autonomy Required Per Form

(Per ADR-004. Cross-referenced as "§ 8.5" by `local-agent-management.md`
§ 8.5 since both tables describe the same constraint from different sides.
This is the canonical version; the local-agent-management.md table is a
mirror.)

The autonomy slider levels (Supervised / Bounded / Autonomous, per
`local-agent-management.md` § 8) gate which handoff forms a receiver-staff
can be assigned to fulfill. A staff with insufficient autonomy cannot be
the executor on a form that demands more autonomy than they have.

| Handoff form | Minimum receiver-staff autonomy required |
|---|---|
| Direct Order | Autonomous |
| Direct Takeover | Autonomous |
| Subcontracting | Autonomous |
| Approval Chain (executor stage) | Bounded |
| Approval Chain (approver stage) | Supervised |
| Advisory | Supervised |
| Observer Brief | Supervised |
| Dual Authorization | (form-bound, not autonomy-bound) |
| Proxy Engagement | N/A (fiduciary relationship; receiver is not a Core 1 substrate) |
| Temporary Cover | Bounded (acts within defined window/scope) |
| Conditional Engagement (Retainer) | Bounded (acts when predicate fires, within scope) |
| Parallel Solicitation (Swarm) | Bounded (each receiver bounded by its declared limits) |
| Negotiated Handoff | Supervised (sender-receiver back-and-forth before binding) |
| Watch Brief | Supervised (notification only; no execution authority) |
| Escalation Ladder | (composition modifier; per-stage) |

Source of truth for the handoff composer's "is this staff allowed to
fulfill this form?" check. If the owner tries to assign a form to a staff
whose standing autonomy is below the minimum, the desk warns and offers
to (a) raise autonomy, (b) pick a different staff, or (c) take the
assignment to the owner's queue instead.

## Sender Authority vs. Receiver Authority

A subtle point that comes up repeatedly: the six axes describe what authority **the receiver receives from the sender**, not what either party intrinsically possesses. The sender cannot give what they do not themselves hold (object-capability principle of attenuation: delegated authority can only narrow). If sender desk lacks permission to publish externally, it cannot construct a Direct Order to a receiver desk to publish externally — Holon's protocol layer enforces this.

Conversely, the receiver may always **reject** any form. Authority described in the handoff is *offered*; acceptance creates the binding. The exception is Direct Order from a desk that has hierarchical authority over the receiver (e.g., enterprise admin → managed desk), where the receiver's acceptance is implicit. Even there, the receiver can mark refusal with reason, which becomes part of the audit record.

## The Common Forms

Out of the 6-axis space, dozens of theoretical combinations exist. About a dozen recur in human practice and across the prior-art domains. These are the named forms Holon ships first.

### 1. Direct Order (Dictator)

Sender unilaterally instructs; receiver executes mechanically; sender can revoke instantly; sub-delegation forbidden by default.

> **Real-world analogs:** military order; CEO directive; system-policy push.
> **Holon use:** desk owner pushes a high-priority task to their own AI staff; an enterprise admin desk pushes a policy update to subordinate desks.

### 2. Direct Takeover

Receiver fully assumes the work; sender steps back; receiver decides everything; sub-delegation allowed (with disclosure by default).

> **Real-world analogs:** full transfer to a contractor; "you own this now."
> **Holon use:** handing a project to a colleague's desk to run end-to-end.

### 3. Proxy Engagement

Receiver acts as agent for a third party (not for the sender). Receiver has fiduciary duty to the third party. Receiver's reporting back to the sender is summarized; the third party (not the sender) gets verbose reporting.

> **Real-world analogs:** hiring a lawyer; engaging a broker; assigning power of attorney.
> **Holon use:** a desk routes work through a "Wang" peer identity who is actually backed by Wang's real desk; the work is owed to Wang, with the sender just being kept informed. (Per ADR-003 the Core 1 substrate is `peer`; the *handoff form* "Proxy Engagement" retains its name because it captures distinct fiduciary semantics.)

### 4. Dual Authorization (Co-Sign)

Both sender and a designated co-approver must agree before the receiver can begin. Either can withdraw before execution; once both have signed and execution starts, revocation requires both again.

> **Real-world analogs:** two-person nuclear control; joint signing on a corporate document; dual-control banking transfers.
> **Holon use:** high-stakes deliverables (publishing externally, paying invoices, sending external communications) require co-sign from a second human.

### 5. Approval Chain

Sequential. A drafts → B approves → C executes. Each stage hands off to the next on completion. Earlier stages can revoke if the next stage hasn't begun yet.

> **Real-world analogs:** contract approval workflows; expense approval chains; Git pull-request flow.
> **Holon use:** a draft deliverable from AI staff → reviewed by the owner → approved before sent externally.

### 6. Reporter / Observer Brief

Receiver gets visibility into the sender's ongoing work for accountability or audit. Receiver has zero action authority; verbose or real-time reporting is mandatory; sub-delegation forbidden; sender can revoke instantly.

> **Real-world analogs:** an auditor; a manager CC'd on the work; a compliance watcher.
> **Holon use:** a manager's desk subscribes to a junior's missions for oversight without controlling them.

### 7. Advisory / Consult

Receiver produces opinions, drafts, or recommendations; sender retains final decision. Receiver has no execution authority over the actual external action.

> **Real-world analogs:** a consultant; a research aide; a clerk drafting a judicial opinion.
> **Holon use:** a desk asks another desk's expert AI staff "what would you do?", then chooses whether to act on the answer.

**Note (per ADR-016):** In V1.x, when a `local_ai` member formally invokes a mentor peer (escalating a sub-task for guidance), the resulting handoff uses the `advisory_consult` form as the closest existing fit — the mentor produces recommendations, and the AI member (or owner) retains the final decision on how to proceed. V1 skips the formal handoff entirely (consultation is cultivation-log only); V2 onward adopts formal handoff as the standard for mentor invocation.

### 8. Temporary Cover

Receiver gets full authority for a defined time window. At expiry, authority returns to sender automatically. During the window the receiver behaves like Direct Takeover.

> **Real-world analogs:** vacation cover; acting capacity during incapacity; springing power of attorney.
> **Holon use:** "while I'm offline, my partner desk can accept missions on my behalf."

### 9. Conditional Engagement (Retainer)

Receiver holds dormant authority that activates only on a defined trigger. Until the trigger, no work happens; the handoff exists as a pre-agreement.

> **Real-world analogs:** a lawyer on retainer; an on-call engineer; insurance.
> **Holon use:** a "fix-it" desk is engaged conditionally — activated only when a specific error class appears in the sender's audit stream.

### 10. Subcontracting

Receiver does not personally execute; receiver coordinates a team of sub-receivers. Sender sees an aggregate deliverable; sub-handoffs are disclosed up-front (count and capability) but not individually approved.

> **Real-world analogs:** general contractor → trades; outsourcing firm.
> **Holon use:** a research desk takes a project, splits it across siblings on its own flat roster, or — more often — sends Core-2 handoffs to 2 partner desks, then returns one consolidated report.

**Important interaction with Core 1's flat-roster invariant.** Subcontracting does NOT mean the receiver desk builds a sub-tree of agents inside itself. Per `local-agent-management.md` § 2, every desk's staff is one level deep — period. When a Subcontracting-form handoff lands on a desk and the receiver wants to "subcontract," the legal moves are: (a) parallelize across the desk's own flat siblings, (b) issue further Core-2 handoffs to *other desks* whose staff handle the work, or (c) involve real human helpers. There is no path that creates a hidden internal hierarchy of agents inside the receiving desk. The "sub-delegator" role names a coordination *function*, not a managerial *layer*.

### 11. Parallel Solicitation (Swarm)

Sender dispatches the same work to multiple receivers simultaneously. Resolution policy is declared up-front: first-to-deliver, best-of-N, or aggregate.

> **Real-world analogs:** requesting bids from multiple vendors; broadcasting a question.
> **Holon use:** an owner sends "review this draft" to three trusted desks; first response wins, others are auto-cancelled.

### 12. Negotiated Handoff (Counter-Offer)

The initial dispatch is a *proposal*. Receiver may accept, reject, or counter (modify scope/budget/deadline and bounce back). Iterates until both agree or one party closes.

> **Real-world analogs:** contract negotiation; sales discovery; freelance scope-of-work.
> **Holon use:** a freelance-style relationship between two desks who haven't worked together before; first dispatch is "could you do this for $X by Y?"

### 13. Watch Brief (Notification Only)

The lightest form. Sender notifies receiver of an event/status; receiver has no obligation to act, react, or even acknowledge. Used for informational fan-out.

> **Real-world analogs:** a CC; a status email; a system notification.
> **Holon use:** a desk publishes "I just shipped X" to subscribers.

### 14. Escalation Ladder (Composition Modifier)

Not a standalone form — a fallback handoff attached to a primary handoff, with a trigger condition. If the primary blocks, errors, or times out, authority cascades to the fallback receiver per the declared rules.

> **Real-world analogs:** on-call escalation; failover lawyer.
> **Holon use:** every important outbound mission can carry an Escalation Ladder so silent failure is structurally impossible.

## Form ↔ Axis Matrix

Each row reads: *this form is defined by these axis-value choices*. Rows are commitments — the sender promises this shape; the receiver enforces it.

| # | Form | Authority | Receiver Role | Duration | Reporting | Revocation | Sub-Delegation | Payload | Timeliness |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Direct Order | Sender-retained | Executor | Single-use / Bounded | Verbose | Sender-instant | Forbidden | By-value | Synchronous / Windowed |
| 2 | Direct Takeover | Receiver-delegated | Executor | Open | Summary | Sender-with-grace | Allowed-disclosed | By-value or By-reference | Long-running |
| 3 | Proxy Engagement | Receiver-delegated | Proxy | Open | Summary (Verbose to 3rd party) | Sender-with-grace | Allowed-disclosed | By-value | Long-running |
| 4 | Dual Authorization | Mutual | Executor | Single-use | Verbose | Mutual-only after start | Forbidden | By-value | Windowed |
| 5 | Approval Chain | Conditional (per stage) | Approver, then Executor | Single-use | Milestone | Sender-instant before downstream stage | Allowed-disclosed | By-value (per stage) | Windowed (per stage) |
| 6 | Observer Brief | Receiver-delegated (zero action) | Reporter | Open | Real-time / Verbose | Sender-instant | Forbidden | Shared-state | Synchronous |
| 7 | Advisory / Consult | Sender-retained | Advisor | Single-use / Bounded | Outcome-only | Sender-instant | Forbidden | By-value | Windowed |
| 8 | Temporary Cover | Receiver-delegated | Executor | Time-bounded | Summary | Auto-expires | Allowed-disclosed | By-value | Scheduled-segment |
| 9 | Conditional Engagement | Conditional | Executor (when triggered) | Conditional / Open | Per-trigger Verbose | Sender-instant | Allowed-disclosed | By-reference | Triggered |
| 10 | Subcontracting | Receiver-delegated | Sub-delegator | Single-use | Outcome-only with disclosed sub-count | Sender-with-grace | Allowed-within-budget | By-value or Sandbox-mediated | Long-running |
| 11 | Parallel Solicitation | Sender-retained | Executor (one of N) | Single-use | Outcome-only | Auto-cancels losers | Forbidden | By-value | Windowed |
| 12 | Negotiated Handoff | Mutual (proposal phase) | Executor (after agreement) | Per-agreement | Per-agreement | Per-agreement | Per-agreement | Per-agreement | Per-agreement |
| 13 | Watch Brief | Sender-retained | Reporter | Single-use | None back | N/A (one-shot) | Forbidden | By-value | Synchronous (fire-and-forget) |
| 14 | Escalation Ladder | (modifier on another form) | (inherits from primary) | (inherits) | (inherits) | (inherits) | (inherits) | (inherits) | (inherits) |

**Sandbox-mediated payload note**: Subcontracting commonly benefits from a shared sandbox when the sub-delegator coordinates work that needs to be runnable / reproducible end-to-end (e.g., "build and test these 3 candidate solutions and pick the best") — the sandbox holds the build environment and intermediate artifacts. Pure document-style subcontracting stays By-value.

## Architecture: Where Each Form Lives

The handoff form is set when the sender constructs the handoff packet. It travels with the packet through the wire layer and is honored by both desks' product layers.

### Sender side

The sender's UI must:

- present the form choice up front when constructing a handoff (with sane defaults per relationship type)
- show implications in plain language ("Receiver can re-delegate without asking you")
- store the form on the local handoff record (DB) and persist axes for full reconstruction
- enforce sender-side rules (revocation behavior, sub-delegation budget, expiry timer)

### Wire / protocol

The handoff packet carries the fields below in addition to those defined in `handoff-design.md` § Handoff Packet:

```
form:                HandoffForm
axes:                HandoffAxes
expiresAt:           ISO8601 | null
triggerPredicate:    TriggerSpec | null   # conditional/standby
revocationRules:     RevocationSpec
subDelegationPolicy: SubDelegationSpec
escalationLadder:    EscalationSpec | null
dualSignatures:      SignatureSet | null  # required for dual_authorization
proxyOf:             PrincipalRef | null  # required for proxy_engagement
parentHandoffId:     HandoffId | null     # for sub-handoffs in chains/subcontracting
```

The receiver desk validates the packet on receipt:

- if `form` is unsupported by the receiver desk (e.g., legacy version), returns `error: form_unsupported`. Does NOT silently downgrade.
- if `axes` are inconsistent (e.g., dual_authorization but no `dualSignatures`), returns `error: form_invalid`.
- if the receiver is configured to refuse the form (e.g., this desk does not accept Subcontracting work from outside the org), returns `error: form_declined`.
- otherwise creates an inbound mission and surfaces the form prominently in the inbox UI.

### Audit

Every handoff event logs the form. Audit queries can filter by form ("show all Dual Authorization handoffs in the last quarter"). Reporter / Observer / Watch Brief handoffs carry heightened audit weight — they exist *for* accountability, so their own audit trail must be impeccable.

### Storage

The handoff record persists every axis value, the form name, and a hash over the canonical axis serialization. The hash lets later audit verify the handoff has not been mutated since acceptance — important for forms with binding semantics (Dual Authorization, Irrevocable).

## Interface (Schemas)

```typescript
// Defined in @holon/handoff-types — shared between desk app and wire layer.

export type HandoffForm =
  | "direct_order"
  | "direct_takeover"
  | "proxy_engagement"
  | "dual_authorization"
  | "approval_chain"
  | "observer_brief"
  | "advisory_consult"
  | "temporary_cover"
  | "conditional_engagement"
  | "subcontracting"
  | "parallel_solicitation"
  | "negotiated_handoff"
  | "watch_brief";
  // "escalation_ladder" is a composition modifier, not a top-level form.

export interface HandoffAxes {
  authority:
    | "sender_retained"
    | "receiver_delegated"
    | "mutual"
    | "receiver_with_veto"
    | "conditional";

  receiverRole:
    | "executor"
    | "proxy"
    | "reporter"
    | "approver"
    | "advisor"
    | "sub_delegator";

  duration:
    | { kind: "single_use" }
    | { kind: "bounded"; cap: BoundedCap }
    | { kind: "open" }
    | { kind: "conditional"; predicate: TriggerSpec }
    | { kind: "standby" };

  reporting:
    | "silent"
    | "summary"
    | "verbose"
    | "real_time"
    | "on_deviation";

  revocation:
    | { kind: "sender_instant" }
    | { kind: "sender_with_grace"; graceMs: number }
    | { kind: "mutual_only" }
    | { kind: "auto_expires" }
    | { kind: "irrevocable_until_completion" };

  subDelegation:
    | { kind: "forbidden" }
    | { kind: "allowed_silent" }
    | { kind: "allowed_with_disclosure" }
    | { kind: "allowed_with_pre_approval" }
    | { kind: "allowed_within_budget"; maxChildren: number };

  payloadMode:
    | { kind: "by_value" }
    | { kind: "by_reference"; refScheme: "signed_url" | "peer_handle" | "content_hash" }
    | { kind: "shared_state"; storeKind: "crdt_doc" | "event_stream" | "live_folder"; storeRef: string }
    | { kind: "sandbox_mediated"; sandboxKind: "container" | "vm" | "workspace"; provisioning: SandboxProvisioningSpec };

  timeliness:
    | { kind: "synchronous"; expectedRespondMs: number }
    | { kind: "windowed"; deadlineAt: string }
    | { kind: "long_running" }
    | { kind: "scheduled_segment"; segments: ScheduleSegment[] }
    | { kind: "triggered"; trigger: TriggerSpec };
}

export interface SandboxProvisioningSpec {
  /** Who provisions the sandbox: sender, receiver, or relay-managed pool. */
  provisionedBy: "sender" | "receiver" | "relay";
  /** Capability descriptor for what the sandbox must support (CPU, memory, tools, network). */
  capabilities: SandboxCapabilities;
  /** Lifetime; sandbox is torn down at this point regardless of work state. */
  ttlMs: number;
  /** Network policy: sealed (no internet), allowlist, or open. */
  network: "sealed" | { kind: "allowlist"; hosts: string[] } | "open";
}

export interface ScheduleSegment {
  /** Days of week the segment is active (0 = Sunday). */
  daysOfWeek: number[];
  /** Start time in HH:MM in the timezone. */
  startTime: string;
  /** End time in HH:MM. */
  endTime: string;
  /** IANA timezone (e.g., "America/Los_Angeles"). */
  timezone: string;
}

export type BoundedCap =
  | { kind: "count"; max: number }
  | { kind: "time"; expiresAt: string }
  | { kind: "tokens"; max: number }
  | { kind: "cost_millicents"; max: number };

export interface TriggerSpec {
  description: string;            // human-readable; surfaced in UI
  predicate: PredicateExpression; // machine-checkable; domain limited
}

export interface RevocationSpec {
  graceMs?: number;
  noticeChannels: Array<"event" | "ui_alert" | "email">;
  compensationAction?: CompensationActionRef; // optional rollback hook
}

export interface SubDelegationSpec {
  policy: HandoffAxes["subDelegation"];
  permittedForms?: HandoffForm[];   // narrow what sub-handoffs may take
  maxDepth?: number;                // default 1
}

export interface EscalationSpec {
  triggers: Array<
    | { kind: "blocked"; afterMs: number }
    | { kind: "error"; codes?: string[] }
    | { kind: "no_response"; afterMs: number }
    | { kind: "explicit_escalate" }
  >;
  fallback: HandoffPacket; // recursive — fallbacks may have their own escalations
}

export interface SignatureSet {
  primary: { signerDeskId: string; signedAt: string; signature: string };
  cosigners: Array<{ signerDeskId: string; signedAt: string; signature: string }>;
}

export interface PrincipalRef {
  // The third party for whom the receiver acts in proxy_engagement.
  principalKind: "person" | "desk" | "org";
  principalId: string;
  // Optional human-readable for UI; not authoritative.
  displayName?: string;
}
```

The redundancy between `form` and `axes` is intentional. The receiver checks `form` for fast-path UI rendering and form-specific logic; the receiver enforces `axes` for the actual authority/revocation/sub-delegation behavior. If the two ever disagree (e.g., `form: direct_order` but `axes.authority: receiver_delegated`), the receiver returns `form_invalid` and refuses.

The `axes` ARE the source of truth. `form` is a hint for UI and protocol versioning.

## Composition

Forms compose three ways. All three are first-class — not afterthoughts.

### 1. Sequential (Approval Chain → Execution)

A handoff completing successfully triggers a next handoff. Each stage's `onComplete` may declare the next handoff packet (statically or dynamically). Chains are not pre-baked — each stage's completion can choose the next stage based on the deliverable content.

### 2. Parallel (Swarm)

A single sender handoff dispatches multiple receiver handoffs simultaneously. Resolution policies:

- `first_to_deliver` — winner takes the deliverable; losers auto-cancelled
- `best_of_n` — sender (or designated AI judge) picks one
- `aggregate` — all results merged into one composite deliverable per a declared aggregation function

### 3. Fallback (Escalation Ladder)

A primary handoff carries an `escalation: EscalationSpec` naming a fallback. If a trigger fires (blocked, errored, timed out, or explicit escalate), authority and the work cascade to the fallback. Fallbacks are recursive — an escalation can have its own escalation. **Maximum depth: 5**, configurable per node policy. Default prevents runaway cascades.

Compositions of compositions are allowed (a Parallel Solicitation whose branches are each Approval Chains, with an Escalation Ladder around the whole thing). Composition tree structure is persisted in the audit trail so post-mortems can reconstruct what happened.

## Revocation Behavior By Form

Quick-reference table for the runtime semantics. Sender and receiver UI must implement these consistently.

| Form | Sender clicks "revoke" | Receiver clicks "decline" mid-work | Duration expires |
|---|---|---|---|
| Direct Order | Halts immediately; receiver acks ≤5s | Cannot decline mid-work; only "block with reason" | Auto-expires; mission marked unfulfilled |
| Direct Takeover | Halts after grace (default 60s); receiver finishes critical step | Receiver returns work uncompleted with reason | N/A (open by default) |
| Proxy Engagement | Halts after grace; proxy notifies third party | Receiver returns uncompleted | N/A |
| Dual Authorization | Cannot revoke unilaterally after start; co-signer must also revoke | Same | Auto-cancel if both haven't signed within window |
| Approval Chain | Halts current stage; downstream cancelled | Stage receiver can reject, sends back to sender | Auto-cancel if any stage exceeds its sub-deadline |
| Observer Brief | Halts immediately; observation feed closes | N/A (no work to decline) | N/A |
| Advisory | Halts immediately; advisor returns "withdrawn" | Advisor refuses to opine | N/A |
| Temporary Cover | Halts immediately; original sender resumes | Receiver returns cover early | Auto-expires; cover ends, sender resumes |
| Conditional Engagement | Halts; trigger no longer monitored | Receiver withdraws retainer | N/A unless conditional duration |
| Subcontracting | Halts root; sub-handoffs cascade-cancel per their own rules | Sub-delegator returns | N/A |
| Parallel Solicitation | Halts all branches | Each receiver declines individually | Auto-cancel branches that didn't deliver in time |
| Negotiated | Halts during negotiation; if executing, falls back to agreed form's revocation | Same | Auto-cancel if negotiation stalls past deadline |
| Watch Brief | N/A (one-shot already delivered) | N/A | N/A |

Compensation actions (rollback hooks) attached via `RevocationSpec.compensationAction` run on revocation if defined. This is where the saga pattern lives — for handoffs that produce side effects (sent emails, payments, published posts), the compensation action declares how to undo. V1 supports declaring compensation; runtime enforcement of compensation execution is V2.

## UI Consent Flow Per Form

The sender's compose-handoff UI renders differently per form. A form-aware composer is not optional — Holon's principle "owner manages outcomes, not agent graphs" depends on the user understanding what they're dispatching at a glance.

| Form | UI sketch |
|---|---|
| Direct Order | Single send button. Label "Receiver gets full authority — act exactly as instructed." |
| Direct Takeover | Single send button. Label "Receiver gets full authority — they decide how to do this." |
| Proxy Engagement | Extra field "Acting on behalf of:" with picker; receiver UI shows "you are acting as proxy for X" |
| Dual Authorization | Two signature lines; cannot send until both filled; second signer notified separately and given full context |
| Approval Chain | Drag-and-drop chain builder; each stage names a desk and a form |
| Observer Brief | Receiver picker only; explicit copy "they will only watch and report — no action authority" |
| Advisory | Receiver picker; "you keep the decision; they only advise" |
| Temporary Cover | Date/time pickers required; large warning if window > 30 days |
| Conditional Engagement | Predicate builder; preview "this activates when…" with sample triggers |
| Subcontracting | Sender confirms "the receiver will distribute this further"; receiver UI prompts pre-disclosed sub-handoff plan |
| Parallel Solicitation | Multi-receiver picker; resolution policy radio (first / best / aggregate) |
| Negotiated | Chat-style proposal/counter-proposal UI; either party can close |
| Watch Brief | Receiver picker only; one-line message |

The receiver's inbox shows the form as a typed badge. **Bad:** "incoming task." **Good:** "Dual Authorization request — co-sign required from you and Wei before work begins."

## Compatibility Matrix Between Forms And Holon Concepts

| Concept | Notes |
|---|---|
| Authority Scope (read/cite/transform) — `handoff-design.md` | **Orthogonal** to form. Authority Scope governs what data the receiver can do *with the context*. Form governs what the receiver can do *as a worker*. A Dual Authorization handoff can carry any authority scope. |
| Lifecycle states (queued → accepted → in_progress → ...) | Apply uniformly across forms. Dual Authorization adds a `pending_cosign` substate before `accepted`. |
| Connection types | Forms are independent of Connection types. The same connection between two desks can carry handoffs of any form, subject to per-connection policy filtering. |
| Mission inbox | Every form except Watch Brief lands as a mission. Watch Brief is delivered to a notifications channel (lighter UI surface). |
| Deliverable model | Forms with `receiverRole: reporter` or `advisor` produce non-traditional deliverables: "report content" or "recommendation document" rather than "completed work product." Deliverable schema must accommodate this — see `deliverable-spec.md` (to be written). |
| Runtime adapter | The runtime adapter receives `RuntimeJobConfig.authority` which now carries the form-derived authority subset. See `runtime-adapter-interface.md` cross-reference. |

## Open Decisions (For Next Pass)

1. **Should `axes` and `form` always be transmitted redundantly, or should one be computed from the other?** Current design: both transmitted; receiver verifies consistency. Alternative: form computed canonically from axes, transmitted as hint only. The redundant approach is more forgiving of protocol drift; the computed approach is more rigorous. Decide before wire-format freeze.

2. **Are there forms missing?** Candidates considered and currently deferred (modelable as compositions, but might deserve named status):
   - **Mediated Handoff** — third-party mediator with binding power
   - **Time-Sliced Handoff** — receiver gets authority only during specific hours
   - **Auctioned Handoff** — sender publishes, receivers bid
   - **Apprenticeship** — receiver does work, sender oversees and intervenes; gradually authority shifts (a multi-handoff lifecycle, not a single form)

3. **Sub-delegation depth limit per node policy** — should the cap be per-form (different defaults for Subcontracting vs Direct Takeover) or per-node (one global setting)?

4. **Compensation actions on revocation** — for forms where work has been performed and revoked (e.g., a Direct Takeover revoked mid-work), should the sender be able to declare a "rollback action" (refund a payment, retract a published post)? V1 stores the declaration; runtime enforcement of compensation is V2.

5. **Form-aware billing** — Subcontracting and Parallel Solicitation generate sub-handoffs whose execution costs may bill differently. The handoff form needs to carry a `billingScope` field eventually. V2 concern.

6. **Cross-form transformation** — should a Direct Takeover whose receiver immediately re-handoffs as Subcontracting be surfaced to the original sender as Subcontracting? (Likely yes, with a "received Direct Takeover became Subcontracting" annotation.)

7. **Negotiated form versioning** — during negotiation, both parties hold competing draft `axes`. The protocol must define how draft axes are exchanged and signed. Dedicated sub-spec needed.

8. **Conditional Engagement predicate language** — what's the language? JSONLogic? CEL? A small bespoke DSL? Affects implementation difficulty, sandboxing, debugging.

## Cross-References

- Lifecycle states (queued → accepted → in_progress → submitted → ...) are defined in `handoff-design.md` § Handoff States and apply across all forms (with the Dual Authorization `pending_cosign` extension noted above).
- Authority Scope (read-only / cite-only / transform / etc.) in `handoff-design.md` § Authority Scope is orthogonal to form, as detailed above.
- Wire format and how forms are transmitted between desks — `peer-communication-architecture.md` (next).
- Persistence schema for handoff form fields — `data-model.md` (to be written).
- How the runtime adapter is told the form context — passed via `RuntimeJobConfig.authority` per `runtime-adapter-interface.md`.
- Audit and observability requirements per form — `reliability-and-testing.md` (to be written).

## Acceptance Criteria For This Doc

This document is considered "implementation-ready" for the V1 product when:

1. ✅ All 13 named forms have a UI consent flow sketched (above)
2. ✅ All 13 named forms have a revocation behavior specified (above)
3. ✅ The 6 axes are sufficient to express all 13 forms unambiguously (verified by the matrix)
4. ✅ TypeScript types compile (in `@holon/handoff-types` — to be created)
5. ⬜ Five user stories from the product spec are walked through using these forms end-to-end with no missing capability (to be done in next pass)
6. ⬜ The wire-format binding (peer-communication-architecture.md) carries every field defined here without loss
7. ⬜ The data model (data-model.md) persists every field defined here with appropriate indexes for audit queries

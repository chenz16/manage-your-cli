# Local Agent Management (Core 1 Deep Dive)

Status: draft v0.1
Date: 2026-05-15
Owner: design
Position: This is the detail doc for Core 1, fleshing out `functional-architecture.md` § 2.1 and § 3.2.

## 1. What This Doc Covers

The deep design of how a single Holon desk manages its own team of local executors. Specifically:

- the flat-roster principle and the management-theory reasoning behind it
- the 1-to-7 span-of-control rule
- the role-based staff model with system dispatch
- the explicit-user-creation requirement (no auto-spawning)
- the owner-cultivation model (agents that are "raised" by their human)
- the per-staff autonomy slider
- the three substrate types (AI / CLI / peer mirror) — per ADR-015 myself substrate removed
- the controller-neutrality property (human or AI may control the desk)
- routing rules within Core 1
- the schema (TypeScript-ish) for staff, role, autonomy level, cultivation profile
- the seam with Core 2 (when work leaves the desk)
- which mibusy V3 mechanisms carry forward as-is, and which evolve

What this doc does NOT cover:

- runtime adapter contract → `runtime-adapter-interface.md`
- handoff forms (Core 2 cross-desk concerns) → `handoff-taxonomy.md`, `handoff-design.md`
- wire-level peer protocol → `peer-communication-architecture.md` (next)
- UI screens and copy → `ui-architecture.md`
- DB schema for staff persistence → `data-model.md` (later)

## 2. The Flat-Roster Principle

### 2.1 The Invariant

> **A desk's staff is exactly one level deep. No staff member owns staff.**

This is not a recommendation. It is enforced by foreign-key constraint, by runtime validation in the staff registry, and by API rejection of any mutation that would create a parent/child relationship within the staff set.

### 2.2 Why Flat — Multiple Lenses

**Management theory.** Lyndall Urwick's classical span-of-control work (5–8 direct reports for complex work; 8–15 for simple) and Miller's 7±2 cognitive-capacity number both converge on a small single-digit cap. Andy Grove's *High Output Management* and decades of tech-org practice (Ben Horowitz: "around 7"; Amazon's two-pizza teams: 6–10) reinforce this empirically. Holon picks 7 as the default.

**Software engineering.** Hierarchical agent systems are notoriously hard to reason about. Each level of nesting multiplies the failure modes (which level dropped the message? which level retried? which level escalated?). Single-layer routing is debuggable in one query: "show me all assignments for staff X." Multi-level requires tree traversal at every audit, every UI render, every retry decision. The flat invariant turns hard problems into trivial ones.

**Cognitive load on the owner.** A desk owner managing direct reports thinks about *the work*. A desk owner managing meta-managers (who manage workers) thinks about *the management of work*. The second is a level of indirection humans handle poorly outside actual organizations with HR functions. Holon owners are individuals — not orgs — and we should not ask them to be middle managers of virtual middle managers.

**The peculiar economics of virtual agents.** The classical reason for hierarchy in human orgs is that humans physically cannot directly supervise more than ~7 people. *That constraint does not apply to virtual agents.* If a desk owner needs more agent throughput, they can simply create more sibling staff — there is no fatigue cost, no salary cost beyond compute, no training overhead beyond cultivation. So the historical justification for layered org charts is absent for AI staff. **Hierarchy in AI staff is solving a problem that doesn't exist.**

### 2.3 What Flat Enforces Structurally

Three layers enforce the invariant:

1. **Database** — `staff.parent_staff_id` does not exist. There is no schema-level way to express agent-owns-agent.
2. **Runtime adapter** — The runtime adapter contract (`runtime-adapter-interface.md`) explicitly defines that a runtime job CANNOT spawn a sub-job. Staff A cannot internally invoke "go run staff B for me." If A needs B's help, A must surface a handoff to the product layer.
3. **API** — The staff registry's `create()` method does not accept a parent/owner field. There is no API to attempt the violation.

### 2.4 What Flat Does NOT Mean

These are all FINE under the flat constraint:

- **Pipelines.** Output of staff A becomes input of staff B (handled by Core 2 sequential composition or Core 1 chained assignments by the owner).
- **Parallel work.** Two or more staff working on related sub-pieces of one larger problem.
- **Role specialization.** Staff are role-specialized — that's encouraged.
- **Cross-desk delegation.** A desk's staff can route to another DESK's staff via Core 2 handoff. The receiving desk's staff is, from this desk's perspective, opaque. Handoff is the only legitimate way to "involve another agent" beyond your own roster.
- **Composition by the owner.** The owner can absolutely orchestrate a multi-step workflow that touches several staff. The orchestration lives in the owner's intent, not in agent hierarchy.

### 2.5 Escape Hatches When Complexity Grows

If a desk owner finds themselves wanting "I wish my researcher had its own assistant," the legitimate responses are:

1. **Add a sibling.** Create another flat staff member to handle the assistant work. The owner directly manages both. (Preferred when the work is recurring.)
2. **Hand off to another desk's staff.** Use Core 2. Find a partner desk whose staff has the capacity. (Preferred when the work is occasional and someone else already has the right setup.)
3. **Hire a real human.** Real humans can themselves run their own Holon desk and contract back through Core 2. (Preferred when the work needs human judgment that no AI staff can supply at adequate quality.)
4. **Re-cultivate the existing staff.** Often the desire for a "sub-assistant" is actually the existing staff being underdeveloped. See § 7.

The illegitimate response — "let me make my researcher a manager who can spawn its own AI helpers" — is structurally impossible.

## 3. Span Of Control: The 1-To-7 Rule

### 3.1 The Number

Default cap: **7 active members per desk** (excluding archived members and excluding Core-2 peer identities, which are not Core-1 members).

Sources for the number:
- Urwick (1956): 5–8 for complex work
- Miller (1956): 7±2 working-memory items
- Grove (1983): "around 6"
- Horowitz (2014): "around 7"
- Amazon two-pizza: 6–10
- Holon's choice: 7 as a sensible midpoint that respects all of the above and matches user intuition

### 3.2 Soft Cap, Hard Cap, Override

| Count | Behavior |
|---|---|
| 1–4 | Normal |
| 5 | UI shows the count without warning |
| 6–7 | UI gently surfaces "consider whether this scales" — non-blocking |
| 8–11 | UI blocks creation by default with the message "Past 7 staff, span-of-control becomes hard. Consider archiving, consolidating, or splitting into multiple desks." Override available with one click + reason logged to audit. |
| 12+ | Hard block. Owner must either archive existing staff or change the per-desk cap setting (admin action, audit-logged). |

### 3.3 What A Desk Should Do At The Cap

When approaching or hitting the cap, the desk's UI should suggest:

- **Consolidation** — "Researcher A and Researcher B have overlapping roles; merge?"
- **Archival** — "Staff X has not been assigned work in 60 days; archive?"
- **Cross-desk delegation** — "Do you want to hand future X-type work to a partner desk instead?"
- **Real human hire** — "Some of this work might benefit from a human contractor."
- **Spinoff** — "Consider splitting this work into a separate desk you also own."

### 3.4 Per-Desk Configuration

The cap is per-desk and configurable. A power user or a small org may legitimately want it set to 5 (tighter focus) or 10 (more capacity, accepting the management cost). The default is 7. Audit logs the cap setting and any changes to it.

## 4. The Resident Role Model

### 4.1 Role vs Staff

A **role** is a job description. A **staff member** is a specific filling of one role.

- A desk has zero or more staff filling a given role.
- The same role can be filled by multiple staff (e.g., two Researchers focused on different domains).
- A staff member's role can change over time (the same Researcher might become a Reviewer if the owner re-purposes them — but the staff record is the same).

The router uses roles for dispatch when an assignment doesn't name a specific staff member.

### 4.2 The Standard Role Library

Holon ships with a standard set of role names. Owners may use these directly, customize them, or define new roles entirely. The standard set:

| Role | Job description |
|---|---|
| **Owner** | The desk's principal (usually the human owner, but may be an AI controller — see § 9). Owns final decisions, sets policy. There is exactly one Owner per desk. |
| **Researcher** | Gathers and synthesizes information; produces structured findings; cites sources. |
| **Drafter** | Produces first-cut artifacts (text, code, plans) from instructions and context. |
| **Reviewer** | Examines drafts, identifies issues, suggests improvements. Does not produce primary output. |
| **Planner** | Decomposes large tasks into smaller assignments; sequences work; estimates. |
| **Executor** | Runs tools and takes external actions (file writes, API calls, deployments). The riskiest role; defaults to lowest autonomy. |
| **Communicator** | Handles message-style outputs (drafts emails, summaries, status reports). |
| **Archivist** | Manages files, deliverables, history; surfaces relevant past work. |

These eight roles cover most knowledge-work patterns. The owner does not need all eight — many desks ship with just Owner + Researcher + Drafter and add others as needed.

**Standard role added by ADR-013:**

| Role | Job description |
|---|---|
| **Owner assistant** | The desk owner's personal AI assistant for orchestration queries and management tasks. Substrate: `local_ai`. Tools: `create_assignment`, `list_missions`, `get_member_status`, `ping_peer`, `view_deliverable`, and other orchestration tools. Context: full read access to the desk's members, missions, connections, and recent deliverables. This member IS the "Myself dialog" chat surface (§ 5.6 of `ui-architecture.md`). Its chat is the global right-panel "Myself" tab; it does not have a per-card chat icon. Seeded at desk creation. Special badge in the roster to distinguish it from regular AI members. See ADR-013. |

The `owner_assistant` is a standard role (not a custom role) and occupies one slot in the span-of-control count from day one. Its creation at desk seed is the explicit creation event for this member — the explicit-creation principle (§ 6) is satisfied by the seed action.

### 4.3 Custom Roles

Owners define custom roles via:

- name (string)
- description (markdown)
- default tool scope
- default autonomy level
- default context-pack templates

A custom role is a desk-local concept; it does not federate to other desks. (Cross-desk requests use capability descriptors, not role names — see `handoff-taxonomy.md` § Open Decisions on capability descriptors.)

### 4.4 System Dispatch By Role

When the owner creates an assignment without specifying a staff member ("research X"), the router picks a staff member by role:

1. Filter by role compatibility with the assignment intent (`assignment.targetRole`)
2. Filter by current capacity (not at maximum concurrent jobs)
3. Filter by autonomy level adequate for the assignment
4. If multiple candidates: prefer staff with cultivation profile most relevant to the topic
5. If still tied: pick the staff with the lightest current load

Dispatch decisions are surfaced in the UI: "Routed to Staff X (Researcher) because Y reasons." The owner can override and re-route at any time.

### 4.5 Role-First, Staff-Second Mental Model

UI emphasis is on roles, not on individual staff members. The Today view shows "the work going out is being handled by your Research team (3 staff)" — not "Sally, Tom, and Pat are doing things." This keeps the owner thinking about *capacity by role*, not about per-staff micromanagement.

Power users who want per-staff visibility can drill in. The default is role-aggregate.

## 5. Staff Substrate Types

A staff member's *substrate* is what physically backs them. Holon supports three substrate types in V1 (per ADR-015: the `myself` substrate was removed; owner manual work lives in Today's personal queue, not as a member card); all three expose the same interface to the rest of the desk.

### 5.1 Local AI Staff

Backed by the runtime adapter (Hermes for V1). Executes assignments through the contract defined in `runtime-adapter-interface.md`. Has tool scope, context permissions, budget caps, and autonomy level set by the owner. Produces deliverables that flow into the deliverable store.

### 5.2 CLI Executor

A wrapped command-line tool surfaced as a staff member. The owner configures the wrapping (which CLI, which arguments are scriptable, which require owner approval). When an assignment routes to a CLI executor, Holon prepares the invocation, optionally surfaces a confirm dialog (depending on autonomy level), runs the CLI, captures output as a deliverable.

This is the substrate type that makes Holon useful for "give me a desk that uses my existing CLI tools." Common examples: a custom build script, a `gh` operation wrapper, a `ffmpeg` pipeline, an org-internal CLI.

CLI executors have a hard autonomy ceiling: they default to Supervised and the owner cannot set them above Bounded (per § 8.4 substrate ceilings). Tools with side effects on the owner's machine warrant tighter governance than pure-thinking AI staff.

### 5.3 Peer Identity (Core-2 Mirror)

This is the trickiest substrate. A *peer identity* in the local roster is the desk's local view of a Core-2 connection to another desk. Visually, it appears in the member roster like any other member ("Wang — Media Research"). Functionally, when the owner assigns work to Wang, Core 1's router escapes to Core 2 (per `functional-architecture.md` § 2.3 crossing #1).

Why this is in Core 1: the OWNER's mental model is "I have a team that includes some humans I work with." The peer mirror lets the team UI feel uniform. The fact that Wang is actually backed by a remote desk is an implementation detail surfaced as a small badge.

Peer identities do NOT count against the 1-to-7 span-of-control cap (they are not Core 1 work). They have their own inbox UI for connection health and their own "view in Connections" link.

(Per ADR-003: the substrate formerly called `proxy` is now `peer`, to disambiguate from the Proxy Engagement handoff form in `handoff-taxonomy.md` § 3, which is a distinct fiduciary concept.)

### 5.4 Owner Manual Work (Not a Substrate)

Per ADR-015, the owner's own manual work is NOT represented as a Members card or a substrate. When an inbound mission is accepted and routed to the owner (not delegated to AI/CLI/peer staff), it lands in the Today screen's personal queue section. The owner identity continues to appear only in the top-right identity menu. See § 10.4 for routing details.

### 5.5 The Uniform Interface

Across all three substrates, the desk shell sees:

```typescript
interface Staff {
  id: StaffId;
  name: string;
  role: RoleName | CustomRole;
  substrate: Substrate;        // discriminated union, see § 11
  autonomyLevel: AutonomyLevel;
  status: "active" | "paused" | "archived";
  currentJobs: number;
  cultivationProfile?: CultivationProfile;
  // ...
}
```

Routing, UI, audit, and assignment lifecycle treat all four substrates uniformly above this interface. Differences appear only in the substrate-specific implementation details (which are encapsulated below the interface).

## 6. Explicit User Creation

### 6.1 The Principle

> **No staff is created without an explicit, traceable, owner-initiated action.**

This is a hard rule. There is no "auto-spawn" path: no AI staff member can request that a new staff be created; no template can silently instantiate; no "smart defaults" can populate a desk with a roster the owner didn't ask for.

### 6.2 Creation Flow

1. Owner clicks "Add staff" in the Staff screen.
2. Owner picks substrate type (AI / CLI / peer). Per ADR-015, myself is no longer a substrate; owner manual work goes to Today's personal queue.
3. Owner picks role (from standard library or custom).
4. Owner sets initial config (name, tool scope, autonomy level).
5. (For AI staff) Owner picks the underlying agent profile (from a library of Hermes profiles).
6. (For CLI executors) Owner configures the CLI wrapping (binary, args template, approval rules).
7. (For peer identities) Owner picks an existing connection or creates a new one.
8. System creates the staff record; emits `staff_created` audit event; surfaces a "first-assignment" walkthrough.

The flow takes ≥ 30 seconds even with happy-path defaults. This is intentional friction — creating staff should feel like a small commitment, not a click.

### 6.3 Why Explicit

Three reasons:

1. **Complexity control.** Auto-spawning means the desk acquires structure the owner didn't author. A few months later they cannot explain why the roster looks the way it does. Explicit creation keeps the owner authoritative on their team.
2. **Audit and accountability.** Every staff has a creation event with the owner's identity. Useful for compliance, for security review, and for "why does my desk have this thing?" debugging.
3. **Mental model integrity.** Owners can hold a small, explicit roster in their head. They cannot hold an emergent self-spawned roster in their head. The latter feels like the desk is alive in a way that breaks trust.

### 6.4 What Explicit Does NOT Forbid

- **Templates.** A "starter pack" template can be one-click — but it explicitly creates N staff, lists them, and asks the owner to confirm before commit.
- **Recommendations.** The desk can recommend "you might want a Reviewer" with rationale; owner clicks to create.
- **Bulk import.** Owners migrating from another tool can bulk-import a roster; the import itself is the explicit action.
- **Cloning.** A staff member can be cloned (e.g., to make a second Researcher with similar config); the clone action is the explicit creation event.
- **AI controller assistance.** An AI controller (see § 9) may help the owner think through what staff to create. The CREATION still goes through the owner's explicit confirmation step.

### 6.5 Mibusy Carry-Forward

The mibusy V3 prototype already implements explicit subagent creation:

- `apps/web/components/AgentForm.tsx` — the staff creation form
- `virtual_agents` table with explicit `created_by` field
- `chat tool: configure_peer_agent` — even AI-mediated creation surfaces the form to the human

Carry forward as-is:
- the form-based creation flow
- the `virtual_agents` table structure (rename/extend for Holon's full Staff model)
- the audit trail on creation

Evolve:
- add `cultivation_profile_id` FK
- add `autonomy_level` enum
- add `substrate` discriminator (mibusy assumes one substrate; Holon needs four)
- enforce span-of-control cap at API level (mibusy does not yet)

## 7. The Cultivation Model

### 7.1 The Framing

A Holon staff is not a one-shot deployed model. It is an entity the owner *cultivates* over time — by giving it work, reviewing its outputs, correcting it, expanding its tool scope, refining its role description. After 50 assignments, the same staff produces noticeably better-aligned output than on assignment 1, because its cultivation profile has accumulated.

This is intentional. Holon is built for the owner who wants to keep their AI workers and grow them, not for the owner who wants disposable AI workers.

### 7.2 What Cultivation Comprises

| Component | Source | Used When |
|---|---|---|
| **Standing instructions** | Owner explicitly adds | Every assignment to this staff |
| **Style preferences** | Inferred from approved deliverables and corrections | Every assignment, lower priority than standing instructions |
| **Tool affinity** | Tracked from frequency of use and outcome quality | Assignment routing (this staff prefers / avoids tool X) |
| **Topic memory** | Persistent memory of past assignments and what was learned | Assignment routing (this staff knows about topic Y) |
| **Past corrections** | Owner-flagged "do not do this again" | Negative-example context on relevant assignments |
| **Past exemplars** | Owner-flagged "this was great, do more of this" | Positive-example context on relevant assignments |
| **Role description tweaks** | Owner edits the role definition over time | Reflected in system prompt for every assignment |

### 7.3 Cultivation Profile

```typescript
interface CultivationProfile {
  staffId: StaffId;
  standingInstructions: MarkdownText;
  stylePreferences: {
    inferred: StylePreferenceSet;       // computed
    ownerOverrides: StylePreferenceSet; // explicit
  };
  toolAffinity: Array<{ tool: ToolName; weight: number; lastUsedAt: string }>;
  topicMemory: Array<{ topic: TopicTag; summary: string; assignmentRefs: AssignmentId[] }>;
  exemplars: Array<{
    kind: "positive" | "negative";
    deliverableRef: DeliverableId;
    note: MarkdownText;
  }>;
  lastCultivationActionAt: string;
}
```

This is a structured record, not a model fine-tune. The structure feeds into the staff's runtime context pack on every assignment.

### 7.4 The Cultivation Feedback Loop

```
Owner creates assignment for Staff X
  → Runtime executes with current cultivation profile baked into context
  → Deliverable returned
  → Owner reviews
     - Approves as-is             → no profile change
     - Approves with comment      → comment added to standing instructions (owner-confirmed)
     - Edits the deliverable      → diff inferred as a style correction (owner can promote to standing)
     - Rejects                    → deliverable marked as negative exemplar
     - Marks as "great work"      → deliverable marked as positive exemplar
```

Cultivation actions are owner-explicit. The system never modifies the profile without an owner action; it can only *suggest* updates ("I notice you edited this paragraph; want to add 'prefer shorter paragraphs' as standing instruction?").

### 7.5 What Cultivation Is NOT

- Not model fine-tuning. The underlying model is unchanged. Cultivation is a structured prompt + context evolution layered on top.
- Not RAG. Cultivation profile is small (few KB), curated, and explicitly authored. RAG-style large vector stores are a separate, optional feature.
- Not silent. The owner can see the entire cultivation profile, edit it, export it, reset it.

### 7.6 Cultivation As A UX Feature

The Staff edit screen surfaces:

- "View cultivation profile" — full readable text
- "Reset cultivation" — wipe profile, keep base config
- "Export cultivation" — JSON export, useful for migration
- "Preview prompt" — show the actual system prompt this staff will get on the next assignment, with cultivation baked in

Owners who want to "raise" a staff member rapidly will use these surfaces actively. Owners who want low-touch staff just leave the profile to grow on its own from approval/rejection signals.

### 7.6a Mentor Consultations In Cultivation

When a `local_ai` member consults a mentor peer (per § 14.5), the consultation is recorded as a special memory entry in the member's cultivation profile (`kind: "mentor_consultation"`). This entry carries the mentor's identity, the domain, a summary of the advice given, and a reference to the triggering assignment. Over many consultations, the cultivation profile accumulates a rich record of how the mentor approached problems in a given domain. In V2, the distillation pipeline reads this record to surface patterns from the mentor's responses directly into the member's standing context. In V3, accumulated mentor patterns may meet the threshold for the system to suggest the member can handle those tasks autonomously. For V1, the log is informational: the owner can inspect it, and it feeds into `topic_memory` for retrieval, but no automatic distillation occurs.

### 7.7 The Always-Human-Governed Staff

Some staff are designed never to graduate beyond owner review. The cultivation profile carries a flag `governanceMode: "always_supervised" | "graduated"`. When `always_supervised`, the autonomy slider is locked at Supervised — the owner cannot promote it. This is for staff handling sensitive work (legal, financial, customer-facing communications, etc.) where the owner has decided "no matter how well it learns, I review every output."

This is a fixed policy on the staff record, settable only at creation or by explicit owner action with audit trail.

## 8. The Autonomy Slider

(Per ADR-004: collapsed from a 6-level slider (L0–L5) to a 3-level slider
(Supervised / Bounded / Autonomous). The former L0 "Inert" mode is now
expressed via `staff.status: paused` instead of as an autonomy level — see
`data-model.md` § 4.4.)

### 8.1 The Continuum

Each staff has an *autonomy level* set by the owner. The level controls how
much of the staff's work happens without owner interaction. There are three
levels.

| Level | What happens |
|---|---|
| **Supervised** | Every output requires owner approval before delivery. The runtime produces a draft; the owner reviews; the owner clicks "approve." External actions (sending, writing, calling tools) also gated. |
| **Bounded** | Staff acts autonomously within declared limits (max tokens, max cost, max external calls per assignment, allowed tool scope). If the staff would exceed any limit, it pauses and asks for owner approval. |
| **Autonomous** | Staff acts without per-assignment approval. Audit logs continue; owner reviews the audit trail asynchronously and can intervene retroactively. |

For the inert case ("staff cannot accept new assignments" — e.g., setup in
progress, on hiatus), set `staff.status = 'paused'` (per `data-model.md`
§ 4.4). When re-activated, the staff resumes at their previously set
autonomy level.

### 8.2 Default Level

New staff start at **Supervised** by default. The owner *promotes* the staff
over time as trust builds, never the other way around (the system never
silently raises autonomy).

The owner can downshift at any time (e.g., a recent bad outcome → drop from
Autonomous to Bounded for a while). Downshifts are immediate; promotions
are a deliberate UI action with a confirmation step.

### 8.3 Per-Assignment Override

Even an Autonomous staff can be assigned a specific assignment with
`requiresApproval: true`. The override applies to that one assignment
without changing the standing autonomy level. Useful for "I'm asking you
to do something more sensitive than usual."

### 8.4 Substrate Constraints On Autonomy

Not all substrates can reach all levels:

| Substrate | Maximum autonomy |
|---|---|
| Local AI member (Hermes) | Autonomous |
| CLI executor | Bounded (cannot reach Autonomous — CLI side effects warrant per-assignment touch via the budget gate) |
| Peer identity | N/A (autonomy of the actual work is the remote desk's concern) |

Per ADR-015: `myself` substrate is removed. Owner manual work routes to Today's personal queue via `target.kind == "owner"` (§ 10.4); no autonomy concept applies to that path.

These ceilings are policy, not law — they could be relaxed in V2 with
stronger sandboxing, but V1 keeps them as hard caps.

### 8.5 Interaction With Handoff Forms

The autonomy level interacts with what handoff forms a staff can be assigned
to fulfill. The canonical table is `handoff-taxonomy.md` § 8.5; cross-linked
here for convenience:

| Handoff form | Minimum staff autonomy required |
|---|---|
| Direct Order, Direct Takeover, Subcontracting | Autonomous (acts without per-assignment approval) |
| Approval Chain (executor stage) | Bounded or higher (executor still respects budget; approval is at chain level) |
| Approval Chain (approver stage) | Supervised (approver reviews each step) |
| Advisory, Observer Brief | Supervised (output is review-mode anyway) |
| Dual Authorization | Bound by the form's mutual approval, not by staff autonomy |
| Proxy Engagement | N/A (fiduciary relationship, not a Core 1 staff substrate) |

If the owner tries to fulfill an inbound mission with a staff whose autonomy
is too low, the desk warns and offers to (a) raise autonomy, (b) pick a
different staff, or (c) take the assignment to the owner's queue instead.

### 8.6 What Supervised Buys You

The Supervised default exists because new AI staff are unproven on this
owner's specific domain. A model that scores well on benchmarks may still
produce work that looks wrong in *this owner's* style. Supervised lets the
owner build a corpus of approved exemplars (which feed into cultivation, see
§ 7) before promoting. The tax of "one extra click per assignment" buys real
safety for the first weeks of a staff member's life.

### 8.7 Dynamic Behavior (V1 / V1.x / V2)

(Per ADR-006: phased introduction of system-driven autonomy behavior. V1
is pure static; V1.x adds auto-degrade triggers in the safe direction;
V2 adds cultivation-driven suggestions that are never auto-applied.)

**V1 — pure static.** Standing autonomy is owner-set only. The system
never adjusts `staff.autonomy_level` in either direction. The rule in
§ 8.2 ("the system never silently raises autonomy") is extended for V1
to "the system never silently *changes* autonomy in either direction."
No telemetry-driven adjustment, no suggestion engine, no auto-pause
tied to autonomy. New AI staff start at Supervised; the owner promotes
/ demotes deliberately.

**V1.x — auto-degrade triggers.** Three triggers can lower (never raise)
autonomy in response to observable signals. The owner is notified each
time and can re-promote manually.

| Trigger | What happens | Mechanism |
|---|---|---|
| 3 rejected deliverables in a row (within a 30-day window) | Demote one level (Autonomous → Bounded, Bounded → Supervised). | Standing `staff.autonomy_level` updated; audit event `staff_autonomy_auto_degraded` emitted before the change. |
| New tool added to staff's tool scope | Next assignment using that tool forced to Supervised (one-shot). | Per-assignment override via `requiresApproval: true` on the next dispatch; standing autonomy unchanged. |
| New peer paired (< 24h ago) | First 5 handoffs to or from the new peer execute at Supervised. | Per-assignment override on each of the first 5; standing autonomy unchanged. |

The "never silently raises" rule remains intact; auto-degrade is allowed
because demotion is always the safe direction.

**V2 — cultivation-driven suggestions (never auto-applied).** A
suggestion engine watches the cultivation profile (§ 7) and surfaces UI
nudges when positive exemplar count crosses thresholds. The nudge
proposes a promotion; the owner clicks to apply. Dismissal suppresses
the suggestion for 30 days.

Starting thresholds (V2 tunable):

| Suggested promotion | Threshold (last 30 days) |
|---|---|
| Supervised → Bounded | 10+ approved exemplars, 0 rejections |
| Bounded → Autonomous | 25+ approved exemplars across ≥ 3 tools, 0 rejections, no budget overruns |

V1 does NOT pre-build scaffolding for V1.x or V2. V1.x and V2 are clean
additions that introduce new audit event kinds and UI affordances
without changing V1's static-only contract. A V1 desk upgraded to V1.x
just starts seeing auto-degrade events fire; no migration needed.

## 9. Controller Of The Desk

### 9.1 The Neutrality Property

A Holon desk does not care whether the entity sending commands at its top is a human typing in a UI or an AI assistant generating those commands programmatically. The desk's API is identical. This is a deliberate design choice: it future-proofs the product for AI-controlled desks (an AI assistant managing a team of AI staff on behalf of a human user) without architectural surgery.

### 9.2 Human Controller (Default)

The owner is a human who interacts via UI, voice, or any other input modality. Every action is initiated by the human's input. Authentication tied to the human's identity.

### 9.3 AI Controller

An AI assistant (could be the owner's personal AI, a Holon-provided "desk assistant," or a third-party agent) sits between the owner and the desk's API. The owner has explicitly authorized the AI to make decisions on their behalf within scope. The AI then:

- creates and assigns work
- promotes/demotes staff autonomy
- archives and adds staff (with human-confirm step preserved per § 6)
- reviews deliverables and applies cultivation feedback

What the AI controller CANNOT do:

- exceed the owner's scope of authority (e.g., create a new connection with a desk the owner has not approved)
- bypass the explicit-creation requirement for new staff
- silently raise autonomy (every promotion still surfaces a confirm event the owner sees in their daily summary)
- override the flat-roster invariant
- override owner-mediated authority for inbound missions

### 9.4 Hybrid Control

Realistic operation: the owner uses the UI for important decisions and an AI controller for routine maintenance. The AI handles inbox triage, routine assignment routing, low-stakes review; the owner handles strategy, sensitive decisions, cultivation that requires judgment.

Hybrid control is the expected default state for power users. The desk records who initiated each action (human or AI controller, with identity).

### 9.5 Architectural Implications

Because the desk's API is the same regardless of controller, the controller layer is not part of Core 1 — it is a *consumer* of Core 1's API. This means:

- The desk's API surface is small enough to be programmable
- A future "official Holon desk assistant" can be built without core changes
- Third parties can build alternative controllers
- All controllers see the same audit trail

Multi-controller (more than one AI assistant + the human, all acting concurrently) is V2.

## 10. Routing Within Core 1

### 10.1 What The Router Does

Given an assignment, decide which staff (or owner queue, or Core 2 escape) handles it. Inputs: the assignment's target specification, the current roster, current loads, current autonomy levels. Outputs: a routing decision plus an audit event.

The router is **policy-only**. It does no planning. The owner has already chosen what they want done; the router only resolves who does it.

### 10.2 Routing Modes

```typescript
type AssignmentTarget =
  | { kind: "staff"; staffId: StaffId }            // explicit staff
  | { kind: "role"; role: RoleName | CustomRole }  // role-based dispatch
  | { kind: "owner" }                              // owner's own queue
  | { kind: "anyone"; capability: CapabilityTag }; // V2: capability matching
```

### 10.3 Dispatch Algorithm (Role Mode)

```
candidates = staff filter:
  - role == target.role
  - status == "active"
  - currentJobs < maxConcurrentJobs
  - autonomyLevel >= assignment.minAutonomyRequired

if candidates is empty:
  → block, surface to owner: "no available staff for role X"

if size(candidates) == 1:
  → assign to that staff

else:
  rank candidates by:
    1. cultivation profile relevance to assignment topic (descending)
    2. recent positive exemplars on this topic (descending)
    3. current load (ascending)
  → assign to top candidate
```

The dispatch decision is logged with full reasoning. The owner can re-route at any time.

### 10.4 Owner Queue

When `target.kind == "owner"`, the assignment lands in the owner's "Today" view as a personal todo. No staff routing happens. The owner completes the work themselves and submits the deliverable.

This is the substrate that makes Holon useful even if you have ZERO AI staff — the desk works as a personal todo system that happens to interoperate with other desks via Core 2.

### 10.5 Core 2 Escape

When the target is a peer member (`target.kind == "staff"` and the member record's `substrate.kind == "peer"`), the router does not execute locally. It hands the assignment off to the handoff layer with the peer connection info attached. The handoff layer takes over (per `functional-architecture.md` § 5.2).

The router does NOT decide handoff form. Form choice is the owner's per-assignment decision (with sensible defaults per connection type — see `handoff-taxonomy.md`).

### 10.6 Failover

If an assignment cannot be routed (no staff, all blocked, all over budget), the router blocks the assignment and surfaces to the owner queue with a reason. Failover is never silent (`functional-architecture.md` § 7.3).

## 11. Interface (Schemas)

```typescript
// Defined in @holon/core1-types

export interface Staff {
  id: StaffId;
  deskId: DeskId;
  name: string;
  role: RoleName | CustomRoleId;
  substrate: Substrate;
  autonomyLevel: AutonomyLevel;
  governanceMode: "always_supervised" | "graduated";
  status: "active" | "paused" | "archived";
  maxConcurrentJobs: number;       // default 1 for AI, 1 for CLI, N for human
  currentJobs: number;             // computed from active assignments
  cultivationProfileId: CultivationProfileId | null;
  createdAt: string;
  createdBy: { kind: "human" | "ai_controller"; id: string };
  archivedAt?: string;
  archivedReason?: string;
}

export type AutonomyLevel = "Supervised" | "Bounded" | "Autonomous";  // per ADR-004: collapsed from L0..L5; inert is now staff.status='paused'

// Per ADR-015: myself substrate removed. Owner manual work routes to Today personal queue
// via target.kind == "owner"; it is not a member substrate.
export type Substrate =
  | { kind: "local_ai"; agentProfileId: HermesProfileId; toolScope: ToolName[]; budget: BudgetCaps }
  | { kind: "cli"; binary: string; argsTemplate: string; approvalRules: ApprovalRule[] }
  | { kind: "peer"; connectionId: ConnectionId; remoteStaffName: string };

export interface Role {
  name: RoleName;        // standard names: "owner" | "researcher" | "drafter" | ...
  description: MarkdownText;
  defaultToolScope?: ToolName[];
  defaultAutonomyLevel: AutonomyLevel;
  defaultContextPackTemplate?: ContextPackTemplateId;
  isCustom: boolean;
  customRoleId?: CustomRoleId;     // present if isCustom
}

export interface CultivationProfile {
  id: CultivationProfileId;
  staffId: StaffId;
  standingInstructions: MarkdownText;
  stylePreferences: {
    inferred: StylePreferenceSet;
    ownerOverrides: StylePreferenceSet;
  };
  toolAffinity: Array<{ tool: ToolName; weight: number; lastUsedAt: string }>;
  topicMemory: Array<TopicMemoryEntry>;
  exemplars: Array<{
    kind: "positive" | "negative";
    deliverableRef: DeliverableId;
    note: MarkdownText;
    addedAt: string;
  }>;
  lastUpdatedAt: string;
}

export interface RoutingDecision {
  assignmentId: AssignmentId;
  decision:
    | { kind: "assign_to_staff"; staffId: StaffId; reasonCodes: string[] }
    | { kind: "owner_queue" }
    | { kind: "core2_escape"; connectionId: ConnectionId; peerStaffId: StaffId }
    | { kind: "blocked"; reasonCodes: string[]; suggestion: string };
  decidedAt: string;
  decidedBy: { kind: "router_auto"; algorithm: "role_dispatch_v1" | "explicit_target" }
           | { kind: "owner_override"; ownerId: string };
}

export interface SpanOfControlPolicy {
  deskId: DeskId;
  softWarnAt: number;          // default 5
  uiBlockAt: number;           // default 8
  hardBlockAt: number;         // default 12
  reasonRequiredForOverride: boolean;  // default true
}
```

## 12. Boundary With Core 2

The two cores share IDs (assignment, mission, deliverable IDs are global) but never share staff data. Specifically:

| Object | Core 1 sees | Core 2 sees |
|---|---|---|
| Local AI member | Full record (substrate, profile, autonomy, etc.) | Nothing — local members are never visible across desks |
| Owner manual work | Today personal queue (not a member record; per ADR-015) | Nothing |
| CLI executor | Full record | Nothing |
| Peer identity | Mirror record (name, badge, current job count) | Underlying connection record |
| Assignment | Local + Core-2-bound assignments by ID | Outbound + inbound by handoff ID |
| Mission | Submitted-locally missions only | All missions (inbound and outbound) |
| Deliverable | Locally produced deliverables | Returned deliverables |

When work crosses the seam, Core 1 does not see the inside of Core 2's protocol; Core 2 does not see the inside of Core 1's roster (except for the peer identity surface). Each core has its own logging, its own UI, its own retry semantics.

## 13. Mibusy Carry-Forward Mapping

| Holon (Core 1) | Mibusy V3 | Status |
|---|---|---|
| Staff | `virtual_agents` table | Carry forward; rename and add fields |
| Substrate type discriminator | `agent_mode` (ai \| facade) | Evolve: 3 substrate types instead of 2 (per ADR-015: myself removed) |
| Explicit creation flow | `AgentForm.tsx` | Carry forward; add cap enforcement |
| Cultivation profile | (does not exist) | New for Holon |
| Autonomy slider | (implicit; mibusy is mostly Supervised-equivalent for AI staff) | New explicit feature — 3-level enum (Supervised / Bounded / Autonomous) per ADR-004 |
| Role-based dispatch | (does not exist; mibusy assigns by name only) | New |
| Span-of-control cap | (does not exist) | New |
| Owner manual work | (mixed in with regular staff conceptually) | Per ADR-015: not a substrate. Owner work routes to Today personal queue via `target.kind == "owner"`. |
| CLI executor substrate | (does not exist) | New for Holon |
| Peer identity in roster | `agent_mode: facade` + `peer_*` fields | Carry forward; rename to `substrate: peer` (per ADR-003; was `proxy` in earlier drafts) |

## 14. Chat Surface — V1 Persistence Note (ADR-013)

Per ADR-013, the chat surface is a UI exposure of Hermes's natural conversational form. No new database table is required.

**V1 persistence mechanism:** Each member record carries a `chat_log[]` array that holds the in-memory conversation history for the current session. This is a Dev-layer implementation detail; the schema extension is:

```typescript
// Added to the Staff interface for V1 chat support (no new table)
chatLog?: Array<{
  role: "user" | "assistant";
  content: string;
  toolCalls?: Array<{ name: string; args: unknown; result: unknown }>;
  citations?: Array<{ refKind: string; refId: string; excerpt?: string }>;
  ts: string;
}>;
```

The array is in-memory only. If the application restarts, the session history is lost — this is acceptable for V1. Persistent chat history (cross-session) is a V2 concern and will be evaluated alongside other V2 data-model extensions.

The `owner_assistant` member uses the same mechanism for the Myself dialog. Its chat history is the "Myself" tab in the global panel; it is not stored in the assignment or deliverable tables.

This design preserves the ADR-009 data-model rule: no `conversations`, `messages`, or `sessions` table is introduced in V1.

## 14.5 Mentor Peers (per ADR-016)

### What Mentor Peers Are

A **mentor peer** is a human expert (backed by a peer connection) attached to a `local_ai` member to provide domain-specific guidance on sub-tasks the owner does not handle personally. The AI member can route specific tasks to its mentor, receive guidance, and (in V2+) gradually absorb the mentor's approach into its cultivation profile. This realizes the "AI 雇人" (AI employs human) concept: the AI staff member, not the owner, is the direct relationship holder with the mentor.

Mentor peers are structurally distinct from direct peer members:

| | Direct peer | Mentor peer |
|---|---|---|
| Who holds the relationship | Owner ↔ human (human-to-human channel) | AI member ↔ human expert |
| Where it lives | `substrate: peer` member in the roster | `mentors[]` array on a `local_ai` staff record |
| Purpose | Owner collaboration, deliverable hand-off | AI sub-task escalation + long-term skill distillation |
| Distillation path | None | V2+: AI absorbs mentor patterns via cultivation |

### How Mentors Attach To local_ai

The `local_ai` substrate gains an optional `mentors[]` array (per `data-model.md` § 4.4.1). Each entry references an existing peer `connection_id` (the mentor is always someone the owner has already paired with), annotates the domain, and carries an `invocation_policy` and `distillation_enabled` flag.

A single peer connection may simultaneously serve as a direct peer in the Members roster and as a mentor on one or more `local_ai` members — same `connection_id`, different invocation contexts (per ADR-016 Q3 resolution).

Constraints:
- `mentors[]` is only valid on `local_ai` substrate. CLI executors and peer substrate members cannot have mentors.
- `owner_assistant` (per ADR-013) may also carry mentors (owner's personal AI may escalate to human experts).

### V1 Explicit-Choice Model

In V1, when an assignment targets a `local_ai` member that has `mentors[]`, the assignment composer modal presents a toggle:

- **"Let [AI name] handle"** — routes to the AI as normal
- **"Send to mentor: [mentor name]"** — routes the task directly to the mentor peer for this assignment

The owner makes this choice explicitly per assignment. There is no auto-routing based on confidence or topic. Every mentor consultation is recorded in the cultivation log (see § 7.6a).

### V1.x → V2 → V3 Phasing

| Phase | What's live |
|---|---|
| **V1 (now)** | UI shows mentor relationship. Assignment composer shows explicit AI-vs-mentor toggle. No auto-routing. No distillation. Cultivation log records consultations. Mentor invocation is informal (cultivation-log only, not a Holon handoff). |
| **V1.x** | `ai_decides` invocation policy enabled. AI evaluates at runtime whether to handle or escalate to a mentor (confidence signal). Mentor invocation upgrades to a formal `Advisory` handoff (per `handoff-taxonomy.md`). |
| **V2** | Distillation pipeline: cultivation profile gains "learned-from-mentor" memory entries. AI reads mentor's past responses on similar topics when composing its own responses. Formal handoff is the standard for mentor invocation. |
| **V3** | True skill transfer: cultivation profile accumulates enough that the AI handles previously-mentor-routed tasks autonomously. System surfaces "AI may no longer need Wang for JP translations" with confidence score and owner confirmation step. |

## 14.6 Owner-Driven Roster CRUD (per ADR-019)

Status: proposed-auto-applied 2026-05-16, iter-007 step 7.

ADR-013 already routes desk control through the owner_assistant chat surface (the Hermes loop exposed as UI). Iter-007 step 7 widens that surface so the owner_assistant can also **mint, edit, and dismiss `local_ai` staff** without leaving chat — turning the conversation into the canonical hiring desk, parallel to the form-based path in § 6.

### What Is Exposed

Three tools are added to the `hermes-acp` toolset surface (see `owner-assistant-tools.md` § 5 for the full catalogue and the 7 → 10 count update). They are owner-only — only the owner desk-AI session sees them; no external surface exposes them. This preserves Engineering Rule 6 (owner-mediated authority): all three only operate when the owner is the actor.

| Tool | Required input | Whitelisted fields | Post-emit audit event |
|---|---|---|---|
| `create_staff` | `name`, `role_label`, `system_prompt` | `name`, `role_label`, `role_name?`, `system_prompt?`, `max_concurrent_jobs?`, `agent_profile_id?`, `tool_scope?` | `staff.created` |
| `update_staff` | `staff_id` + at least one editable field | `name`, `role_label`, `role_name`, `status`, `system_prompt`, `autonomy_level`, `governance_mode`, `max_concurrent_jobs` | `staff.updated` |
| `dismiss_staff` | `staff_id` | (no edits — soft tombstone) | `staff.dismissed` |

`status` is constrained to `active | paused | retired` (the chat-surface dismiss path uses the tombstone set; `archived` remains the form-path concept).

### Defaults Applied On Create

Per Engineering Rule 11 (PII-free, machine-portable defaults — see ADR-018), `create_staff` fills in machine-portable, generic values for every field the owner did not pass:

- `substrate.kind = "local_ai"`
- `autonomy_level = "Supervised"` (matches § 8.2 default — system never silently raises)
- `governance_mode = "graduated"`
- `status = "active"`
- `agent_profile_id = "hermes_profile_generic_v1"`
- `tool_scope = ["web_search", "read_file"]`
- `desk_id = fx.primary_desk_id` — flat-roster invariant (Engineering Rule 5): every minted staff is a sibling, never a child of another staff record.

### Substrate Restriction On Dismiss

`dismiss_staff` rejects any staff whose substrate is not `local_ai`. Specifically: `peer`, `cli`, and the `owner_assistant` singleton (per ADR-013, ADR-015) cannot be dismissed through chat — they require the explicit form-based path in § 6 (or for the owner_assistant, no path at all in V1).

**Open question:** is `local_ai`-only the right scope, or should CLI staff also be dismissible through chat? Owner intent says "this CLI wrapper is retired" is an equally common case. The substrate restriction is a conservative V1 default; revisit after iter-008+.

### Mutable-Store Layering (Implementation Posture)

State lives above the runtime (Engineering Rule 1). The three handlers are HTTP shells over a BFF mutable store that layers three projections on top of the fixture baseline:

```
   fixture baseline
   ⊕ dynamicStaff   (chat-created rows)
   ⊕ staffOverrides (field-level edits on top of fixture or dynamic)
   − dismissedStaffIds (soft-tombstone set)
   ─────────────────────────────────
   = listStaffMerged() / getStaffMerged()
```

The Members service (`packages/core/src/members-service.ts`) now sources from this merged view, so the /members UI sees chat-created staff automatically without any additional plumbing. This mirrors the same pattern that `owner-config-service.md` § 3 uses for the OwnerAssistant singleton — fixture + overrides + (V2) DB.

`clearMutableStore()` wipes all three projections together and returns counts; admin reset (`admin-surfaces.md` § 3.1) restores the fixture baseline as the single source of truth.

### Engineering-Rule Alignment

| Rule | How this surface complies |
|---|---|
| **#1 — state above runtime** | Holon BFF owns the roster. Hermes tool handlers HTTP into the BFF; they do not mutate runtime state directly. |
| **#4 — no silent failure** | Every CRUD path returns `{ error: msg }` JSON on failure; every success logs a structured `audit` line on stdout. No bare try/catch. |
| **#5 — flat-roster invariant** | `create_staff` always sets `desk_id = fx.primary_desk_id`; no parent_staff_id surface exists. Span-of-control cap from § 3.2 still applies once enforced at the BFF level (currently fixture-baseline does not enforce; open follow-up). |
| **#6 — owner-mediated authority** | Tools are registered only on the owner desk-AI's `hermes-acp` session. No external/peer/cli path exposes them. Owner-mediated by construction. |
| **#8 — audit emit after state change** | All three handlers emit `staff.created` / `staff.updated` / `staff.dismissed` after the mutable-store write returns (post-emit per ADR-007 V1 posture). |
| **#11 — PII-free defaults** | Default `agent_profile_id` and `tool_scope` above are generic and machine-portable; no developer-name, no absolute paths. |

### Relationship To § 6 (Explicit User Creation)

§ 6 prescribed a form-based, ≥30-second creation flow with a deliberate friction tax. The chat-CRUD path **does not contradict § 6** — it is the AI-controller-assistance branch of § 6.4 ("AI controller assistance — the AI may help the owner think through what staff to create. The CREATION still goes through the owner's explicit confirmation step"). Here, the owner's explicit confirmation step is the chat turn itself: the owner names the role and persona in chat, and the assistant calls `create_staff` on their behalf. The friction tax moves from "fill a form" to "compose a request in chat", but it remains owner-explicit — no auto-spawn, no template-burst, no AI-initiated creation.

**Open question:** new staff created via chat are auto-`active`. The form path lets the owner stage in `paused` first. Should chat-created staff ship in `paused` and wait for an explicit chat-side `update_staff status=active` flip? Conservative answer is yes; current behavior is no. Flagged for iter-008 feedback.

**Open question:** should `create_staff` accept `autonomy_level` directly, or always start at `Supervised` (current behavior, matching § 8.2)? Current default is § 8.2-compliant; surfacing the parameter would let the owner skip the Supervised step for a clearly low-risk persona, at the cost of weakening the "system never silently raises" posture if the AI infers an autonomy_level the owner did not articulate.

### Cross-References

- ADR-013 — chat surface as Hermes loop (anchors the owner_assistant chat-CRUD surface).
- ADR-015 — myself out of Members (clarifies that "owner manual work" is never minted via these tools).
- ADR-016 — mentor peer (orthogonal: mentors live in `local_ai.mentors[]` per § 14.5, not in the dismissable roster).
- ADR-018 / Engineering Rule 11 — PII-free defaults applied by `create_staff`.
- ADR-019 — the canonical ADR for this surface; see `docs/decisions/019-runtime-staff-crud.md`.
- `owner-assistant-tools.md` § 5 — the tool catalogue including the three new entries.
- `data-model.md` § 4.4 — the `staff` schema and the optional `system_prompt` / `created_at` extension.

## 15. Workspace Concept (V2)

Starting in V2, a Workspace is a multi-owner shared container above individual desks. V1 desks are implicitly single-person workspaces. See ADR-010.

**Sketch (V2 detail in `docs/architecture/workspace.md` — to be written in V2 planning):**

- A workspace contains 1+ persons and 1+ desks (the members' desks plus any org-owned desks).
- **Shared deliverable space:** deliverables published to the workspace are visible to all members with appropriate permissions.
- **Shared connection registry:** workspace-level connections are visible to all members; members can send handoffs on behalf of the workspace.
- **Shared audit log:** workspace-level audit events are visible to workspace admins.
- **Workspace-internal assignment:** members can assign tasks to other members with lighter ceremony than cross-org handoffs (design of internal-vs-handoff distinction deferred to V2).
- **Private desk preserved:** each member retains their own private desk; the workspace is the shared layer above it, not a replacement.

**V1 contract:** one desk = one owner. Workspace is V2-only; no implementation in V1. Per ADR-015, the `myself` substrate no longer exists; owner manual work is in Today's personal queue.

**Relationship to ADR-002:** ADR-010 partially supersedes ADR-002 § Decision Part 2 ("one desk = one owner forever"). The "forever" clause is replaced by the workspace model for V2. ADR-002 Decision Part 1 (the `myself` rename) is unchanged.

## 16. Open Decisions

1. **Default cap value.** Currently 7. Should we allow the owner to set as low as 3 (very tight focus) or as high as 15 (org-style)? The 12 hard block is a value choice — could be loosened.
2. **Standard role library — exact list.** Eight roles proposed; is one missing (e.g., "Translator" for multilingual desks)? Is one redundant (e.g., should "Drafter" and "Communicator" be one role)?
3. **Cultivation profile schema specifics.** Is the flat structure right, or should it be hierarchical (per topic / per assignment-class)? Affects the inferred-vs-explicit boundary.
4. **Autonomy level granularity.** DECIDED (ADR-004, 2026-05-15): three levels (Supervised / Bounded / Autonomous). Inert is `staff.status: paused`. Dynamic behavior (auto-degrade in V1.x, suggestions in V2) per ADR-006.
5. **CLI executor security model.** What sandboxing is provided, or is it the owner's responsibility entirely? Affects whether CLI executors can be cross-desk via Core 2 (V2 question, but the structural decision is now).
6. **Cultivation portability.** Can a cultivation profile be exported and imported into a fresh staff on another desk? Useful but raises consent / privacy questions about what's in the profile.
7. **AI controller authentication.** How does an AI controller prove it has the owner's authorization? Token from the human? OAuth-style flow? Same as the desk-to-desk auth (V2)?
8. **Staff member cloning semantics.** When a staff is cloned, does the cultivation profile clone too? Probably yes. Does the past assignment history clone? Probably no (clone is a fresh worker with the same recipe).

## 17. Acceptance Criteria

This doc is implementation-ready for V1 when:

1. ✅ Flat-roster invariant is statable, justifiable, and structurally enforceable (DB + runtime + API)
2. ✅ The 1-to-7 rule is configurable with a clear default
3. ✅ Role library is enumerated; custom-role mechanism is specified
4. ✅ Substrate types are exhaustive (3) and mutually exclusive (per ADR-015: myself removed)
5. ✅ Cultivation profile schema is fielded (not vapor)
6. ✅ Autonomy slider has 6 named levels with semantics
7. ✅ Routing algorithm is described step-by-step
8. ✅ Mibusy carry-forward table is specific
9. ⬜ A new desk can be set up end-to-end and produce its first deliverable using only this doc + `runtime-adapter-interface.md` (verify in implementation pass)
10. ⬜ The cultivation feedback loop is observable: after 5 assignments with feedback, the staff produces measurably different output (verify in M1)
11. ⬜ Span-of-control cap is enforced at three layers (verify in M0 schema work)

# Design Requirement — Auto-Triage of Asks via Triage Skills

Date: 2026-05-19
Author: owner ↔ assistant design discussion (this web session)
Status: **design-requirement-proposed**
Target iteration: next available after storage (≥ iter-019)
Pickup by: Requirements Agent → iteration `requirements.md` + `plan.md`
Related: ADR-029 (coworker substrate), Engineering Rules #4 (no silent failure), #6 (owner-mediated authority), #7 (authority attenuation), #8 (audit completeness), iter-009 (skill catalog), iter-028 (per-staff Hermes sessions)

> Design-requirement-proposed handoff. Requirements Agent should expand into
> formal iteration requirements.md + plan.md, surface open questions back
> to owner, and propose ADR(s) for architectural decisions.

---

## 0. Context

Currently every Ask (mission inbound from a peer via Core 2) lands in the owner's mission inbox awaiting manual triage. Engineering Rule #6 enforces this — "no auto-accept" — to preserve owner-mediated authority.

In practice, many Asks are predictable and don't need per-occurrence owner judgment:
- Daily standup from team peer → always accept, assign to Sally
- Document review request from a trusted client → always accept, assign to Tom
- Generic outreach from unknown sender → always decline politely
- Anything marked urgent → always surface to owner with high priority

Forcing owner to manually decide each of these wastes the bottleneck (owner's attention). The owner direction (2026-05-19):

> "代办是不是我们的agent自己做个筛选, 自己能做的就做了, 先标记接下, 然后user设置处理(自动化), user可以设置自动化的规则"

Translation: The agent should auto-triage what it can; pre-mark accepted; user configures automation rules.

---

## 1. The Key Design Insight: **Triage rules ARE skills**

Initial design considered introducing a "triage rules" subsystem — new tables, new schema, new UI, new ADR. Owner refined (2026-05-19):

> "把规则写成skill, skill可以更新, 其他的按照你默认的走"

Translation: Write the rules as skills. Skills can be updated. Everything else follows your defaults.

**This collapses 80% of the design surface.** Triage rules become a new `kind` of skill, reusing:

| Existing infrastructure | What it gives us for free |
|---|---|
| `Skill` table + CRUD APIs | Storage, versioning, mutate-set persistence |
| `/skills` page UI | Rule management UI (no new page needed) |
| Skill cultivation flow | Improving rules over time via dialogue with Holon |
| Skill describe/direct creation | Rule creation via natural language ("any standup from team → Sally") or structured form |
| Skill testing / preview surface (iter-009) | "Show me what would happen to last 10 asks if I add this rule" |
| Built-in vs user-defined Skill distinction | Default rule pack ships as built-ins, owners override |
| Skill sharing (V1.x roadmap) | Rules become shareable just like any other skill |
| Audit events `skill.created/updated/deleted/invoked` | Triage audit comes free |

**Zero new tables. Zero new UI pages. Zero new concept for the owner to learn.**

---

## 2. Compatibility With Engineering Rules

### Rule #6 — Owner-Mediated Authority

The naive read is "auto-triage violates Rule #6." It does not, because:

- The owner exercises authority **at rule-definition time** (creating/editing/enabling the triage skill)
- The triage skill **acts on the owner's standing pre-authorization**, not on its own judgment
- This is exactly how real organizations work: "Boss to assistant: always book me on the 7am flight to Boston" — the assistant doesn't ask each time, but the boss is still the source of authority

Owner authority lives in the rule. Each invocation is the agent **executing pre-authorized behavior**, not making autonomous decisions.

### Rule #4 — No Silent Failure

Every triage decision (auto-accept / auto-decline / surface) must emit a visible audit event AND appear in the Asks UI with a badge showing what happened. Failed rule execution must surface with retry/manual-override option, never silently swallow.

### Rule #7 — Authority Attenuation

Triage skills run within the owner's authority scope — they can't grant authority the owner doesn't hold. Specifically: a triage skill that auto-accepts an Ask still attenuates to whatever the receiving staff member's scope is. A virtu with `read-only:gmail` can't get write access just because a triage rule routed an ask to it.

### Rule #8 — Audit Completeness (V1 post-emit)

Every triage decision emits `ask.triaged` audit event after the decision lands:

```typescript
{
  event: "ask.triaged",
  ask_id: AskId,
  triage_skill_id: SkillId,
  decision: "auto_accept" | "auto_decline" | "surface_to_owner",
  assigned_to?: StaffId,
  rule_match_reason: string,         // why this skill matched
  ts: ISO8601,
}
```

---

## 3. Architecture

### Triage skill — new `kind` on existing Skill model

```typescript
// Existing skill model gains a `kind` discriminator
type Skill = TaskSkill | TriageSkill;

interface TaskSkill {
  id: SkillId;
  kind: "task";                    // existing default
  name: string;
  description: string;
  system_prompt: string;
  tools: ToolId[];
  // ... existing fields
}

interface TriageSkill {
  id: SkillId;
  kind: "triage";                  // new
  name: string;
  description: string;
  priority: number;                // 0-100, higher runs first
  enabled: boolean;
  
  // The triage logic — same shape as TaskSkill's system_prompt, but
  // gets called with a specific Ask object and must return a TriageDecision
  system_prompt: string;
  
  // Optional deterministic pre-filter — if present, skill only runs
  // when these conditions match. Saves an LLM call for obvious cases.
  pre_filter?: {
    sender?: PeerId | "any" | "trusted_group:GroupId";
    type?: AskType;
    subject_contains?: string[];
    urgency?: "urgent" | "normal" | "low";
  };
  
  // Allowed decisions — owner can restrict a skill to certain decisions
  // (e.g., a paranoid owner could disable auto_decline entirely)
  allowed_decisions: Array<"auto_accept" | "auto_decline" | "surface_to_owner">;
}

interface TriageDecision {
  kind: "auto_accept" | "auto_decline" | "surface_to_owner" | "pass";
  assign_to?: StaffId;             // for auto_accept
  decline_reason?: string;         // for auto_decline
  surface_priority?: "high" | "normal";  // for surface_to_owner
  reasoning: string;               // why — for audit + transparency
}
```

`kind: "pass"` means "this skill doesn't apply, try the next one in priority order."

### Triage execution flow

```
Ask arrives via Core 2
   ↓
TriageDispatcher (new module, sits at Core 2 → Core 1 seam)
   ↓
Get all enabled triage skills, sorted by priority desc
   ↓
For each skill:
  ↓
  Run pre_filter (if present) → not match → next skill
  ↓
  Run skill system_prompt on the Ask → decision
  ↓
  If decision.kind == "pass" → next skill
  Else → execute decision, break
   ↓
If no skill decided → default: surface_to_owner (Rule #6 fallback)
   ↓
Emit ask.triaged audit event
   ↓
Ask state → {auto_accepted | auto_declined | pending_owner}
```

### Where in the codebase

```
packages/core/src/triage/
  triage-dispatcher.ts         — orchestrates skill execution per ask
  triage-skill-runtime.ts      — invokes a single triage skill via Hermes
  decision-types.ts            — TriageDecision, TriageReason types

packages/api-contract/src/
  skill.ts                     — add `kind` discriminator + TriageSkill type
  ask.ts                       — add triage_state, triage_skill_id, triage_decision fields

apps/web/app/api/v1/
  asks/[id]/triage/route.ts    — POST: manually re-trigger triage on an ask
  asks/[id]/undo-triage/route.ts — POST: revoke auto-action within window
```

---

## 4. Default Triage Skill Pack (built-ins shipped with Holon)

These ship as built-in skills (per existing `BUILTIN_SKILL_IDS` pattern from iter-009). Owners can disable, override, or extend.

| Skill name | Priority | Pre-filter | Decision logic |
|---|---|---|---|
| `triage-urgent-surface` | 95 | `urgency=urgent` | Always `surface_to_owner` with `priority=high` |
| `triage-from-untrusted-decline` | 80 | `sender=unknown` | If looks like spam/cold-outreach → `auto_decline` polite template; else `pass` |
| `triage-known-peer-accept-if-match-history` | 60 | `sender in trusted_peers` | Check history: if this peer regularly sends asks of this type that owner accepts → `auto_accept` with previously-used staff; else `pass` |
| `triage-fallback-surface` | 0 | (no filter) | Always `surface_to_owner` (safety net) |

Owners typically write **custom rules between priority 60 and 80** for their domain-specific patterns ("Daily standup from team Slack → Sally", "Wang doc review → Tom").

---

## 5. State Machine for Ask Lifecycle (extended)

Existing:
```
arrived → pending_owner → accepted | declined → in_progress → completed
```

Extended:
```
arrived
   ↓
triaging                             (TriageDispatcher running)
   ↓
   ├─ auto_accepted                  (triage skill decided accept)
   │    ↓
   │    [undo window: 5 min, configurable 1-30]
   │    ↓
   │    in_progress → completed
   │
   ├─ auto_declined                  (triage skill decided decline)
   │    ↓
   │    [undo window: 5 min]
   │    ↓
   │    declined (final, after window)
   │
   └─ pending_owner                  (surfaced — same as before)
        ↓
        accepted | declined → ... (existing)
```

**Undo window** is the safety hatch — Rule #4 (no silent failure) reinforced. Within window, owner can click "Undo auto-accept" on the Ask card and it goes back to pending_owner.

---

## 6. UI Surfaces

### `/skills` page — extend with Triage section

Skills list gets two sections (mirrors existing `yours` / `examples` pattern):

```
[Page header: Skills]

─── Yours ──────────────────────────
  TASK SKILLS                       (existing)
    + Reply to client emails
    + Summarize meetings
    ...
  TRIAGE RULES                      (new)
    + Wang document review → Tom
    + Daily standup → Sally
    + Spam decline auto-template

─── Examples ────────────────────────
  TASK SKILLS                       (existing)
    + summarize_inbox (built-in)
    + draft_email_reply (built-in)
  TRIAGE RULES                      (new)
    + triage-urgent-surface (built-in)
    + triage-fallback-surface (built-in)
    + triage-from-untrusted-decline (built-in)
```

Click on a triage rule → opens the skill detail page (existing UX) with extra fields for `priority`, `pre_filter`, `allowed_decisions`.

### Asks tab — show triage outcome on each card

Existing Ask card gains a small badge:

```
┌─────────────────────────────────────────────────────┐
│ 🤖 Auto-accepted by rule "Daily standup → Sally"   │
│    Decision made 2 min ago · [Undo]                 │
├─────────────────────────────────────────────────────┤
│ From: Wang Chen                                      │
│ Subject: Mon standup update needed                   │
│ Assigned to: Sally · 4h SLA                          │
└─────────────────────────────────────────────────────┘
```

Filter chips: `All` / `Auto-handled` / `Surfaced to me` / `Declined`.

### New rule via natural language (existing Skill describe flow)

Owner uses the existing "+ New skill" flow with kind=triage:

```
[+ New triage rule]
┌────────────────────────────────────────────────┐
│ ○ Describe in words   ● Set fields directly    │
│                                                 │
│ Describe what to auto-handle:                  │
│ ┌────────────────────────────────────────────┐ │
│ │ Any document review request from           │ │
│ │ Wang Chen, route to Tom and accept         │ │
│ │ automatically.                              │ │
│ └────────────────────────────────────────────┘ │
│                                                 │
│ [Create rule]                                  │
└────────────────────────────────────────────────┘
```

Under the hood: LLM (via `deepseek-json.ts`) parses to a `TriageSkill` JSON object, owner reviews/edits, saves.

---

## 7. Acceptance Criteria

1. ✅ A triage skill with `kind: "triage"` can be created via the `/skills` page (both describe + direct modes)
2. ✅ When an Ask arrives via Core 2, the TriageDispatcher runs enabled triage skills in priority order
3. ✅ A matching skill's decision is executed (auto_accept assigns to specified staff; auto_decline sends polite template; surface_to_owner sets pending_owner state)
4. ✅ Every triage decision emits an `ask.triaged` audit event with skill_id, decision, reason
5. ✅ The Asks tab card shows a triage badge for auto-handled asks
6. ✅ Within the undo window (default 5 min), the owner can click "Undo" and the ask returns to pending_owner
7. ✅ Built-in triage skills ship in the default fixture and can be disabled (but not hard-deleted, per existing skill pattern)
8. ✅ If no triage skill matches an Ask, it defaults to `pending_owner` (Rule #6 fallback preserved)
9. ✅ Triage skill execution failures are caught and emit `ask.triage_failed` audit event; ask falls through to `pending_owner` (Rule #4 — no silent failure)
10. ✅ Owner can see all enabled triage skills + their match counts in `/skills` page (visibility for tuning)

---

## 8. Open Questions (resolved per owner direction 2026-05-19)

Owner said "其他的按照你默认的走" — defaults from prior design discussion are accepted:

| Q | Resolution |
|---|---|
| Q1: Scope of auto-triage | **V1: peer-inbound Asks only**. Internal owner-self assignments not auto-triaged in V1. |
| Q2: Rule chaining | **V1: single layer**, no rule-triggers-rule. First match wins. |
| Q3: Auto-decline default posture | **Allowed but conservative**. Built-in spam-decline ships disabled by default; owner enables explicitly. |
| Q4: Undo window | **5 min default, configurable 1-30 min** via owner config. |
| Q5: Rule UI | **Reuse `/skills` page**, both describe (NL) and direct (JSON-ish form) modes inherited from existing skill creation. No new visual rule builder. |

---

## 9. Out of Scope for V1.x (deferred)

- ML-based triage learning (let AI learn rules from observed owner behavior) → V2
- Rule chaining / multi-step triage workflows → V2
- Triage rules for internal owner-self assignments → V2
- Per-peer rule scopes (rule only applies to specific peer) → can be done via `pre_filter.sender` in V1, full per-peer-scoped permissions in V2
- Triage skill sharing across desks (via Core 2) → tied to skill-sharing roadmap, V2
- Time-window rules ("auto-accept only during business hours") → V2

---

## 10. Spec Edits Implied (downstream tasks)

- `docs/architecture/data-model.md`: Add `kind` discriminator to skill table; add triage-specific fields; add ask `triage_state` enum and `triage_skill_id` foreign key
- `docs/architecture/local-agent-management.md`: New § on TriageDispatcher and where it sits in the Core 2 → Core 1 seam
- `docs/architecture/peer-communication-architecture.md`: Note that the Ask intake path now passes through TriageDispatcher before reaching the owner inbox
- `docs/architecture/handoff-taxonomy.md`: Clarify that auto-accept via triage skill is still owner-mediated (Rule #6 satisfied at rule-definition time)
- New ADR: "Triage rules are skills with `kind: 'triage'` — no separate subsystem"
- New audit event taxonomy in audit spec: `ask.triaged`, `ask.triage_failed`, `ask.triage_undone`

---

## 11. Phased Delivery Plan

| Phase | Scope | Time estimate |
|---|---|---|
| **V1.1** | Schema migration: add `kind` to skill, add `triage_state` to ask | 1 small iteration |
| **V1.2** | TriageDispatcher module + built-in triage skills + audit events | 1 iteration |
| **V1.3** | `/skills` page UI extension for triage skills (Triage Rules section) | 1 iteration |
| **V1.4** | Asks tab UI extension (triage badge + undo) + describe-mode NL rule creation | 1 iteration |
| **V1.5** | Tuning / preview ("what would have happened to last 10 asks") | 1 small iteration |
| **V2+** | ML-learned rules, chaining, internal-assignment triage, per-peer scopes | separate ADRs |

V1.1 is safely doable in parallel with the Storage V1.1 refactor — they touch different parts of the codebase.

---

## 12. Pickup Instructions for Requirements Agent

When you pick this up:

1. Read this doc + ADR-029 + iter-009 (skill catalog) + `docs/architecture/peer-communication-architecture.md` § Ask intake
2. Confirm Q1-Q5 resolutions still acceptable to owner (they were resolved in the discussion but worth a quick re-check)
3. Draft `requirements.md` for V1.1 (schema migration only — safest first step)
4. Draft ADR proposal: "Triage rules implemented as skills with kind=triage; no separate subsystem"
5. Plan V1.2 dependency on V1.1 being merged
6. Note in the iter plan: V1.1 storage refactor (from the storage design req) and V1.1 triage schema migration can ship in parallel — they don't touch the same files

---

## 13. Owner's Direct Quotes (context anchoring)

From 2026-05-19 design discussion:

> "那个代办是不是我们的agent自己做个筛选, 自己能做的就做了, 先标记接下, 然后user设置处理(自动化), user可以设置自动化的规则"

> "把规则写成skill, skill可以更新, 其他的按照你默认的走"

---

## 14. Why This Design Is Right (architecture critique applied)

1. **Reuses existing concepts** — no new "rule" concept for owner to learn, no new tables, no new UI page
2. **Skill versioning + cultivation come free** — rules improve over time the same way skills do
3. **Built-in + override pattern works** — built-in triage skills ship with sane defaults; owners override per existing Skill model
4. **Sharing roadmap aligned** — when skill sharing lands (V1.x), triage rules become shareable automatically
5. **Honors all 4 relevant Engineering Rules** — Rule #4 (visible decisions + undo), #6 (authority at rule-def time), #7 (attenuation preserved), #8 (audit per-decision)
6. **Minimal new code surface** — TriageDispatcher (~200 LOC) + schema migration (~50 LOC) + UI extensions reusing existing components (~150 LOC). Total ~400 LOC across V1.1-V1.4
7. **Safe defaults** — fallback always `surface_to_owner`; undo window catches mistakes; failure modes emit audit events

---

End of design requirement.

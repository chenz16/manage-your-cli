# Owner Config Service & `/me` Editing Surface

Status: draft (iter-007 step 4 implementation status)
Date: 2026-05-16
Author: Requirements Agent
Position: Sibling of `owner-assistant-tools.md`,
`worker-dispatcher.md`, and `admin-surfaces.md`. Documents the
read/write path that backs the `/me` page — the surface where the
owner edits their own `OwnerAssistant` record (name, role, intro,
system prompt, workspace, monthly budget, skills, upstream
connection). Sits under `local-agent-management.md` § 4.2 (the
`owner_assistant` role) and references the same schema
extension flagged in `owner-assistant-tools.md` § 10.9.

## 1. What This Doc Covers

The end-to-end path for owner-config reads and writes:

- the three-tier read model (fixture baseline + in-memory overrides
  + the V2 DB that does not yet exist)
- the PATCH allow-list and why structural fields are excluded from it
- the LLM-polish surface — which fields offer it, which do not, and why
- the `holon:reset` event protocol from the owner-config side (the
  browser-side event also covered by `owner-assistant-tools.md` § 11.2)
- the explicit "when does this graduate to a real DB" question

What this doc does NOT cover:

- The owner-assistant runtime / chat surface — see
  `owner-assistant-tools.md`.
- The admin reset endpoint itself — see `admin-surfaces.md` § 3.1.
- The LLM polish endpoint mechanics (token budget, model choice,
  failure modes) — see `admin-surfaces.md` § 3.3.
- The OwnerAssistant schema shape per se — that lives in
  `packages/api-contract/src/entities/owner-assistant.ts` and is
  ADR-flagged in `owner-assistant-tools.md` § 10.9.

## 2. Why Owner Config Needs Its Own Surface

`OwnerAssistant` is the desk's identity record. Every other staff
member is governed by the owner-creates-on-form flow in
`local-agent-management.md` § 6 — but the owner themselves has
nowhere else to land. Three reasons this deserves a doc entry rather
than being lumped under `local-agent-management.md`:

1. **It is the *only* staff record edited live in V1.** Every other
   staff record is fixture-baseline-only at this stage; only the
   owner's record has a PATCH path. The asymmetry needs a doc home.
2. **It is the first surface that gives an LLM write access to a
   first-class entity field.** The polish endpoint (`admin-surfaces.md`
   § 3.3) generates text; the user-accepts gate keeps it owner-
   mediated (Engineering Rule 6), but the surface is novel enough
   to spell out which fields are polish-eligible.
3. **The three-tier read model is reused elsewhere.** The fixture +
   mutable + (future) DB pattern matches `worker-dispatcher.md`
   § 4.3 (deliverables merge: mutable wins, then fixture).
   Documenting it once here gives us something to point at.

## 3. Three-Tier Read Model

```text
┌─────────────────────────────────────────────────────────────┐
│ Tier 1 — Fixture baseline                                   │
│ src/ui-mock/_shared/fixtures.snapshot.json                  │
│ Holds the seeded OwnerAssistant entry with defaults for     │
│ every optional field. Read-only at runtime; only changes    │
│ via fixture refresh.                                        │
└─────────────────────────────────────────────────────────────┘
                          ⊕  (mutable wins)
┌─────────────────────────────────────────────────────────────┐
│ Tier 2 — In-memory overrides                                │
│ packages/core/src/mutable-store.ts                          │
│   ownerOverrides: OwnerAssistantPatch                       │
│   getOwnerOverrides() / patchOwnerOverrides()               │
│ Process-scoped, globalThis-backed (same pattern as the      │
│ jobs Map and the ACP bridge). Evaporates on dev restart     │
│ AND on admin reset (clearMutableStore returns               │
│ owner_overrides_cleared).                                   │
└─────────────────────────────────────────────────────────────┘
                          ⊕  (future)
┌─────────────────────────────────────────────────────────────┐
│ Tier 3 — Real DB persistence (NOT YET)                      │
│ Open question — see § 6. Likely a row in a per-desk         │
│ owner_assistants table once packages/db lands.              │
└─────────────────────────────────────────────────────────────┘
```

Merge happens in `packages/core/src/owner-config-service.ts`:

| Function | Behaviour |
|---|---|
| `getOwner()` | Reads fixture, applies any keys in `mutable-store.ownerOverrides`, returns the merged shape. Field-level merge; nested objects (e.g. `skills`) are replaced wholesale per key, not deep-merged. |
| `updateOwner(patch)` | Validates the patch (allow-list — see § 4), then calls `patchOwnerOverrides(patch)`. Returns the post-merge owner record so callers can re-render without a second fetch. |

Both functions are exported from `@holon/core` so the BFF route
(`apps/web/app/api/v1/me/route.ts`) is a thin shell over them. Same
contract as `deliverables-service`, `members-service`, etc.

The merge ordering matters: **mutable wins** (consistent with
`worker-dispatcher.md` § 4.3). A cleared override on reset returns
the field to its fixture default; this is the *only* way to "undo"
an edit in V1.

## 4. PATCH Allow-List

`PATCH /api/v1/me` accepts a JSON body of `OwnerAssistantPatch`. The
route handler hard-codes an `ALLOWED_FIELDS` set; anything outside
it is silently dropped with a structured stdout warning (per
Engineering Rule 4 — surface, do not swallow). The allow-list:

| Field | Polishable? | Notes |
|---|---|---|
| `owner_name` | no | Identity string. Short, deterministic. |
| `owner_role` | no | Identity string. Short, deterministic. |
| `owner_intro` | **yes** | Multi-line bio / context paragraph. Prime polish candidate. |
| `system_prompt` | **yes** | Free-form persona / instructions. Multi-line. |
| `workspace_dir` | no | Path-like string. Polishing would corrupt syntax. |
| `monthly_budget_mc` | no | Numeric, USD↔millicents converted in the client. |
| `skills` | **yes** (per `body`) | Array of `{name, description, body}`. `name` is short / deterministic; `description` and `body` are polishable on a per-entry basis. |
| `upstream_connection_id` | no | Connection id; opaque. |
| `upstream_display_name` | no | Identity string for the upstream peer. |

Explicitly **excluded** from the allow-list (structural — these
encode invariants the owner is not allowed to mutate via this
surface):

| Excluded field | Why |
|---|---|
| `name` | The internal staff `name` field (distinct from `owner_name`). Renaming a staff record is a Core 1 concern that goes through the staff-edit form, not the owner-config PATCH — keeps the flat roster's identity stable (Engineering Rule 5). |
| `role_label` | Same reasoning — it is the canonical role string used by routing / persona prompts; changing it via the `/me` page would silently break worker dispatch (`worker-dispatcher.md` § 5.1 reads `role_label` to build the persona prefix). |
| `substrate` | Substrate is the runtime category (`local_ai`, `cli`, `peer`, `myself`). Changing substrate at runtime would re-categorise the owner record. ADR-013 + ADR-015 fix the owner's substrate; not editable here. |
| anything else | The allow-list is **whitelist**, not blacklist — any future schema addition has to opt in explicitly. |

The route emits a structured audit line on every accepted PATCH:

```
{ audit: "owner.config.patched", changed_keys: [...], ts }
```

Post-emit (per Engineering Rule 8 / ADR-007 V1 posture) — the audit
line writes after `patchOwnerOverrides` returns successfully. Error
paths (invalid body, allow-list violation) emit a parallel
`{ audit: "owner.config.patch_rejected", reason, … }` before
surfacing the 4xx to the caller.

## 5. LLM Polish Surface

The polish button (✨) on `/me` is a per-field affordance, not a
page-level one. Mechanics are documented in `admin-surfaces.md`
§ 3.3 (the endpoint); this section covers the **policy** — which
fields are polishable and why.

### 5.1 Polish-Eligible Fields

| Field | Hint passed to `/polish` |
|---|---|
| `owner_intro` | "owner bio / context — keep voice, fix grammar" |
| `system_prompt` | "system prompt for the desk AI — preserve all instructions, fix awkwardness" |
| `skills[*].description` | "short skill description — tighten without losing meaning" |
| `skills[*].body` | "skill body / playbook — clean up but do not add information" |

Pattern: every polishable field is **multi-line, free-form, user-
authored prose**. Identity strings (`owner_name`, `owner_role`,
`upstream_display_name`) are excluded because a one-token "polish"
risks corruption with no editorial upside.

### 5.2 Why Not Polishable

| Field | Reason |
|---|---|
| `owner_name`, `owner_role` | Short identity strings. The polish round-trip cost is not worth the risk of unintended rewording. |
| `workspace_dir` | Path string. An LLM polish could break shell syntax silently. |
| `monthly_budget_mc` | Numeric. Polishing nonsensical. |
| `upstream_connection_id`, `upstream_display_name` | Opaque; refer to a peer's identity, not the owner's prose. |
| `skills[*].name` | Short string — same reasoning as `owner_name`. |

### 5.3 The Polish Loop is Owner-Mediated

The `InlineField` component renders the polished result in-place but
does **not** auto-save. The owner sees the suggested text, accepts
(triggering the PATCH on blur) or rejects (reverts to the pre-polish
buffer). This is the Rule 6 (owner-mediated authority) gate on the
polish surface — an LLM produced the text but a human committed it.

Per `admin-surfaces.md` § 3.3, the polish endpoint itself does not
write any Holon state; the only state change is the subsequent
PATCH initiated by the owner. So the polish surface is a "read"
from Holon's perspective.

## 6. `holon:reset` Event Protocol — Owner-Config Side

The cross-cutting event is documented end-to-end in
`owner-assistant-tools.md` § 11.2 (browser-side). The
owner-config-specific behaviour:

| Action | Component | Effect on owner config |
|---|---|---|
| Dispatch `holon:reset` | `apps/web/app/me/_components/DebugControls.tsx` | Fired after `POST /api/v1/admin/reset` succeeds — server has already wiped `ownerOverrides`. |
| Listen for `holon:reset` | `apps/web/app/me/_components/MeClient.tsx` | Re-fetches `GET /api/v1/me`, which now returns the fixture baseline (since the overrides Map is empty). UI snaps back to defaults. |

The server side: `clearMutableStore()` in
`packages/core/src/mutable-store.ts` now returns
`owner_overrides_cleared: <bool>` alongside `jobs_cleared` and
`deliverables_cleared`. The admin reset response surfaces this so a
caller can confirm the wipe was complete.

This is the **only** mechanism in V1 that returns an edited
owner-config to its fixture defaults. There is no per-field "reset
to default" affordance. If that becomes a real need (e.g., the
owner polishes their system prompt into oblivion and wants the
original back), the right shape is probably a per-key
`DELETE /api/v1/me/:field` that removes the key from
`ownerOverrides` without touching the rest. Flagged as Open Q 6-A.

## 7. Engineering-Rule Alignment

| Rule | How this surface complies |
|------|----------------------------|
| **#1 Product state above runtime** | All owner-config state lives in `@holon/core`. The polish runtime (DeepSeek) only produces *suggested* text; the commit goes through the BFF PATCH path. |
| **#3 Specs are the contract** | The `OwnerAssistant` schema extension that this surface needs is **already flagged** as ADR-worthy (`owner-assistant-tools.md` § 10.9). Restated under § 8 below — this doc does not silently bless the new fields. |
| **#4 No silent failure** | Allow-list violations emit `owner.config.patch_rejected`. PATCH path returns explicit 4xx with reason. The polish endpoint's failures are surfaced per `admin-surfaces.md` § 3.3. |
| **#5 Flat-roster invariant** | `name`, `role_label`, `substrate` excluded from the allow-list — the owner cannot mutate the structural identity of their own staff record via this surface. |
| **#6 Owner-mediated authority** | The PATCH is initiated by the owner clicking blur on an `InlineField`. The polish surface is suggest-only; the owner accepts before save. No auto-commit. |
| **#8 Audit (V1 posture)** | `owner.config.patched` post-emit; `owner.config.patch_rejected` pre-emit on error. Diagnostic record per ADR-007. |
| **#10 Latency budgets** | The PATCH is a single in-process mutation against an in-memory Map; well within state-bridge budgets (see `owner-assistant-tools.md` § 7). Polish is a DeepSeek round-trip, dominated by the model, not bounded by this surface. |

## 8. Open Questions

6-A. **Per-field reset.** Today only the all-or-nothing
`clearMutableStore()` path returns a field to its fixture default.
A `DELETE /api/v1/me/:field` (or `PATCH` with a sentinel value)
would be cheap and would make the polish-then-regret loop
recoverable.

6-B. **When does owner-config graduate to a real DB?** The
in-memory `ownerOverrides` Map is fine while:

  - the desk is single-process (V1, desktop-Tauri per ADR-005), AND
  - the owner does not mind losing edits on dev-server restart, AND
  - admin reset is the intended way to "factory reset" the owner.

It becomes insufficient as soon as **any** of these flips:

  - V2 multi-process / multi-node deploy (each process has its own
    Map — owner edits on node A invisible to node B).
  - Owner edits need to survive a server restart (real product use).
  - Audit needs to show "what was the system_prompt when job X ran" —
    i.e., we want owner-config history, not just current value.

The natural V2 step is a row in a per-desk `owner_assistants`
table once `packages/db` lands. Same trigger as the chat-history
DB migration in `owner-assistant-tools.md` § 11.4 (Open Q 11-A);
likely both flips together.

6-C. **Schema-extension ADR is now urgent.** The fields this
surface edits (`owner_name`, `owner_role`, `owner_intro`,
`system_prompt`, `workspace_dir`, `monthly_budget_mc`, `skills`,
`upstream_*`) are not in `data-model.md` at all (verified by
`owner-assistant-tools.md` § 10.9). Each iteration that adds
read/write surfaces against these fields without an accepted ADR
deepens the spec drift. **This doc does not apply the schema
change — it restates the urgency.** Suggested ADR title (same as
§ 10.9): *"OwnerAssistant carries owner identity, persona, skills,
workspace, and budget."*

6-D. **Polish budget accounting.** Same gap as
`admin-surfaces.md` § 7 Open Q 3 — the polish endpoint does not
consult `monthly_budget_mc`. Worth flagging here because the
owner-config surface is precisely where `monthly_budget_mc` is
visible and editable. The integration loop is small: PATCH side
already knows the budget; polish side could check the same
override on each call.

6-E. **Skill body length.** `skills[*].body` is unbounded text
today. A polish round-trip on a 50 kB body is a slow, expensive
DeepSeek call. Either cap the polish input size (with UI feedback)
or move skill bodies to a separate `/skills/:id` editor surface
where length is a first-class concern.

## 8.5 Runtime-Fault Hardening (Appended 2026-05-16, post-tester run #2)

The "config edit survives a brittle runtime" promise of this surface
turned out to have two implicit assumptions that the iter-007 human
tester broke in practice. Both are now hardened. Recorded here
(rather than in `owner-assistant-tools.md`) because both faults
manifested **on the `/me` edit path** — the user was mid-edit, the
runtime hiccupped, the PATCH double-fired or the bridge died.
Engineering Rule 4 (no silent failure) requires that these surface
rather than be swallowed; the retry / dedupe is *the* no-silent-
failure path here, not a `try/catch` swallow.

### 8.5.1 PATCH Double-Fire Dedupe

**Symptom.** Tester report: "every click-outside fires PATCH twice."
The `InlineField` had two save triggers competing:

1. The textarea's native `onBlur` (fires when the field loses focus).
2. A document-level `mousedown` outside-click handler (catches clicks
   that don't naturally blur the textarea, e.g., on chrome).

When the user click-outside-blurred, both fired, producing identical
back-to-back PATCH requests. Server accepted both — the second was a
no-op merge against the first, but the audit line
(`owner.config.patched`) doubled, polluting the diagnostic record.

**Fix.** `apps/web/app/me/_components/InlineField.tsx` introduces
`suppressBlurRef`. The outside-click handler is the single canonical
save trigger; before it calls `commit()`, it sets `suppressBlurRef =
true`. The native `onBlur` checks the flag and short-circuits. The
ref is reset on `startEdit`. Same guard added to the single-line
`<input>` for parity.

This is a UI-layer fix, not a route-layer fix — the route remains
idempotent (a no-op merge is harmless), but the audit-completeness
posture (Rule 8) cares about one mutation = one audit line. Two
audit lines for one user action is a diagnostic-record bug.

### 8.5.2 Hermes Bridge EPIPE Auto-Respawn

**Symptom.** The ACP subprocess (`uv run hermes acp`) can die or
have its stdin pipe close out from under the BFF — observed when
the user reset mid-stream, when the subprocess crashed on a bad
prompt, or when a long-idle pipe was reaped. The next `promptOwner`
call would throw EPIPE / "write after end" / "ACP connection
closed" / "not connected" and crash the Node process (the EPIPE on
a dead pipe was an uncaught error on `proc.stdin`).

**Fix.** `apps/web/lib/hermes-acp-client.ts`:

- `promptOwner` is now `promptOwnerWithRetry(text, onUpdate, signal,
  attempt)`. Before the call, it inspects `G_STATE.bridge`; if
  `process.exitCode !== null` the stale handle is cleared and a
  fresh spawn happens on next access.
- Catch block classifies EPIPE / "write after end" / "ACP connection
  closed" / "not connected" as **transient** (Engineering Rule 4
  taxonomy: transient runtime, not user error) and retries **once**
  with a fresh spawn. A second failure surfaces to the caller.
- `proc.stdin.on('error', …)` registered so an EPIPE on the dead
  pipe does not bubble as an uncaught process-level exception.

This is *exactly* the no-silent-failure path Engineering Rule 4
requires: the runtime fault is classified, the recovery is
bounded (one retry), and a second failure surfaces to the caller
with the underlying error class preserved. There is no bare
`try/catch` — every catch arm either retries with classification
or rethrows with context.

**Why this belongs in the owner-config doc.** The `/me` page is
not the only consumer of the bridge — `/chat` is the primary one —
but `/me` is the surface where the user does *editing* work that
they would lose if the bridge died mid-PATCH. The PATCH itself
does not go through the bridge (it's a direct BFF route), but the
polish surface does: a polish call mid-edit would have crashed the
session and lost the user's draft. The retry preserves the edit.

**Cross-ref:** the bridge wiring itself is documented in
`owner-assistant-tools.md` § 10, and the retry mechanics are
restated there as a "Hermes bridge fault recovery" subsection.

### 8.5.3 New Open Questions

6-F. **Retry budget is one — is that enough?** A single retry
catches the common case (subprocess died between requests). It
does not catch a flapping bridge (dies, respawns, dies again on
next prompt). The right next move is probably an exponential
backoff with a max of 3 attempts and a circuit-breaker that
surfaces a permanent failure to the UI after the breaker trips.
V1 single-user dev posture probably does not need this; flag for
V2.

6-G. **Dedupe is UI-side only.** The route remains permissive
(any number of identical PATCHes succeed). A future multi-tab
scenario (the user editing the same field in two tabs) would
benefit from an `If-Match`-style etag header or a server-side
"identical PATCH within N ms ⇒ no-op + no audit" rule. Open
question: where should the dedupe canonically live — UI, route,
or both?

## 9. Cross-References

- `owner-assistant-tools.md` § 10.9 — same OwnerAssistant
  schema-extension flag, from the agent-tools side
- `owner-assistant-tools.md` § 11 — chat-persistence three-layer
  stack (sibling; shares `holon:reset` protocol)
- `owner-assistant-tools.md` § 5.5 — **staff CRUD tool surface (per
  ADR-019).** Same `mutable-store + fixture-merge + overrides`
  pattern as this doc: chat-created staff rows (`dynamicStaff` Map),
  field-level patches (`staffOverrides` Map), and dismissed
  tombstones (`dismissedStaffIds` Set) layer on top of the fixture
  baseline exactly the way `ownerOverrides` layers on top of the
  fixture OwnerAssistant entry here.
- `local-agent-management.md` § 14.6 — narrative side of the same
  staff CRUD surface (the ADR-019 canonical home).
- `admin-surfaces.md` § 3.1 — `/api/v1/admin/reset` (server side of
  the holon:reset event)
- `admin-surfaces.md` § 3.3 — `/api/v1/admin/polish` endpoint
  mechanics (this doc covers policy, that doc covers mechanics)
- `worker-dispatcher.md` § 4.3 — same mutable-wins merge pattern;
  § 5.1 reads `role_label` (why it's excluded from PATCH)
- `local-agent-management.md` § 4.2 — `owner_assistant` role; § 6 —
  staff creation flow (the parallel form-based path for *other* staff)
- `data-model.md` § 4.4.3 — the canonical write-up of the
  mutable-store layering convention this surface and the staff CRUD
  surface (ADR-019) both use.
- `data-model.md` — canonical schema home that *should* gain an
  `OwnerAssistant` subsection per Open Q 6-C
- ADR-007 — V1 audit posture; ADR-013 — chat surface as Hermes loop;
  ADR-015 — `myself` substrate (why `substrate` is excluded from PATCH);
  ADR-019 — runtime staff CRUD via chat (sibling surface using the
  same mutable-store + overrides pattern).
- Implementation: `packages/core/src/owner-config-service.ts`,
  `packages/core/src/mutable-store.ts`, `apps/web/app/api/v1/me/route.ts`,
  `apps/web/app/me/page.tsx` + `_components/{MeClient,InlineField,DebugControls}.tsx`

## 10. /members Hire & Dismiss UI — Same BFF, Different Surface (iter-008 phase 3)

iter-008 phase 3 added a `+ Hire` button + per-card dismiss `×` on
the /members page (`apps/web/app/members/_components/HireDialog.tsx`
+ `MembersClient.tsx`). The implementation is a **thin UI wrapper
over the exact same BFF endpoints the chat-CRUD path (ADR-019) uses**.
This section documents the consistency story so the next reader does
not mistake them for parallel implementations.

| Action | /members UI calls | Chat path calls (per ADR-019) | Same? |
|---|---|---|---|
| Mint a `local_ai` staff | `POST /api/v1/staff` (after `POST /api/v1/admin/polish` in `mode: 'generate'` to draft `{name, role_label, system_prompt}` from a one-sentence sketch) | `POST /api/v1/staff` (via `create_staff` tool) | Yes — same endpoint, same allow-list, same `staff.created` audit line, same flat-roster invariant (Rule 5 — `desk_id = fx.primary_desk_id` always). |
| Dismiss a `local_ai` staff | `DELETE /api/v1/staff/{id}` (dismiss `×` on the card; per-substrate gate: only rendered on `local_ai` cards — peer/cli/owner_assistant are immune) | `DELETE /api/v1/staff/{id}` (via `dismiss_staff` tool) | Yes — same endpoint, same soft-tombstone semantics (`dismissedStaffIds` Set), same `staff.dismissed` audit line. |
| Edit fields | not yet exposed on /members (V1) | `PATCH /api/v1/staff/{id}` (via `update_staff` tool) | N/A — only chat has edit today; /members add is straightforward when needed. |

Three implications worth recording (consistency is load-bearing):

- **One source of truth, two access modes.** Same shape as ADR-021's
  `cli_exec` vs xterm split for the CLI substrate — the underlying
  service contract is single, the access paths are multiple. The
  /members UI is the "I want a form" surface; chat is the "I want a
  conversation" surface. Both bottom out in `staff-management-service`
  + the mutable-store layering (per ADR-019 / § 9 cross-ref above).
- **Polish is a /members-only step today, not a chat step.** The
  /members "Hire" modal calls `/admin/polish` in `mode: 'generate'` to
  turn a one-sentence sketch into a `{name, role_label, system_prompt}`
  draft the owner reviews before submit. The chat `create_staff` path
  has no equivalent — the owner names the role and persona in the
  chat turn itself (per ADR-019 § "Decision"). Both satisfy Engineering
  Rule 6 (owner-mediated authority): in /members the owner reviews the
  draft before clicking Hire; in chat the owner authors the request
  itself.
- **Per-substrate dismiss gating happens in the UI, but the BFF is
  the canonical guard.** The `×` button is conditionally rendered
  (only on `local_ai` cards), but the `DELETE` endpoint independently
  rejects non-`local_ai` with HTTP 400. Engineering Rule 4 (no silent
  failure) requires the server-side check; the UI rendering is a UX
  affordance, not a security boundary.

Cross-ref: `owner-assistant-tools.md` § 5.5 (chat-side tool catalogue),
`local-agent-management.md` § 14.6 (canonical narrative home), ADR-019
(the decision record that opened the path), ADR-021 (the same
"one substrate, two access modes" pattern applied to CLI).


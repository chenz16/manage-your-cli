# Owner Assistant Runtime & Tool Surface

> **Status: Superseded (moved to `legacy/` 2026-05-30).** This doc
> describes the Hermes-runtime owner-assistant design used in the
> sister repo `holon-engineering`. `manage-your-cli` replaced the
> Hermes runtime with a direct multi-CLI adapter; the live owner-facing
> Secretary is implemented as a warm CLI process — see
> [`docs/architecture/README.md`](../README.md),
> [`apps/web/lib/warm-agent.ts`](../../../apps/web/lib/warm-agent.ts),
> and [`packages/holon-mcp`](../../../packages/holon-mcp). For the
> live tool surface, see the Holon MCP server (`list_live_agents`,
> `dispatch`, `read_agent_output`, `create_agent`, `retire_agent`,
> `read_memory`, `write_memory`). This doc is retained for design
> lineage only.

Status: draft (iter-007 in progress)
Date: 2026-05-16
Author: Requirements Agent
Position: Sub-doc of Core 1 (Local Agent Management). Specifies the runtime
configuration and tool surface for the `owner_assistant` member introduced by
ADR-013. Below `local-agent-management.md` § 4.2 (role definition); above
`runtime-adapter-interface.md` (the contract `owner_assistant` runs through).

## 1. What This Doc Covers

The shape of the owner-assistant runtime — the chat surface at `/` that is the
owner's primary control loop over their desk. Specifically:

- the two-tier agent model (owner / desk AI vs. workers) that we are committing
  to as the operating posture
- the bundled Hermes runtime configuration for `owner_assistant`
- the custom tool surface (`holon-owner` plugin) and how it sits next to
  Hermes's built-in `delegate_task`
- per-tool parameter shapes, backing BFF endpoints, side effects, and
  audit-emit posture
- authority & safety properties (Engineering Rules 1, 2, 5, 6)
- the latency budget for state-bridge tools

What this doc does NOT cover:

- the worker (Aria, Drafter, gh-cli, etc.) tool scopes — those follow the
  substrate-defined `tool_scope` in `local-agent-management.md` § 5.1
- the BFF's own implementation of the backing endpoints — see the
  `packages/api-contract` schemas + the BFF service code
- the wider runtime contract — `runtime-adapter-interface.md` is canonical
- the chat UI itself — `ui-architecture.md` § 5.6 covers the panel; ADR-013
  is the architectural decision record

## 2. Context & Motivation

### 2.1 Why a Custom Tool Surface

ADR-013 established that the chat surface is "Hermes's `AIAgent` loop exposed
as UI" — no new architectural primitive, no conversations table, just a
long-running runtime job. ADR-013 § 3 listed `create_assignment`,
`list_missions`, `get_member_status`, `ping_peer`, `view_deliverable` as
example tools but left the actual list as a Dev concern. This doc fills that
gap.

The tools are necessary because a generic Hermes loop has no concept of
Holon-product state. It does not know what staff exist on this desk, what
missions are in the inbox, or what connections are paired. Without
Holon-aware tools, the owner-assistant cannot answer "show me all blocked
missions" or "who's idle right now?" — the core ADR-013 use cases.

### 2.2 Why Research-and-Delegate, Not Do

Per user directive 2026-05-16, the owner-assistant is positioned as a
**research-and-delegate** agent, not as a heavy executor. Concretely:

- The owner-assistant **reads** Holon state, **plans** with the owner, and
  **dispatches** work to workers. It does not, itself, run long analytical
  jobs, write deliverables, or call external services.
- Workers (every other staff member: Aria, Drafter, gh-cli, peers, etc.) do
  the heavy execution. They are spawned through Hermes's built-in
  `delegate_task` mechanism — the owner-assistant invokes that tool with a
  brief, and Hermes spawns a sub-agent.

This is the **two-tier agent model**:

```
┌─────────────────────────────────────────────────────────┐
│  Tier 1: Owner / desk AI  (this doc)                    │
│  - Substrate: local_ai (Hermes + DeepSeek)              │
│  - Role: owner_assistant                                │
│  - Tools: state bridges + delegate_task                 │
│  - Posture: research, plan, dispatch                    │
└────────────────┬────────────────────────────────────────┘
                 │  delegate_task(brief, …)
                 ▼
┌─────────────────────────────────────────────────────────┐
│  Tier 2: Workers  (governed by local-agent-management)  │
│  - Substrates: local_ai | cli | peer                    │
│  - Roles: researcher, drafter, executor, peer mirrors…  │
│  - Tools: per-staff substrate.tool_scope                │
│  - Posture: do one bounded job, return a deliverable    │
└─────────────────────────────────────────────────────────┘
```

This matches Engineering Rule 1 (`product state lives above the runtime`):
the owner-assistant's tools are explicitly state-bridges, not state-owners.
Holon's BFF remains the source of truth for what staff/missions/connections
exist; the owner-assistant queries through it, never around it.

### 2.3 Smoke Result That Justifies This Spec

(2026-05-16, just landed) — an owner-assistant configured against DeepSeek
successfully called Hermes's bundled `delegate_task` tool to spawn a
sub-Hermes instance, which executed and returned a string. This proves the
Tier-1 → Tier-2 spawn loop works end-to-end **before** any custom
state-bridge tool is wired up. The custom-tool work in iter-007 is purely
additive: state reads, log-only state writes, and (deferred) research.

## 3. Architecture Overview

```text
┌───────────────────┐
│ Chat UI (app /)   │  React, Tauri shell, slide-out right panel per ADR-013
└────────┬──────────┘
         │  POST /api/v1/chat/threads/:id/messages   (per api-contract/chat.ts)
         ▼
┌───────────────────────────────────────────────────────────────────┐
│ BFF chat stream                                                   │
│ - Maintains one long-running RuntimeJobHandle per chat session    │
│ - Multiplexes user messages into the Hermes loop as turns         │
│ - Streams output_delta / tool_call_* events back to the UI        │
└────────┬──────────────────────────────────────────────────────────┘
         │  RuntimeAdapter.start() / inject-turn  (per runtime-adapter-interface.md)
         ▼
┌───────────────────────────────────────────────────────────────────┐
│ Hermes owner-agent  (substrate: local_ai)                         │
│ - Provider: deepseek / deepseek-chat                              │
│ - Plugins: deepseek-provider, holon-owner, hermes core            │
│ - Tools allow-list:                                               │
│     [state-bridges] list_staff, query_staff, list_connections,    │
│                    list_missions, list_deliverables,              │
│                    assign_to_staff, dispatch_handoff              │
│     [worker spawn] delegate_task   (Hermes built-in)              │
│     [research v2]  web_search      (deferred)                     │
└─────┬──────────────────────────────────────────────┬──────────────┘
      │                                              │
      │ HTTP localhost                               │ delegate_task
      ▼                                              ▼
┌──────────────────────────┐         ┌──────────────────────────────┐
│ Holon BFF state API      │         │ Sub-Hermes worker            │
│ http://localhost:3000/   │         │ (one-shot AIAgent loop;      │
│  api/v1/{staff,missions, │         │  substrate-dependent tool    │
│         connections,…}   │         │  scope — see Open Q #1)      │
└──────────────────────────┘         └──────────────────────────────┘
```

Three boundaries hold:

1. **Owner-assistant → BFF**: HTTP, localhost, single-digit-ms target.
   The owner-assistant has no direct DB access; all state reads/writes go
   through the typed BFF endpoints in `packages/api-contract/src/endpoints/`.
2. **Owner-assistant → workers**: Hermes-internal via `delegate_task`. No
   new wire protocol. Sub-agent's deliverable returns inline as the tool's
   result string (V1) — richer return path is Open Question #3.
3. **Workers → Core 2**: only via the existing Core-2 four-crossing seam.
   The owner-assistant is allowed to *queue* a handoff to the outbox
   (`dispatch_handoff`), but it cannot send on-wire — that is gated by
   owner approval per Engineering Rule 6.

## 4. Runtime Configuration

### 4.1 Hermes Vendoring

Hermes v0.13.0 (Nous Research) is vendored under `deps/hermes/`. Plugins are
loaded from `$HERMES_HOME/plugins/`. The owner-assistant runs as a standard
Hermes `AIAgent` loop with no custom Hermes patches — only plugins.

### 4.2 Model Provider

| Field | Value |
|---|---|
| Provider plugin | `deepseek` (bundled at `deps/hermes/plugins/model-providers/deepseek/`) |
| Model id | `deepseek-chat` |
| API key source | `.env` at repo root, `DEEPSEEK_API_KEY` |
| BYOK posture (ADR-011) | Holds: key is loaded from local config, never transmitted to relay, never written to handoff packets |

Provider choice is a desk-level config concern, not part of this doc's
contract. Any provider for which a Hermes plugin exists may be substituted;
the tool surface is provider-agnostic.

### 4.3 Plugin Layout

```
packages/hermes-plugin-holon-owner/
├── plugin.yaml          # name: holon-owner; requires_env: [HOLON_BFF_BASE_URL]
├── schemas.py           # tool JSON-schemas (one dict per tool)
├── __init__.py          # register(ctx) hook — registers tools with Hermes
└── tools.py             # handler functions: HTTP calls into the BFF
```

The plugin sits in the pnpm workspace as a sibling to `packages/core` and
`packages/api-contract`, but it is a pure Python package. Hermes loads it
via a symlink from `$HERMES_HOME/plugins/holon-owner` → this directory.
This keeps the plugin source under repo-root tooling (lint, CI) while
respecting Hermes's plugin discovery convention.

### 4.4 What Lives In TypeScript vs Python

| Layer | Language | Why |
|---|---|---|
| BFF endpoints (`api-contract` + service) | TypeScript | Existing Core 1 / Core 2 codebase |
| Tool schemas | Python (Hermes convention) | Hermes loads schemas as Python dicts |
| Tool handlers | Python | They run inside the Hermes process |
| Owner-assistant orchestration | Python (Hermes) | The runtime is Python |
| Chat UI | TypeScript (React) | App shell |

This is a clean seam: Python tools call TypeScript BFF over localhost HTTP.
No shared in-process types, no FFI.

## 5. Tool Catalogue

All state-bridge tools target the local BFF at
`${HOLON_BFF_BASE_URL}/api/v1/...` (default `http://localhost:3000`). Each
tool's parameter schema is the canonical source; the table below summarises.

**Catalogue size (updated 2026-05-16, iter-008 phases 2 + 4):** the custom
`holon-owner` tool surface has grown from **7 → 10 → 12** entries. The
original seven (5 reads in § 5.1 + 2 writes in § 5.2) were joined by three
roster-CRUD tools (ADR-019, § 5.5), and now by two more in iter-008:
`list_recent_jobs` (read; § 5.6) closes the work-feedback loop so the
secretary can answer "is X done yet?", and `cli_exec` (write; § 5.7) lets
the secretary fire one-shot commands into a CLI staff's tmux session
without opening the interactive xterm panel (ADR-020 + ADR-021).
`delegate_task` (Hermes built-in) remains a separate, non-custom entry
per § 5.3 and is not counted in the 7 / 10 / 12 tally. The two research
tools in § 5.4 are still deferred.

### 5.1 State Reads

| Tool | Backing endpoint | Parameters | Returns |
|---|---|---|---|
| `list_staff` | `GET /api/v1/staff` | `{}` | `{ items: Staff[] }` — flat roster |
| `query_staff` | `GET /api/v1/staff/{id}` | `{ staff_id: string }` | `{ staff: Staff }` — full profile |
| `list_connections` | `GET /api/v1/connections` | `{}` | `{ items: Connection[], summary: {…} }` |
| `list_missions` | `GET /api/v1/missions?state=…` | `{ status?: "proposed" \| "accepted" \| "in_progress" \| "blocked" \| "completed" }` | `{ items: Mission[], next_cursor }` |
| `list_deliverables` | `GET /api/v1/deliverables` | `{}` | `{ items: Deliverable[], next_cursor }` |

Side effect: none. Audit-emit: none in V1 (reads are not audited per
`functional-architecture.md` § 7.5 — only state mutations are). Latency
budget: see § 7.

Note on tool-name vs endpoint-name skew: the BFF endpoint for missions uses
the query parameter `state` (per `inbound.ts`), while the tool schema in
`packages/hermes-plugin-holon-owner/schemas.py` uses `status`. The tool
handler is responsible for mapping `status → state`. Flagged as a small
inconsistency, not a blocker; harmonising in iter-008+ is fine.

### 5.2 State Writes (Log-Only in V1)

| Tool | Backing endpoint | Parameters | Side effect (V1) | Audit |
|---|---|---|---|---|
| `assign_to_staff` | (V1) write to a local "owner-assistant log" table; (V2) `POST /api/v1/assignments` | `{ staff_id: string, brief: string }` | Records intent; **does not auto-execute the assignment**. The owner reviews the queued assignment in the UI and explicitly runs it. | Post-emit `owner_assistant_assignment_queued` (per ADR-007) |
| `dispatch_handoff` | (V1) write to local outbox table; (V2) wired into Core 2 send path | `{ connection_id: string, brief: string }` | Lands in outbox; **does not send on-wire**. Owner reviews and approves before peer delivery. | Post-emit `owner_assistant_handoff_queued` |

These two tools are the load-bearing safety surface of this spec. Both
**queue** work; neither **executes** work. See § 6.

### 5.3 Worker Spawn (Hermes Built-In)

The owner-assistant invokes Hermes's built-in `delegate_task` to spawn a
worker. No new tool is registered for this; it is part of the Hermes core
toolset.

```
delegate_task(
  task: string,           # the brief
  context?: string,       # additional context
  agent_profile?: string  # which sub-agent profile to spawn (Open Q #1)
) -> string               # the sub-agent's final response
```

Side effect: spawns an in-process sub-Hermes `AIAgent` loop. Returns when
that loop terminates (DeliverableEvent or ErrorEvent in `RuntimeEvent`
terms). The return value is a string — the sub-agent's final text. V1
deliverable-return semantics are Open Question #3.

Audit: the spawn is logged by Hermes's own observability plugin; whether it
also writes a Holon audit row (so the BFF can show "owner_assistant
delegated to sub-agent X") is Open Question #4.

### 5.4 Research Tools (Deferred)

| Tool | Status | Note |
|---|---|---|
| `web_search` | Deferred to v2 | Owner-assistant must research outside of Holon state to do "find a good Researcher for this topic" style queries. v1 falls back to the owner pasting context into chat. |
| `read_url` | Deferred to v2 | Pair with `web_search`. |

These are flagged here so consumers of this doc know the v1 owner-assistant
is **state-aware but world-blind**. It can see your desk; it cannot see the
internet. Use `delegate_task` to spawn a worker (e.g., a Researcher with a
`web_search` tool scope) when the owner needs external research.

### 5.5 Roster CRUD (per ADR-019)

Added in iter-007 step 7 — three tools that let the owner mint, edit, and
dismiss `local_ai` staff from chat. The canonical narrative lives in
`local-agent-management.md` § 14.6; this section is the protocol summary.

| Tool | Backing endpoint | Required input | Whitelisted fields | Audit (post-emit per ADR-007) |
|---|---|---|---|---|
| `create_staff` | `POST /api/v1/staff` | `name`, `role_label`, `system_prompt` | `name`, `role_label`, `role_name?`, `system_prompt?`, `max_concurrent_jobs?`, `agent_profile_id?`, `tool_scope?` | `staff.created` |
| `update_staff` | `PATCH /api/v1/staff/{id}` | `staff_id` + at least one editable field | `name`, `role_label`, `role_name`, `status`, `system_prompt`, `autonomy_level`, `governance_mode`, `max_concurrent_jobs` | `staff.updated` |
| `dismiss_staff` | `DELETE /api/v1/staff/{id}` | `staff_id` | — (soft tombstone) | `staff.dismissed` |

Side effects:

- `create_staff` mints a `staff_<uuidv7>` id, applies PII-free defaults
  (substrate=`local_ai`, autonomy=`Supervised`, governance=`graduated`,
  status=`active`, `agent_profile_id="hermes_profile_generic_v1"`,
  `tool_scope=["web_search","read_file"]`), and inserts into the BFF's
  `dynamicStaff` Map. Always sets `desk_id = fx.primary_desk_id` —
  Engineering Rule 5 (flat-roster invariant).
- `update_staff` merges the patch into the BFF's `staffOverrides` Map
  (field-level overlay; mutable wins, same pattern as
  `owner-config-service.md` § 3). The patch does not touch fixture rows.
- `dismiss_staff` adds the id to the BFF's `dismissedStaffIds` Set
  (soft-delete tombstone). The merged read path
  (`listStaffMerged` / `getStaffMerged`) hides dismissed rows. Returns
  HTTP 400 for non-`local_ai` substrates, HTTP 404 for missing or
  already-dismissed ids. The `local_ai`-only restriction is documented
  in § 14.6 of `local-agent-management.md` and flagged as an open
  question.

Status semantics: `update_staff` accepts the constrained set
`active | paused | retired` (chat-surface tombstone uses the dismiss
path, not `status=archived`).

Engineering-rule alignment (see § 14.6 of `local-agent-management.md`
for the full table): Rule 1 (state above runtime — Holon BFF owns the
roster; Hermes only executes), Rule 4 (no silent failure — every CRUD
path returns `{error: msg}` JSON plus a structured `audit` line on
success), Rule 5 (flat-roster invariant — `create_staff` always sets
`desk_id = fx.primary_desk_id`), Rule 6 (owner-mediated authority —
the three tools are only registered on the owner desk-AI's `hermes-acp`
session; no external path exposes them), Rule 8 (audit emit after
state change — post-emit per ADR-007 V1 posture), Rule 11 (PII-free
defaults per ADR-018).

Latency: same budget class as § 5.2 writes (≤ 20 ms p50, ≤ 80 ms p95,
≤ 150 ms p99) — single in-process Map mutation + structured stdout audit.

End-to-end verified (manual smoke, 2026-05-16): "请用 create_staff 帮我
招一个市场分析师" → assistant called `create_staff`, BFF minted a
`staff_<uuidv7>` row, `/members` count went 3 → 4; subsequent
`update_staff` flipped status/max_jobs; `dismiss_staff` removed from
list (4 → 3).

### 5.6 Work Feedback Loop — `list_recent_jobs` (iter-008 phase 2)

Closes the visibility gap that opened the moment `assign_to_staff` started
queueing real worker runs (see `worker-dispatcher.md` § 3 lifecycle). Before
this tool, the secretary could queue work but had no way to answer the
owner's follow-up "搞完了么?" / "is X done yet?" without the owner
switching to `/today` or `/deliverables` themselves.

| Tool | Backing endpoint | Parameters | Returns |
|---|---|---|---|
| `list_recent_jobs` | `GET /api/v1/jobs` (client-side filtered) | `{ staff_id?: string, status?: "queued" \| "running" \| "completed" \| "failed", limit?: number (default 10) }` | `{ items: Job[] }` — newest-first, capped at `limit` |

Side effect: none. Audit-emit: none (read tool). Latency budget: same as
§ 5.1 reads (≤ 5 ms p50). The tool handler delegates filtering to the
plugin (the BFF endpoint returns all jobs unfiltered) — the filter is
cheap; pushing it into the BFF is iter-009 territory.

System-prompt wiring (`src/ui-mock/_shared/fixtures.snapshot.json`,
`owner_assistant.system_prompt`) adds a "Follow-up queries" section
telling the secretary to call `list_recent_jobs` on status-check phrasings.
Together with the `/today` `<JobsSection />` (poll every 4 s, surfaces up
to 8 rows with status badges + deliverable links), this is the V1
feedback loop. See `worker-dispatcher.md` § 7 for the matching
observability surface.

Engineering-rule alignment: Rule 1 (Holon BFF owns the jobs table; the
secretary reads through, never invents jobs), Rule 10 (latency — read
is in-process Map scan; UI poll interval 4 s is the SLO).

### 5.7 CLI One-Shot — `cli_exec` (iter-008 phase 4, per ADR-021)

Pairs with the interactive xterm panel covered in `cli-passthrough.md`.
Two modes coexist on the same underlying tmux session: the owner uses
the interactive panel (`/cli <name>` slash or `+ Hire`-adjacent "open
terminal" affordance on /members) for live work; the secretary uses
`cli_exec` for one-shot commands (`@gh-cli pr list`, `@local-bash df
-h`) that need to come back as text in the chat bubble. See ADR-021
for the trade-off.

| Tool | Backing endpoint | Parameters | Returns |
|---|---|---|---|
| `cli_exec` | `POST /api/v1/staff/{id}/cli/exec` | `{ staff_id: string, command: string, wait_ms?: number (default 2500, max 30000) }` | `{ ok: true, output: string, truncated: bool }` |

Side effect: auto-launches the tmux session for the staff if it is not
already running (so the owner does not need to pre-spawn). Sends the
keys, waits `wait_ms`, returns the last ≤ 8 KB of captured output.
`truncated: true` if the chunk hit the 8 KB cap (Rule 4 — caller knows
it was clipped, not silently swallowed).

Audit-emit: the underlying `sendKeys` already emits `cli.input` per
`cli-passthrough.md` § 3.2. No additional `cli_exec`-named event is
emitted — the audit trail records the actual session mutation, not the
wrapping tool name.

Latency budget: bounded by `wait_ms` (≤ 30 s ceiling per Rule 10). The
secretary's chat round-trip therefore has a hard 30 s tail on this
tool. The cap is deliberate — if the owner needs an interactive
session that takes longer, the secretary should redirect them to the
xterm panel rather than block the chat.

Engineering-rule alignment: Rule 1 (Holon owns the tmux session state
via `cli-session-service.ts`; the tool is a thin executor), Rule 4
(`truncated` flag + `ok:false, reason` returns — no silent failure),
Rule 6 (callable only by the owner desk-AI), Rule 8 (audit emit after
state change via `sendKeys`), Rule 10 (`wait_ms` cap).

### 5.8 @-Mention Recognition (iter-008 phase 4)

Added in iter-008 phase 4 — a **prompt-layer convention**, not a new
tool. The secretary's system prompt now includes an "@-mentions"
section that says: when the owner writes `@<Name>` in chat, look up
the matching `staff_id` from the snapshot (the same snapshot pulled
by the `pre_llm_call` hook per § 10.1), then route based on the
target's substrate:

| Target substrate | Route via |
|---|---|
| `local_ai` | `assign_to_staff(staff_id, brief)` |
| `cli` (short, ≤ 30 s) | `cli_exec(staff_id, command)` |
| `cli` (longer / interactive) | Tell the owner to use `/cli <name>` or the /members panel; do **not** call `cli_exec` |
| `peer` | `dispatch_handoff(connection_id, brief)` — connection_id derived from the peer staff record |

This is intentionally a prompt-layer affordance, not a hardcoded
parser. Three reasons: (a) Hermes loops do not have a pre-LLM
parsing hook, (b) the LLM is already reading the full snapshot so the
name → id lookup is cheap inline, (c) the owner's `@Name` is often
ambiguous (multiple Aria-Drafter pairings, etc.) and the LLM's
disambiguation prompt is better than a deterministic substring match
that would silently misroute. Engineering Rule 4 (no silent failure)
is satisfied: ambiguous matches surface as a chat question
("Which Aria — `staff_01HK…` or `staff_01HL…`?") rather than a
silent fallback.

Open question 8-A: should `@<Name>` resolution become a first-class
plugin pre-hook (lookup happens before LLM sees the turn, with the
id substituted in)? V1 punt — the prompt-layer answer is good
enough for the demo and avoids the disambiguation-loss problem above.

## 6. Authority & Safety

### 6.1 Rule 1 — Product State Above Runtime

Every tool that touches Holon state goes through the BFF. The owner-assistant
has no SQL access, no direct file-system access to Holon's state store, no
in-process state cache that could drift. If the BFF says "staff X does not
exist," the owner-assistant cannot create one out of band. Holon decides
what exists; Hermes only executes.

### 6.2 Rule 2 — Two Cores Stay Separate

The state-bridge tool surface lives entirely on the Core 1 side:

- `list_staff`, `query_staff`, `assign_to_staff` → Core 1 (local roster)
- `list_missions`, `list_deliverables` → Core 1 surface of Core 2 objects,
  read through Core 1's projection
- `list_connections`, `dispatch_handoff` → these touch the Core 2 surface
  but only via the **four declared crossings**: `dispatch_handoff`
  corresponds to crossing #1 (outbound dispatch) per
  `functional-architecture.md` § 2.3. The tool stages an outbox entry; it
  does not reach into Core 2's send path directly.

The owner-assistant cannot import Core 2 internals; it can only call BFF
endpoints that are themselves crossing-aware.

### 6.3 Rule 5 — Flat-Roster Invariant

**Updated 2026-05-16, iter-007 step 7 / ADR-019:** the original posture of
this section was "no tool in this surface creates staff." That changed
with the addition of `create_staff` / `update_staff` / `dismiss_staff`
(see § 5.5). The flat-roster invariant is still preserved, just through
different mechanics:

- `create_staff` always sets `desk_id = fx.primary_desk_id`. There is no
  `parent_staff_id` field in the BFF schema (`packages/api-contract`),
  so the tool surface cannot express staff-owns-staff. Every minted row
  is a sibling, never a child.
- `update_staff` is whitelisted to non-structural fields; substrate kind
  and the (non-existent) parent-pointer cannot be set or mutated.
- `dismiss_staff` is a soft tombstone, not a cascade — it cannot pull
  siblings or peers along with it.

The chat-CRUD path is the AI-controller-assistance branch of
`local-agent-management.md` § 6.4 ("AI controller assistance — the AI may
help the owner think through what staff to create; the CREATION still
goes through the owner's explicit confirmation step"). The owner's
explicit confirmation step is the chat turn itself (the owner names the
role and persona in chat; the assistant calls `create_staff` on their
behalf). The form-based ≥30-second path in § 6.2 remains available and is
the only path for `peer` and `cli` substrates.

Sub-agents spawned via `delegate_task` are still runtime jobs, not staff
records. They have no DB representation. This preserves the invariant
trivially for the delegate path: the staff set never grows from a
`delegate_task` call (only `create_staff` grows it, and only under the
constraints above).

### 6.4 Rule 6 — Owner-Mediated Authority

The two state-write tools (`assign_to_staff`, `dispatch_handoff`) are
**queue-only** in V1. Concretely:

- `assign_to_staff` records "the owner-assistant proposes to assign work
  W to staff S." The owner sees this in their UI and clicks to execute.
  Until they click, the staff member is not actually working.
- `dispatch_handoff` records "the owner-assistant proposes to send brief B
  to connection C." The handoff lands in the local outbox. Nothing is sent
  on-wire until the owner approves.

This realises Rule 6 ("External work always lands in the owner's mission
inbox first — no auto-accept") on the outbound side: the owner-assistant
cannot autonomously commit the desk to outbound peer work either.

Sub-agents spawned via `delegate_task` execute autonomously within the
spawn — but their effects on Holon state are mediated by whatever tools
they have, which are governed by their own `substrate.tool_scope` (per
`local-agent-management.md` § 5). A worker with a constrained tool scope
(e.g., only `web_search`) cannot mutate Holon state regardless of what the
owner-assistant briefed it to do.

### 6.5 What This Does NOT Cover

- **Authority attenuation (Rule 7)**: the owner-assistant can only briefs
  what the owner has authority to delegate. In V1 the owner has full
  authority over their own desk, so attenuation is trivially satisfied.
  V2 / multi-controller scenarios will require tightening — flagged in
  Open Q #5.
- **CLI executor side effects**: if a worker is a CLI substrate
  (`runtime-adapter-interface.md` discusses this), its side effects are
  governed by the substrate's approval rules, not by the owner-assistant.
  The owner-assistant cannot bypass a CLI substrate's approval policy.

## 7. Latency Budget

State-bridge tools are local HTTP. The user-facing chat round-trip is
dominated by the model call (DeepSeek), not by tool latency, so the budget
here is "should not contribute meaningful tail latency."

| Operation | p50 | p95 | p99 | Comments |
|---|---|---|---|---|
| `list_staff`, `list_connections`, `list_missions`, `list_deliverables` (cached BFF) | ≤ 5 ms | ≤ 20 ms | ≤ 50 ms | localhost, in-memory store in V1 |
| `query_staff` | ≤ 5 ms | ≤ 20 ms | ≤ 50 ms | same |
| `assign_to_staff`, `dispatch_handoff` | ≤ 20 ms | ≤ 80 ms | ≤ 150 ms | write path; includes audit-emit |
| `delegate_task` | seconds to minutes | seconds to minutes | seconds to minutes | wraps the sub-agent's full run; the budget is the sub-agent's, not this tool's |

These are SLOs (Engineering Rule 10). The chat-stream should surface a
visible `tool_call_started` indicator (per ADR-013 § 5 and
`runtime-adapter-interface.md` § "Granularity") so even fast tools are
perceptible to the user — "blink-of-an-eye" feels worse than "tool ran" in
a chat context.

## 8. Open Questions

1. **`delegate_task` sub-agent profile** — when the owner-assistant calls
   `delegate_task("research vendor X")`, what's the sub-agent? Options:
   (a) a fresh blank Hermes instance with no Holon-specific tools;
   (b) a Hermes instance configured with the **target staff's**
   `substrate.tool_scope` (so "delegate to Aria" gives the sub-agent
   Aria's actual tool set); (c) a separate "anonymous worker" profile
   distinct from any staff record. The user directive frames workers as
   "all other staff" so (b) is the intended direction, but the wiring —
   how does `delegate_task` know which staff record to map to? — is not
   yet specified. This intersects with `runtime-adapter-interface.md`'s
   `RuntimeJobConfig.staffId` field.
2. **Sub-agent progress surfacing** — the UI needs to show the owner
   "Aria is working on X" while a `delegate_task` call is in flight,
   potentially for minutes. V1 just blocks the tool call until the
   sub-agent finishes (and the chat UI shows a generic `tool_call_started`
   indicator). V2 wants nested streaming: the sub-agent's `output_delta`
   events surfaced through the parent agent's stream, probably via a new
   event kind in `RuntimeEvent`. Not blocking for iter-007.
3. **Deliverable return path** — V1, the sub-agent returns a string from
   `delegate_task`. This is fine for "research" briefs but does not match
   the `DeliverableDraft` shape in `runtime-adapter-interface.md` § 5
   (which supports markdown / structured / files). If the sub-agent
   produced a file, that file currently has nowhere to go. V2: route the
   sub-agent's `DeliverableEvent` through the BFF into the deliverable
   store, and have `delegate_task` return a `deliverable_id` the
   owner-assistant can reference.
4. **Audit-emit for delegate_task spawns** — Hermes's observability plugin
   logs the spawn internally, but Holon's audit log
   (`functional-architecture.md` § 7.5) does not see it. Should
   `delegate_task` be wrapped/intercepted to emit a Holon audit event so
   the BFF can render "owner-assistant delegated to <sub-agent>"? Probably
   yes — flagged for iter-008+.
5. **Authority scope at the tool layer** — when the owner-assistant
   queues `assign_to_staff(staff_id, brief)`, does the BFF check that the
   brief is within the owner's authority for that staff (e.g., respects
   the staff's autonomy ceiling per `local-agent-management.md` § 8.4)?
   V1: no, the queue is permissive and authority is checked at execute
   time. This is fine for a single-controller V1 desk but will need
   revisiting for multi-controller V2 (Engineering Rule 7).
6. **Tool-name / endpoint-name harmonisation** — `list_missions` exposes
   a `status` parameter but the BFF endpoint expects `state` (per
   `packages/api-contract/src/endpoints/inbound.ts`). The handler does
   the mapping; clean up in iter-008.
7. **Where does `member.chat_log[]` live for the owner-assistant?** —
   ADR-013 § 1 specifies in-memory only for V1, attached to the member
   record. The owner-assistant is a member with substrate `local_ai`, so
   the same mechanism applies. But because the owner-assistant runs as a
   long-running Hermes job (per `runtime-adapter-interface.md` § "Chat
   Sessions as Long-Running Jobs"), Hermes itself maintains the
   conversation context inside its `AIAgent` loop state. The
   `member.chat_log[]` is therefore a UI replay buffer, not the
   authoritative context. Is there drift risk between the two? Probably
   not in V1, but worth a check before V2 persistent chat history.
8. **Web search timing** — deferring `web_search` to v2 means the v1
   owner-assistant cannot answer "find a good Researcher for X" without
   the owner providing context. Acceptable? Or does iter-007 need a
   trivial Tavily/Brave wrapper to make the demo usable?

## 9. Cross-References

- `local-agent-management.md` § 4.2 — `owner_assistant` role definition
- `local-agent-management.md` § 5.1 — `local_ai` substrate (the substrate
  the owner-assistant runs on)
- `local-agent-management.md` § 9 — Controller Of The Desk (the
  owner-assistant is an in-desk AI controller surface)
- `runtime-adapter-interface.md` § "Chat Sessions as Long-Running Jobs"
  — lifecycle of the owner-assistant's Hermes job
- `runtime-adapter-interface.md` § "RuntimeJobConfig" — `tools` allow-list
  is the security boundary the owner-assistant relies on
- `peer-communication-architecture.md` § 2 (UC-1..UC-10) — the canonical
  use cases that `dispatch_handoff` is preparing the ground for
- `handoff-taxonomy.md` — form choice for an outbox-staged handoff is a
  per-handoff decision the owner makes at approval time, not by the
  owner-assistant
- ADR-013 (`docs/decisions/013-chat-surface-as-hermes-loop.md`) — chat is
  Hermes's loop exposed as UI
- ADR-011 — BYOK / API-key handling
- ADR-007 — audit-emit-after-state-change posture
- `packages/api-contract/src/endpoints/{members,inbound,connections,deliverables}.ts`
  — canonical BFF schemas backing the state-bridge tools
- `packages/hermes-plugin-holon-owner/schemas.py` — canonical tool JSON
  schemas (this doc summarises; the file is authoritative)
- `deps/hermes/plugins/model-providers/deepseek/` — model provider plugin

## 10. Implementation Status — Step 3 (ACP Bridge)

Status update appended 2026-05-16 after iter-007 step 3 landed.
§§ 1–9 above remain the contract; this section records what actually
shipped, names the wire-level surfaces, and marks which Open Questions
from § 8 are now resolved.

### 10.1 What Shipped

The Hermes ACP bridge wires the Next.js BFF to a long-lived `uv run
hermes acp` subprocess over the Agent Client Protocol
(`@agentclientprotocol/sdk@0.21.1`), JSON-RPC on stdio. Concretely:

| File | Role |
|---|---|
| `apps/web/lib/hermes-acp-client.ts` | Singleton process wrapper. Spawns Hermes once per Next.js process, holds one ACP session, exposes `promptOwner / closeBridge / peekBridge`. |
| `apps/web/app/api/v1/chat/owner/stream/route.ts` | SSE endpoint. Forwards the latest user message into the ACP session; translates `session_update` events into assistant-ui-friendly chunks. |
| `apps/web/app/api/v1/chat/owner/snapshot/route.ts` | GET endpoint. Returns a compact `team / connections / open_missions / recent_deliverables` JSON pulled from `@holon/core` services. Called by the `holon-owner` plugin's `pre_llm_call` hook on every turn. |
| `apps/web/app/_components/owner-adapter.ts` | The `ChatModelAdapter`. Drains SSE → yields assistant-ui content parts. |
| `apps/web/app/_components/ChatRuntimeProvider.tsx` | Lifts `AssistantRuntimeProvider` to the root layout (above `AppShell`). |
| `~/.hermes/config.yaml` | `model: deepseek-chat`, `provider: deepseek` — so ACP-launched sessions hit a real model. |

The contract in § 3 ("BFF chat stream … one long-running
RuntimeJobHandle per chat session") is realised; the wire is ACP, not
the internal `RuntimeAdapter` interface in
`runtime-adapter-interface.md`. ACP is the externally-versioned protocol
that `hermes acp` already exposes; using it directly avoids inventing
a parallel adapter layer for V1.

### 10.2 globalThis Singleton — Why

Each Next.js App Router route bundle imports its own copy of
`hermes-acp-client.ts` (this is a Next.js bundler property, not a bug).
A plain module-scope `let bridge` would therefore yield a separate
Hermes subprocess per route — `/api/v1/chat/owner/stream` and
`/api/v1/admin/reset` would not see the same session.

The fix: state lives on `globalThis.__holonHermes`. Same pattern is
used by `packages/core/src/mutable-store.ts` (jobs + deliverables) and
`packages/core/src/worker-dispatcher.ts` (tick handle + running job
id). See `worker-dispatcher.md` for the full pattern note.

### 10.3 ACP `session_update` → SSE Event Translation

The bridge collapses the ACP event vocabulary down to four
assistant-ui-friendly kinds. Anything not in the table is dropped
silently (acceptable for V1 — Engineering Rule 4 only mandates
surfacing **errors**, not every protocol event).

| ACP `sessionUpdate`     | SSE `type`     | Payload                                       | Notes |
|-------------------------|----------------|-----------------------------------------------|-------|
| `agent_message_chunk`   | `text`         | `{ text: <cumulative assembled text> }`       | Sent as cumulative, not delta, so the UI can do an idempotent overwrite. |
| `tool_call`             | `tool_call`    | `{ id, name, status }`                        | Adapter currently drops these from the bubble (see § 10.4). |
| `tool_call_update`      | `tool_update`  | `{ id, status }`                              | Same — dropped by adapter today. |
| `agent_thought_chunk`   | —              | —                                             | Ignored in V1; could surface as a collapsed "Thinking…" panel later. |
| `plan`, `user_message_chunk` | —         | —                                             | Ignored. |
| (turn end)              | `done`         | `{ stopReason, finalText }`                   | |
| (caught exception)      | `error`        | `{ message }`                                 | Adapter renders inline as `⚠️ <message>`. |

### 10.4 Why Tool Events Do Not Inject Into the Bubble

A first cut surfaced each `tool_call` as an inline marker in the
assistant message body. This caused visible jitter: tokens kept arriving
after the tool marker, and re-renders snapped the scroll position. The
adapter now only re-yields on `text` and `done` events so the bubble
grows strictly at the tail.

Tool activity is **not** invisible — the SSE wire still carries
`tool_call` / `tool_update`. A dedicated tool-activity surface (sidebar
or step-list above the message) is the right next step. Tracked as
Open Question 10-A below; this matches Open Question 2 in § 8
(sub-agent progress surfacing) in spirit but for direct tool calls.

### 10.5 Open Questions From § 8 — Resolution Status

| § 8 Q | Status | Resolution / pointer |
|------|--------|---------------------|
| 1 — `delegate_task` sub-agent profile | **Resolved (V1)** | Not used. We bypassed `delegate_task` for the V1 worker path. Workers are spawned by the `worker-dispatcher` as **one-shot `hermes -z` invocations** with the **target staff's persona prefix** + the full `hermes-acp` toolset (`--yolo --provider deepseek -m deepseek-chat`). The staff record drives the persona; tool scope is currently the full default set (open question — see `worker-dispatcher.md` § Open Questions). |
| 2 — Sub-agent progress surfacing | Unresolved | V1 worker output streams to nowhere; only the final stdout becomes the deliverable. Live progress surfacing waits on a status push channel (SSE on `/api/v1/jobs/:id/stream`). |
| 3 — Deliverable return path | **Resolved (V1)** | Worker stdout is captured and persisted as a real `Deliverable` (prefix `deliv_…`, `body_kind: 'markdown'`, `origin_label: 'local'`) via `packages/core/src/mutable-store.ts`. The mutable store is merged into the read path in `packages/core/src/deliverables-service.ts` so the `/deliverables` UI sees worker output alongside the fixture baseline. See `worker-dispatcher.md` § 3. |
| 4 — Audit-emit for spawns | Partially resolved | The job-queue endpoint logs `audit: 'staff.job.queued'` as a structured stdout line. No Holon audit-table row yet (no audit table exists in V1 anyway — Engineering Rule 8 / ADR-007 V1 posture is "audit is a diagnostic record"). |
| 5 — Authority scope at the tool layer | Unresolved | Still permissive in V1 single-controller posture. |
| 6 — Tool-name / endpoint-name (status vs state) | Unresolved | Punt to iter-008. |
| 7 — Drift between `member.chat_log[]` and Hermes-side session state | **De-risked, not resolved** | The ACP session is the single source of conversation state; `member.chat_log[]` is not populated by the bridge. Admin reset (§ 10.6) kills the ACP subprocess, which discards conversation. The drift risk only re-emerges if/when V2 persists chat history. |
| 8 — Web search timing | **Resolved (different way)** | The owner agent itself still has no `web_search`. But because workers inherit the full `hermes-acp` toolset, the owner can now delegate "research X" to a worker who can `web_search`. Acceptable v1 answer. |

### 10.6 Admin Reset Hook

`POST /api/v1/admin/reset` calls `closeBridge()` from this module to
SIGTERM the Hermes subprocess (SIGKILL after 800 ms). The next chat
turn spawns a fresh session with a new `session_id` and an empty
conversation. Same endpoint also clears the mutable store
(`clearMutableStore()` from `@holon/core`). See `admin-surfaces.md`
for the full admin endpoint contract.

### 10.7 New Open Questions (Step 3)

10-A. **Tool-activity UI surface.** Tool events are on the wire but
nowhere on screen. Right answer is probably a step-list above the
assistant bubble (so the user sees "🔧 list_staff → 12 staff returned"
without polluting the message body). Not blocking for iter-007.

10-B. **Singleton lifecycle in prod multi-instance.** The
`globalThis.__holonHermes` pattern is per-process. In a multi-node
prod deploy, each node has its own Hermes subprocess and its own
session — sticky-routing to keep a user pinned to "their" Hermes is
required. V1 dev / single-binary Tauri does not hit this.

10-C. **Plugin discovery for ACP-launched Hermes.** The `holon-owner`
plugin's tools must register against the `hermes-acp` toolset bundle
for the ACP session to see them. Currently relies on the symlink
convention (§ 4.3). If a user runs `hermes acp` from outside the repo,
plugins will not load. V1 acceptable; document as a deploy invariant.

10-D. **`pre_llm_call` snapshot cost.** Every owner turn re-pulls the
full team / connections / open-missions / deliverables snapshot.
Fine while V1 is in-memory fixtures + small mutable store; could
become a real cost when the BFF talks to a DB. Cache + invalidate on
mutating tool calls is the natural V2 fix.

### 10.8 Lesson Learned — Nav Link Bug

`apps/web/app/_components/Nav.tsx` originally used plain `<a href="…">`
for nav items. Each click triggered a full page navigation, which
unmounted the React tree (including `ChatRuntimeProvider`) and wiped
the chat thread. Fixed by switching to `next/link`, which keeps the
client-side runtime alive.

Recorded here (not just in code comments) because it is the *reason*
`ChatRuntimeProvider` lives at the root layout — if some future
refactor moves the provider back under a route segment, the same
bug class reappears. Verified by `apps/web/scripts/test-chat-persist.mjs`.

### 10.9 ADR-Worthy Schema Extension (Flag, Not Change)

`packages/api-contract/src/entities/owner-assistant.ts` was extended
with new optional fields:

```
owner_name, owner_role, owner_intro,
system_prompt,
workspace_dir, monthly_budget_mc,
skills: [{ name, description, body }],
upstream_connection_id, upstream_display_name
```

`docs/architecture/data-model.md` does **not** currently describe an
`OwnerAssistant` shape at all — searching the file for `owner_assistant`,
`skills`, `workspace_dir`, `monthly_budget_mc` returns zero hits at
the time of writing. The new fields are therefore not just an
extension but the first appearance of this shape at the canonical
schema layer.

**Per CLAUDE.md § "Spec Authority" and § "No new schemas without spec
update", this is an ADR-worthy change.** The Requirements Agent has
not silently edited `data-model.md`; the change is recorded here so
the human can decide:

- (a) accept the extension and draft an ADR + add an `OwnerAssistant`
  subsection to `data-model.md`, or
- (b) reject and ask the code to roll back the schema extension.

Suggested ADR title: *"OwnerAssistant carries owner identity, persona,
skills, workspace, and budget."* Suggested doc location:
`docs/decisions/017-owner-assistant-shape.md`.

Note: the fixture entry in `src/ui-mock/_shared/fixtures.snapshot.json`
is also seeded with realistic data for these fields. That is a mock
artifact, not a schema commitment, but the fixture won't roundtrip
against an OwnerAssistant shape that lacks these optional fields if
the human chooses path (b).

### 10.10 Hermes Bridge Fault Recovery (Appended 2026-05-16)

The ACP subprocess (`uv run hermes acp`) is a single point of
failure for both the chat surface (`/chat`) and the polish surface
on `/me` (transitively, via `/api/v1/admin/polish` if/when it gets
promoted onto the bridge). Iter-007 tester run #2 exposed two
failure modes that crashed the Node process:

1. **Stale handle after subprocess death.** The cached
   `G_STATE.bridge` retained a handle to a Hermes process that
   had exited (`process.exitCode !== null`). The next
   `promptOwner` call wrote to a dead stdin → EPIPE.
2. **Pipe-level errors propagating as uncaught exceptions.**
   `proc.stdin` had no `'error'` listener, so an EPIPE on the
   dead pipe bubbled out of the event loop and killed the BFF.

**Fix (in `apps/web/lib/hermes-acp-client.ts`):**

- `promptOwner` is wrapped as `promptOwnerWithRetry(text,
  onUpdate, signal, attempt)`. Before calling into ACP it
  inspects `G_STATE.bridge.proc.exitCode`; if non-null the
  stale bridge is cleared and a fresh spawn is forced.
- The catch arm classifies these error strings as **transient
  bridge faults** (per Engineering Rule 4's classify-then-act
  taxonomy): `EPIPE`, `write after end`, `ACP connection
  closed`, `not connected`. On a transient fault, retry **once**
  with a fresh spawn. A second failure surfaces to the caller
  with the original error class preserved.
- `proc.stdin.on('error', …)` registered at spawn time so a
  late-arriving pipe error becomes a logged event rather than
  a process-killing uncaught exception.

**Why this satisfies Engineering Rule 4 (no silent failure):**
the retry path is *not* a swallow. The first failure is
classified and acted on; the second failure surfaces. There is
no bare `try/catch` — every catch arm either (a) reclassifies
and retries with a fresh spawn, or (b) rethrows with the
underlying error class preserved so the SSE adapter can render
`⚠️ <message>` per § 10.3. The audit-emit posture is unchanged:
a successful retry emits one `staff.job.queued` (or equivalent)
event, identical to a single-shot success.

**Why this lives in the agent-tools doc, not just elsewhere:**
the bridge IS the agent's runtime. Any chat tool that goes
through `promptOwner` inherits this recovery. The owner-config
surface (`owner-config-service.md` § 8.5.2) restates the same
behaviour from the editing-surface angle; this section is the
canonical mechanism, that section is the *why it matters for
the user*.

**Cross-ref:** `owner-config-service.md` § 8.5 covers the same
fault from the `/me` PATCH angle plus the double-PATCH dedupe.
§ 11 below (chat persistence) covers the orthogonal "page
reload survives" SLO; bridge fault recovery and chat
persistence stack — the bridge dying mid-conversation is now
two-layer-survivable (retry catches the bridge fault; the
sessionStorage rehydration buffer catches the page reload that
might follow).

**New Open Question:**

10-E. **Retry budget is one.** Catches the common case
(subprocess died between requests). Does not catch a flapping
bridge or a Hermes config error that fails repeatably on every
spawn. The right V2 move is probably an exponential backoff
with `max_attempts=3` plus a circuit-breaker that surfaces
"bridge is broken — see logs" to the chat UI after the breaker
trips. V1 single-user dev posture probably does not need this.

## 11. Chat Persistence — Three-Layer Stack

Status update appended 2026-05-16 after the chat-persistence work
landed in apps/web. § 1–10 above remain the contract; this section
documents the V1 mechanism that keeps the assistant-ui conversation
alive across soft nav, hard reload, and explicit reset. The contract
is **UX-level**, not protocol-level — Hermes still owns conversation
state on its side (per § 10.1, the ACP session is the single source
of truth). Everything here is about keeping the *browser* in sync
with that session across page-lifetime boundaries.

This is positioned as part of the latency / SLO contract per
Engineering Rule 10 — a page reload that wipes the conversation is
a UX regression on the same axis as a tool that takes 30 s when its
budget is 50 ms. § 7's latency table covers tool round-trip; this
section covers the orthogonal "session survives the page" SLO.

### 11.1 The Three Boundaries

| Boundary | What kills naive state | What we do |
|---|---|---|
| **Soft nav** (`/me` → `/chat`) | A plain `<a href>` in `Nav.tsx` triggers a full page navigation; the React tree unmounts, `ChatRuntimeProvider` dies, runtime is lost. | Use `next/link` with `prefetch={false}` for all in-app nav. The provider stays mounted. |
| **Soft nav with provider below route segment** | If `ChatRuntimeProvider` lived inside a route segment, switching segments would still unmount it. | `ChatRuntimeProvider` is hoisted to root `app/layout.tsx`, **above** `AppShell`. Survives every soft route change. |
| **Hard reload** (F5, address-bar enter, dev hot-reload) | Even a perfectly-scoped provider can't survive the page unloading. | On every completed turn, `owner-adapter.ts` serialises the conversation to `sessionStorage` under key `holon.chatMessages`. On mount, the provider passes `loadInitialMessages()` as `useLocalRuntime`'s `initialMessages`. |

The three layers stack — each addresses a different cause of state
loss, and removing any one re-introduces a regression class. Verified
end-to-end by `apps/web/scripts/test-chat-persist.mjs`, which clicks
through three nav tabs AND performs a `page.reload()`, asserting a
probe tag survives all four boundaries.

### 11.2 The `holon:reset` Event Protocol

The reset path needs to coordinate two state owners (the assistant-ui
runtime and the `sessionStorage` rehydration buffer) without coupling
them in code. We use a custom DOM event for the fan-out:

```
window.dispatchEvent(new Event('holon:reset'))
```

| Dispatcher | When |
|---|---|
| `apps/web/app/me/_components/DebugControls.tsx` | "Wipe chat + jobs + worker deliverables" and "Reset + reload" buttons, after the `POST /api/v1/admin/reset` resolves. |
| `apps/web/app/me/_components/MeClient.tsx` | After any path that needs a downstream re-fetch of `OwnerAssistant` (currently shared the same trigger as DebugControls). |

| Listener | Reaction |
|---|---|
| `apps/web/app/_components/owner-adapter.ts` | Clears `sessionStorage['holon.chatMessages']` so the next mount sees an empty conversation. |
| `apps/web/app/_components/ChatRuntimeProvider.tsx` | Bumps an internal `mountKey` to force a clean remount of `useLocalRuntime` (so any in-flight state inside the runtime is dropped, not just the rehydration buffer). |
| `apps/web/app/me/_components/MeClient.tsx` | Re-fetches `GET /api/v1/me` to pick up any owner-config changes that arrived alongside the reset. |

The event is intentionally untyped (no detail payload) — every
listener decides for itself what "reset" means in its own scope. This
keeps fan-out cheap and avoids a registry pattern that would couple
the cross-cutting concerns. Cross-ref: `admin-surfaces.md` § 3.1
covers the server side of the reset (closing the ACP bridge and
clearing the mutable store); this section is the browser-side
counterpart that makes the reset visible to the user.

### 11.3 What This Is NOT

- **Not durable persistence.** `sessionStorage` is per-tab and
  evaporates when the tab closes. Opening a second tab does not
  inherit the conversation. This is the right V1 contract — the
  Hermes ACP session is also per-server-process, so cross-tab
  durability would over-promise.
- **Not the canonical conversation log.** Hermes owns conversation
  state on its side; the sessionStorage copy is a **UI replay
  buffer**. Open Question 7 in § 8 (drift between
  `member.chat_log[]` and Hermes-side state) is materially the same
  question — restated here so the next pass of this doc sees both
  copies. If the ACP session is killed (admin reset) but
  sessionStorage is not cleared, the UI would replay a conversation
  the agent has forgotten. The `holon:reset` event protocol exists
  precisely to keep these two in sync.
- **Not a substitute for a real chat-history DB.** When V2 brings
  multi-device / multi-tab / cross-session chat continuity, this
  whole layer should be retired in favour of a server-side
  `chat_messages` table (the natural cousin of the `jobs` /
  `deliverables` mutable store that `worker-dispatcher.md` § 4.2
  flags for the same V2 migration).

### 11.4 Open Questions (New, Step 4)

11-A. **When does this graduate to a real DB?** Today the upper
bound on conversation length is whatever fits in `sessionStorage`
(~5 MB string per origin in most browsers). Long conversations
or large tool outputs hit that ceiling silently. A server-side
`chat_messages` table is the right answer when (a) we want
cross-tab continuity, (b) conversations routinely exceed ~50 turns,
or (c) we want to ship transcripts to the audit log. None of these
are V1-blocking. Cross-ref: `owner-config-service.md` § 6 for the
sibling "when does owner-config graduate" question — likely the
same trigger.

11-B. **Reset event proliferation.** `holon:reset` works today
because it has two dispatchers and three listeners. If the listener
count keeps growing, the implicit contract (every listener knows
what reset means) gets fragile. Migrate to a typed event bus
(`EventTarget` subclass with named events) before the listener
count crosses ~5.

11-C. **sessionStorage write amplification.** Every completed turn
serialises the **full** message array, not a delta. For a long
conversation this is O(n) write per turn and O(n²) cumulative —
fine for V1 (turn counts are small), but the natural V2 fix is
either a delta-append protocol or "stop persisting once the server
DB is the source of truth."

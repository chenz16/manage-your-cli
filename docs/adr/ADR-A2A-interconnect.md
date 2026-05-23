# ADR: A2A agent interconnect (秘书 ↔ 员工 ↔ 外面的 agent)

Status: Proposed · 2026-05-23 · Owner-directed ("本地的 agent 互联 — 秘书 — 我 — 外面的他")

## Context

Manage Your CLI already has three comms planes:

- **Human ↔ Secretary** — chat (`/api/v1/chat/owner/stream`, warm CLI).
- **Secretary ↔ tools** — **MCP** (`packages/holon-mcp`: list_live_agents / dispatch / read_agent_output / create_agent / retire_agent / read_memory / write_memory).
- **Secretary ↔ employees** — local, via MCP dispatch into each employee's tmux session.

What's missing is a **standard, location-agnostic agent ↔ agent plane** so an agent here can talk to an agent *elsewhere* — another desk on this machine, or a teammate's desk across the internet ("外面的他"). Today the only cross-desk hook is `OwnerAssistant.upstream_connection_id` + a `peer` staff substrate (`connection_id`, `remote_staff_name`) and a `pair/start` route — a stub, no wire protocol.

Owner's connection structure (verbatim intent):

```
本地 agent 互联  ──  秘书  ──  我(owner)  ──  （外面的他 / 别人的 desk）
   (MCP, local)      (chat)              (A2A over HTTP, internet of agents)
```

## Decision

**Adopt the A2A (Agent-to-Agent) standard for the agent↔agent plane; keep MCP for the agent↔tools plane.** They are complementary: MCP = an agent reaching down to tools/sub-agents it owns; A2A = peer agents (that don't own each other) collaborating across a trust/network boundary.

A2A primitives we adopt:

1. **Agent Card** — `GET /.well-known/agent-card.json`: this desk's identity, capabilities (which employees/skills are reachable), and the A2A endpoint URL. How a remote desk discovers what we can do.
2. **A2A endpoint** — `POST /api/v1/a2a` speaking A2A JSON-RPC: `message/send` (+ `message/stream` via SSE) and `tasks/get` / `tasks/cancel`. A task = a unit of delegated work with a lifecycle (submitted → working → completed/failed) and artifacts (mapped to our **Drops**).
3. **Transport security** — reuse `loopback-guard` for same-machine peers; for internet peers, a shared connection secret (HMAC) negotiated at `pair/start`. **No subscription tokens ever cross the wire** — each desk runs its own CLIs locally; A2A only carries task text + artifacts, never credentials. (Consistent with the product's "we don't deal with tokens" rule.)

Mapping to existing model:

- A `peer` staff = a local handle to a remote desk's agent, reached via that desk's A2A endpoint (`connection_id` → endpoint URL + secret).
- `upstream_connection_id` = the owner's own A2A link to a higher desk ("我 ↔ 外面的他").
- Inbound A2A tasks land as **Inbound/Todo** items the secretary triages (dispatch to an employee, or answer directly); results return as A2A artifacts (Drops).

## Why A2A standard (not a bespoke protocol)

- **Interop** — "internet of agents": any A2A-speaking desk (ours or a third party) can interoperate without us inventing a private wire format. Aligns with `[[feedback_real_not_simulated]]` (use the real standard, not a mock) and `[[feedback_long_term_value]]` (clean-later beats fast-now bespoke).
- **Discovery built in** — agent cards make capabilities self-describing.
- **Lifecycle + streaming** — task states + SSE match how our employees already run (long, observable).

## Non-goals (v1)

- No multi-tenant routing/gateway (single owner per desk — `[[project_holon_vs_openclaw_tenancy]]`).
- No credential federation. Each desk authenticates its own CLIs locally.
- No registry/marketplace of desks — peers are added explicitly via `pair/start`.

## Slice plan

- **Slice A — Agent Card + read-only discovery.** `GET /.well-known/agent-card.json` (identity + capabilities derived from live employees/skills). A peer can fetch + see what this desk offers. No task execution yet. (Self-contained, no auth changes.)
- **Slice B — Local A2A loopback task.** `POST /api/v1/a2a` `message/send` guarded by `loopback-guard`; routes the task to the secretary (or a named employee) via existing MCP dispatch; returns the result as an artifact. Proves the protocol end-to-end same-machine.
- **Slice C — Streaming + task lifecycle.** `message/stream` (SSE) + `tasks/get`/`tasks/cancel`; surface running A2A tasks in Today.
- **Slice D — Internet peer.** `pair/start` negotiates endpoint URL + HMAC secret; `peer` staff dispatch over the network; inbound tasks → Inbound triage.

Each slice ships independently, additive, behind the existing peer/connection model. Implementation delegated to Codex per slice; manager (me) writes the slice brief, verifies typecheck+build, promotes.

## Consequences

- A new `packages/a2a` (protocol types + agent-card builder + JSON-RPC handler) keeps the wire format isolated and reusable by web + future mobile.
- `peer` substrate gains a real transport; `pair/start` gains real negotiation.
- Risk: A2A spec is young/evolving — pin a version in the agent card; keep the handler thin so spec drift is a localized change.

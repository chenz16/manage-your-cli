# Peer Communication Architecture

Status: draft v0.1
Date: 2026-05-15
Owner: design
Position: This is the wire / transport / identity layer for Core 2. It is what the connection layer (`functional-architecture.md` § 3.6) actually does. Above it lives the handoff layer (`handoff-design.md`, `handoff-taxonomy.md`); below it lives raw HTTPS / SSE / WebRTC.

## 1. What This Doc Covers

The full design of how two Holon desks talk to each other across the network. Specifically:

- the canonical use cases that drive every requirement
- the survey of existing interconnect protocols and what we adopt vs invent
- the wire format (JSON-RPC 2.0 + A2A-shaped tasks)
- the transport layer (HTTPS POST + Server-Sent Events for inbound push; WebRTC for V2 direct-peer)
- identity, authentication, and the cloud relay's role
- multi-device routing (one person, many desks)
- idempotency, retries, signatures (Stripe-pattern)
- connection lifecycle and health
- latency and reliability budgets
- mibusy V3 carry-forward (what works, what evolves)
- the boundary with the handoff layer above

What this doc does NOT cover:

- handoff form semantics → `handoff-taxonomy.md`
- handoff lifecycle and packet content → `handoff-design.md`
- runtime adapter contract → `runtime-adapter-interface.md`
- local agent management → `local-agent-management.md`
- the high-level system map → `functional-architecture.md`

## 2. Use Cases That Drive The Design

These are the real scenarios Holon must support. Every protocol decision below traces back to at least one.

### UC-1: One person, multiple devices

Alice has a laptop desk and a phone desk. Both belong to Alice. Bob, who knows Alice as a person (not as a specific device), sends Alice a mission. The protocol must:

- route to whichever of Alice's desks is appropriate (most recently active, most capable, primary, all — owner's policy choice)
- not require Bob's desk to know Alice's device topology
- let Alice's two desks share visibility into the same mission once it's accepted

### UC-2: Cross-person handoff with mixed substrates

Alice's desk hands a research task to Wang's desk. Wang's desk has both a human (Wang himself) and AI staff. Wang chooses to route it to his AI Researcher; the AI does the work; Wang reviews; Wang submits the deliverable back to Alice. Alice's desk attaches the deliverable to her original assignment.

### UC-3: Cascade — A → B → C

Alice asks Wang for "competitive analysis of vendor X". Wang doesn't have direct knowledge of vendor X but knows Lin does. Wang's desk creates a sub-handoff to Lin's desk (subcontracting form, disclosed to Alice up front). Lin completes; Lin's deliverable returns to Wang; Wang aggregates with his own commentary; Wang's deliverable returns to Alice. The protocol must let Alice trace the chain (within disclosure rules).

### UC-4: Parallel solicitation

Alice sends "review this proposal" to three trusted desks simultaneously. First-to-deliver wins. Losing branches must be auto-cancelled cleanly (no zombie work).

### UC-5: Inbound mission while offline

Alice's phone is in airplane mode. Bob sends Alice a mission. The relay holds it. When Alice's phone comes back online, the mission is delivered. Alice's laptop, if also subscribed, may have already received it — the protocol handles the eventual deduplication.

### UC-6: Direct order from organizational authority (V2 enterprise)

Alice's enterprise admin desk pushes a policy update to Alice's work desk. This is a Direct Order handoff form; Alice's desk must accept (per the established hierarchical authority on the connection); the action is heavily audit-logged.

### UC-7: Negotiation between unfamiliar desks

Bob's desk has never worked with Alice's desk. Bob sends a Negotiated Handoff: "could you do X for $Y by Z?" Alice counters with $Y' and Z'. Iterates until agreement or one party closes. The protocol carries the negotiation state cleanly.

### UC-8: Connection revocation

Alice realizes Bob's desk has been compromised. Alice revokes the connection. Subsequent calls from Bob's desk fail clearly. In-flight work is cancelled. Alice's audit log records the revocation reason.

### UC-9: Direct peer (LAN / known IP) — V2

Two desks on the same local network bypass the cloud relay for latency-sensitive collaboration. The protocol uses WebRTC data channels with the cloud relay performing only the initial signaling.

### UC-10: Cloud relay outage

The cloud relay goes down. Already-connected desks can fall back to direct-peer (UC-9) if the connection supports it; otherwise outbound work buffers locally with visible status, and inbound work is unavailable. No silent failure.

## 3. Protocol Research — What We Adopt vs Invent

A separate research pass surveyed 13 existing protocols against Holon's needs (full report internal). The condensed conclusion:

### Adopted

- **A2A (Agent-to-Agent Protocol, 2025)** as the *task / artifact / lifecycle schema*. A2A's TaskState (`submitted → working → input-required → completed/failed/canceled/rejected`) maps near-1:1 to Holon's mission states; A2A's Artifact concept maps to deliverables; A2A's Agent Card supports capability discovery for Negotiated Handoff (UC-7). A2A is governed by Linux Foundation, Apache 2.0, with 150+ orgs participating. Spec: <https://a2a-protocol.org/>.

- **JSON-RPC 2.0** as the wire envelope. Same envelope MCP uses, same envelope A2A defines. Mature, debuggable, batch support, well-defined error model. Spec: <https://www.jsonrpc.org/specification>.

- **Server-Sent Events (SSE)** as the inbound-push transport. Long-lived outbound connection from each desk to the cloud relay; relay pushes events down. Auto-reconnects with `Last-Event-ID`. NAT/proxy/mobile friendly. Better than WebSocket for this use because we mostly need server→client; bidirection is via separate POST.

- **Stripe webhook patterns** for signed callbacks: HMAC-SHA256 signature header `X-Holon-Signature: t=<ts>,v1=<sig>` over `timestamp.body`; replay window 5 min; 24h dedup window keyed by `(sender_desk, request_id)`; retry schedule modeled on Stripe's (immediate, 5m, 30m, 2h, 5h, 10h, then 12h × 2 days; max 3 days).

- **Matrix-style multi-device identity** as a *concept*, not the protocol. Each desk gets its own credentials; a person is a collection of desks. Routing fan-out is per-mission policy. We do not adopt Matrix the protocol — federation lag (seconds) violates Holon's latency budget. We do borrow the model.

### Deferred

- **DIDComm v2** — mature spec but ecosystem-thin; bearer-JWT identity is sufficient until Holon needs cross-org federation without a central relay. V3+ consideration.

- **ActivityPub** — federation-shaped but slow and prone to fan-out DDoS in the wild. Not the right fit.

- **gRPC** — perf wins are irrelevant when bottleneck is human-in-the-loop seconds. Adds proxy/NAT complexity.

- **NATS / RabbitMQ** — internally inside the cloud relay this is reasonable, but it's an implementation choice not a protocol-surface decision.

### Invented

- **Sub-handoff disclosure field** — extension on the dispatch envelope: `plannedSubHandoffs: [{targetCapability, estimatedCount, rationale}]` with required pre-approval surfaced in the receiver's UI. Not in A2A; needed for Holon's accountability invariant per `handoff-taxonomy.md`.

- **Handoff form binding** — A2A's Task is form-agnostic; Holon's handoff carries the form (one of 14) plus axes. Receiver desk validates form/axes consistency on receipt.

- **Multi-device fan-out policy** — A2A assumes server-addressable agents; Holon adds the relay-side person→[desks] table and per-mission policy.

## 4. Layering And Component Map

```
┌───────────────────────────────────────────────────────────────┐
│  Handoff Layer                                                │
│  - constructs handoff packets (form, axes, context pack)      │
│  - validates incoming packets                                 │
│  - manages handoff lifecycle                                  │
│  Lives in Core 2; specced by handoff-design.md +              │
│  handoff-taxonomy.md.                                         │
└───────────────────────────────────────────────────────────────┘
                              │
                              │  send(connectionId, handoffPacket)
                              ▼
┌───────────────────────────────────────────────────────────────┐
│  Connection Layer  (THIS DOCUMENT)                            │
│  - per-peer-desk durable connection state                     │
│  - credential management (token, signing key)                 │
│  - health (healthy / degraded / offline / retrying / revoked) │
│  - retries, idempotency cache                                 │
│  - chooses transport: relay or direct-peer (V2)               │
└───────────────────────────────────────────────────────────────┘
                              │
                              │  wire send / receive
                              ▼
┌───────────────────────────────────────────────────────────────┐
│  Wire Transport  (THIS DOCUMENT)                              │
│  - HTTPS POST for outgoing requests/callbacks                 │
│  - SSE for incoming push from cloud relay                     │
│  - WebRTC data channel for V2 direct-peer                     │
│  - JSON-RPC 2.0 envelope                                      │
│  - HMAC signature, idempotency header                         │
└───────────────────────────────────────────────────────────────┘
                              │
                              ▼
                  ┌─────────────────────┐
                  │  Cloud Relay        │  (or direct peer in V2)
                  │  - person → desks   │
                  │  - signing & dedup  │
                  │  - mission queue    │
                  └─────────────────────┘
```

The connection layer and wire transport are the two layers this document specifies.

## 5. Wire Format

### 5.1 Envelope: JSON-RPC 2.0

Every cross-desk message is a JSON-RPC 2.0 request, response, or notification. Reasons: shared with MCP and A2A (engineers know the shape); batch support for N requests in one HTTP call; well-defined error model; trivially debuggable in `curl`.

```json
{
  "jsonrpc": "2.0",
  "id": "req_01HKQ8...",
  "method": "holon.handoff.dispatch",
  "params": {
    "handoffPacket": { ... },
    "connectionId": "conn_01HKQ7...",
    "plannedSubHandoffs": [ ... ]
  }
}
```

### 5.2 Method Set

The wire-level method namespace is small. All under `holon.*`.

| Method | Purpose | Direction |
|---|---|---|
| `holon.handoff.dispatch` | Send a handoff to a remote desk | sender → relay → receiver |
| `holon.handoff.acknowledge` | Receiver acks receipt; provides receipt id | receiver → sender (via relay) |
| `holon.handoff.respond` | Receiver responds to dispatch (accept / reject / counter) | receiver → sender |
| `holon.handoff.update` | Status update on accepted handoff (started / blocked / progress) | receiver → sender |
| `holon.handoff.deliver` | Final deliverable callback | receiver → sender |
| `holon.handoff.cancel` | Sender cancels in-flight handoff | sender → receiver |
| `holon.handoff.escalate` | Trigger escalation ladder | either party |
| `holon.connection.register` | Desk registers with relay (one-time per credential) | desk → relay |
| `holon.connection.heartbeat` | Liveness ping | desk ↔ relay |
| `holon.connection.health` | Health query | sender → relay or sender → receiver |
| `holon.connection.revoke` | Revoke a connection | either party → relay |
| `holon.discovery.agentCard` | Fetch a desk's capability descriptor (for Negotiated Handoff) | desk → desk via relay |
| `holon.event.push` | Generic event delivered to a connected desk via SSE | relay → desk |

A2A's task lifecycle methods are subsumed by the `holon.handoff.*` set above (a Holon handoff IS A2A's task with extensions). We do not expose A2A's task methods directly because Holon's form/axes layer needs to wrap them.

### 5.3 The Dispatch Payload (the headline call)

```typescript
// Method: holon.handoff.dispatch
// Request:
interface DispatchParams {
  // Identity & routing
  fromDesk: DeskId;
  fromPerson: PersonId;
  toConnection: ConnectionId;            // sender's local connection ID
  // Cloud relay translates to the recipient's address(es).

  // The handoff packet (per handoff-design.md + handoff-taxonomy.md)
  handoff: HandoffPacket;

  // Pre-disclosed sub-handoffs (per handoff-taxonomy.md sub-delegation policy)
  plannedSubHandoffs?: Array<{
    targetCapability: string;
    estimatedCount: number;
    rationale: string;
  }>;

  // Idempotency
  requestId: string;                     // UUIDv7; sender-generated; stable for retries

  // Routing policy across receiver's devices
  multiDevicePolicy?:
    | { kind: "primary" }                // default: deliver to receiver's primary desk
    | { kind: "all_devices" }            // fan out to every device, first to ack claims
    | { kind: "most_recently_active" }
    | { kind: "specific_desk"; deskId: DeskId };
}

// Response:
interface DispatchResult {
  acceptedAt: string;                    // when the relay accepted
  relayHandoffId: string;                // relay's internal id for tracking
  routedTo: Array<{                      // which device(s) the relay pushed to
    deskId: DeskId;
    pushedAt: string;
  }>;
}
```

Note: the response is from the RELAY, not the receiver. It confirms "your dispatch has been routed." The receiver's actual response (accept / reject / counter) comes asynchronously via `holon.handoff.respond` on the SSE channel.

### 5.4 Errors

```typescript
// Standard JSON-RPC error codes plus Holon-specific extensions.
type HolonRpcErrorCode =
  // Auth & identity
  | -32001 // INVALID_TOKEN
  | -32002 // CONNECTION_REVOKED
  | -32003 // SIGNATURE_FAILED
  | -32004 // REPLAY_DETECTED
  // Routing
  | -32010 // RECIPIENT_NOT_FOUND
  | -32011 // NO_DEVICE_AVAILABLE   (recipient is offline across all devices)
  | -32012 // MULTI_DEVICE_POLICY_UNSUPPORTED
  // Form / payload
  | -32020 // FORM_UNSUPPORTED       (per handoff-taxonomy.md)
  | -32021 // FORM_INVALID
  | -32022 // FORM_DECLINED          (recipient policy refuses the form)
  | -32023 // PACKET_TOO_LARGE
  // Idempotency
  | -32030 // IDEMPOTENCY_KEY_REUSED_DIFFERENT_PAYLOAD
  // Internal
  | -32099;// INTERNAL_RELAY_ERROR
```

Errors are typed and informative. "Silent failure is unacceptable" (`functional-architecture.md` § 7.3) is enforced at this layer by exhaustive error coverage.

## 6. Transport

### 6.1 Outbound (Desk → Network) — HTTPS POST

Standard HTTPS POST to `https://relay.holon.example/rpc` (or a direct-peer endpoint in V2). Headers:

```
POST /rpc HTTP/1.1
Host: relay.holon.example
Content-Type: application/json
Authorization: Bearer <desk_jwt>
X-Holon-Request-Id: <UUIDv7>
X-Holon-Signature: t=<unix_ts>,v1=<hmac_sha256_hex>
X-Holon-Protocol-Version: 1
Content-Length: <n>

{ "jsonrpc": "2.0", "id": "req_01HKQ8...", "method": "...", "params": { ... } }
```

The `X-Holon-Signature` covers `<unix_ts>.<request_body>` with HMAC-SHA256 using the per-connection signing key. Receiver rejects if `|now - ts| > 300` (5 min replay window) or signature mismatch.

### 6.2 Inbound (Network → Desk) — Server-Sent Events

Each desk holds one long-lived SSE connection to the cloud relay:

```
GET /events HTTP/1.1
Host: relay.holon.example
Accept: text/event-stream
Authorization: Bearer <desk_jwt>
Last-Event-ID: <last_processed_event_id>
```

The relay streams events as they arrive:

```
id: evt_01HKQ8...
event: holon.handoff.dispatch
data: { "jsonrpc":"2.0","method":"holon.handoff.dispatch","params":{ ... } }

id: evt_01HKQ9...
event: holon.handoff.deliver
data: { ... }
```

Each event has a stable id; on disconnect, the desk reconnects with the last id it processed; the relay resumes from there. This handles UC-5 (offline phone catches up when back online).

Heartbeat: relay sends a comment frame `: heartbeat` every 15 seconds. Desk treats >45 s of silence as connection lost and reconnects.

### 6.3 Direct Peer (V1) — HTTPS LAN / Known-IP

Per ADR-008, V1 ships direct-peer as a first-class transport mode alongside cloud-relay and local-only.

Two desks in direct-peer mode:

- Perform the standard pairing handshake (per `auth-and-identity.md`) with out-of-band code exchange (QR code or manually entered IP:port).
- After pairing, traffic flows over **HTTPS POST to a LAN IP:port** — the same JSON-RPC 2.0 envelope and HMAC signing as the relay path. No relay intermediary.
- One desk acts as the listener (opens a port); the other connects to it.
- Mode is stored in `connections.transport_mode = 'direct_peer'`; `endpoint_url` holds the peer's LAN IP:port.
- HMAC signing and replay-window checks are identical to the relay path.

**Transport mode selection note:** The connection layer abstracts cloud-relay vs direct-peer vs local-only. The handoff layer calls `ConnectionLayer.send()` regardless of mode.

**Local-only mode:** A desk with no outbound connections operates in local-only mode (`connections.transport_mode = 'local'`). Full Core 1 stack is operational; Connections screen shows "No peers configured — local-only mode." No relay dependency.

**V2 upgrade — WebRTC for NAT traversal:** Two desks behind symmetric NAT without LAN adjacency cannot use V1 direct-peer (HTTPS requires a reachable IP:port). V2 adds WebRTC (TURN server, ICE candidates, DTLS) for full NAT traversal. The JSON-RPC envelope and HMAC signing are unchanged; only the transport layer changes. V2 direct-peer WebRTC replaces (or supplements) V1 direct-peer HTTPS for the NAT-traversal case.

### 6.4 Why Not WebSocket

WebSocket without significant framing on top dies silently on mobile background, NAT rebinding, and corporate proxies. SSE has documented production failure modes (proxy buffering) but the failure is observable (heartbeat gap → reconnect). For inbound push specifically, SSE wins.

If V2 adds bidirectional streaming (e.g., live collaboration on a deliverable), WebSocket may join. V1 needs only push-from-relay + POST-from-desk.

## 6.5 Payload Modes (Wire Mechanics)

The handoff taxonomy defines four payload modes (`handoff-taxonomy.md` § Axis 7). Wire-level mechanics for each:

### By-value
Default. The full payload is serialized into the JSON-RPC `params.handoff` object. Maximum size: 1 MB per request (relay-enforced; senders that need more must use by-reference).

### By-reference
The packet's `payloadMode.refScheme` chooses the fetch mechanism:

- **signed_url** — sender uploads content to relay-managed object storage (S3-compatible); the packet carries a time-limited signed URL. Receiver fetches via standard HTTPS GET. Default TTL 24h; revocation = invalidate the URL via relay API. Used for files > 1 MB or revocable attachments.
- **peer_handle** — direct fetch from the sender's desk: receiver issues `holon.payload.fetch({handleId})` via the standard relay path, which forwards to the sender. Sender controls liveness (revocation = simply stop responding). Used when sender prefers to keep the data local but accept fetches.
- **content_hash** — sender provides the SHA-256; receiver fetches from a shared content-addressed store (V2; not in MVP). Useful for caching common attachments across many handoffs.

In all by-reference cases, the handoff packet itself stays small (< 4 KB typical). Receiver MUST handle fetch failures explicitly: the handoff state moves to `blocked` with reason `payload_unfetchable`.

### Shared-state
The packet's `payloadMode.storeRef` identifies a shared store hosted by the relay:

- **crdt_doc** — relay hosts a CRDT-backed document (Y.js or Automerge — choice deferred to implementation). Both desks subscribe via SSE for delta events; either can mutate. Conflict resolution by the CRDT semantics; no manual merging.
- **event_stream** — append-only event stream the relay hosts; both sides publish/subscribe via standard SSE. Used for Observer Brief: receiver subscribes to sender's audit feed scoped to the handoff's authority scope.
- **live_folder** — virtual folder backed by relay storage; both sides see file additions/removals/edits in near real-time. Useful for ongoing document collaboration.

Shared-state stores have explicit lifetime tied to the handoff: created when the handoff is accepted, torn down when the handoff reaches terminal state. Revocation removes the receiver's read/write capability immediately.

### Sandbox-mediated
The most operationally complex mode. The packet's `payloadMode.provisioning` describes how the sandbox is created:

- **provisionedBy: sender** — sender creates the sandbox in its own infrastructure; transmits credentials in the packet. Receiver SSH/HTTPS into the sandbox. Cleanup is sender's responsibility.
- **provisionedBy: receiver** — sender supplies a sandbox spec (image, capabilities); receiver provisions in its own infrastructure; supplies access back. Used when receiver has policy that says "I will only run code in my environment." Cleanup is receiver's responsibility.
- **provisionedBy: relay** — Holon relay (or a hosted sandbox provider integrated with the relay) provisions a neutral environment from a pool. Both sides get scoped access. Cleanest revocation (just kill the sandbox). Most operationally heavy for the relay.

Sandbox identity flows via mutual credential exchange in the handoff packet: sender's signing key + receiver's signing key are both registered with the sandbox so it can verify both parties' actions.

Sandbox lifecycle is driven by `payloadMode.ttlMs`. After TTL the sandbox is torn down regardless of work state — incomplete work is reported via a final status update. Sandbox content can be exported as the deliverable artifact; the export itself is normally By-value or By-reference attached to `holon.handoff.deliver`.

V1 ships **By-value and By-reference (signed_url)**. Shared-state and sandbox-mediated are V2 — significant infrastructure investment.

## 6.6 Timeliness Handling

The handoff taxonomy defines five timeliness modes (`handoff-taxonomy.md` § Axis 8). Wire-level mechanics:

### Synchronous
Both desks must be online together. Sender's `holon.handoff.dispatch` includes `timeliness.expectedRespondMs`; the relay refuses delivery if the receiver is offline. Sender's UI surfaces "recipient offline" within the relay's standard response time (p95 < 300 ms). Useful only when both parties are actively present.

### Windowed
Receiver MUST acknowledge by `timeliness.deadlineAt` (or sooner). The relay tracks deadlines and surfaces overdue handoffs to BOTH parties. When the deadline passes without acceptance, the handoff transitions to `expired`; the sender is notified and may retry, escalate (if escalation_ladder is set), or cancel.

Receiver's commitment after acceptance: complete the work by the same deadline (or send progress updates if longer). Failure to complete by deadline does not auto-fail the handoff but emits a `deadline_overdue` event to both parties.

### Long-running
No deadline pressure. Receiver works at their own pace; sender does not auto-prompt. Standard heartbeat (15 s relay-to-desk) keeps the connection alive but no timing on the work itself. This is the lowest-overhead mode.

### Scheduled-segment
The packet's `timeliness.segments` enumerates active windows. The receiver's desk publishes its availability schedule in its Agent Card (via `holon.discovery.agentCard`); senders consult this before composing. The relay enforces that:

- During an active segment, dispatch routes normally.
- Outside an active segment, dispatch is queued by the relay and held until the next segment starts. The sender sees "queued for next active window at <time>".
- The receiver desk's UI shows current segment status and upcoming windows.

Examples: an on-call desk active 9am-5pm Pacific weekdays; an event-coverage desk active during a specific event timeframe.

### Triggered
Pairs with Axis 3 conditional/standby. The handoff is created and held by the relay; nothing happens until the trigger predicate fires. The trigger source can be:

- A specific event in the sender's audit stream
- A scheduled time (cron-like)
- An external webhook into the relay
- Another handoff reaching a specific state (chain composition)

When fired, the handoff transitions from `triggered_pending` to `dispatched` and routes normally. Both desks are notified via SSE.

### Cross-Mode Interactions

| Combination | Behavior |
|---|---|
| Synchronous + receiver offline | Dispatch fails immediately with `RECIPIENT_NOT_FOUND` (-32010); sender retries or chooses different recipient |
| Windowed + deadline expires | Auto-transition to `expired`; escalation ladder fires if set |
| Scheduled-segment + dispatch outside segment | Queued by relay; UI shows queue position and next segment start |
| Long-running + connection lost > 24h | Connection moves to `degraded` then `offline`; handoff remains valid (pickup on reconnect) |
| Triggered + trigger fires while sender offline | Trigger is queued at the relay; fires when sender's desk reconnects (or never if sender has revoked) |

### Latency Budget Adjustments by Timeliness

The base latency budget (§ 11) applies to all modes. Synchronous mode has tighter receiver-side processing budget: receiver's first acknowledgment must arrive within `expectedRespondMs / 2` (so end-to-end round-trip stays under the sender's budget). Windowed/long-running have only the standard transport budget — not work-completion budget.

## 7. Identity & Authentication

### 7.0 Dual-Role Peer Connections (per ADR-016)

A peer connection (a row in the `connections` table with a stable `connection_id`) can simultaneously serve two distinct roles in the local roster without conflict. The same `connection_id` may appear as:

1. A **direct peer member** — a `substrate: peer` staff record in the Members roster (the owner's direct human collaborator, per `local-agent-management.md` § 5.3).
2. A **mentor** on one or more `local_ai` members — referenced in `staff.substrate.mentors[].peer_id`.

These are different invocation contexts for the same underlying connection. The wire layer (this document) sees only one connection with one identity and one signing key regardless of the role context. The product layer (Core 1) distinguishes the role by how the connection is referenced (direct peer vs mentor entry). No new wire protocol methods are needed for mentor consultation in V1; consultations travel as standard Advisory-form handoffs in V1.x+ or are recorded informally in V1.

### 7.1 Identity Hierarchy

```
Person (holon identity)
  ├── Desk #1 (Alice's laptop)
  ├── Desk #2 (Alice's phone)
  └── Desk #N (Alice's work computer)
```

A *person* is the human (or organizational entity in V2) who owns one or more desks. Each desk has its own credentials. Cross-desk routing happens at the person level (UC-1).

### 7.2 Credentials

Each desk has:

- a long-lived **device key pair** (Ed25519) generated during desk setup, private key stored securely on the device
- a **desk JWT** issued by the Holon relay, refreshed periodically, encoding `{sub: desk_id, person: person_id, capabilities: [...], iat, exp}`
- a **per-connection signing key** (symmetric, derived per connection) for HMAC signatures on cross-desk traffic

### 7.3 Initial Pairing

Desk-to-desk pairing (UC-7 first-time) requires explicit consent from both sides:

1. Sender's desk requests a pairing handshake with target person id (via relay).
2. Relay creates a pairing intent record.
3. All of target person's online desks see the pairing request in their inbox.
4. Target accepts on one device (the device-of-record for this connection).
5. Relay issues a connection record on both sides with mutual signing keys derived via HKDF.
6. Both sides see the connection appear in their Connections screen.

No automatic pairings. No "anyone can send me missions by knowing my person id" — the inbox would be a spam attractor. (Exception: V2 enterprise SSO may grant org-internal connections automatically per admin policy.)

### 7.4 Token Lifecycle

- Desk JWT: 24h lifetime; refreshed silently with refresh token (90d lifetime).
- Per-connection signing key: derived once at pairing; rotated on explicit owner action or on detected compromise.
- Revocation: when an owner revokes a connection, the relay invalidates the signing key immediately and pushes a `connection_revoked` event to both sides over SSE.

### 7.5 V2 SSO

Enterprise V2 swaps the Holon relay's JWT issuer for an external IdP (OIDC). Subject becomes the org's user id; person id is mapped via a directory. The protocol surface stays unchanged — only the issuer differs.

## 8. Multi-Device Routing

### 8.1 The Relay's Routing Table

The cloud relay holds, per person:

```
{
  personId: "person_alice",
  desks: [
    { deskId: "desk_alice_laptop", presence: "online", lastSeen: "...",
      capabilities: ["accept_missions", "edit_deliverables", "voice"] },
    { deskId: "desk_alice_phone",  presence: "background", lastSeen: "...",
      capabilities: ["accept_missions"] },
  ],
  primaryDeskId: "desk_alice_laptop",  // owner's choice
}
```

Capabilities are device-declared. A phone may not advertise `edit_deliverables` if the desk owner has marked it as a notify-only device.

### 8.2 Per-Mission Routing Policies

The sender desk includes a `multiDevicePolicy` field (per § 5.3):

| Policy | Behavior |
|---|---|
| `primary` (default) | Deliver to the recipient's marked-primary desk only |
| `most_recently_active` | Deliver to the desk whose `lastSeen` is most recent and `presence != offline` |
| `all_devices` | Fan out to every online desk; first to ack claims; others receive a `claimed_by(deskId)` event |
| `specific_desk` | Deliver only to the named desk (used when the sender knows the right device) |
| (no online devices) | Relay queues the mission; pushes to the next device that comes online |

### 8.3 Receiver-Side Reconciliation

When `all_devices` policy fans out a mission to multiple of Alice's desks, the first one to call `holon.handoff.acknowledge` claims it. The others receive a `holon.event.push` with type `claimed_by` and remove the mission from their inbox.

When a mission is acknowledged, the relay records the claiming desk; subsequent updates (status pings, etc.) route only to that desk.

### 8.4 Inter-Device Sync Within A Person

Desks belonging to the same person can subscribe to each other's mission state (V2). V1 keeps it simple: each desk is autonomous; the relay holds canonical mission state; desks query/sync via the standard methods.

## 9. Idempotency, Retries, Reliability

### 9.1 Idempotency Key

Every state-changing call includes an `X-Holon-Request-Id` header (a UUIDv7, sender-generated, stable across retries of the same logical request).

The relay maintains a 24-hour dedup cache keyed by `(senderDeskId, requestId)`. A retried request with the same key returns the cached response; a request with the same key but different payload returns `IDEMPOTENCY_KEY_REUSED_DIFFERENT_PAYLOAD` (-32030).

The receiver desk also enforces idempotency for callbacks (a deliverable callback retried by the relay must not create duplicate deliverables).

### 9.2 Retry Schedule (Stripe-Pattern)

The cloud relay retries any failed delivery on the following schedule:

```
attempt 1: immediate
attempt 2: +5 minutes
attempt 3: +30 minutes
attempt 4: +2 hours
attempt 5: +5 hours
attempt 6: +10 hours
attempt 7: +12 hours
attempt 8: +12 hours
attempt 9: +12 hours
abandon: after 3 days (~5 calendar days for the 9 attempts)
```

All retries are visible in both desks' UI (Connection health screen shows "retrying, last attempt at X, next at Y"). The owner can cancel manually at any time.

A retry is triggered for: 5xx HTTP from receiver, network timeout, signature failure (likely transient), DNS failure. Not retried: 4xx errors except 429 (rate limited — retry per Retry-After header).

### 9.3 Connection Health States

```
unconfigured → healthy → degraded → offline → retrying → revoked / invalid_token
```

| State | Meaning |
|---|---|
| `healthy` | Last successful exchange < 60 s ago; no failures in last 5 min |
| `degraded` | Some failures but recent success |
| `offline` | No success in last 5 min; presumed unreachable |
| `retrying` | Active retries in progress |
| `revoked` | Connection terminated by either party |
| `invalid_token` | Auth failure; needs re-pairing or token refresh |

Health is computed continuously, surfaced live in Connections screen, and audit-logged on every transition.

### 9.4 Compensation / Rollback (Connects To Saga Pattern)

If a deliverable callback fails permanently after retries, the original assignment moves to status `blocked` with reason `callback_failed_after_retries`. The owner sees the deliverable was produced but didn't return; they can manually fetch it (V2 feature: deliverable can be pulled from receiver desk via authenticated GET).

## 10. Sub-Handoff Disclosure (Reliability of Cascades)

Per `handoff-taxonomy.md`, handoffs may have `subDelegation` policies that allow / require disclosure. The protocol layer enforces:

- The dispatch payload's `plannedSubHandoffs` is required when the sender's `subDelegation.policy` is `allowed_with_disclosure` or stricter.
- The receiver's UI surfaces the planned sub-handoffs as part of the consent flow.
- When the receiver actually creates a sub-handoff, the receiver's desk includes `parentHandoffId` linking back to the original. This propagates up the chain.
- If the receiver's actual sub-handoffs deviate from the disclosed plan (different count, different capability), the receiver MUST send a `holon.handoff.update` with the deviation, which surfaces an alert in the original sender's UI.

## 11. Latency & Reliability Budgets

These are SLOs the layer commits to. Measured from the point each side controls.

| Operation | p50 | p95 | p99 | Notes |
|---|---|---|---|---|
| Outbound dispatch ack from relay | 100 ms | 300 ms | 800 ms | Relay-side; doesn't include receiver processing |
| Status update push (relay → receiver desk via SSE) | 50 ms | 200 ms | 500 ms | Once SSE connection is established |
| First-byte of inbound mission visible in receiver UI | 200 ms | 600 ms | 1500 ms | End-to-end including SSE push + UI render |
| Deliverable callback ack from sender | 100 ms | 300 ms | 800 ms | Same path as dispatch ack |
| Connection health update on state change | 1 s | 3 s | 10 s | Eventually consistent across both sides |

Heartbeat-driven failure detection: 45 s to mark a connection `offline` after silence (15 s heartbeat × 3 missed).

Direct peer (V2) targets ~5 ms p50 for status updates inside a LAN.

## 12. Connection Lifecycle (Detailed)

```
unconfigured
    │  pairing handshake (§7.3)
    ▼
healthy ◀───────────────────┐
    │                        │
    │  (failures accumulate) │
    ▼                        │
degraded ───(success)────────┤
    │                        │
    │  (no success >5min)    │
    ▼                        │
offline ───(reachable)───────┤
    │                        │
    │  (retries started)     │
    ▼                        │
retrying ──(success)─────────┘
    │
    │ (abandon / explicit revoke)
    ▼
revoked  /  invalid_token
```

Owner-visible: every transition is an event in the Connections screen and an audit log entry.

Programmatic: any handoff dispatch on a non-healthy connection surfaces a warning to the sender ("This connection is degraded. Send anyway?"). Hard failures on a `revoked` or `invalid_token` connection are immediately surfaced; nothing is queued.

## 13. Mibusy V3 Carry-Forward

The mibusy V3 prototype's peer network (HTTP POST + callback + token auth + facade pattern) is the proof that this protocol shape works. Specific carry-forward:

| Mibusy V3 | Holon V1 | Status |
|---|---|---|
| Direct HTTP POST `/api/v2/missions` | `holon.handoff.dispatch` over JSON-RPC POST | Evolved (envelope + signing + idempotency) |
| Callback POST `/api/v2/peer/done` | `holon.handoff.deliver` | Evolved (typed deliverable + signature) |
| `peer_token` per connection | Per-connection HMAC signing key | Evolved (HMAC instead of bearer, derived not stored) |
| `peer_origin_id` UNIQUE for idempotency | `X-Holon-Request-Id` UUIDv7 + relay dedup cache | Evolved (UUIDv7 sortable; 24h cache window) |
| `peer_url` direct addressing | Cloud relay routing (sender does not know receiver's URL) | Changed (relay-mediated; direct peer = V2) |
| `agent_mode: facade` for peer identity | Substrate `peer` in member record (`local-agent-management.md` § 5.4) | Carry forward (substrate renamed `proxy` → `peer` per ADR-003) |
| `desk_id` env-var isolation | Deck identity is a first-class JWT claim | Evolved |
| Fire-and-forget async dispatch | Async with explicit acks + state machine | Evolved (more structured) |
| No retry logic | Stripe-pattern retry schedule with visible status | Added |
| No SSE / inbound push | SSE channel from each desk to relay | Added |
| `mission_source` packed string for callback url | Proper schema fields | Fixed |
| No multi-device | Person → desks routing table | Added |
| No signature verification | HMAC-SHA256 + replay window | Added |

The two `/api/v2/...` endpoints in mibusy V3 prove the shape works end-to-end. Holon V1 keeps the shape, formalizes the gaps, and adds the relay layer.

## 14. Security Considerations

- **Token theft.** A stolen desk JWT lets the attacker act as that desk until refresh-token expiry or owner revocation. Mitigations: short JWT lifetime (24h), refresh token bound to device, revocation pushed via SSE within seconds.
- **Replay.** HMAC + 5-min replay window + idempotency cache handles standard replay. An attacker replaying within the 5-min window cannot produce a different effect (same request id → cached response).
- **Confused deputy.** A receiver desk that itself has high authority must NOT use that authority on behalf of a low-authority sender. The handoff packet's authority scope and form are the contract. Implementation MUST attenuate.
- **Relay compromise.** A compromised relay can drop, delay, or duplicate messages but cannot forge them (per-connection HMAC signing keys are only on the desks). It can also see metadata (who talks to whom). E2E encryption of payloads is V2.
- **Person enumeration.** Knowing a person id should not let an attacker enumerate their desks. The relay's API hides device topology from non-paired desks; only the relay's internal routing knows which physical desks belong to a person.
- **DDoS via fan-out.** Sender desk that sends `multiDevicePolicy: all_devices` to a person with 100 desks could fan out a mission 100 times. Relay enforces a per-person fan-out cap (default 10).

## 15. Open Decisions

1. **JSON-RPC batch support.** A2A allows batched dispatch; should Holon? Useful for parallel solicitation (UC-4) but complicates idempotency (each request needs its own request-id). Recommend: yes, supported; each batch member has its own request-id.
2. **Maximum payload size.** 1 MB? 10 MB? Affects inline file attachment in deliverables. Recommend: 1 MB inline, anything bigger uses signed-URL handoff (relay-managed object storage).
3. **End-to-end encryption.** When and how? V1 = relay can read payloads. V2 = E2E for payload bodies (relay routes envelope only). Affects signing key derivation.
4. **Direct peer requirements.** What capability flags must both desks set? What's the fallback policy if WebRTC ICE fails? Recommend: capability flag `direct_peer_capable: true`, fallback to relay automatically.
5. **Negotiated handoff state machine.** During negotiation, both parties hold competing draft `axes`. Need a separate sub-spec for the proposal/counter-proposal state machine. Linked to `handoff-taxonomy.md` open decision #7.
6. **Multi-device sync of mission state.** Within a person's own desks, when does sync happen? On demand? Background SSE push? Recommend: relay holds canonical state; each desk queries on render; eventual consistency is acceptable (~seconds).
7. **Connection-level rate limits.** What limits per sender per receiver per time window? Default: 100 dispatches per minute per connection; configurable per receiver desk policy.
8. **Discovery / Agent Card publishing.** A2A's Agent Card is at `/.well-known/agent.json`. Holon needs to decide: per-desk public capability descriptor? Auth-gated? Recommend: per-desk capability descriptor, fetched only by paired connections (no public publishing in V1).
9. **Cloud relay implementation choice.** Custom service? Hosted on Supabase / Railway / fly? NATS-backed? Outside this doc's scope but informs latency budgets. Pick early; affects observability story.

## 16. Acceptance Criteria

The protocol is "implementation-ready" when:

1. ✅ All 10 use cases (§2) trace to a specific protocol mechanism
2. ✅ Wire format is fully specified at the JSON level
3. ✅ All 13 methods named with payloads
4. ✅ Error codes enumerated with semantics
5. ✅ Identity model specifies credential types, lifetimes, revocation paths
6. ✅ Multi-device routing specifies the routing table and policies
7. ✅ Idempotency mechanism (key + cache + dedup window) is concrete
8. ✅ Retry schedule is specified (Stripe-pattern)
9. ✅ Latency budgets are committed (§11)
10. ✅ Mibusy carry-forward is field-level explicit
11. ✅ Security threats are enumerated with mitigations
12. ⬜ A test rig with 2 desks + relay can run a full UC-2 round-trip and pass conformance suite (verify in M1)
13. ⬜ A 100-mission soak test sustains the latency budget (verify in M3)
14. ⬜ Connection health states transition correctly under network partition simulations (verify in M3)

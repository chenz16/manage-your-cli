# Cloud Relay Architecture

Status: draft v0.1
Date: 2026-05-15
Owner: design + ops
Position: Internal architecture of the Holon cloud relay. The relay sits between desks and provides identity, routing, idempotency, retry, and audit aggregation. Specified from desk-side already in `peer-communication-architecture.md`; this doc covers the relay-internal structure.

## 1. Scope

The cloud relay is one of three V1 transport modes (cloud-relay, direct-peer, local-only) per ADR-008. It is the most common default for users without LAN adjacency. Users in direct-peer or local-only mode do not depend on this relay.

What this doc covers:

- the relay's responsibilities in detail
- internal services / components
- data model (relay-side; smaller than desk-side)
- scaling story (how to go from 100 desks to 100K)
- deployment topology
- operations: monitoring, alerts, on-call playbook outline
- the relay's own threat surface (echoing `security-threat-model.md` § 3.4)

What this doc does NOT cover:

- desk-to-relay protocol (per `peer-communication-architecture.md` §§ 5, 6)
- handoff semantics (per `handoff-design.md`, `handoff-taxonomy.md`)
- direct-peer transport (per `peer-communication-architecture.md` § 6.3)

## 2. The Relay's Job

Per `peer-communication-architecture.md` § 4, the relay sits between desks. Specifically, it:

1. **Maintains identity.** Issues desk JWTs (or in V2 SSO, validates externally-issued JWTs against an IdP). Maintains the JWT denylist for revocations.
2. **Maintains the routing table.** `person_id → [desk_id, presence, capabilities, last_seen]`. Decides which desk(s) to deliver inbound work to.
3. **Provides idempotency.** A 24-hour cache keyed by `(senderDeskId, X-Holon-Request-Id)` returns cached responses on retries.
4. **Drives retries.** Outbound deliveries that fail get queued per the Stripe-pattern schedule (per `peer-communication-architecture.md` § 9.2).
5. **Manages SSE connections.** Each desk holds one outbound SSE connection to the relay; the relay pushes inbound events down it.
6. **Mediates pairing handshakes.** Holds pairing intents while both sides confirm.
7. **Object storage broker.** Mints signed URLs for by-reference payload mode (per `peer-communication-architecture.md` § 6.5). Files live in S3-compatible storage.
8. **(V2)** Audit log aggregation across orgs for compliance export.
9. **(V2)** Sandbox provisioning for sandbox-mediated payload mode.

## 3. Component Map

```
                ┌─────────────────────────────┐
                │  HTTP gateway (Hono on Bun) │
                │  - terminates TLS           │
                │  - rate limits per IP / JWT │
                └──────────┬──────────────────┘
                           │
        ┌──────────────────┼──────────────────────────┐
        │                  │                          │
   ┌────▼─────┐  ┌────────▼─────────┐  ┌────────────▼─────────┐
   │ JWT svc  │  │ Routing svc      │  │ Pairing svc          │
   │ - issue  │  │ - person→desks   │  │ - intents            │
   │ - verify │  │ - presence track │  │ - confirmations      │
   │ - revoke │  │ - fan-out policy │  │ - intent expiry      │
   └──────────┘  └──────────────────┘  └──────────────────────┘
        │                  │                          │
   ┌────▼──────────────────▼──────────────────────────▼────┐
   │             Postgres (relay-canonical state)            │
   │  - desks, jwt_denylist, persons, routing_entries       │
   │  - pairing_intents                                     │
   │  - idempotency_cache                                   │
   │  - retry_queue                                         │
   │  - audit_aggregate (V2)                                │
   └──────────────────────────────────────────────────────────┘
        ↑                  ↑                          ↑
        │                  │                          │
   ┌────┴──────────┐  ┌────┴──────────────┐  ┌──────┴──────────┐
   │ SSE manager   │  │ Retry scheduler   │  │ Object-storage  │
   │ - per-desk    │  │ - polls retry_q   │  │ broker          │
   │   long conn   │  │ - dispatches      │  │ - signed URLs   │
   │ - heartbeat   │  │   redeliveries    │  │ - quota track   │
   └───────────────┘  └───────────────────┘  └─────────────────┘
                                                      │
                                                      ▼
                                              ┌──────────────┐
                                              │ S3-compatible│
                                              │ object store │
                                              └──────────────┘
```

Each component is a small service module within a single deployable in V1. V2 may split into separate processes if scale demands.

## 4. Component Specifications

### 4.1 HTTP Gateway

- Hono framework on Bun runtime (open decision per `implementation-architecture.md` § 12).
- Terminates TLS (or upstream load balancer does).
- Per-IP rate limit: 100 req/sec sustained, 1000 burst.
- Per-JWT rate limit: 10 req/sec sustained.
- Routes to internal services based on path prefix.

### 4.2 JWT Service

Implements `auth-and-identity.md` § 5.

- `POST /auth/desk/token` — issues new JWT for a desk that signs the request with its registered device key.
- `POST /auth/desk/refresh` — refreshes JWT using refresh token + device signature.
- `POST /auth/desk/revoke` — adds JWT to denylist; pushes revocation event via SSE.
- `POST /auth/desk/rotate-key` — accepts new device pubkey signed by old device key.

Storage: `jwt_denylist` table (jti + expiry). Garbage-collect expired entries hourly.

V2: when JWT issuer is external (SSO), the relay validates against the IdP's JWKS endpoint. The relay's own JWT-issuance endpoints become disabled per-org.

### 4.3 Routing Service

The most operationally critical service.

**State maintained:**

```typescript
interface RoutingTable {
  // Person → desks
  byPerson: Map<PersonId, DeskInfo[]>;

  // Reverse for revocation propagation
  byDesk: Map<DeskId, DeskInfo>;
}

interface DeskInfo {
  deskId: DeskId;
  personId: PersonId;
  capabilities: string[];
  presence: "online" | "background" | "offline";
  lastSeen: Date;
  isPrimary: boolean;
  ssePushTarget?: SseConnection;  // active SSE connection if online
}
```

**Operations:**

- Update presence on every SSE connect / disconnect / heartbeat.
- Resolve `target_person_id` to a list of online desks.
- Apply per-mission `multiDevicePolicy` (per `peer-communication-architecture.md` § 8.2).
- Push inbound events to chosen desk(s).
- Notify desks of revocation events.

**Persistence:** primarily in-memory for hot path; backed by `routing_entries` table for restart recovery + multi-relay-instance coordination.

**Scaling consideration**: this state is per-user; sharded by `person_id`. See § 6.

### 4.4 Pairing Service

Implements `auth-and-identity.md` § 4.

- `POST /pair/initiate` — creates a `pairing_intent` row; pushes notification to all of receiver's online desks.
- `POST /pair/accept` — receiver confirms; relay creates connection records on both sides; pushes pairing-complete event.
- `POST /pair/decline` — receiver declines; pushes decline event to initiator.
- Auto-expire pairing intents after 1 hour.

**Important**: relay never sees the per-connection HMAC signing key. The key is derived independently by both desks via ECDH on their pubkeys (the relay only carries pubkeys).

### 4.5 SSE Manager

The persistent-connection layer. Each connected desk holds one outbound SSE connection to the relay, kept alive by heartbeats.

**Per-connection state:**

- `lastEventId` — for resume on disconnect.
- Outbound event queue — events to push as soon as the SSE connection is writable.

**Lifecycle:**

- Desk connects: validate JWT, register in routing table presence, replay events since `Last-Event-ID`.
- Desk disconnects: mark presence → offline (after 45s missing heartbeat), keep state for resume.
- Reconnect: same flow, replay missed.

**Scaling**: SSE connections are sticky to a relay instance. Use consistent hashing on `desk_id` to route a desk to its assigned relay instance. Peer relay instances cross-publish events via internal pub/sub (NATS or Postgres LISTEN/NOTIFY).

### 4.6 Retry Scheduler

Reads `retry_queue` table (per `data-model.md` § 4.12); fires due retries.

**Loop:**

```
every 5 seconds:
  rows = SELECT * FROM retry_queue WHERE next_attempt_at <= now() LIMIT 100
  for each row:
    try dispatch via wire-protocol path
    if success:
      delete row
      emit retry_succeeded audit event
    if failure:
      compute next_attempt_at per Stripe schedule
      increment attempt_count
      if attempt_count >= max_attempts:
        delete row
        emit retry_abandoned audit event
        notify both sides
      else:
        update row
```

Per Stripe schedule: 9 attempts over ~3 days. Specific delays per `peer-communication-architecture.md` § 9.2.

### 4.7 Idempotency Cache

A simple cache keyed by `(senderDeskId, requestId)` with 24h TTL.

- On every state-changing RPC, check cache.
- If hit: return cached response.
- If miss: process the request, cache the response.
- Sweep expired entries hourly.

Storage: `idempotency_cache` table per `data-model.md` § 4.13. For low-latency hot path, may also add an in-memory LRU layer.

**Conflict detection**: if same request_id arrives with different payload hash, respond with `WIRE_IDEMPOTENCY_CONFLICT` (per `reliability-and-testing.md` § 3.1). Critical security signal.

### 4.8 Object Storage Broker

For by-reference payload mode (per `peer-communication-architecture.md` § 6.5).

- `POST /storage/upload` — sender uploads, gets back a URL + content hash.
- `GET /storage/{hash}/{key}` — receiver fetches with a signed URL (24h TTL by default).
- `DELETE /storage/{hash}/{key}` — owner-initiated revocation; invalidates URL.

Backend: S3 / GCS / R2 / minio for self-hosted. Bucket-per-tenant in V2 hosted.

Quota tracking: per-desk storage quota with soft warnings + hard limits.

## 5. Data Model (Relay-Side)

Smaller than the desk-side. Tables specific to relay operation:

```sql
-- Desks registered with this relay
CREATE TABLE desks (
  id              TEXT PRIMARY KEY,
  person_id       TEXT NOT NULL,
  device_key_pub  TEXT NOT NULL,
  capabilities    JSONB NOT NULL DEFAULT '[]',
  is_primary      BOOLEAN NOT NULL DEFAULT FALSE,
  presence        TEXT NOT NULL DEFAULT 'unknown',
  last_seen_at    TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  archived_at     TEXT
);

CREATE INDEX idx_desks_person ON desks(person_id);

-- Persons known to the relay
CREATE TABLE persons (
  id              TEXT PRIMARY KEY,
  display_name    TEXT NOT NULL,
  personal_code   TEXT UNIQUE,             -- 12-char base32 for pairing
  external_idp    TEXT,                    -- V2 SSO
  external_id     TEXT,                    -- V2 SSO
  created_at      TEXT NOT NULL
);

-- Live routing entries (denormalized for fast lookup; reconciled with desks)
CREATE TABLE routing_entries (
  desk_id         TEXT PRIMARY KEY REFERENCES desks(id),
  person_id       TEXT NOT NULL,
  presence        TEXT NOT NULL,
  capabilities    JSONB NOT NULL,
  is_primary      BOOLEAN NOT NULL,
  last_seen_at    TEXT NOT NULL,
  sse_relay_node  TEXT                     -- which relay instance has the live SSE connection
);

CREATE INDEX idx_routing_person ON routing_entries(person_id);

-- JWT denylist
CREATE TABLE jwt_denylist (
  jti             TEXT PRIMARY KEY,
  desk_id         TEXT NOT NULL,
  revoked_at      TEXT NOT NULL,
  expires_at      TEXT NOT NULL          -- garbage-collect after this
);

CREATE INDEX idx_jwt_denylist_expires ON jwt_denylist(expires_at);

-- Pairing intents
CREATE TABLE pairing_intents (
  id                          TEXT PRIMARY KEY,
  initiator_person_id         TEXT NOT NULL,
  initiator_desk_id           TEXT NOT NULL,
  initiator_pub_key           TEXT NOT NULL,
  initiator_display_name      TEXT NOT NULL,
  target_code                 TEXT NOT NULL,
  resolved_target_person_id   TEXT NOT NULL,
  initiator_capabilities      JSONB NOT NULL DEFAULT '[]',
  initiator_note              TEXT,
  status                      TEXT NOT NULL DEFAULT 'pending',
  accepted_by_desk_id         TEXT,
  accepted_pub_key            TEXT,
  expires_at                  TEXT NOT NULL,
  created_at                  TEXT NOT NULL,
  updated_at                  TEXT NOT NULL,
  CHECK (status IN ('pending','accepted','declined','expired'))
);

CREATE INDEX idx_pairing_target ON pairing_intents(resolved_target_person_id, status);

-- Idempotency cache (mirror of desk-side data-model.md § 4.13 schema)
CREATE TABLE idempotency_cache (
  request_id        TEXT PRIMARY KEY,
  sender_desk_id    TEXT NOT NULL,
  cached_response   JSONB NOT NULL,
  payload_hash      TEXT NOT NULL,
  expires_at        TEXT NOT NULL,
  created_at        TEXT NOT NULL
);

CREATE INDEX idx_idempotency_expires ON idempotency_cache(expires_at);

-- Retry queue (mirror of desk-side data-model.md § 4.12)
CREATE TABLE retry_queue (
  id                TEXT PRIMARY KEY,
  operation_kind    TEXT NOT NULL,
  operation_payload JSONB NOT NULL,
  attempt_count     INTEGER NOT NULL DEFAULT 0,
  max_attempts      INTEGER NOT NULL DEFAULT 9,
  next_attempt_at   TEXT NOT NULL,
  last_attempt_at   TEXT,
  last_error        JSONB,
  created_at        TEXT NOT NULL
);

CREATE INDEX idx_retry_due ON retry_queue(next_attempt_at) WHERE attempt_count < max_attempts;

-- Audit aggregate (V2 — for compliance export)
CREATE TABLE audit_aggregate (
  id              TEXT PRIMARY KEY,
  source_desk_id  TEXT NOT NULL,
  occurred_at     TEXT NOT NULL,
  kind            TEXT NOT NULL,
  payload         JSONB NOT NULL,
  recorded_at     TEXT NOT NULL
);

CREATE INDEX idx_audit_aggregate_desk_time ON audit_aggregate(source_desk_id, occurred_at DESC);
```

## 6. Scaling Story

V1: single relay instance, single Postgres, ~1000 connected desks.
V1.x: still single relay; ~10K desks (vertical scale + tuning).
V2: multi-instance relay with sticky SSE routing; ~100K desks per region.
V3: multi-region with cross-region routing; 1M+ desks.

### Horizontal scaling approach

```
                    ┌──────────────┐
                    │ Load balancer│
                    └──────┬───────┘
                           │
            ┌──────────────┼──────────────┐
            │              │              │
       ┌────▼────┐    ┌────▼────┐    ┌────▼────┐
       │ Relay 1 │    │ Relay 2 │    │ Relay 3 │
       └─────────┘    └─────────┘    └─────────┘
            │              │              │
            └──────┬───────┴──────┬───────┘
                   │              │
              ┌────▼──────┐  ┌────▼──────┐
              │ Postgres  │  │ NATS /    │
              │ (primary  │  │ Redis     │
              │ + read    │  │ (cross-   │
              │ replicas) │  │  instance │
              │           │  │  pub/sub) │
              └───────────┘  └───────────┘
```

**Sticky SSE routing**: Each desk gets routed to a specific relay instance via consistent hash on `desk_id`. The instance holds the desk's SSE connection. Cross-instance event delivery uses NATS / Postgres LISTEN-NOTIFY.

**Stateless services**: JWT, pairing, idempotency, retry — all stateless processing; state in DB. Any instance can serve any request.

**Read scaling**: Postgres read replicas for the routing table queries (eventually consistent). Hot routing entries cached in-memory.

### Bottleneck analysis

At 100K desks, expected hotspots:

- SSE connection memory (~100K open connections; Bun handles ~1M per instance per published benchmarks; we'd want 5-10 instances for headroom)
- Postgres write throughput on `audit_aggregate` (V2; can shard by `source_desk_id` hash)
- Object storage egress for by-reference payload fetches (CDN in front)

## 7. Deployment Topology

### V1 reference deployment

- 1 relay instance (Bun + Hono)
- 1 Postgres primary
- 1 S3-compatible bucket (or local minio for self-hosted)
- TLS terminating load balancer or built-in
- Observability: structured JSON logs to stdout, Prometheus scraping `/metrics`, OTel traces to a collector

Single-region. Estimated cost: ~$50/month at low traffic on most clouds.

### V2 production deployment

- 3+ relay instances behind load balancer
- Postgres primary + 2 read replicas
- NATS for cross-instance pub/sub
- Bucket-per-tenant in object storage with lifecycle policies
- CDN in front of object storage for fetch paths
- Multi-AZ within one region

### V3 enterprise deployment

- Multi-region (US + EU + APAC) with region-pinned data residency
- Per-org dedicated relay clusters available
- HSM for JWT signing key
- On-prem option (Helm chart shipping the whole stack)

## 8. Operations

### 8.1 SLOs (per `reliability-and-testing.md` § 6 + relay's own contributions)

| SLO | Target |
|---|---|
| Dispatch ack p50 | ≤ 100 ms |
| Dispatch ack p95 | ≤ 300 ms |
| SSE push p50 | ≤ 50 ms |
| SSE push p95 | ≤ 200 ms |
| Revocation propagation p95 | ≤ 2 s |
| Relay availability | 99.9% (V1); 99.95% (V2); 99.99% (V3) |
| Audit aggregate durability | 99.999% |

### 8.2 Metrics (relay-specific, per `observability-and-metrics.md` to be written)

- `holon_relay_connected_desks` (gauge)
- `holon_relay_pairing_intents_pending` (gauge)
- `holon_relay_idempotency_cache_size` (gauge)
- `holon_relay_idempotency_cache_hit_rate` (gauge)
- `holon_relay_retry_queue_depth` (gauge)
- `holon_relay_request_duration_seconds` (histogram, by method)
- `holon_relay_sse_connections_active` (gauge)
- `holon_relay_object_storage_bytes_stored` (gauge, per tenant V2)

### 8.3 Alerts

- `connected_desks` drops sharply (regional outage signal)
- `idempotency_cache_hit_rate > 50%` (active replay attack signal)
- `pairing_intents_pending > 10000` (flooding attack)
- `request_duration_seconds p95 > 1s` for any method (degradation)
- `retry_queue_depth > 100K` (downstream issue causing accumulation)
- `idempotency_conflict_rate > baseline` (security signal)

### 8.4 Runbook outline

For V1, runbooks live in operator docs (later). Key incident classes:

- **Relay restart needed.** Drain SSE connections (broadcast `going-away` event so desks reconnect); restart; desks reconnect with `Last-Event-ID`.
- **Postgres failover.** Standard Postgres HA. Requires brief read-only window.
- **Bucket / object storage outage.** By-reference payload fetches fail; queue with retry. By-value still works.
- **Mass revocation event.** Publish revocations to SSE; clients update local state. Audit-log every revocation.

### 8.5 V1 Operating Model (BYOK + Free, Three Transport Modes)

In V1, the cloud relay is operated by the Holon project on a best-effort basis per ADR-011:

- No SLA promised. Target availability per § 8.1 SLOs is a goal, not a contract.
- Per-desk rate caps apply (rates TBD at implementation; designed to allow normal usage without hitting limits).
- Relay cost absorbed by the project. No billing integration in V1.
- No payment-related claims in JWTs; no entitlement enforcement.
- Relay-side audit emission uses the V1 post-emit pattern per ADR-007: relay emits audit events after relay state changes (revocations, routing updates, pairing completions).

Per ADR-008, the cloud relay is one of three V1 transport modes (cloud-relay, direct-peer, local-only). Users in direct-peer or local-only mode do not use this relay. V2 evaluates whether to introduce a paid relay tier.

## 9. Threat Surface (cross-ref)

The relay's threat surface is consolidated in `security-threat-model.md` § 3.4 (relay/infrastructure threats). Key items:

- T13 — Compromised relay (Critical)
- T14 — Routing table tampering (High)
- T15 — Pairing intent flooding (Low; rate-limited)
- T16 — Person-id enumeration (Low; high-entropy codes)
- T26 — Relay key compromise (Critical)

Relay-side mitigations:
- HSM for JWT signing key
- Relay code audit + supply chain controls
- Per-source rate limiting
- Cross-desk audit reconciliation tooling (V2)

## 10. Open Decisions

1. **Bun vs Node.js.** Bun is fast and matches the JS-native shape of the project; Node has larger ecosystem. Recommend Bun for V1.
2. **NATS vs Postgres LISTEN/NOTIFY for cross-instance pub/sub.** NATS is purpose-built; Postgres is one less moving part. V1: single instance, neither needed. V2: pick when sharding lands.
3. **Object storage lifecycle policy.** Default deletion of by-reference uploads after handoff completion; or keep for replay/audit? Trade-off privacy vs convenience.
4. **Audit aggregate retention.** V2 customers may need 7-year retention for compliance. Cold storage tier.
5. **Multi-region routing.** When relay goes multi-region, how is a person's desks-across-regions handled? Sticky to home region with cross-region forwarding?
6. **Self-hosted relay.** What's the V3 self-hosted distribution — Docker Compose? Helm chart? Both? Decide V2.
7. **WebSocket fallback.** SSE works through proxies but some corporate proxies buffer (per `peer-communication-architecture.md` § 6.2). Should the relay also accept WebSocket as an alternative transport? Operational complexity.

## 11. Cross-References

- Desk-side wire protocol: `peer-communication-architecture.md` §§ 5, 6
- Auth & JWT lifecycle: `auth-and-identity.md` §§ 5, 6
- Idempotency strategy: `peer-communication-architecture.md` § 9
- Retry schedule: `peer-communication-architecture.md` § 9.2
- DB schema (desk-side mirror tables): `data-model.md` §§ 4.12, 4.13
- Threats specific to the relay: `security-threat-model.md` § 3.4
- Reliability / SLOs: `reliability-and-testing.md` § 6

## 12. Acceptance Criteria

V1 implementation-ready when:

1. ✅ All 9 relay responsibilities (§ 2) have a service module
2. ✅ Component map shows the V1 single-instance architecture
3. ✅ Relay-side data model schema specified
4. ✅ Scaling story sketched through V3
5. ✅ Deployment topology for V1 is concrete
6. ✅ SLOs aligned with reliability-and-testing.md
7. ✅ Threat surface cross-referenced
8. ⬜ A reference V1 relay deploys successfully on a single small instance and serves 100+ test desks (M4 gate)
9. ⬜ Multi-instance sticky SSE routing implemented and load-tested (V2)

# Reliability and Testing

Status: draft v0.1
Date: 2026-05-15
Owner: design
Position: Operationalizes the "no silent failure" invariant declared in `functional-architecture.md` § 7.3. Specifies the error taxonomy, retry policy, failure modes per architectural layer, observability hooks, and the test strategy that proves the system honors its commitments.

## 1. Scope

This document is what makes Holon's "no silent failure" promise enforceable rather than aspirational. It covers:

- the unified error taxonomy across all layers
- the retry decision matrix (when to retry, with what schedule, how many times)
- failure modes per architectural layer with required surfacing behavior
- observability requirements: logs, metrics, traces, audit hooks
- the SLO portfolio and how each is measured
- the test strategy: unit, integration, end-to-end, contract, chaos
- conformance suites for runtime adapters
- recovery patterns for the common failure classes

What this doc does NOT cover:

- specific incident-response runbooks → operator docs (V2)
- analytics / business metrics → V2
- the cloud relay's own SRE practice → relay-ops doc (V2)

## 2. The "No Silent Failure" Invariant — Operational Definition

The invariant from `functional-architecture.md` § 7.3 in operational terms:

> Every state transition that does not reach the expected terminal state MUST surface as either:
> (a) a typed error event in the audit bus visible to the owner, AND
> (b) a UI-visible state change in the relevant entity (assignment, mission, handoff, connection, runtime job).
>
> Silent failure is defined as: the system entered an unexpected state, did not surface it within the SLO for that layer, and a subsequent observer cannot see what happened via audit inspection.

Three structural enforcement mechanisms:

1. **Typed error union exhaustiveness.** Every layer's API returns a union type that includes all known error codes. New error paths require extending the union (compile-time check). Generic `Error` catches with no typed code are forbidden by lint rule.
2. **Audit-emit after state-change (V1 posture per ADR-007).** Service methods run the state change first; on success, emit the corresponding audit event. On failure, emit the failure event before surfacing the error to the caller. The strict pre-emit pattern ("attempt → change → success/failure") is the V3 target when compliance requirements demand full event-sourcing; it is not a V1 invariant. Emit failures (where state changed but audit write failed) are counted in `holon_audit_emit_failures_total`.
3. **UI subscription completeness.** Every entity-status surface in the UI subscribes to the relevant audit event kinds; tests verify the subscription set covers every error event that targets the entity kind.

## 3. Unified Error Taxonomy

A single error taxonomy across all layers. Each error has a code, severity, retryability, and "who needs to see it" classification.

### 3.1 Error Codes

```typescript
export type HolonErrorCode =
  // ── Runtime layer (per runtime-adapter-interface.md § Error Model) ──
  | "RUNTIME_BUDGET_EXCEEDED"
  | "RUNTIME_TOOL_DENIED"
  | "RUNTIME_TOOL_FAILED"
  | "RUNTIME_CONTEXT_UNAVAILABLE"
  | "RUNTIME_UNREACHABLE"
  | "RUNTIME_CRASHED"
  | "RUNTIME_INVALID_CONFIG"
  | "RUNTIME_UNSUPPORTED_CAPABILITY"
  | "RUNTIME_PERMISSION_DENIED"
  | "RUNTIME_KILLED"
  | "RUNTIME_INTERNAL"

  // ── Handoff layer (semantic / form-related) ──
  | "HANDOFF_FORM_UNSUPPORTED"
  | "HANDOFF_FORM_INVALID"
  | "HANDOFF_FORM_DECLINED"
  | "HANDOFF_AUTHORITY_INSUFFICIENT"
  | "HANDOFF_DUAL_COSIGN_TIMEOUT"
  | "HANDOFF_DUAL_COSIGN_DENIED"
  | "HANDOFF_AXES_HASH_MISMATCH"
  | "HANDOFF_PARENT_INVALID"
  | "HANDOFF_DEADLINE_EXPIRED"

  // ── Wire / connection layer (per peer-communication-architecture.md § 5.4) ──
  | "WIRE_INVALID_TOKEN"
  | "WIRE_CONNECTION_REVOKED"
  | "WIRE_SIGNATURE_FAILED"
  | "WIRE_REPLAY_DETECTED"
  | "WIRE_RECIPIENT_NOT_FOUND"
  | "WIRE_NO_DEVICE_AVAILABLE"
  | "WIRE_PACKET_TOO_LARGE"
  | "WIRE_IDEMPOTENCY_CONFLICT"
  | "WIRE_RELAY_INTERNAL"
  | "WIRE_RELAY_UNREACHABLE"
  | "WIRE_TIMEOUT"
  | "WIRE_RATE_LIMITED"

  // ── Auth / identity layer (per auth-and-identity.md) ──
  | "AUTH_JWT_EXPIRED"
  | "AUTH_JWT_DENIED"           // jti on denylist
  | "AUTH_REFRESH_DENIED"
  | "AUTH_DEVICE_REVOKED"
  | "AUTH_DEVICE_KEY_MISMATCH"
  | "AUTH_PAIRING_TIMEOUT"
  | "AUTH_CONTROLLER_UNAUTHORIZED"
  | "AUTH_CAPABILITY_INSUFFICIENT"

  // ── Storage layer ──
  | "DB_CONSTRAINT_VIOLATION"
  | "DB_DEADLOCK"
  | "DB_DISK_FULL"
  | "DB_UNREACHABLE"
  | "STORAGE_FILE_NOT_FOUND"
  | "STORAGE_FILE_TOO_LARGE"
  | "STORAGE_QUOTA_EXCEEDED"

  // ── Routing / scheduler ──
  | "ROUTE_NO_STAFF_AVAILABLE"
  | "ROUTE_STAFF_AT_CAPACITY"
  | "ROUTE_CIRCULAR_REFERENCE"
  | "ROUTE_TARGET_ARCHIVED"

  // ── Cross-cutting ──
  | "VALIDATION_FAILED"
  | "RATE_LIMIT_EXCEEDED"
  | "INTERNAL_INVARIANT_VIOLATION";
```

### 3.2 Error Envelope

Every error surfaces in the same envelope:

```typescript
export interface HolonError {
  code: HolonErrorCode;
  message: string;                       // human-readable, NOT for parsing
  layer: "runtime" | "handoff" | "wire" | "auth" | "storage" | "routing" | "cross_cutting";
  severity: "info" | "warning" | "error" | "critical";
  retryable: boolean;
  context: {                              // structured for debugging; sanitized of secrets
    entityKind?: string;
    entityId?: string;
    operation?: string;
    correlationId?: string;
    stackHash?: string;                   // hashed stack trace for grouping
  };
  cause?: HolonError;                     // wrapped cause for nested failures
  occurredAt: string;                     // ISO-8601
}
```

Error logging discipline:

- `info` — expected non-failures (e.g., handoff declined for legitimate policy reasons). Logged but no alert.
- `warning` — degradations that didn't yet fail (e.g., approaching budget). Surfaced to owner UI but not loud.
- `error` — operation failed; user-visible; may be retryable.
- `critical` — invariant violation (`INTERNAL_INVARIANT_VIOLATION`, data corruption suspected). Pages on-call. Aborts current operation.

### 3.3 Retryability Matrix

The single source of truth for "should we retry this." Other docs reference this table.

| Code | retryable | Why | Default schedule |
|---|---|---|---|
| RUNTIME_BUDGET_EXCEEDED | false | Same limit, same outcome | — |
| RUNTIME_TOOL_DENIED | false | Permission boundary intentional | — |
| RUNTIME_TOOL_FAILED | true | Network / API blip likely transient | runtime-internal: 3× immediate |
| RUNTIME_CONTEXT_UNAVAILABLE | true | Context store may recover | runtime-internal: 3× backoff 100/300/1000 ms |
| RUNTIME_UNREACHABLE | true | Process restart possible | system: ×3 with 5s/30s/2m backoff |
| RUNTIME_CRASHED | true (once) | Crash may be transient | system: ×1 retry; abandon if recurs |
| RUNTIME_INVALID_CONFIG | false | Caller bug | — |
| RUNTIME_UNSUPPORTED_CAPABILITY | false | Routing decision was wrong | — |
| RUNTIME_PERMISSION_DENIED | false | Authority constraint enforced | — |
| RUNTIME_KILLED | false | Caller intent | — |
| RUNTIME_INTERNAL | false | Bug — investigate, not retry | — |
| HANDOFF_FORM_UNSUPPORTED | false | Receiver doesn't support form; need different form | — |
| HANDOFF_FORM_INVALID | false | Sender bug | — |
| HANDOFF_FORM_DECLINED | false | Receiver policy | — |
| HANDOFF_AUTHORITY_INSUFFICIENT | false | Sender lacks scope | — |
| HANDOFF_DUAL_COSIGN_TIMEOUT | false | Co-signer didn't sign in time | — |
| HANDOFF_DUAL_COSIGN_DENIED | false | Co-signer refused | — |
| HANDOFF_AXES_HASH_MISMATCH | false | Tampering detected; security event | — |
| HANDOFF_PARENT_INVALID | false | Chain integrity broken | — |
| HANDOFF_DEADLINE_EXPIRED | false | Time-bounded handoff aged out | — |
| WIRE_INVALID_TOKEN | false (after refresh) | Refresh JWT, then retry the request once | post-refresh: 1× |
| WIRE_CONNECTION_REVOKED | false | Connection dead | — |
| WIRE_SIGNATURE_FAILED | true (likely transient) | Clock skew or rare collision; retry once | wire: ×1 |
| WIRE_REPLAY_DETECTED | false | Cache says we already have an answer; use that | — |
| WIRE_RECIPIENT_NOT_FOUND | false | Receiver desk doesn't exist; sender bug | — |
| WIRE_NO_DEVICE_AVAILABLE | true | Recipient may come online | Stripe schedule (peer-comms § 9.2) |
| WIRE_PACKET_TOO_LARGE | false | Sender must restructure (use by-reference) | — |
| WIRE_IDEMPOTENCY_CONFLICT | false | Reused key with different payload — bug | — |
| WIRE_RELAY_INTERNAL | true | Relay-side issue, transient | Stripe schedule |
| WIRE_RELAY_UNREACHABLE | true | Network / DNS / relay outage | Stripe schedule |
| WIRE_TIMEOUT | true | Network blip | Stripe schedule |
| WIRE_RATE_LIMITED | true | Per Retry-After header | server-specified |
| AUTH_JWT_EXPIRED | true (after refresh) | Refresh and retry once | post-refresh: 1× |
| AUTH_JWT_DENIED | false | JWT denylisted | — |
| AUTH_REFRESH_DENIED | false | Re-auth required | — |
| AUTH_DEVICE_REVOKED | false | Device killed | — |
| AUTH_DEVICE_KEY_MISMATCH | false | Bug or attack | — |
| AUTH_PAIRING_TIMEOUT | false | Re-initiate pairing | — |
| AUTH_CONTROLLER_UNAUTHORIZED | false | Controller scope insufficient | — |
| AUTH_CAPABILITY_INSUFFICIENT | false | Caller bug | — |
| DB_CONSTRAINT_VIOLATION | false | Caller bug | — |
| DB_DEADLOCK | true | Standard deadlock retry | local: ×3 with jittered backoff |
| DB_DISK_FULL | false (until operator action) | Cannot self-heal | — |
| DB_UNREACHABLE | true | DB restart possible | local: ×5 with backoff |
| STORAGE_FILE_NOT_FOUND | false | Reference is stale | — |
| STORAGE_FILE_TOO_LARGE | false | Sender must chunk | — |
| STORAGE_QUOTA_EXCEEDED | false (until operator) | Cannot self-heal | — |
| ROUTE_NO_STAFF_AVAILABLE | false | Owner must add capacity | — |
| ROUTE_STAFF_AT_CAPACITY | true | Wait for slot | local: poll q 5s up to 5 min |
| ROUTE_CIRCULAR_REFERENCE | false | Bug | — |
| ROUTE_TARGET_ARCHIVED | false | Re-route required | — |
| VALIDATION_FAILED | false | Caller bug | — |
| RATE_LIMIT_EXCEEDED | true | Per Retry-After | server-specified |
| INTERNAL_INVARIANT_VIOLATION | false | CRITICAL — page on-call | — |

### 3.4 The Three Retry Schedulers

Three retry domains exist; each owns a slice of the matrix.

1. **Runtime-internal retries** — inside the runtime adapter, for transient runtime/tool failures. Bounded (3×), fast (≤ 1s aggregate). Hidden from product-layer audit unless ultimate failure.
2. **Local system retries** — inside one desk, for local operations (DB deadlock, runtime crash). Bounded (3–5×), short backoff (seconds to minutes). Audit emitted on each attempt.
3. **Distributed retries via the retry queue** — for cross-desk operations (handoff dispatch, deliverable callback). Stripe schedule per `peer-communication-architecture.md` § 9.2 (immediate, 5m, 30m, 2h, 5h, 10h, 12h × 3, abandon at ~3 days). Persisted in `retry_queue` table per `data-model.md` § 4.12.

## 4. Failure Modes Per Layer

For each architectural layer, the canonical failure modes and the required surfacing behavior.

### 4.1 Runtime Layer Failures

| Mode | Detection | Surfacing | Recovery |
|---|---|---|---|
| Runtime process crashes mid-job | Adapter health check fails or job stream EOFs unexpectedly | Emit `RUNTIME_CRASHED` event; assignment → `failed` (or `retrying` if first crash); UI shows "AI staff crashed; retry?" | One automatic retry; if recurs, prompt owner |
| Tool call hangs | Per-tool timeout (default 30s) | Emit `RUNTIME_TOOL_FAILED` event (with `tool_call_id`); job continues with tool error returned to runtime | Runtime decides whether to abort or continue; if abort, emits `error` |
| Budget exceeded mid-job | Cost meter crosses threshold | Emit `RUNTIME_BUDGET_EXCEEDED`; job → terminal with partial output preserved | Owner decides: extend budget and re-run, or accept partial |
| Tool denied | Tool not in allowed list | Emit `RUNTIME_TOOL_DENIED` event; runtime should not have requested this — bug indicator | No retry; owner must adjust tool scope |
| Permission scope violation | Authority check fails inside adapter | Emit `RUNTIME_PERMISSION_DENIED`; this is the confused-deputy alarm | No retry; investigate why runtime tried to escalate |
| Adapter cannot reach runtime | Connect / heartbeat fails | Emit `RUNTIME_UNREACHABLE`; adapter status = `failed` | System retry per matrix |

### 4.2 Handoff Layer Failures

| Mode | Detection | Surfacing | Recovery |
|---|---|---|---|
| Receiver returns `form_unsupported` | Wire-layer typed error | Emit `HANDOFF_FORM_UNSUPPORTED`; handoff → `failed`; surface form choice UI to sender | Owner picks compatible form and re-sends |
| Dual cosign times out | Deadline tracker | Emit `HANDOFF_DUAL_COSIGN_TIMEOUT`; handoff → `expired`; both signers notified | Sender re-initiates if still wanted |
| Axes hash mismatch on receive | Hash recomputed on receipt | Emit `HANDOFF_AXES_HASH_MISMATCH` (severity: critical); handoff refused; security event logged | Investigate; potential tampering |
| Parent handoff invalid | Sub-handoff references nonexistent / unauthorized parent | Emit `HANDOFF_PARENT_INVALID`; refuse | Sender bug; fix and re-send |
| Deadline expires mid-work | Background sweeper | Emit `HANDOFF_DEADLINE_EXPIRED`; if escalation ladder set, fire it; otherwise → `expired` | Per escalation policy |

### 4.3 Wire / Connection Layer Failures

| Mode | Detection | Surfacing | Recovery |
|---|---|---|---|
| Recipient offline | Relay returns `WIRE_NO_DEVICE_AVAILABLE` | Connection health → `degraded`; mission queued at relay; UI shows "queued, will deliver when X comes online" | Auto-retry per Stripe schedule |
| Signature failure | HMAC verify fails | Emit `WIRE_SIGNATURE_FAILED`; one retry (clock skew); persistent failure → `WIRE_INVALID_TOKEN` cascade | Connection key rotation if persistent |
| Replay detected | Idempotency cache hit with same key | Return cached response (this is correct behavior, not a failure) | None needed |
| Idempotency conflict | Same key, different payload | Emit `WIRE_IDEMPOTENCY_CONFLICT`; refuse; sender bug | Sender must investigate |
| Relay unreachable | DNS / connection refused / 5xx | Emit `WIRE_RELAY_UNREACHABLE`; queue locally; transition connection → `offline` after 5min | Stripe retry; eventually owner sees "no relay reachable" |
| SSE connection drops | Heartbeat gap > 45s | Reconnect with `Last-Event-ID`; missed events replayed; transient — usually invisible to owner | Auto |

### 4.4 Auth Failures

| Mode | Detection | Surfacing | Recovery |
|---|---|---|---|
| JWT expired | 401 with `expired` reason | Auto-refresh; retry once | Auto |
| JWT denylisted | 401 with `denied` reason | Emit `AUTH_JWT_DENIED`; force re-auth UI | Owner re-confirms identity |
| Refresh denied | 401 on refresh | Emit `AUTH_REFRESH_DENIED`; force full re-auth | Owner re-pairs the desk |
| Device revoked | 401 with `device_revoked` | Emit `AUTH_DEVICE_REVOKED`; the desk shuts down (revoked devices cannot continue) | Re-pairing required |
| Pairing timeout | Pairing intent expires (1h default) | Emit `AUTH_PAIRING_TIMEOUT`; UI shows expired intent | Re-initiate pairing |

### 4.5 Storage Failures

| Mode | Detection | Surfacing | Recovery |
|---|---|---|---|
| DB deadlock | Postgres SQLSTATE 40001 | Auto-retry up to 3× | Auto |
| DB disk full | INSERT fails with disk-full code | Emit `DB_DISK_FULL` (critical); halt writes; alert owner | Operator action required |
| File not found | Open returns ENOENT | Emit `STORAGE_FILE_NOT_FOUND`; deliverable file reference is stale | Investigation required |
| Quota exceeded (per-desk) | Pre-write check | Emit `STORAGE_QUOTA_EXCEEDED`; refuse write; surface to owner | Owner archives old deliverables or upgrades plan |

### 4.6 Routing Failures

| Mode | Detection | Surfacing | Recovery |
|---|---|---|---|
| No staff for role | Empty candidate set | Emit `ROUTE_NO_STAFF_AVAILABLE`; assignment → `blocked`; owner queue | Owner adds staff or accepts assignment themselves |
| Staff at capacity | All candidates at `max_concurrent_jobs` | Emit `ROUTE_STAFF_AT_CAPACITY`; assignment polls; owner can manual override | Auto-resolve when slot opens |
| Circular reference | Sub-handoff would create cycle | Emit `ROUTE_CIRCULAR_REFERENCE` (critical); refuse | Bug — investigate routing logic |
| Target archived | Routing computed; staff archived between compute and dispatch | Emit `ROUTE_TARGET_ARCHIVED`; re-route to role | Auto re-route |

## 5. Observability Requirements

### 5.1 Logs

- All errors (severity ≥ `error`) logged with the full envelope.
- Logs are structured JSON, one event per line, with a stable schema.
- Sensitive fields (signing keys, refresh tokens, raw deliverable content) are NEVER logged. Linter rule + runtime check.
- Log destination: stdout (always); file (configurable); cloud aggregator (V2).

Standard log fields:

```
{
  ts: "2026-05-15T14:23:01.123Z",
  level: "error",
  layer: "wire",
  code: "WIRE_RELAY_UNREACHABLE",
  message: "...",
  desk_id: "desk_...",
  correlation_id: "...",
  context: { ... },
  stack_hash: "abc123"      // grouping key; full stack only in dev mode
}
```

### 5.2 Metrics

A small fixed set; resist the urge to add metrics for everything.

| Metric | Type | Tags | What it tells you |
|---|---|---|---|
| `holon_assignments_active` | gauge | desk, status | How many assignments are in each state |
| `holon_handoffs_active` | gauge | desk, direction, state | Outbound and inbound handoffs by state |
| `holon_assignments_completed_total` | counter | desk, outcome (done/cancelled/failed) | Throughput |
| `holon_handoff_dispatch_duration_seconds` | histogram | desk, form, recipient_kind | End-to-end dispatch latency |
| `holon_runtime_job_duration_seconds` | histogram | desk, adapter, role | Runtime execution time |
| `holon_runtime_event_lag_seconds` | histogram | desk, adapter | Adapter latency budget compliance (per `runtime-adapter-interface.md` § Latency Budget) |
| `holon_wire_signature_failures_total` | counter | desk, connection, source | Security signal |
| `holon_retry_attempts_total` | counter | desk, operation_kind, outcome | Retry layer health |
| `holon_audit_events_emitted_total` | counter | desk, kind | Audit completeness signal |
| `holon_invariant_violations_total` | counter | desk, invariant | MUST stay at zero in production |
| `holon_connection_health_state` | gauge | desk, connection, state | Per-connection live state |

`holon_invariant_violations_total > 0` is a paging alert, always.

### 5.3 Distributed Traces

For cross-desk handoffs, propagate W3C Trace Context (`traceparent` header) across desks. Each handoff becomes one trace; each desk's handling is a span; child handoffs are child spans. Sampling: 100% in dev, 1% in prod (adjustable per desk policy).

Tools: OpenTelemetry SDK; export to Jaeger/Tempo/whatever the operator chooses. Spec is OTel-conformant; no vendor lock.

### 5.4 Audit Hooks

Every event written to `audit_events` (per `data-model.md` § 4.11) is also fanned out to:

- the desk's UI subscriber (live update)
- the metrics collector (counter/gauge updates)
- the retry layer (when error events match retryable codes)
- the V2 audit-aggregator (cross-desk audit warehouse for compliance)

Audit hooks are decoupled — a slow subscriber must not block the audit write.

## 6. SLO Portfolio

The SLOs Holon commits to. Each is measured continuously and reported in the operator dashboard.

| SLO | Target | Measurement |
|---|---|---|
| Mission inbox delivery (Core 2 → Core 1) | p95 < 600 ms end-to-end | From relay receipt to receiver UI render |
| Runtime adapter event lag | per `runtime-adapter-interface.md` § Latency Budget | First-event arrival time |
| Handoff dispatch ack | p95 < 300 ms | Sender desk submit → relay ack |
| Connection revocation propagation | p95 < 2 s | Owner click → remote desk UI shows revoked |
| Audit event durability | 99.999% | Emitted events that survive a desk crash |
| Cross-desk callback success rate (eventual) | > 99% within 3-day retry window | After Stripe schedule completes |
| Owner-visible state freshness | < 1 s lag from underlying state | Time from DB write to UI update |
| Invariant violations | 0 in any 30-day window | `holon_invariant_violations_total` rate |

## 7. Test Strategy

Multiple test layers, each owning a different failure class.

### 7.1 Unit Tests

- Coverage target: 80% statement, 100% on critical paths (handoff form validation, idempotency cache, retry schedule logic, audit-emit-before-state-change).
- No I/O. No DB. Pure functions and isolated module behavior.
- Per-PR enforcement.

### 7.2 Integration Tests

- Real local DB (SQLite or Postgres test container).
- Real runtime adapter (dummy adapter for speed; the live CLI adapter — `cli-adapters.ts` + `cli-session-service.ts` — exercised in nightly CI). *Earlier sister-repo drafts used a Hermes adapter here; `manage-your-cli` has no Hermes adapter.*
- Test scenarios per use case in `peer-communication-architecture.md` § 2.
- Per-PR for fast scenarios; nightly for the full set.

### 7.3 End-to-End Tests

- Two-desk topology: spin up two desks + one relay in CI.
- Walk through canonical flows: pure local, outbound to peer, inbound mission, deliverable return, multi-hop cascade.
- Browser-based UI verification (Playwright / Cypress) for the owner-visible surface.
- Per-PR for one canonical flow; nightly for the full matrix.

### 7.4 Contract Tests

- Wire-protocol conformance: a test rig that speaks to any Holon-conformant relay/desk and verifies all 13 RPC methods + error responses match spec.
- Runtime adapter conformance: per [`legacy/runtime-adapter-interface.md`](legacy/runtime-adapter-interface.md) § Acceptance Criteria (sister-repo lineage); lives at `packages/runtime-conformance` and runs against the dummy adapter and the live CLI adapter (`packages/core/src/cli-adapters.ts`).
- Handoff form conformance: every form's lifecycle states transition correctly per `handoff-taxonomy.md` revocation matrix.

### 7.5 Chaos Tests

For "no silent failure" enforcement specifically. Each test asserts that a specific failure is surfaced correctly.

| Chaos scenario | Injected failure | Required observable |
|---|---|---|
| Network partition between desks | Drop all wire traffic for 60s | Connection state moves to `offline` within 5min; in-flight handoffs visible as retrying; resume on partition heal |
| DB crash mid-write | Kill Postgres during a transaction | App detects, surfaces error, retries; no partial state in audit log |
| Relay restart | Bounce relay process | Desks detect SSE drop; reconnect with last-event-id; replayed events not duplicated |
| Runtime hang | Block runtime tool call indefinitely | Per-tool timeout fires; `RUNTIME_TOOL_FAILED` event; runtime decides next action |
| Disk full | Fill the disk to 100% | `DB_DISK_FULL` event (critical); halt writes; alert visible |
| JWT expiry mid-request | Force JWT expiry between requests | Silent refresh; retry succeeds; no user-visible disruption |
| Refresh denial | Revoke refresh token mid-session | Re-auth UI surfaces; old session preserves draft state |
| Cosigner offline at deadline | Dual auth handoff with cosigner offline past deadline | `HANDOFF_DUAL_COSIGN_TIMEOUT` fires; both signers see expired |
| Cascade with mid-chain failure | A→B→C; C fails at last step | Failure propagates back to B, then A; A sees handoff failed with reason; can re-initiate |
| Replay attack | Replay a captured request | Idempotency cache returns cached response; no duplicate effect; security log entry |

Chaos tests run in nightly CI; quarterly drill against staging environment with operator participation.

### 7.6 Property-Based Tests

For algorithms with combinatorial state spaces:

- Handoff form validity: generate random form/axes combinations; verify the validator's accept/reject is consistent with the spec.
- Routing decisions: generate random staff rosters + assignments; verify the router never violates flat-roster invariant or autonomy ceilings.
- Idempotency cache: generate random request streams; verify that retries always return the original response and that conflicts are detected.
- Retry schedule: simulate many failure → success patterns; verify schedule timing matches spec.

### 7.7 Adversarial Tests

Specifically test the "what if a peer desk is hostile" surface:

- Peer sends malformed handoff packets — receiver must reject cleanly.
- Peer sends valid packet with invalid signature — receiver must reject.
- Peer floods with handoffs — receiver's rate limiter must throttle without crashing.
- Peer sends `axes_hash` that doesn't match — receiver must refuse (security event).
- Peer reuses idempotency key with different payload — receiver must detect and reject.

Adversarial tests live in `packages/adversarial-tests` and run on every PR.

## 8. Conformance Suites

### 8.1 Runtime Adapter Conformance

Per [`legacy/runtime-adapter-interface.md`](legacy/runtime-adapter-interface.md) § Acceptance Criteria (sister-repo lineage). The same suite runs against the dummy adapter (reference behavior) and the live CLI adapter (production). New adapters MUST pass all tests before being allowed in production deployment.

### 8.2 Wire Protocol Conformance

Spec'd as a separate test rig: send every method per `peer-communication-architecture.md` § 5.2 and verify response shapes; trigger every error code; verify retry behavior; verify idempotency cache behavior.

### 8.3 Handoff Form Conformance

Walk every form through its lifecycle per `handoff-taxonomy.md`. Verify state transitions, revocation behavior, sub-delegation rules.

## 9. Recovery Patterns

Common failure-recovery patterns the system applies.

### 9.1 Surface, Don't Suppress

When in doubt, surface to the owner. A frequent benign question is preferable to a missed error.

### 9.2 Idempotent By Default

All cross-desk operations carry an idempotency key. Local operations within one desk use database transactions for atomicity. Retries are always safe.

### 9.3 Partial Progress Preservation

When an assignment fails partway, preserve any output produced so far in the deliverable store with status `partial`. Owner can then decide: accept partial, continue from partial, or restart.

### 9.4 Compensation Actions

Forms with side effects (payments, sent emails, published posts) carry a `compensationAction` (per `handoff-taxonomy.md` § Open Decisions #4) declaring how to undo. V2 enforces compensation runs on revocation; V1 records the declaration.

### 9.5 Graceful Degradation

| Component down | What still works |
|---|---|
| Cloud relay unreachable | Local AI work continues; cross-desk work queues locally; UI shows "offline mode" |
| Runtime adapter (live CLI adapter) unreachable | Owner can still review past work, accept/reject inbound missions, do work themselves; AI staff appear paused |
| DB unreachable (catastrophic) | App halts gracefully; user sees "database unreachable; please restart" |
| Single connection broken | Other connections unaffected |

## 10. Implementation Notes

### 10.1 Audit-Emit-Before-State-Change Pattern

```typescript
// WRONG — silent failure if commit() throws
await db.transaction(async tx => {
  await stateChange(tx);
  await auditEvent(tx, "succeeded");
});

// RIGHT — audit attempt always recorded
await auditEvent("attempt", correlationId);
try {
  await db.transaction(async tx => {
    await stateChange(tx);
  });
  await auditEvent("succeeded", correlationId);
} catch (err) {
  await auditEvent("failed", correlationId, { error: err });
  throw err;
}
```

The `attempt` audit event is the proof we tried. The `succeeded` or `failed` is the outcome. Together, the audit log can ALWAYS reconstruct what was attempted, even if individual operations crashed before completing.

### 10.2 No Generic Catch

Lint rule: `catch (err)` blocks must either:
- re-throw after logging, OR
- explicitly handle a typed error (with code), OR
- be marked `@noTypedHandler` with reviewer sign-off and a comment

### 10.3 Test The Test

For "no silent failure" — each chaos test must include an "anti-test" that PROVES the test would catch the failure. Mutation testing helps: deliberately remove the audit emission and verify the test fails.

## 11. Cross-References

- Error codes referenced from: `runtime-adapter-interface.md` (runtime errors), `peer-communication-architecture.md` (wire errors), `auth-and-identity.md` (auth errors)
- Retry queue persistence: `data-model.md` § 4.12
- Audit event schema: `data-model.md` § 4.11
- "No silent failure" invariant declaration: `functional-architecture.md` § 7.3
- Audit completeness invariant: `functional-architecture.md` § 7.5
- SLOs cross-checked against component-specific budgets in respective docs

## 12. Open Decisions

1. **Critical-error paging.** Who/what gets paged on `INTERNAL_INVARIANT_VIOLATION`? V1 = log + critical-banner UI; V2 = ops integration (PagerDuty / Opsgenie).
2. **Per-desk error budget visualization.** Show owner an aggregate "your desk had X errors this week" surface? Useful but might erode trust if not contextualized.
3. **Adversarial test budget.** How much CI time is dedicated to adversarial / fuzz tests? Recommend: 5 minutes per PR, full hour nightly.
4. **Mutation testing depth.** Mutation testing is expensive; which modules get it? Recommend: handoff form validator, idempotency cache, audit emission.
5. **Tracing sample rate per desk.** Default 1% in production but should owners be able to bump to 100% temporarily for debugging?
6. **Compensation action enforcement timing.** V1 declares; V2 enforces. What's the trigger to move from V1 to V2 (real customer demand, specific compliance need)?
7. **Audit log retention vs cost.** "Forever" is the V1 default; in practice some operators will need to age out. Default policy + owner override? Per-desk per-event-kind retention?
8. **Chaos test in production.** Game days / chaos engineering against production — when is it appropriate? Probably not until V2 / paying customers exist.

## 13. Acceptance Criteria

This spec is "implementation-ready" for V1 when:

1. ✅ All 50+ error codes are listed and classified
2. ✅ Retryability matrix is exhaustive and matches each layer's needs
3. ✅ Failure modes per layer have a required surfacing behavior
4. ✅ The 3 retry schedulers are distinguished
5. ✅ Observability requirements (logs, metrics, traces, audit hooks) are specified
6. ✅ SLO portfolio names targets and measurement approach
7. ✅ Test strategy covers unit / integration / E2E / contract / chaos / property / adversarial
8. ✅ "No silent failure" pattern (audit-attempt-before-state-change) is concrete
9. ⬜ Chaos test suite implemented covering all 10 scenarios in § 7.5 (verify in M3)
10. ⬜ Conformance suites pass against dummy adapter (M1) and the live CLI adapter (M2)
11. ⬜ SLO dashboard exists and shows live measurements (M3)
12. ⬜ `holon_invariant_violations_total` is verifiably zero across a 30-day window in staging (M4 gate)

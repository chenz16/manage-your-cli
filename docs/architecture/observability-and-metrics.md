# Observability and Metrics

Status: draft v0.1
Date: 2026-05-15
Owner: design + ops
Position: Deepens the brief observability section in `reliability-and-testing.md` § 5. Specifies log format, metric naming convention, tracing integration, and dashboard design. The operational handbook for keeping Holon visible.

## 1. Scope

What this doc covers:

- structured logging schema and conventions
- metric naming convention + the canonical metric catalog
- distributed tracing integration (OpenTelemetry, W3C Trace Context)
- dashboards (per-desk owner dashboard + operator dashboard)
- alert design
- log/metric/trace retention and storage
- privacy: what NEVER appears in observability data

What this doc does NOT cover:

- the audit log itself (that's `data-model.md` § 4.11 — append-only, persistent, owner-visible)
- specific incident-response runbooks (V2 ops docs)
- analytics / business metrics (V2)

## 2. The Three Pillars

| Pillar | What | Stored where | Retention |
|---|---|---|---|
| **Logs** | Structured JSON events; one per error/notable action | stdout → file → V2 cloud aggregator | 7 days hot, 30 days warm |
| **Metrics** | Counters, gauges, histograms; aggregate behavior | Prometheus-compatible scrape endpoint | 30 days at high resolution; downsampled forever |
| **Traces** | End-to-end request flow across services and desks | OpenTelemetry export to operator's choice | 7 days at full sampling; 1% sampled forever |

**Audit log is a fourth pillar but NOT observability** — it's product state that happens to be append-only. Don't conflate.

## 3. Logging

### 3.1 Log Schema

Every log line is a single JSON object (one line per event):

```json
{
  "ts": "2026-05-15T14:23:01.123Z",
  "level": "error",
  "layer": "wire",
  "code": "WIRE_RELAY_UNREACHABLE",
  "message": "Connection attempt to relay failed after 3 retries",
  "desk_id": "desk_01HKQ8...",
  "person_id": "person_alice",
  "correlation_id": "corr_01HKQ9...",
  "context": {
    "operation": "holon.handoff.dispatch",
    "connection_id": "conn_01HKQ7...",
    "attempt": 3,
    "next_retry_at": "2026-05-15T14:28:01.123Z"
  },
  "stack_hash": "sha256:abc123...",
  "stack": "..."   // only in dev mode; redacted in prod
}
```

### 3.2 Required Fields

| Field | Type | When | Notes |
|---|---|---|---|
| `ts` | ISO-8601 UTC ms | always | UTC always |
| `level` | "info"\|"warning"\|"error"\|"critical" | always | Maps to `HolonError.severity` |
| `layer` | string | always | One of: runtime, handoff, wire, auth, storage, routing, ui, app, cross_cutting |
| `code` | string | when there's an error code | Per `reliability-and-testing.md` § 3.1 |
| `message` | string | always | Human-readable; never for parsing |
| `desk_id` | string | when applicable | Desk emitting the log |
| `correlation_id` | string | always for cross-component flows | UUIDv7 propagated through call chain |

### 3.3 Forbidden Fields (NEVER log these)

- Signing keys (per-connection HMAC, device key private, refresh tokens)
- JWT bearer tokens (the JWT itself; jti is OK to log)
- Deliverable body content (may contain user PII)
- Context pack item contents (same)
- API keys for external services (DeepSeek key, OpenAI key, etc.)
- Personal codes (12-char base32 pairing codes)
- File contents
- Database row contents (column values)

If any of these accidentally appears in a log → critical bug → fix immediately + rotate the credential.

Implementation: a logger middleware that scrubs known-sensitive field patterns before writing. Lint rule: `console.log` is forbidden; only the structured logger.

### 3.4 Log Levels

| Level | When to use |
|---|---|
| `info` | Notable lifecycle events that ARE expected: desk started, connection paired, handoff completed normally. Low volume. |
| `warning` | Degradations or non-fatal anomalies: retry happened (resolved), budget approaching, tool denied (intentional but worth noting). Medium volume. |
| `error` | Operation failed, user-visible. High signal. |
| `critical` | Invariant violation, data corruption suspected, security event. Pages on-call. Should be exceedingly rare. |

If `info` becomes high-volume in production, demote to a metric. Logs are for events; metrics are for rates.

### 3.5 Log Output

- Local desk: stdout (always) + rotating file (`~/.holon/logs/holon-YYYY-MM-DD.log`).
- Cloud-hosted desk: stdout captured by container runtime → log aggregator (operator choice: Loki, ELK, Datadog).
- Relay: same as cloud-hosted desk.

Rotation: daily, gzip after 1 day, delete after 30 days locally.

### 3.6 Trace ID Propagation In Logs

Every log line in a flow shares the same `correlation_id`. Cross-desk flows propagate `correlation_id` via the `X-Holon-Correlation-Id` header on RPC calls.

This makes log aggregation queries trivial: "show me all logs for correlation_id X" gives the full multi-service, multi-desk flow.

## 4. Metrics

### 4.1 Naming Convention

`holon_{component}_{measurement}_{unit}`

- `holon_` prefix: identifies our metrics
- `{component}`: subsystem (assignment, handoff, wire, runtime, retry, audit, relay, etc.)
- `{measurement}`: what's being measured
- `{unit}`: implicit for counters; explicit for histograms (`_seconds`, `_bytes`)

Examples:
- `holon_assignments_active` (gauge)
- `holon_handoff_dispatch_duration_seconds` (histogram)
- `holon_wire_signature_failures_total` (counter)

### 4.2 Canonical Metric Catalog

#### Per-desk metrics

```
# Assignments
holon_assignments_active{desk_id, status}                          gauge
holon_assignments_completed_total{desk_id, outcome}                counter
holon_assignment_duration_seconds{desk_id, outcome}                histogram
holon_assignments_blocked_seconds{desk_id}                         histogram

# Handoffs
holon_handoffs_active{desk_id, direction, state}                   gauge
holon_handoffs_completed_total{desk_id, direction, form, outcome}  counter
holon_handoff_dispatch_duration_seconds{desk_id, form}             histogram
holon_handoff_axes_hash_mismatches_total{desk_id}                  counter

# Runtime adapter
holon_runtime_jobs_active{desk_id, adapter, role}                  gauge
holon_runtime_job_duration_seconds{desk_id, adapter, outcome}      histogram
holon_runtime_event_lag_seconds{desk_id, adapter}                  histogram
holon_runtime_tokens_used_total{desk_id, staff_id, kind}           counter
holon_runtime_cost_millicents_total{desk_id, staff_id}             counter

# Wire / connection
holon_connections_total{desk_id, state}                            gauge
holon_wire_requests_total{desk_id, method, outcome}                counter
holon_wire_request_duration_seconds{desk_id, method}               histogram
holon_wire_signature_failures_total{desk_id, source_connection}    counter
holon_wire_idempotency_hits_total{desk_id, method}                 counter

# Auth
holon_jwt_refreshes_total{desk_id, outcome}                        counter
holon_pairing_attempts_total{desk_id, outcome}                     counter
holon_revocations_total{desk_id, target_kind}                      counter

# Reliability
holon_retry_attempts_total{desk_id, operation_kind, outcome}       counter
holon_retry_queue_depth{desk_id}                                   gauge
holon_audit_events_emitted_total{desk_id, kind}                    counter
holon_invariant_violations_total{desk_id, invariant}               counter   # MUST stay 0

# UI (V2: client-side metrics from owner browser)
holon_ui_page_load_duration_seconds{page}                          histogram
holon_ui_interaction_latency_seconds{component}                    histogram
```

#### Relay-only metrics (per `cloud-relay-architecture.md` § 8.2)

```
holon_relay_connected_desks                                         gauge
holon_relay_pairing_intents_pending                                 gauge
holon_relay_idempotency_cache_size                                  gauge
holon_relay_idempotency_cache_hit_rate                              gauge
holon_relay_retry_queue_depth                                       gauge
holon_relay_request_duration_seconds{method}                        histogram
holon_relay_sse_connections_active                                  gauge
holon_relay_sse_reconnects_total                                    counter
holon_relay_object_storage_bytes_stored{tenant}                     gauge
holon_relay_idempotency_conflict_rate                               gauge       # security signal
```

### 4.3 Metric Cardinality Discipline

Labels with high cardinality blow up metric storage. Rules:

| OK to label | NOT OK to label |
|---|---|
| `desk_id` (bounded by hosting plan) | `assignment_id` (unbounded) |
| `staff_id` (≤ 7 per desk) | `correlation_id` (per-request; unbounded) |
| `state` (small enum) | `error_message` (free-form) |
| `outcome` (success/failure/retried) | `user_input_text` |
| `form` (14 values per `handoff-taxonomy.md`) | `deliverable_id` |

If you need to query by an unbounded dimension, use logs or traces, not metrics.

### 4.4 Metric Exposition

Each component exposes `/metrics` endpoint in Prometheus text format:

```
# HELP holon_assignments_active Currently active assignments by status
# TYPE holon_assignments_active gauge
holon_assignments_active{desk_id="desk_01HKQ8",status="running_local"} 2
holon_assignments_active{desk_id="desk_01HKQ8",status="waiting_remote"} 1
```

Operator's Prometheus / VictoriaMetrics / Mimir scrapes this. V1: single Prometheus instance is fine. V2: federated.

## 5. Distributed Tracing

### 5.1 Standard

OpenTelemetry SDK in TypeScript. W3C Trace Context (`traceparent` / `tracestate` headers) for cross-service propagation.

### 5.2 What's Traced

Each user-initiated action becomes one trace. Examples:

- "Owner creates assignment → router → runtime adapter → deliverable storage" (one trace, ~5-10 spans)
- "Owner accepts inbound mission → handoff layer → assignment creation → routing" (one trace, ~6 spans)
- "Cross-desk handoff dispatch → relay → recipient desk → mission inbox UI render" (one trace, ~10 spans across 3 processes)

### 5.3 Span Conventions

```
operation:        "holon.{layer}.{operation_name}"
                  e.g., "holon.handoff.dispatch", "holon.runtime.start_job"

attributes:
  desk.id:          "desk_..."
  person.id:        "person_..."
  staff.id:         "staff_..." (if applicable)
  handoff.form:     "direct_order" (if applicable)
  handoff.id:       "handoff_..." (if applicable)
  assignment.id:    "assign_..." (if applicable)
  outcome:          "success" | "failure" | "cancelled"
  error.code:       "WIRE_..." (when outcome=failure)
```

Spans never carry: signing keys, deliverable body content, context pack contents, JWT.

### 5.4 Sampling

- **Dev**: 100% sampling.
- **Production V1**: 10% sampling for normal flows; 100% for error flows (sampling decision deferred until after error event seen).
- **Production V2**: configurable per desk. Customers in regulated industries may want 100%.

### 5.5 Trace Backend

OTel-compatible. Operator picks: Jaeger, Tempo, Honeycomb, Datadog APM, etc. V1 ships docker-compose with Jaeger for dev convenience.

## 6. Dashboards

Two audiences need dashboards.

### 6.1 Owner Dashboard (per-desk)

Embedded in the desk app's UI (per `ui-architecture.md`). Shows:

- Today summary (already covered by Today screen)
- Connection health timeline
- Per-staff activity over time
- Cumulative deliverables produced (week-over-week)
- Cost breakdown per staff (V2)

These come from the audit_events table primarily, not from observability metrics. The owner sees product-level state, not infrastructure metrics.

### 6.2 Operator Dashboard (cross-desk)

For Holon's operations team (or self-hosted operator). Shows infrastructure metrics. Standard panels:

**Health overview:**
- Total active desks (gauge)
- Total active connections (gauge)
- Wire request success rate (last 5min)
- Audit events emitted/sec
- `holon_invariant_violations_total` (sparkline; should be flat 0)

**Per-component:**
- Wire layer: request rate by method, p95 latency, error rate
- Auth layer: JWT issuance rate, refresh rate, revocation rate
- Handoff layer: completed handoffs by form, dispatch latency, axes hash mismatches
- Runtime layer: job duration distribution, token consumption, cost rate
- Relay (if applicable): connected desks, SSE connections, idempotency cache hit rate
- Storage: assignment count, deliverable count, retention effectiveness

**SLO compliance:**
- Each SLO from `reliability-and-testing.md` § 6 plotted as "% of last 30 days within target"

Default dashboard: shipped as Grafana JSON in `ops/dashboards/`. Customers can clone and customize.

## 7. Alerts

Alerts go to whichever channel the operator configures (PagerDuty, Opsgenie, Slack, email).

### 7.1 Critical (page on-call immediately)

- `holon_invariant_violations_total > 0` for any 1m window
- `holon_wire_signature_failures_total` rate > baseline×10
- `holon_relay_idempotency_conflict_rate > 1%`
- Any `level=critical` log
- Relay availability < 99% over 5min window

### 7.2 Warning (notify but don't page)

- p95 latency exceeds SLO for any operation over 5min
- `holon_retry_queue_depth > 1000` per desk (sustained 30min)
- Connection state transitions thrashing (>10 per minute on one connection)
- `holon_runtime_event_lag_seconds` p95 > budget × 1.5

### 7.3 Informational (dashboard only)

- New version deployed
- Backup completed
- Routine key rotation
- Daily summary digest

## 8. Privacy In Observability

Specific guidance for what data may flow into logs/metrics/traces:

| Data class | OK in logs | OK in metrics | OK in traces |
|---|---|---|---|
| Desk ID, Person ID | ✅ | ✅ | ✅ |
| Connection ID | ✅ | ✅ | ✅ |
| Handoff form name | ✅ | ✅ | ✅ |
| Handoff state | ✅ | ✅ | ✅ |
| Error code | ✅ | ✅ (via labels) | ✅ |
| Mission title | ⚠ truncate to 80 chars | ❌ (cardinality) | ⚠ truncate |
| Deliverable title | ⚠ truncate to 80 chars | ❌ | ⚠ truncate |
| Mission body | ❌ | ❌ | ❌ |
| Deliverable body | ❌ | ❌ | ❌ |
| Context pack item content | ❌ | ❌ | ❌ |
| Personal code | ❌ | ❌ | ❌ |
| Signing keys, JWTs, refresh tokens | ❌ | ❌ | ❌ |
| File contents / file paths within user's deliverables | ❌ | ❌ | ❌ |

When in doubt, exclude. The audit log (which is owner-controlled) is the right place for content; observability is for infrastructure.

## 9. Owner-Visible Observability

Some observability data is exposed in the owner's UI:

- **Connection health timeline** (per `ui-architecture.md` § 5.4) — derived from `holon_connections_total` state changes
- **Retry indicator on stuck handoffs** — derived from `holon_retry_queue_depth` per-handoff
- **Runtime cost per assignment** — from `holon_runtime_cost_millicents_total`
- **Desk activity over time** — from `holon_assignments_completed_total` aggregated

These need not equal what the operator sees; the owner sees product-relevant slices.

## 10. Retention and Storage

| Pillar | Hot retention | Warm | Cold |
|---|---|---|---|
| Logs | 7 days at full granularity | 30 days compressed | None (deleted) |
| Metrics | 30 days at full resolution | Forever at downsampled (15-min buckets) | (forever-warm) |
| Traces | 7 days at sample rate | None | None |
| Audit log (not observability) | Forever | Forever | Cold-tier after 1 year (V2) |

V2 enterprise customers may need longer retention; configurable per-desk / per-org.

## 11. Implementation Notes

### 11.1 Logger interface

```typescript
import { logger } from "@holon/observability";

logger.error({
  layer: "wire",
  code: "WIRE_RELAY_UNREACHABLE",
  message: "Connection attempt to relay failed",
  desk_id: deskId,
  correlation_id: ctx.correlationId,
  context: { operation, attempt, next_retry_at },
});
```

The logger handles: structured output, scrubbing, level filtering, output routing.

### 11.2 Metric interface

```typescript
import { metrics } from "@holon/observability";

metrics.counter("holon_assignments_completed_total", { desk_id, outcome }).inc();

const timer = metrics.histogram("holon_handoff_dispatch_duration_seconds", { form }).startTimer();
// ... do work ...
timer({ /* labels resolved at end */ });
```

### 11.3 Tracing interface

```typescript
import { tracer } from "@holon/observability";

await tracer.startActiveSpan("holon.handoff.dispatch", { attributes: { "desk.id": deskId, "handoff.form": form }}, async (span) => {
  try {
    // ... work ...
    span.setStatus({ code: SpanStatusCode.OK });
  } catch (err) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: err.code });
    throw err;
  } finally {
    span.end();
  }
});
```

## 12. Cross-References

- High-level reliability + testing: `reliability-and-testing.md`
- Audit event schema (different concept): `data-model.md` § 4.11
- Metrics catalog from reliability doc § 5.2 — superseded by § 4.2 here
- Threat detection signals: `security-threat-model.md` § 6
- Per-desk owner UI surfaces: `ui-architecture.md`

## 13. Open Decisions

1. **Default logging backend.** stdout works locally; pick a default cloud aggregator? V1: Loki (simplest); enterprise can choose.
2. **Default tracing backend.** Jaeger (open) vs Tempo vs Honeycomb (managed). V1: Jaeger via docker-compose for dev; operator chooses for prod.
3. **Sampling strategy in production.** 10% default; should certain layers always trace 100% (auth events, security signals)?
4. **Owner-visible cost transparency.** Show owners actual API spend per staff? Helpful but might be intimidating; V1.x.
5. **Anomaly detection.** Adding ML-based anomaly detection on top of basic alerting (V2/V3).
6. **Chargeback / billing observability.** For multi-tenant V2, need per-tenant resource attribution. Specific labels TBD.
7. **Privacy budget.** A formal "privacy budget" approach (e.g., differential privacy on cross-tenant aggregates) for V3 enterprise.

## 14. Acceptance Criteria

V1 implementation-ready when:

1. ✅ Log schema with required and forbidden fields specified
2. ✅ Metric naming convention + catalog of all V1 metrics
3. ✅ Tracing standard (OTel + W3C) named
4. ✅ Sampling strategy defined per environment
5. ✅ Owner vs operator dashboard distinction made
6. ✅ Alert priorities (critical / warning / info)
7. ✅ Privacy table for what data may appear where
8. ✅ Retention policy per pillar
9. ✅ Implementation interfaces sketched (logger, metrics, tracer)
10. ⬜ `packages/observability` ships with the spec implemented (M3 gate)
11. ⬜ Reference Grafana dashboards in `ops/dashboards/` (M4)
12. ⬜ Lint rule against `console.log` and against logging forbidden fields (M0)

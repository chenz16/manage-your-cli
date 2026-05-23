# Runtime Adapter Interface

Status: draft v0.1
Date: 2026-05-15
Owner: design
Supersedes: the 3-line `runAssignment` sketch in `implementation-architecture.md` § Runtime Adapter Layer

## Purpose

Holon's product layer (router, missions, assignments, deliverables, UI) is runtime-agnostic. It owns work, ownership, and accountability. It does not own how AI staff execute. That job belongs to a **runtime adapter**.

This document is the contract between Holon's product layer and any runtime that wants to execute local AI staff inside a Holon node. Honoring this contract is the only way a runtime gets to be a Holon staff backend.

In the MVP and the personal commercial release, **Hermes is the only production adapter shipped**. The interface remains abstract because:

1. It forces a clean boundary — Hermes-specific concepts (subagents, tool registry) cannot leak upward into router / handoff / UI code.
2. It enables a stub/test adapter for CI and local development without booting Hermes.
3. It does not rule out future adapters (in-house, customer-built) — but no third-party adapter ships in V1.

The interface is small on purpose. Less surface area = less drift between adapters = less coupling for the product layer.

## Design Principles

1. **Latency neutrality.** The adapter layer must add no measurable overhead on top of the underlying runtime. See the latency budget below — it is a hard constraint, not a guideline. If a wrapping abstraction violates this budget, the abstraction is wrong.

2. **Streaming-first, not request-response.** All runtime work is modeled as an event stream. The product layer subscribes; it never polls. Final deliverables are also delivered through the stream as a terminal event, not as a separate return value.

3. **Idempotent and resumable where the runtime allows it.** Holon assigns each job a stable `jobId`. Restarting an adapter call with the same `jobId` must either resume an in-flight job (if the adapter and runtime can) or refuse with a clear error — never silently start a duplicate.

4. **Capability honesty.** Adapters declare what they support (pause/resume, tool injection, budget enforcement, etc.). Holon must not assume; it must check the capability map. Declaring a capability you cannot honor is a contract breach.

5. **No silent failure.** Every error path in the runtime must surface as an `error` event with a typed code. The adapter layer must not swallow runtime exceptions.

6. **No upward leakage of runtime types.** The product layer sees only `RuntimeEvent`, `DeliverableDraft`, and the typed error union defined here. It never sees a Hermes-shaped object, a vendor SDK type, or raw model output.

## Conceptual Model

```text
Holon product layer
    │
    │  RuntimeJobConfig  ──▶
    │
    │   ◀── start / pause / resume / cancel
    │
    │   ◀── AsyncIterable<RuntimeEvent>
    │       (token-by-token or batched, adapter's choice
    │        within latency budget)
    │
    │   ◀── DeliverableDraft (terminal event)
    │
RuntimeAdapter (Hermes / dummy / future)
    │
    ▼
Underlying runtime (Hermes process, model API, etc.)
```

A **runtime job** is one execution of one assignment by one local AI staff member. Jobs do not span assignments. Jobs do not call other jobs. If staff A needs to delegate to staff B, the product layer creates a separate assignment for B; it does not happen inside an adapter call.

## The Interface

```typescript
/**
 * The contract every runtime adapter must implement.
 * Defined in @holon/runtime-contract (no runtime dependencies; pure types
 * + small async helpers).
 */
export interface RuntimeAdapter {
  /** Stable adapter identifier, e.g. "hermes", "dummy", "openai-agents". */
  readonly id: AdapterId;

  /** Semver of the adapter's implementation. */
  readonly version: string;

  /** Semver of the RuntimeAdapter interface this implementation targets. */
  readonly contractVersion: string;

  /** What the adapter can actually do. Holon checks this before scheduling. */
  readonly capabilities: AdapterCapabilities;

  /** One-time setup; validates config, opens runtime connections, etc. */
  init(ctx: AdapterInitContext): Promise<void>;

  /** Graceful shutdown; flush in-flight jobs, close connections. */
  shutdown(): Promise<void>;

  /**
   * Start a job. Returns a handle the caller uses to control the job
   * and consume its event stream.
   *
   * MUST return within the start latency budget (see § Latency Budget).
   * MUST NOT block on the underlying runtime starting up — emit a
   * `started` event when the runtime is actually live.
   */
  start(config: RuntimeJobConfig): Promise<RuntimeJobHandle>;
}

export interface RuntimeJobHandle {
  /** The jobId Holon supplied; echoed back for idempotency. */
  readonly jobId: JobId;

  /**
   * The event stream. Hot — already producing. Closed by the adapter
   * when the job reaches a terminal state.
   *
   * Holon code consumes via `for await (const ev of handle.events)`.
   */
  readonly events: AsyncIterable<RuntimeEvent>;

  /** Best-effort pause. Returns true if the adapter actually paused. */
  pause(): Promise<boolean>;

  /** Resume after a successful pause. Throws if the job is not paused. */
  resume(): Promise<void>;

  /**
   * Cooperative cancel. Adapter signals the runtime to stop and emits
   * `cancelled` (or `error` if the runtime would not stop).
   * Idempotent.
   */
  cancel(reason: CancelReason): Promise<void>;

  /**
   * Hard kill. Used after a `cancel` deadline expires.
   * Adapter MUST forcibly stop the runtime and emit a terminal event.
   * Idempotent.
   */
  kill(): Promise<void>;

  /** Current adapter-side view of the job. Cheap to call. */
  status(): JobStatus;
}
```

The product layer treats `RuntimeAdapter` as a singleton per adapter type per node. Multiple `RuntimeJobHandle`s are alive concurrently — one per running assignment.

## RuntimeJobConfig (Input)

```typescript
export interface RuntimeJobConfig {
  /** Unique, stable, supplied by Holon. Adapter MUST use this for
   *  any persistence / resumption logic. */
  jobId: JobId;

  /** The assignment this job is fulfilling. For correlation only —
   *  adapter must not look up the assignment in Holon's DB. */
  assignmentId: AssignmentId;

  /** The local AI staff identity executing the job. The adapter
   *  resolves this to its own profile (e.g. a Hermes agent profile). */
  staffId: StaffId;

  /** What the staff member is being asked to do. */
  task: {
    /** One-line summary, used for logs and UI fallbacks. */
    title: string;
    /** Full instruction body, markdown allowed. */
    body: string;
    /** Structured output expectation, if the assignment needs one. */
    outputExpectation?: OutputExpectation;
  };

  /** Bounded context provided by the handoff. Read-only to the runtime;
   *  the runtime cannot pull more. See `handoff-design.md` § Context Pack. */
  contextPack: ContextPackRef;

  /** Tools the runtime is allowed to call.
   *  Adapter MUST NOT make any tool available that is not on this list.
   *  This is a security boundary — capability-based, not advisory. */
  tools: AllowedTool[];

  /** Hard limits. */
  budget: {
    /** Maximum wall-clock time. After this, adapter cancels then kills. */
    timeoutMs: number;
    /** Maximum tokens (input + output combined) — when known. */
    maxTokens?: number;
    /** Maximum cost in millicents — when the runtime can self-meter. */
    maxCostMillicents?: number;
  };

  /** Authority scope from the handoff: read-only, cite-only,
   *  transform, etc. Adapter forwards to the runtime; runtime is
   *  responsible for honoring it. Logged and auditable. */
  authority: AuthorityScope;
}
```

Key rules:

- **`jobId` is the idempotency key.** Calling `start` with the same `jobId` while a job is alive returns the existing handle. Calling it after terminal state with the same `jobId` is an error.
- **The adapter never reads from Holon's DB or filesystem directly.** Everything it needs is in `RuntimeJobConfig`. This is what makes the adapter testable in isolation and prevents Hermes from "owning" product state.
- **`tools` is a capability list, not a hint.** A runtime that respects the contract cannot spontaneously decide to invoke a tool not in this list. If the underlying runtime cannot enforce this, the adapter MUST sandbox tool calls itself or refuse the job.
- **API key / credentials (BYOK, per ADR-011).** In V1, the desk owner's LLM API key is injected into `RuntimeJobConfig` by the product layer at job start (the field is not shown in the interface above; it is passed as a provider-specific config entry in an opaque `providerCredentials` field that the adapter type-narrows per provider). The key is sourced from local encrypted desk config; it is **never** transmitted to the relay or included in handoff packets. The adapter MUST NOT log or persist the key beyond the job's lifetime. Holon does not manage LLM API keys on behalf of users in V1.

## RuntimeEvent (Output Stream)

A discriminated union. New event kinds may be added in minor versions; existing event kinds may not change shape without a major version bump.

```typescript
export type RuntimeEvent =
  | StartedEvent
  | StatusEvent
  | OutputDeltaEvent
  | ToolCallStartedEvent
  | ToolCallCompletedEvent
  | ContextRetrievedEvent
  | UsageEvent
  | WarningEvent
  | DeliverableEvent     // terminal: success
  | CancelledEvent       // terminal: cancelled
  | ErrorEvent;          // terminal: failure

interface BaseEvent {
  jobId: JobId;
  /** Monotonic per job. Starts at 0. */
  seq: number;
  /** ISO-8601 with millisecond precision. */
  ts: string;
}

interface StartedEvent extends BaseEvent {
  kind: "started";
  /** When the underlying runtime is actually executing, not just queued. */
  runtimeStartedAt: string;
}

interface StatusEvent extends BaseEvent {
  kind: "status";
  /** Human-readable, used in UI ("Reading file…", "Calling tool…"). */
  message: string;
  /** Stage the runtime is in. */
  stage: "thinking" | "tool_call" | "writing" | "summarizing" | "waiting_input";
}

interface OutputDeltaEvent extends BaseEvent {
  kind: "output_delta";
  /** Incremental text. The product layer concatenates for live display. */
  text: string;
  /** The channel this output goes to, if the runtime supports multi-channel. */
  channel?: "main" | "scratch" | "reasoning";
}

interface ToolCallStartedEvent extends BaseEvent {
  kind: "tool_call_started";
  toolCallId: string;
  toolName: string;
  /** JSON-serializable args. May be partial if streamed. */
  args: unknown;
}

interface ToolCallCompletedEvent extends BaseEvent {
  kind: "tool_call_completed";
  toolCallId: string;
  ok: boolean;
  /** JSON-serializable result, or error message. Truncated if huge. */
  result: unknown;
  /** Wall-clock duration of the tool call in ms. */
  durationMs: number;
}

interface ContextRetrievedEvent extends BaseEvent {
  kind: "context_retrieved";
  /** What the runtime pulled from the context pack — for audit. */
  refs: Array<{ kind: "file" | "doc" | "memory"; id: string; title?: string }>;
}

interface UsageEvent extends BaseEvent {
  kind: "usage";
  /** Tokens consumed since the last usage event (delta), not cumulative. */
  inputTokensDelta: number;
  outputTokensDelta: number;
  /** Cost since the last usage event in millicents (1/1000 USD cent). */
  costMillicentsDelta: number;
}

interface WarningEvent extends BaseEvent {
  kind: "warning";
  /** Non-fatal: budget approaching, retry happened, tool denied, etc. */
  code: WarningCode;
  message: string;
}

interface DeliverableEvent extends BaseEvent {
  kind: "deliverable";
  /** Terminal — the event stream closes after this. */
  draft: DeliverableDraft;
  /** Cumulative usage for the job. */
  usage: { inputTokens: number; outputTokens: number; costMillicents: number };
}

interface CancelledEvent extends BaseEvent {
  kind: "cancelled";
  reason: CancelReason;
}

interface ErrorEvent extends BaseEvent {
  kind: "error";
  /** Typed error (see § Error Model). */
  code: RuntimeErrorCode;
  message: string;
  /** True if a retry by Holon's reliability layer might succeed. */
  retryable: boolean;
  /** Optional structured detail (sanitized — no secrets, no PII). */
  detail?: unknown;
}
```

### Why a discriminated union and not raw text

The product UI needs to render different states: spinning while `thinking`, file icon while `tool_call_started: read_file`, citation chip when `context_retrieved`. A flat text stream would force the UI to parse markdown for state, which is fragile. A discriminated union makes the UI rendering trivially correct.

### Granularity

Adapters MAY batch `output_delta` events to respect the latency budget — for example, flushing every 50 ms or every 200 characters, whichever comes first. They MUST NOT batch `tool_call_*`, `error`, `cancelled`, or `deliverable` events; those must be emitted immediately.

## DeliverableDraft

This is the **draft** because the product layer attaches metadata (author, parent assignment, ownership, signatures, returned-to-origin status) before persisting it as a real Deliverable. The runtime hands over content; the product layer hands over identity.

```typescript
export interface DeliverableDraft {
  /** One-line title. The runtime should generate a real title, not "Untitled." */
  title: string;

  /** The body. */
  body:
    | { kind: "markdown"; text: string }
    | { kind: "structured"; schemaId: string; data: unknown }
    | { kind: "files_only"; note?: string };

  /** Files produced by the runtime. Stored by Holon, referenced here. */
  files?: Array<{
    /** Adapter-assigned local path or temp ID — Holon copies it out. */
    sourceRef: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
  }>;

  /** Citations: things the runtime read from the context pack and wants
   *  to declare it relied on. The product layer renders these as
   *  citation chips and the audit log records them. */
  citations?: Array<{
    refKind: "file" | "doc" | "memory" | "url";
    refId: string;
    excerpt?: string;
  }>;

  /** Free-form notes from the runtime — unverified, non-load-bearing. */
  runtimeNotes?: string;
}
```

### What this is NOT

- It is **not** a chat transcript. The transcript is reconstructed by the product layer from the event stream if needed.
- It is **not** signed or attributed. Identity attaches at the product layer.
- It does **not** contain raw tool outputs. Those are in `tool_call_completed` events; if a deliverable wants to reference one, it does so via `citations`.

## Lifecycle

States the adapter exposes via `handle.status()`:

```
queued → starting → running → [paused] → finishing → terminal
                                                       └─ done | cancelled | failed
```

Transitions:

| Operation | From state(s) | To state | Notes |
|---|---|---|---|
| `start()` returns | (initial) | `queued` or `starting` | Adapter chooses; both valid |
| First runtime activity | `queued`/`starting` | `running` | Triggers `started` event |
| `pause()` succeeds | `running` | `paused` | Returns false if not supported |
| `resume()` | `paused` | `running` | Throws if not paused |
| `cancel()` | any non-terminal | `finishing` | Adapter signals runtime |
| Cancel completes | `finishing` | `cancelled` | Emits `cancelled` event |
| `kill()` | any non-terminal | `failed` | Forced; emits `error{code:KILLED}` |
| Runtime succeeds | `running`/`finishing` | `done` | Emits `deliverable` event |
| Runtime errors | any non-terminal | `failed` | Emits `error` event |

**Cancel deadline.** When Holon calls `cancel()`, it starts a 5 s deadline timer. If the adapter has not reached a terminal state in 5 s, Holon calls `kill()`. The adapter MUST always reach terminal within 1 s of `kill()`; if it cannot, it has a defect.

**Pause is best-effort.** If the underlying runtime cannot pause (e.g. an in-flight model call), `pause()` returns `false` and the job continues. The product layer must handle this — pause is a hint to save work, not a guarantee.

## Capability Declarations

```typescript
export interface AdapterCapabilities {
  /** Can the adapter actually pause and resume? */
  pauseResume: boolean;

  /** Will the adapter enforce the tools list itself, or does the
   *  underlying runtime enforce? Either is fine; "neither" is a defect. */
  toolEnforcement: "adapter" | "runtime";

  /** Does the adapter meter cost in real time?
   *  If false, `UsageEvent.costMillicentsDelta` will always be 0. */
  costMetering: boolean;

  /** Does the adapter honor the maxTokens / maxCostMillicents budget by
   *  emitting an `error{code: BUDGET_EXCEEDED}` and stopping? */
  budgetEnforcement: boolean;

  /** Can the adapter resume a job by jobId after process restart? */
  resumeAfterRestart: boolean;

  /** Maximum number of concurrent jobs this adapter can run.
   *  Holon's scheduler respects this. */
  maxConcurrentJobs: number;

  /** Output channels the adapter populates. */
  outputChannels: Array<"main" | "scratch" | "reasoning">;
}
```

Holon's scheduler reads `capabilities` once at `init` and caches it. If a capability changes at runtime (e.g. a runtime upgrade), the adapter must call `init` again or restart.

## Error Model

```typescript
export type RuntimeErrorCode =
  | "BUDGET_EXCEEDED"        // hit timeout / token / cost limit
  | "TOOL_DENIED"            // runtime tried to use a tool not in list
  | "TOOL_FAILED"            // a tool call failed unrecoverably
  | "CONTEXT_UNAVAILABLE"    // context pack ref couldn't be loaded
  | "RUNTIME_UNREACHABLE"    // can't talk to the underlying runtime
  | "RUNTIME_CRASHED"        // runtime died mid-job
  | "INVALID_CONFIG"         // RuntimeJobConfig was malformed
  | "UNSUPPORTED_CAPABILITY" // job needs a capability adapter declared false for
  | "PERMISSION_DENIED"      // authority scope violation detected by runtime
  | "KILLED"                 // hard kill from Holon
  | "INTERNAL";              // adapter bug; opens a P0 ticket
```

`retryable` flag guidance:

| Code | retryable | Why |
|---|---|---|
| `BUDGET_EXCEEDED` | false | Retrying would just hit the same limit |
| `TOOL_DENIED` | false | Permission boundary is intentional |
| `TOOL_FAILED` | true | Network blips, transient API errors |
| `CONTEXT_UNAVAILABLE` | true | Context store may recover |
| `RUNTIME_UNREACHABLE` | true | Process might be restarting |
| `RUNTIME_CRASHED` | true | Try once, give up if it crashes again |
| `INVALID_CONFIG` | false | Caller bug; retrying changes nothing |
| `UNSUPPORTED_CAPABILITY` | false | Same as above |
| `PERMISSION_DENIED` | false | Same as above |
| `KILLED` | false | Caller intent |
| `INTERNAL` | false | Holon must investigate, not silently retry |

## Latency Budget

These are the hard SLOs the adapter layer must meet **on top of the underlying runtime's own latency**. They are not budgets for the runtime itself.

| Measurement | p50 | p95 | p99 | How measured |
|---|---|---|---|---|
| `start()` returning a handle | ≤ 5 ms | ≤ 20 ms | ≤ 50 ms | Time from call to handle returned |
| First event arriving on the stream after the runtime emits it | ≤ 2 ms | ≤ 10 ms | ≤ 30 ms | Time from runtime-internal emit to product-layer receipt |
| `cancel()` returning | ≤ 5 ms | ≤ 20 ms | ≤ 50 ms | Time from call to return (NOT to terminal state) |
| `pause()` returning | ≤ 10 ms | ≤ 50 ms | ≤ 100 ms | Same |
| `status()` returning | ≤ 1 ms | ≤ 5 ms | ≤ 10 ms | Hot path; called by UI poll loops |

**Implications for adapter authors:**

- Do not perform synchronous serialization between the runtime and Holon's event types unless it is essentially free. Prefer structural typing or shared object references.
- Do not cross a process boundary unless absolutely necessary. If you must, use a binary protocol (msgpack, protobuf, raw structs over UDS), not JSON over HTTP.
- The "wrap-and-translate" pattern is what kills this budget. If your adapter is doing meaningful CPU work per event, it is wrong.

The dummy adapter and the Hermes adapter must both pass these SLOs in CI before being released.

## First Implementation: Hermes Adapter

The Hermes adapter is the only adapter that ships in V1. It lives at `packages/runtime-hermes`.

### Mapping (formal)

| Holon concept | Hermes concept | Notes |
|---|---|---|
| `StaffId` | Hermes agent profile id | Profiles are configured at node setup time |
| `RuntimeJobConfig.task` | Hermes task description + system prompt | Adapter constructs the Hermes call |
| `RuntimeJobConfig.tools` | Hermes tool registry scope (allowlist) | Adapter narrows the registry per job |
| `RuntimeJobConfig.contextPack` | Hermes context block (files, snippets) | Adapter loads from Holon's context store |
| `RuntimeJobConfig.budget.timeoutMs` | Hermes job deadline | Adapter sets a wall-clock timer |
| `RuntimeJobConfig.budget.maxTokens` | Hermes token cap | If supported by Hermes runtime |
| Hermes streaming output | `output_delta` events | Adapter batches per latency budget |
| Hermes tool call events | `tool_call_started/completed` | 1:1 mapping |
| Hermes terminal output | `DeliverableDraft` | Adapter constructs from Hermes result |
| Hermes runtime errors | `ErrorEvent` with mapped code | See error mapping table below |

### Hermes-side capabilities (what the adapter reports)

```typescript
{
  pauseResume: <verify with Hermes team — tentatively false>,
  toolEnforcement: "runtime", // Hermes registry scope is the boundary
  costMetering: <verify — tentatively true if Hermes meters tokens>,
  budgetEnforcement: <verify — tentatively true for tokens, manual for time>,
  resumeAfterRestart: <verify — likely false in MVP>,
  maxConcurrentJobs: <set per node config; MVP default 4>,
  outputChannels: ["main"],
}
```

### Open questions for Hermes integration spike

These must be resolved before M1 ships:

1. Does Hermes expose a streaming event API, or only request/response? If only request/response, the adapter must wrap with chunked emission — which puts the latency budget at risk.
2. Does Hermes support cooperative pause (signal → flush → suspend)?
3. How does Hermes report token usage — per-message, per-tool-call, or only at end?
4. Does Hermes have a stable resume-by-id mechanism, or are jobs ephemeral to a Hermes process?
5. What is Hermes's behavior on tool call timeout?
6. Does Hermes signal context-retrieval events, or are file reads invisible?
7. How does Hermes propagate authority scope to tool calls? (e.g., does cite-only mode prevent tool writes?)

**Action**: Before writing the production Hermes adapter, run a 1-week spike that answers all 7 questions with code, not docs. Output of the spike: a `hermes-integration-findings.md` appendix to this doc, with each question answered + code reference.

## Test/Dummy Adapter

Lives at `packages/runtime-dummy`. Used by:

- CI integration tests (no Hermes process needed)
- Local development of the product layer
- Adapter conformance tests (the dummy is the reference behavior)

Behavior:

- Reads a YAML scenario file referenced by `RuntimeJobConfig.task.body` (e.g. `body: "scenario:happy-path-3-tool-calls"`)
- Emits the events from that scenario at configurable speeds (real-time or sped-up)
- Honors all lifecycle ops correctly (pause/resume/cancel/kill — for testing the product layer)
- Supports failure scenarios (each error code, each retryable flag value)
- Reports full capabilities (`pauseResume: true`, `costMetering: true`, etc.) so it can stand in for any future adapter

Scenario library lives at `packages/runtime-dummy/scenarios/*.yaml`. Adding a new scenario is the canonical way to write a regression test for adapter-layer bugs.

## Acceptance Criteria for "Production-Ready" Adapter

A new adapter (Hermes V1, or any future adapter) is allowed in production when:

1. ✅ All capability declarations match observed behavior (verified by `packages/runtime-conformance` test suite)
2. ✅ Latency budget SLOs pass on a reference machine (CI gate)
3. ✅ All error codes can be triggered in test scenarios and surface correctly
4. ✅ `cancel()` reaches terminal in p99 ≤ 5 s on 100 sample jobs
5. ✅ `kill()` reaches terminal in p99 ≤ 1 s on 100 sample jobs
6. ✅ No event is dropped under load (1 000 events/s sustained for 60 s)
7. ✅ Process restart does not leak: in-flight jobs either resume (if `resumeAfterRestart: true`) or fail with `RUNTIME_CRASHED` cleanly
8. ✅ `init` and `shutdown` are clean: no orphaned subprocesses, no unclosed file descriptors
9. ✅ Conformance suite passes 100% (lives at `packages/runtime-conformance`; same suite runs against dummy and Hermes)
10. ✅ Manual review of one full UI session against this adapter — every visible state corresponds to a real event (no UI inferences)

## Versioning

This interface is versioned independently from any adapter implementation.

- `contractVersion` is semver.
- Minor bumps add new event kinds, new capability fields, or new optional config fields. Backwards-compatible.
- Major bumps change existing event shapes, change function signatures, or remove capabilities. Adapters must declare the contract version they target.

Holon's scheduler refuses to load an adapter whose `contractVersion` major does not match the product layer's expected major.

## Chat Sessions as Long-Running Jobs (ADR-013)

Per ADR-013, every chat session in the Holon UI is a long-running Hermes job — one `RuntimeJobHandle` per open chat session, running until the user closes the panel.

**Mapping:**

| Chat concept | Runtime adapter concept |
|---|---|
| User opens chat panel | `adapter.start(config)` — job begins |
| User sends a message (turn N) | New input injected into the running job (multi-turn via Hermes's native loop) |
| Agent streaming response | `output_delta` events consumed by the chat panel |
| Tool call visible in chat (e.g., "Checking status…") | `tool_call_started` + `tool_call_completed` events |
| Citation chip in response | `context_retrieved` event; `DeliverableDraft.citations` at turn end |
| User closes chat panel | `handle.cancel()` — cooperative shutdown |

**Why this is a long-running job and not a series of short jobs:**
Hermes's `AIAgent` is the conversation loop (see mibusy `docs/implementation/hermes-v2-implementation-goal.md` § "AIAgent is the main conversation loop"). The loop maintains conversation context across turns natively. Starting a new job per turn would lose the context. Starting one job per session and feeding new user messages as turns is the correct adapter pattern.

**Implications for the adapter:**

- Chat jobs can be much longer-lived than assignment jobs (minutes to hours vs. seconds to minutes for typical assignments). The adapter MUST NOT assume short-lived jobs.
- `pause()` and `resume()` are meaningful for chat: the panel can be minimized (pause) and restored (resume). The adapter should support pause if the Hermes runtime allows it.
- The budget fields (`timeoutMs`, `maxTokens`) in `RuntimeJobConfig` apply per session. For chat, these should be set generously or managed via a session-level budget policy distinct from assignment budgets. Design of chat-specific budget policy is a Dev concern.
- `cancel()` is the clean close path when the user closes the panel. The adapter should flush any partial turn and reach terminal cleanly.

**No new adapter interface changes.** Chat sessions use the existing `RuntimeAdapter` interface as-is. The product layer manages the job lifecycle; the adapter remains unaware that it is serving a chat session vs. an assignment. This is the "zero new architectural primitive" property of ADR-013.

## Non-Goals

- This interface is not a generic "agent SDK." It is a contract for one job at a time, with Holon owning orchestration. Multi-step planning, tool routing across staff, or agent-to-agent communication all happen in the product layer, not the adapter.
- This interface does not define how adapters discover what staff exist. Staff identity is a product-layer concern; the adapter just receives a `staffId` and resolves it to a runtime profile via its own configuration.
- This interface does not cover peer members. Peer work is a product-layer handoff to a remote node, not a runtime job. Adapters are exclusively for local AI member execution.
- This interface does not define a memory/skills system. Hermes's memory features are the runtime's concern; if the product layer wants memory, it constructs the context pack to include the relevant memories.

## Open Decisions (Bring to Next Doc Pass)

1. Is `costMillicents` precise enough, or do we need fractional? Pricing models with sub-millicent rates exist.
2. Should `output_delta` carry an optional `format` (markdown / plain / json)? Currently inferred from context.
3. Should `WarningEvent.code` be a closed enum like `RuntimeErrorCode`, or open string? Closed is safer; open is more flexible.
4. Should the conformance suite test `pause` correctness through wall-clock timing, or through deterministic event interleaving? Affects CI flakiness.
5. Do we need a `metrics` event for adapter-internal telemetry (queue depth, restart counts), or does adapter expose those out-of-band?

These are not blocking for the doc — they are flagged for the schema-doc and observability-doc passes.

## Cross-References

- Event types are persisted via the model defined in `architecture/data-model.md` (to be written) — `events.kind` enum should include all `RuntimeEvent.kind` values plus product-layer events from `functional-architecture.md` § Event Model.
- `ContextPackRef` resolves to the structure in `architecture/handoff-design.md` § Context Pack.
- `AuthorityScope` is defined in `handoff-design.md` § Authority Scope.
- `OutputExpectation` is defined in the product spec `holon-product-definition.md` § Deliverable.
- The reliability layer (`architecture/reliability-and-testing.md`, to be written) consumes `ErrorEvent.retryable` to decide whether to retry; this doc does not specify retry policy itself.
- Chat session job lifecycle: ADR-013 (`docs/decisions/013-chat-surface-as-hermes-loop.md`) + mibusy `docs/implementation/hermes-v2-implementation-goal.md` § "AIAgent is the main conversation loop".

# Worker Dispatcher & Mutable Job Store

> **Status: Superseded (moved to `legacy/` 2026-05-30).** This doc
> describes a worker-dispatch design that spawns Hermes one-shot
> processes (`uv run hermes -z -t hermes-acp`), an architecture that
> belongs to the sister repo `holon-engineering`.
> `manage-your-cli` replaced this with a direct CLI dispatch model:
> each employee is an official CLI binary in its own persistent
> tmux session, created/driven via
> [`packages/core/src/cli-session-service.ts`](../../../packages/core/src/cli-session-service.ts)
> and the Holon MCP `dispatch` tool. See
> [`docs/decisions/040-cli-staff-dual-runtime.md`](../../decisions/040-cli-staff-dual-runtime.md)
> for the rationale. This doc is retained for design lineage only.

Status: draft (iter-007 step 5 implementation status)
Date: 2026-05-16
Author: Requirements Agent
Position: Sibling of `owner-assistant-tools.md`. Describes how briefs
queued by the owner-assistant turn into Hermes worker runs and how
their output becomes a `Deliverable`. Sits below
`local-agent-management.md` § 5 (staff substrates) and above
`runtime-adapter-interface.md` (which still owns the cross-runtime
contract for V2; V1 ships an in-process subset).

## 1. What This Doc Covers

The path from `assign_to_staff(brief)` (queued by the owner agent's
tool surface, per `owner-assistant-tools.md` § 5.2) to a finalised
`Deliverable` row that shows up on `/deliverables`. Specifically:

- The in-memory mutable store (`@holon/core/mutable-store`) that
  holds jobs and worker-produced deliverables.
- The background dispatcher loop (`@holon/core/worker-dispatcher`)
  that picks queued jobs and spawns Hermes one-shots.
- The job lifecycle, the failure surface, and how the worker's stdout
  becomes a typed `Deliverable`.
- Alignment with Engineering Rules 1, 4, 5, 6.

What this doc does NOT cover:

- The owner agent's tool surface — see `owner-assistant-tools.md`.
- The future cross-runtime contract — `runtime-adapter-interface.md`
  remains the V2 north star; this doc describes the V1 in-process
  shortcut.
- The chat UI — `ui-architecture.md` § 5.6.

## 2. Architecture Overview

```text
┌───────────────────────────────────────────────────────────────┐
│ Owner agent (Hermes ACP session)                              │
│ - calls tool: assign_to_staff(staff_id, brief)                │
└────────────────────────────┬──────────────────────────────────┘
                             │  HTTP localhost
                             ▼
┌───────────────────────────────────────────────────────────────┐
│ BFF: POST /api/v1/staff/:id/jobs                              │
│ - validates staff exists                                      │
│ - createJob(...)  → mutable-store                             │
│ - startDispatcher() (idempotent)                              │
│ - audit stdout: { audit: "staff.job.queued", … }              │
└────────────────────────────┬──────────────────────────────────┘
                             │
                             ▼
┌───────────────────────────────────────────────────────────────┐
│ @holon/core/mutable-store  (process-scoped, globalThis-backed)│
│ - Map<job_id,        Job>                                     │
│ - Map<deliverable_id, Deliverable>                            │
└────────────────────────────┬──────────────────────────────────┘
                             │  setInterval(1.5s) poll
                             ▼
┌───────────────────────────────────────────────────────────────┐
│ @holon/core/worker-dispatcher                                 │
│ - tick(): if !runningJobId, take nextQueuedJob()              │
│ - mark running → spawn worker → capture stdout                │
│ - mark completed (with deliverable_id) | failed (with error)  │
└────────────────────────────┬──────────────────────────────────┘
                             │  child_process.spawn
                             ▼
┌───────────────────────────────────────────────────────────────┐
│ uv run hermes -z "<persona prefix>\n\n--- BRIEF ---\n<brief>" │
│   -m deepseek-chat --provider deepseek                        │
│   -t hermes-acp --yolo                                        │
│ cwd: deps/hermes/    env: process.env + .env (DEEPSEEK_…)     │
└────────────────────────────┬──────────────────────────────────┘
                             │  stdout (markdown)
                             ▼
┌───────────────────────────────────────────────────────────────┐
│ createDeliverable({ id: deliv_…, body_kind: 'markdown', … })  │
│ markJobCompleted(job.id, deliverable.id)                      │
└────────────────────────────┬──────────────────────────────────┘
                             │  read path
                             ▼
┌───────────────────────────────────────────────────────────────┐
│ listDeliverables(): mutable ⊕ fixture (mutable first)          │
│ → /deliverables UI                                            │
└───────────────────────────────────────────────────────────────┘
```

The dispatcher is **entirely Core 1** — no Core-2 crossing involved
(workers produce **local** deliverables). The Core-2 outbound dispatch
crossing (per `functional-architecture.md` § 2.3) is exercised by the
separate `dispatch_handoff` tool, not by this path.

## 3. Job Lifecycle

States are linear; there is no retry transition in V1.

```
   queued ──► running ──┬─► completed  (deliverable_id set)
                        └─► failed     (error set)
```

| State       | Set by                          | Side effect                                                       |
|-------------|---------------------------------|-------------------------------------------------------------------|
| `queued`    | `createJob()` via BFF POST      | Audit-log line: `staff.job.queued`. Dispatcher started if dormant.|
| `running`   | `markJobRunning()` in dispatcher| Console: `[dispatcher] running <job_id> for staff=<staff_id>`     |
| `completed` | `markJobCompleted(deliv_id)`    | `createDeliverable(…)` first; then `markJobCompleted`             |
| `failed`    | `markJobFailed(error)`          | No deliverable created; error string preserved on the job record  |

Timestamps: `created_at` on creation, `started_at` on `running`,
`completed_at` on either terminal state.

### 3.1 Failure Modes (V1)

| Class                       | How surfaced (per Engineering Rule 4)                                       |
|-----------------------------|------------------------------------------------------------------------------|
| Hermes process exit ≠ 0     | `failed`, `error: "hermes exited <code> · stdout=… stderr=…"`               |
| Worker timeout (5 min)      | `failed`, `error: "worker timeout after 300s"`. SIGKILL sent.                |
| Empty stdout despite exit 0 | `failed`, same shape (treated as exit ≠ 0 because no body to materialise).  |
| Dispatcher exception around `processJob` | `failed`, `error: "dispatcher exception: <msg>"`               |

All errors surface in two places:

1. The job record itself (visible via `GET /api/v1/staff/:id/jobs` and
   `GET /api/v1/jobs`).
2. The Next.js process stdout (so a developer running the dev server
   sees `[dispatcher] job <id> FAILED · …` immediately).

No bare `try/catch` is used to swallow — the `try / catch (e: unknown)`
in `tick()` re-classifies the error into a `failed` job state (per
Engineering Rule 4 and the `reliability-and-testing.md` error
taxonomy).

## 4. Mutable Store Notes

Lives at `packages/core/src/mutable-store.ts`. Process-scoped Maps
held on `globalThis.__holonMutable` (same pattern as the ACP bridge
singleton — Next.js route bundles each import their own copy of the
module, so plain module-scope `let` would not share state across
endpoints).

### 4.1 Why Mutable Store Lives in `@holon/core`

The mutable store needs to be read by:

- the dispatcher (`@holon/core`)
- the deliverables service (`@holon/core/deliverables-service`)
- the BFF jobs routes (`apps/web/app/api/v1/{jobs,staff/[id]/jobs}/route.ts`)
- the admin reset route (`apps/web/app/api/v1/admin/reset/route.ts`)

Putting it in `@holon/core` keeps everyone on the same typed surface
without coupling apps/web to private module shapes.

### 4.2 What It Is NOT

It is **not** a substitute for the eventual `packages/db` Postgres
layer. The data-model.md schema authority is unchanged; this store
just shims it in-memory for V1. When `packages/db` lands:

- `jobs` becomes a real table (likely keyed by `staff_id` for the
  worker side, plus a global `dispatcher_state` row).
- `deliverables` already has a canonical schema in
  `api-contract/entities/deliverable.ts`; the mutable store gets
  retired in favour of the same insert/select against Postgres.
- The admin reset (`/api/v1/admin/reset`) replaces `clearMutableStore()`
  with a TRUNCATE in dev mode only.

### 4.3 Merge Semantics — Mutable Wins

`deliverables-service.listDeliverables()` concatenates mutable
deliverables first, then fixtures, then sorts by `created_at` desc.
`getDeliverable(id)` looks at the mutable store before the fixture
baseline. ID collisions are not expected (prefix `deliv_…` + 26 chars
of base36) but if one occurred, mutable wins — the realistic worker
output is more interesting than the stale fixture.

## 5. Worker Spawn Detail

The dispatcher invokes:

```
uv run hermes -z "<persona prefix>\n\n--- BRIEF (job <id>) ---\n<brief>\n--- END BRIEF ---" \
  -m deepseek-chat --provider deepseek \
  -t hermes-acp --yolo
```

- `cwd: deps/hermes/` — Hermes is vendored there (per
  `owner-assistant-tools.md` § 4.1).
- `-z` is Hermes's one-shot mode (turn-bounded, exits after the brief
  completes).
- `-t hermes-acp` loads the full hermes-acp toolset (web_search,
  terminal, read_file, write_file, etc.) — per the
  2026-05-16 user directive that workers should have the **full**
  hermes-acp tool surface, not a per-staff narrow scope.
- `--yolo` disables the per-tool permission prompt that ACP usually
  raises. Acceptable for V1 single-user / single-owner posture; will
  need a per-substrate gate for V2.

### 5.1 Persona Prefix

`worker-dispatcher.staffPersonaPrompt(staff_id)` synthesises a short
system-style preamble from the fixture staff record:

```
You are <name> (<role_label>) on the Holon desk.
Your declared tool scope: <…tool_scope joined…>.
Produce a concise, well-structured deliverable for the brief below.
Use markdown. Cite sources if you use web_search.
```

If the staff id is unknown, the prefix falls back to a generic line.
Two important properties:

1. The persona is read from the fixture **at spawn time**, not at
   queue time. If the owner edits the staff record between
   `assign_to_staff` and dispatcher pickup, the new persona is used.
   V1 is fine with this; V2 should probably snapshot the persona at
   queue time so the job is reproducible.
2. The "tool_scope" line is *advisory* to the model — there is **no
   enforcement** that the worker only uses those tools. The worker
   runs with the full `hermes-acp` toolset regardless. This is a
   known V1 gap (see Open Q 5 below).

### 5.2 Environment Loading

Hermes needs `DEEPSEEK_API_KEY` (and any other provider secrets) to
make the model call. Next.js does **not** auto-load the repo-root
`.env` for spawned children — it only loads `apps/web/.env*`. The
dispatcher therefore re-parses `.env` from `HOLON_REPO_ROOT` on every
spawn and merges into the child's `env`. Cheap (the file is small),
predictable, and resilient to hot-reload state loss in dev.

A diagnostic log line is emitted per spawn confirming whether the key
was found in `process.env` and/or in the parsed `.env`:

```
[dispatcher] spawn env: DEEPSEEK_API_KEY in process.env=<bool>
             in .env=<bool> env_file=<path> exists=<bool>
```

This is intentionally chatty for V1 — it surfaced the original
"key not visible to child" bug. Tighten or move behind a `DEBUG=…`
flag once stable.

### 5.3 Deliverable Synthesis

When the worker exits with code 0 and non-empty stdout:

```ts
{
  id: deliv_<26 chars base36>,
  desk_id: <fixtures.primary_desk_id>,
  title: `${staff.name} · ${brief.slice(0, 60)}…`,
  body: { markdown: <full stdout> },
  body_kind: 'markdown',
  status: 'final',
  origin_label: 'local',
  created_at: <now>,
  author_staff_id: job.staff_id,
}
```

`origin_label: 'local'` is the signal that this deliverable came from
a worker the owner dispatched (vs. an inbound peer deliverable, which
would be `origin_label: 'peer'`). The `/deliverables` UI uses this to
distinguish provenance.

`status: 'final'` is set unconditionally in V1. There is no `draft`
review step for worker output — the owner reads the final or rejects
it after the fact. A `draft → reviewed → final` workflow would be a
V2 addition (intersects with mission lifecycle in
`functional-architecture.md` § 6).

## 6. Engineering-Rule Alignment

| Rule | How this surface complies |
|------|----------------------------|
| **#1 Product state above runtime** | The jobs table (mutable store) lives in `@holon/core`. The runtime (Hermes one-shot) is bounded — it runs one brief and exits. State transitions (`queued → running → completed/failed`) and `Deliverable` rows are written by `@holon/core` code, not by the worker reaching back into Holon. |
| **#4 No silent failure** | All four failure classes in § 3.1 surface to (a) the job record and (b) the dev console. `tick()`'s `catch (e: unknown)` always re-classifies into `markJobFailed(...)`. No bare try/catch swallows. |
| **#5 Flat-roster invariant** | Workers are ephemeral processes, not staff records. The job references a staff_id but the worker process is not registered as new staff. `staff_id` is treated as a foreign key into the existing flat roster (`getMember(id)` is the validation gate at the BFF). |
| **#6 Owner-mediated authority** | The only path that calls `POST /api/v1/staff/:id/jobs` is the owner agent's `assign_to_staff` tool. The dispatcher itself does not invent work — it only executes what the owner already queued. |
| **#8 Audit completeness** | V1 audit is a structured stdout line: `{ audit: "staff.job.queued", job_id, staff_id, brief_preview, ts }`. Post-emit (after `createJob` returns). Compatible with the V1 posture in ADR-007. |
| **#10 Latency budgets** | The queue→pickup latency is bounded by the 1.5 s tick interval. The brief→deliverable latency is bounded by the 5-min worker timeout. The chat round-trip is unaffected — `assign_to_staff` returns immediately after `createJob`, well within the state-bridge budget in `owner-assistant-tools.md` § 7. |

Rules 2, 3, 7, 9 are not exercised by this surface (no Core-2
crossing, no spec drift introduced, no authority delegation across
desks, no form validation).

## 7. Observability

V1 = structured stdout lines, read out of `pnpm dev`. Three event
families:

```
{ audit: "staff.job.queued", job_id, staff_id, brief_preview, ts }
[dispatcher] running <job_id> for staff=<staff_id>
[dispatcher] job <job_id> COMPLETED · deliverable=<deliv_id> (<bytes> bytes)
[dispatcher] job <job_id> FAILED · <error preview>
```

Plus the per-spawn env diagnostic in § 5.2.

No metrics, no traces, no structured-log shipper. V2 should bring
this in line with `observability-and-metrics.md`.

`GET /api/v1/jobs` returns the full job list + dispatcher status so
a smoke test (`apps/web/scripts/test-dispatcher.mjs`) can confirm
end-to-end flow without parsing stdout.

## 8. Open Questions

1. **Concurrency cap.** V1 = 1 job at a time
   (`if (D.runningJobId) return`). When real work backs up, jobs queue
   linearly. Move to a small pool (2–4)? Per-staff serialisation?
   Per-substrate? Probably "1 per staff, N total" is the right shape —
   matches the "staff member is busy" mental model.
2. **Retry policy.** V1 = no retry. A `failed` job stays failed; the
   owner re-queues by hand. For transient failures (network, model
   rate-limit) an automatic retry-with-backoff would help, but only
   if the dispatcher can distinguish transient from permanent
   failures (currently it cannot — needs the
   `reliability-and-testing.md` error taxonomy threaded through the
   subprocess exit codes).
3. **Multi-step / DAG jobs.** Some briefs need a chain (research →
   draft → review). V1 forces the owner to enqueue each step
   manually. A `parent_job_id` link plus a "spawn child on completion"
   hook would let workers self-chain — but that re-introduces the
   "runtime decides what work exists" smell that Engineering Rule 1
   pushes against. Better answer is probably "owner agent reads the
   completed deliverable and queues the next step itself."
4. **Live progress streaming.** Worker stdout is captured in toto and
   only revealed when the worker exits. For a 5-minute worker the
   owner sees nothing for 5 minutes, then a wall of text. Right
   answer is `SSE GET /api/v1/jobs/:id/stream` that tails the
   worker's stdout chunk-by-chunk. Intersects with
   `owner-assistant-tools.md` § 8 Open Q 2.
5. **Tool-scope enforcement.** Workers are launched with the full
   `hermes-acp` toolset regardless of the staff member's declared
   `substrate.tool_scope` (see § 5.1). `local-agent-management.md`
   § 5.1 frames `tool_scope` as a hard boundary; the V1 dispatcher
   weakens this to "advisory in the persona prompt." Either
   `local-agent-management.md` should be updated to acknowledge an
   "advisory in V1, enforced in V2" posture (ADR-worthy), or the
   dispatcher should build a per-staff toolset bundle before spawn.
6. **Job persistence.** Mutable store evaporates on dev-server restart.
   Acceptable for V1 demo flow; not acceptable when real owners are
   running jobs that take minutes. SQLite-backed `packages/db` is the
   right next step.
7. **Cost accounting.** `monthly_budget_mc` exists on the
   `OwnerAssistant` shape but is not consulted before spawning a
   worker. Need a "cost so far this month" tally that the dispatcher
   checks before each spawn, plus a billing model for what each
   Hermes call costs (DeepSeek pricing × token usage). Intersects
   with the cost-tracking gap in `peer-communication-architecture.md`
   for inter-desk handoffs.
8. **Worker observability vs. owner observability.** Hermes's own
   logs go to the dispatcher's `stderr` capture and end up in the
   `error` field on failure (truncated to last 400 chars). The owner
   has no way to read the full worker trace via UI. A `worker_logs`
   side-channel that the owner agent can `query_job_logs(job_id)`
   on is the natural V2 fix.

## 9. Open Questions Surfaced Against Other Specs

(Per CLAUDE.md "Spec Authority" — surfaced here rather than silently
edited into other docs.)

A. **`local-agent-management.md` § 5.1 tool_scope.** V1 worker spawn
treats `tool_scope` as advisory text in the persona prefix, not as
an enforced boundary. Either § 5.1's wording needs a "V1 advisory /
V2 enforced" caveat, or the dispatcher needs to honour `tool_scope`
at spawn time. ADR-worthy.

B. **`functional-architecture.md` § 7.5 (audit).** Audit is currently
a structured stdout line, not a row in any table. ADR-007 codifies
"audit is a diagnostic record in V1," which makes this fine — but
the absence of an audit *table* means there is nowhere for the BFF
to render "this deliverable was produced by job X at time T" beyond
the job record itself. Document or accept.

C. **`runtime-adapter-interface.md`.** The dispatcher is *not* a
`RuntimeAdapter` implementation. It is a parallel, narrower path
optimised for "spawn one-shot Hermes." When V2 brings real
substrates (cli, peer mirror, etc.), `RuntimeAdapter` is the right
abstraction and this dispatcher should fold into it. Not a
contradiction with the spec — just a documented gap.

## 10. Cross-References

- `owner-assistant-tools.md` § 5.2 — `assign_to_staff` (the tool
  that queues into this dispatcher)
- `owner-assistant-tools.md` § 10 — Step 3 implementation status
  (sibling doc); see resolution of § 8 Open Qs 1, 3
- `admin-surfaces.md` — `POST /api/v1/admin/reset` wipes both the
  ACP bridge and this mutable store
- `owner-config-service.md` § 3 — same mutable-wins three-tier
  read model (fixture ⊕ in-memory ⊕ future DB) used for owner
  config; § 5.1 reads `role_label` to build the persona prefix,
  which is why `role_label` is *excluded* from the `/me` PATCH
  allow-list (see owner-config-service.md § 4)
- `local-agent-management.md` § 5 — staff substrates;
  `substrate.tool_scope` is the field that V2 dispatching needs to
  honour (Open Q 5)
- `runtime-adapter-interface.md` — the V2 north-star abstraction
  this V1 dispatcher will eventually fold into
- `data-model.md` — when `jobs` becomes a real table, this is where
  the schema lives (currently absent)
- `functional-architecture.md` § 6 (mission lifecycle), § 7.5 (audit),
  § 2.3 (cores stay separate — this surface is Core 1 only)
- ADR-007 — V1 audit posture (post-emit, diagnostic record)
- ADR-013 — chat surface as Hermes loop (the owner side that feeds
  this dispatcher)
- Tests: `apps/web/scripts/test-dispatcher.mjs` (end-to-end queue →
  worker → /deliverables), `apps/web/scripts/test-delegation.mjs`
  (owner-agent tool-call path)

## 11. Feedback Loop (iter-008 phase 2)

Closes the visibility gap noted in § 8 Open Q 4 / Open Q 8 — once
real worker jobs started landing, the owner had no way to ask "is X
done yet?" without leaving chat. Two additions, both thin:

- **`list_recent_jobs` tool** (per `owner-assistant-tools.md` § 5.6).
  Reads from `GET /api/v1/jobs` with optional `staff_id` / `status` /
  `limit` filters. Called by the secretary on status-check phrasings
  ("搞完了么?", "is X done?"). Read-only — no audit emit, no
  side effect; latency budget is the same as § 5.1 state reads
  (≤ 5 ms p50). Engineering Rule 1 (state above runtime) preserved:
  the secretary reads through the BFF; it never invents job records.
- **`/today` `<JobsSection />`** (per `ui-architecture.md` — to be
  cross-referenced when that doc next updates). Polls
  `GET /api/v1/jobs` every 4 s; surfaces up to 8 rows with status
  badges + deliverable links. Same data source as the tool, just a
  human-eyes-on-it surface for the cases where the owner is glancing,
  not asking.

Together these close the loop without persisting anything new — the
jobs Map in `mutable-store` is already the source of truth (see § 4);
the new tool and UI just consume it. Engineering Rule 10 SLO: the 4 s
poll is the documented UX SLO; tightening it is a V2 fix that
probably comes with SSE on `/api/v1/jobs/:id/stream` (§ 8 Open Q 4 /
`owner-assistant-tools.md` § 8 Open Q 2).


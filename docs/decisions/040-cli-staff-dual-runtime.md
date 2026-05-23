# 040 — CLI Staff: Direct Runtime (no Hermes) + Manager-Managed Memory

Date: 2026-05-23
Status: Accepted for V1 slice 1

## Context

Holon staff carry a `substrate.kind` (ADR-015, refined by ADR-029):
`local_ai | cli_agent | cli (deprecated) | peer`. Two of these are AI executors:

- **`local_ai`** — bounded local AI work executed by a **runtime adapter**. In V1
  the only shipped adapter is **Hermes** (`worker-dispatcher.ts` spawns
  `hermes run -t hermes-acp` with the staff's role + tool_scope). Hermes owns the
  agent loop and tool registry for these staff.
- **`cli_agent`** — LLM-driven CLI agents (Claude Code, Codex, Aider). Today
  `cli-session-service.ts` runs each as a persistent **tmux** session
  (`holon-<staff_id>`), and the BFF exposes `launch / exec / input / stream`.

`runtime-adapter-interface.md` already states the product layer is
**runtime-agnostic** — "Hermes is the only production adapter shipped … [the
interface] does not rule out future adapters." So a CLI executor is an
anticipated second runtime, not a special case.

Two facts force the CLI path to **bypass Hermes entirely**:

1. **CLI agents own their own agent loop.** Claude Code / Codex are not ACP
   sub-agents Hermes can drive turn-by-turn; wrapping them inside Hermes as if
   they were would be a mock, not a real integration (project rule: use the real
   component, never a from-scratch fake). The real integration is to run the real
   CLI directly.
2. **Owner finding (2026-05-23):** giving a CLI agent the task directly — with
   good context — is markedly more effective for hard work (writing code,
   multi-file changes) than routing through the bounded Hermes turn model.

What is missing is the half that makes a CLI a *staff member* rather than a raw
terminal: **the manager-managed memory + context layer.** `cli/exec` today only
fires a raw command at tmux and returns the buffer. There is no place that, when
a task is dispatched to a CLI staff, assembles that staff's accumulated memory +
the task brief + relevant references into a coherent opening context, nor any
place that captures the result back into the staff's memory.

## Decision

### 1. Two runtimes, selected by `substrate.kind`

- `local_ai` → **Hermes adapter** (`worker-dispatcher.ts`). Goes through Hermes.
- `cli_agent` → **CLI adapter** (`cli-session-service.ts`, tmux + the real CLI).
  **Never goes through Hermes.** This is the "two options" the product exposes:
  choosing the substrate kind when creating staff picks the runtime.

This reaffirms Engineering Rule #1 (product state lives above the runtime;
Hermes is just one runtime) and `runtime-adapter-interface.md`.

### 2. CLI staff are stateless muscle; Holon is the manager that owns memory

A CLI invocation is treated as **stateless** — each task gets a fresh context.
Holon's product layer (the "manager") owns, per `cli_agent` staff:

- **Persistent memory** — a manager-maintained, owner-visible notes blob
  (markdown). It is Holon state, persisted in `owner.sqlite`. It is **not** sent
  through Hermes and is not the CLI's own scrollback.
- **Context assembly on dispatch** — when a task is dispatched, Holon composes a
  context preamble from: the staff's `role_label` + `system_prompt`, its
  persisted memory, the task brief, and (future) pinned references — and feeds
  that to the CLI session as the opening message.
- **Deliverable capture + memory update** (slice 2) — on completion Holon
  captures the result as a deliverable and may append to the staff's memory.

This is exactly the manager↔Codex pattern already used to build Holon, made into
a product capability.

### 3. Slice boundaries

- **Slice 1 (this ADR):** per-staff `cli_memory` persistence (read/write,
  owner-visible) + `dispatchCliTask` (context assembly + injection into the
  session) + a `cli/dispatch` BFF + a `cli/memory` BFF. Deliverable auto-capture
  is explicitly deferred.
- **Slice 2:** completion detection → deliverable capture → optional memory
  append. Pinned-reference inclusion in the preamble (reuse ADR-039 path).

## Runtime Contract (slice 1)

```ts
// core
function readCliStaffMemory(staffId: string): string;          // '' if none
function writeCliStaffMemory(staffId: string, memory: string): void;

interface DispatchCliTaskInput { staffId: string; brief: string }
interface DispatchCliTaskResult {
  ok: boolean;
  launched: boolean;     // true if the session was started by this call
  preamble: string;      // the context actually injected (for audit/UI)
  reason?: string;
}
function dispatchCliTask(input: DispatchCliTaskInput): DispatchCliTaskResult;
```

BFF:

- `POST /api/v1/staff/:id/cli/dispatch  { brief }` → `DispatchCliTaskResult`
- `GET  /api/v1/staff/:id/cli/memory`           → `{ memory: string }`
- `PATCH /api/v1/staff/:id/cli/memory { memory }` → `{ ok: true }`

The injected preamble shape (sent as the session's opening message):

```
[Holon · {role_label} · {name}]
{system_prompt}

== 你的记忆（由 Holon 维护）==
{cli_memory}

== 本次任务 ==
{brief}
```

## Slice 1.1 — full automation (auto-launch + working dir)

Owner requirement (2026-05-23): the owner must not have to type — the session
should auto-start the agent. Added to `SubstrateCliAgent`:

- `cwd?: string` — the working directory the agent runs in, **also its de-facto
  permission boundary** (owner-selected at creation).
- `auto_launch?: boolean` — when set (default ON if `binary` present),
  `launchCliSession` runs `cd <cwd>; <binary> <args_template>` on session start
  (e.g. `claude --dangerously-skip-permissions`) instead of just hinting. It
  still `exec bash -l -i` AFTER the agent exits, so a missing/mis-pathed binary
  or the agent quitting drops to a shell rather than killing the session.

So "who is the runtime + which folder + which flags/model" are all per-staff
config: runtime = `binary` (claude/codex), permission scope = `cwd`, flags/model
= `args_template`. The owner-facing picker for these is the next UI slice.

## Consequences

- CLI staff get a real "memory" without any Hermes coupling; the manager layer is
  the single owner of that memory (Rule #1).
- `cli_memory` is plain owner state — owner-editable, auditable, and portable if
  the CLI binary changes (Claude Code ↔ Codex).
- Dispatch is one-way in slice 1 (fire context → human watches stream). Closing
  the loop (capture deliverable) is slice 2, kept separate so each slice is
  testable.

## Alternatives rejected

- **Route `cli_agent` through Hermes** — would require faking the CLI as an ACP
  sub-agent. Rejected: it is a mock, not a real integration, and loses the CLI's
  own agent loop (the thing that makes it effective).
- **Let the CLI manage its own memory (CLAUDE.md / scrollback only)** — rejected
  for the product path: memory must be Holon-owned to stay owner-visible,
  auditable, and runtime-portable. (The CLI's own files still exist; Holon's
  layer sits above them.)

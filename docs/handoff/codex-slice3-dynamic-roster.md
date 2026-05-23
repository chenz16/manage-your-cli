# CODEX SPEC — Slice 3: dynamic employees + live roster UI + employees fetch boss-memory

Parent (authoritative): `docs/handoff/cli-only-architecture-v2.md` (read §0 North Star,
§4 dynamic employees, §5 memory). Branch: `feat/cli-only-minimal`. Worktree:
`C:\dev\holon-cli` (fetch + reset --hard origin/feat/cli-only-minimal, then
`corepack pnpm install`).

## 0. North Star (don't violate)
Holon is a thin shell; intelligence = the CLI; Holon adds only context + memory. No
fancy machinery. "Everything is dynamic" — the roster/config reflect live state, never
hardcoded.

## 1. Goal (one testable slice)
Make the team **dynamic and visible**: employees created/retired via the Secretary
(MCP `create_agent`/`retire_agent`, already built in Slice 1) **show up live in the
web roster UI**, with their lifecycle (short/long) + alive status; and when the
Secretary dispatches a task, the employee **gets relevant context fetched from the
boss-side memory**. This is the owner-facing payoff: a CLI-manager team that appears,
works, and disappears, with knowledge living at the boss.

## 2. Build

### 2a. Live roster UI (web) — reflect dynamically-created employees
The members/roster page (`apps/web/app/members/...`) must show **cli_agent staff read
live from the (now-persisting) store** — create_agent staff now persist to
`~/.holon/owner.sqlite` (Slice 2 fixed persistence). Requirements:
- List all `cli_agent` employees from the real roster API (`/api/v1/staff`), not any
  hardcoded list. Newly-created (via Secretary/MCP) employees appear; retired ones
  reflect archived/gone.
- Show per employee: name/role, **lifecycle badge (short / long)**, **alive status**
  (session running vs not — reuse the cli status), and the existing CliTerminal
  "open terminal" affordance.
- "Everything dynamic": no hardcoded employee assumptions; empty state when none.
- Reflect create/retire on refresh (live polling/refresh is fine; real-time push is
  Slice 2.5/A2A — out of scope here).
- Surface `lifecycle` on the staff record. If `SubstrateCliAgent` lacks a `lifecycle`
  field, add it (additive, default 'short') — small schema add is OK here; keep it
  consistent with create_agent which already takes lifecycle.

### 2b. Employees fetch context from boss-memory at dispatch
When the Secretary dispatches to an employee (`dispatch` tool → `dispatchCliTask`),
the injected brief/preamble should **include relevant boss-memory context** pulled via
`readBossMemory` (the INDEX, plus any scope the brief references). Concretely: extend
the dispatch preamble builder so the employee receives "here is the boss context you
need" sourced from the boss store — employees don't carry their own memory, they fetch
from the boss (v2 §5). Keep it lean (don't dump the whole store — pass the INDEX +
scoped files, progressive disclosure).

### 2c. Lifecycle behavior
- **short** (default): ephemeral. `retire_agent` kills the session AND marks the staff
  archived/removed from the active roster (cleanup). Short employees are meant to come
  and go.
- **long**: persistent. `retire_agent` stops the session but **keeps the soul doc** and
  the staff record (status archived but restorable). Long employees survive.
- The roster UI shows the distinction (badge); archived short employees drop off the
  active list.

## 3. Constraints / hygiene
- **No API keys; no Hermes** (don't touch Hermes files — Slice 4). 
- Keep existing web UI patterns (Store vs Yours, CliTerminal, etc.). Reuse, don't
  rewrite. If you add a `lifecycle` field, update `packages/api-contract` + any zod
  schema + the create path consistently.
- Typecheck green: `corepack pnpm -F api-contract typecheck && -F core typecheck && -F
  holon-mcp typecheck && -F web typecheck`.
- Do NOT run `next dev`/`next build` (shared `.next`). Typecheck + curl/unit only.
- Engineering Rules: #4 no silent failure / no bare try-catch; #8 audit; #5 flat roster.
- Do NOT touch: Hermes files, mobile/*, repo-root CLAUDE.md, docs/architecture/*.

## 4. Acceptance
1. All typechecks green.
2. Creating an employee via the Secretary/MCP (`create_agent`) makes it appear in
   `/api/v1/staff` and in the members roster UI with the right lifecycle badge + alive
   status; `retire_agent` removes a short one from the active roster.
3. A dispatched employee's injected brief contains boss-memory context (show the
   preamble built from `readBossMemory`).
4. Report: files changed, any schema add (lifecycle), how the roster reads live state,
   how dispatch pulls boss-memory, and exact commands for me to integration-test
   (create_agent → see it in /api/v1/staff → retire → gone).

## 5. Git
Work on `feat/cli-only-minimal`. Your sandbox likely can't install/typecheck/commit —
that's fine, implement + report; I verify + fix + commit on WSL. If you can commit, use
the standard Co-Authored-By trailer.

# CODEX SPEC — Slice 1: Holon MCP + lean Secretary + boss-side memory skeleton

Parent (authoritative design): `docs/handoff/cli-only-architecture-v2.md`. Read it.
Branch: `feat/cli-only-minimal`. Worktree (yours): `C:\dev\holon-cli-rewrite` —
**repoint to the branch first**: `git fetch origin feat/cli-only-minimal &&
git checkout feat/cli-only-minimal && git reset --hard origin/feat/cli-only-minimal`,
then `corepack pnpm install`.

## 0. Context (do not re-litigate — owner-locked, see v2)
Persistent tmux per agent; official claude/codex CLI; **no API keys**. The Secretary
is a *super-lean* vanilla CLI whose powers come entirely from a **Holon MCP**.
**Memory is centralized at the boss** — employees keep no durable memory; they fetch
from the boss. This slice builds the MCP + the Secretary persona + the boss memory
store skeleton. (Display, live-tmux chat redirect, dynamic-lifecycle UI, and Hermes
removal are LATER slices — out of scope here.)

NOTE on existing code: a prior pipeline committed `manager-chat-service.ts`
(`runManagerTurn` + screen *reply-extraction*). That reply-extraction is **obsolete**
(v2 does deterministic display formatting, not answer parsing). Do not build on the
parser. Reusable groundwork: `cli-memory-scaffold.ts`, the dispatch/read wrappers.

## 1. Build: Holon MCP server (stdio)
New package (suggest `packages/holon-mcp/`, TypeScript, official
`@modelcontextprotocol/sdk`). Tools — **thin-wrap existing `@holon/core` fns**
(verify signatures yourself; do NOT reimplement the heavy logic):
- `list_live_agents()` → `[{id,name,role,alive,cwd,lastActivity}]` — wrap
  `getCliStatus` + session registry + `looksLikeBareShell` (NOT tmux
  pane_current_command — it lies).
- `dispatch(agent, brief)` → wrap `dispatchCliTask` (resolve agent by name/id).
- `read_agent_output(agent, lines?)` → wrap `captureCliOutput` (return RAW text).
- `create_agent(role, lifecycle)` → `lifecycle: 'short'|'long'` (default 'short').
  Provision a `cli_agent` staff (reuse staff-management-service + SubstrateCliAgent;
  UUIDv7; flat-roster Rule #5), cwd `~/holon-agents/<id>/`, binary from owner config
  (default claude). 'long' → also seed a soul/CLAUDE.md via `ensureAgentMemoryFile`.
- `retire_agent(agent)` → kill the session (wrap kill) + mark retired. Short-term
  cleanup. (For 'long' agents, retire = stop session but keep soul doc.)
- `read_memory(scope?)` / `write_memory(scope, text)` → **boss-side central store**
  (see §2), NOT per-employee files.
Engineering Rules: #4 no silent failure / no bare try-catch (classify + return a
structured error; never swallow); #8 audit line per dispatch/create/retire/write.
Add a stdio self-test that lists tools and calls `list_live_agents` (returns [] ok)
with NO API key in env.

## 2. Build: boss-side central memory store (skeleton, progressive-disclosure)
- A single central markdown store owned by the boss/owner — e.g.
  `~/holon-agents/boss/` with **`INDEX.md`** (the lean index: pointers/paths +
  one-line summaries — "where things are") + a **`MEMORY/` tree of detail files**
  (e.g. `MEMORY/<topic>.md`, employee training notes, roster). The boss soul/global
  context is its own file too.
- **Progressive disclosure (PAI) — do NOT dump everything.** `read_memory(scope?)`:
  with no scope → return the **INDEX only**; with a scope/pointer → return that one
  detail file. Never load the whole store at once (the index must stay small so the
  boss context never explodes). `write_memory(scope, text)` appends to the relevant
  detail file **and** updates the INDEX line. This is where employee training/tuning
  and global context get recorded.
- Employees fetch context from here (later slices wire them to call `read_memory`).
- Markdown only — **no vector DB / RAG / memory engine**. Reuse the
  `cli-memory-scaffold` style for file creation.

## 3. Build: lean Secretary persona + MCP registration
- Author `~/holon-agents/secretary/CLAUDE.md` (+ `AGENTS.md` for codex) via
  `ensureAgentMemoryFile`. Content = the LEAN secretary role: "You are the CEO's
  secretary. Stay extremely concise. Do light work yourself (answer, triage,
  summarize). For heavy work, `create_agent`/`dispatch` to an employee, then
  `read_agent_output` and summarize back. Default new employees to short-term; only
  long-term if the owner says so. All memory is the boss's: `read_memory` for
  context, `write_memory` to record training/decisions. Never do an employee's heavy
  job yourself." Keep it short.
- Register the Holon MCP for the secretary's claude/codex (`.mcp.json` / `claude mcp
  add` for claude; codex equivalent). No API key in the registration. Document the
  exact files/commands.

## 4. Constraints / hygiene
- **No API keys; no Hermes** (don't touch Hermes files this slice).
- Typecheck must pass: `corepack pnpm -F api-contract typecheck && corepack pnpm -F
  core typecheck && corepack pnpm -F web typecheck` (+ the new package).
- Do NOT run `next dev`/`next build` (shared `.next` clobber). Typecheck + MCP
  stdio self-test only.
- Do NOT touch: Hermes files, mobile/*, repo-root CLAUDE.md, docs/architecture/*.

## 5. Acceptance
1. All typechecks green; `packages/holon-mcp` builds.
2. stdio self-test: lists the 7 tools; `list_live_agents` → array (no throw);
   `create_agent('test-helper','short')` provisions a cli_agent; `write_memory` +
   `read_memory` round-trip the boss store — all with NO API key in env.
3. Tools are thin wrappers over existing core fns (show the wrapping in the report).
4. Secretary persona md + MCP registration files exist and are documented.
5. Report: files changed, MCP SDK + tool schemas, the claude/codex MCP registration
   shape (with `--help`/doc evidence), what (if anything) you added to core and why,
   and exact commands for me to integration-test.

## 6. Git
Work on `feat/cli-only-minimal`. Commit per logical unit; standard Co-Authored-By
trailer. Push to `origin feat/cli-only-minimal` when typecheck is green.

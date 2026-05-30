# Holon CLI-only — Architecture v2 (owner-driven, 2026-05-23)

> **Status: Historical record.** This document captures a point-in-time
> snapshot. References to **Hermes** / `hermes-acp` /
> `hermes_profile_generic_v1` describe the runtime used by the sister
> repo [`holon-engineering`](https://github.com/chenz16/holon-engineering)
> at the time of writing. `manage-your-cli` does not bundle, link to, or
> depend on Hermes — its live substrate is a direct multi-CLI adapter
> (`claude` / `codex` / `gemini` / `qwen`) under
> [`packages/core/src/cli-adapters.ts`](../../packages/core/src/cli-adapters.ts)
> and [`apps/web/lib/warm-agent.ts`](../../apps/web/lib/warm-agent.ts).
> The body below is preserved unedited for history.

**This supersedes `cli-only-minimal-rewrite.md` (v1).** v1 converged on a *headless
reply-extraction* manager (Option A) and per-agent memory. The owner redirected to
the design below. The old WSL dev pipeline (`holon-dev-manual`) building v1 was
**stopped 2026-05-23**; its reusable groundwork (cli-memory-scaffold, dispatch/
read-output wrappers) is kept, but the **screen reply-extraction parser is obsolete**
(we do NOT parse answers; the display layer does deterministic formatting only).

Goal unchanged: drop Hermes; run on the user's own CLI subscriptions; no API keys.

## 0. North Star (the one principle everything else serves)
**Holon is a thin shell. ALL intelligence comes from the CLIs (claude/codex).
Holon adds only (1) context/prompt and (2) memory. No fancy machinery** — no RAG,
no vector DB, no orchestration engine, no Hermes, no bespoke "AI" layer. This is
exactly why it's cheap (heavy thinking runs on the user's flat-fee subscription),
ban-safe (we drive the official CLI as normal local usage), and maintainable (we
don't reinvent what the CLI already does). **Any proposal to add a "smart" layer
must first justify itself against this principle** — default answer is no; push the
intelligence into the CLI's own prompt/memory instead.

## 1. Runtime — persistent tmux windows
Every agent (Secretary + employees) runs the official `claude`/`codex` CLI in its
**own persistent tmux session** on the user's machine. Subscription-only, **NO API
keys** (`ANTHROPIC_API_KEY`/`OPENAI_API_KEY` never required). Ban-safe: we drive the
official CLI as normal local usage; we never reuse OAuth tokens in our own client.

## 2. Roles
- **Secretary (CEO 管家 / Sr Manager).** A *super-lean* vanilla CLI. It carries no
  orchestration logic of its own. It does only light work inline (answer the owner,
  triage, summarize) and **dispatches all heavy work to employees**. It knows the
  global context (boss-side memory) and which employees are alive (the MCP). The
  owner's chat surface talks to the Secretary.
- **Employees (workers).** `claude`/`codex` in their own persistent tmux. They do
  the heavy work. **Created and destroyed dynamically** (§4). They hold no durable
  memory of their own (§5).

## 3. Inter-session communication = Holon MCP
A local stdio **MCP server** (the owner's "MCP for cross-session notification").
It **thin-wraps existing `@holon/core` functions** — it does NOT reimplement them.
Tools (lean set):
- `list_live_agents()` — who is alive (wrap `getCliStatus` + `looksLikeBareShell`).
- `dispatch(agent, brief)` — assign work (wrap `dispatchCliTask`).
- `read_agent_output(agent, lines?)` — read back **raw** screen text (the Secretary
  summarizes; the MCP does not).
- `create_agent(role, lifecycle)` — dynamic creation (§4).
- `retire_agent(agent)` — dynamic destruction (short-term cleanup).
- `read_memory(scope)` / `write_memory(scope, text)` — against the **boss-side**
  central store (§5).
All powers live in the MCP so the Secretary stays lean and the same tools are
reusable by any agent. Engineering Rules apply (#4 no silent failure / no bare
try-catch; #5 flat roster; #8 audit per mutating tool).

## 4. Dynamic employees + lifecycle ("everything is dynamic")
- The Secretary **creates employees dynamically** on demand.
- **Default = short-term** (ephemeral). Only if the owner says "long-term" is a
  long-term employee created.
- **Short-term:** appear in the owner's **live roster** view, ephemeral, retired
  after use.
- **Long-term:** persistent; may carry a soul doc; survive across sessions.
- **UI is a live reflection** of currently-created employees (roster + config are
  dynamic; nothing hardcoded). Creation and destruction show up live.
- Cheap create/destroy is possible *because memory is not in the employee* (§5).

## 5. Memory = centralized at the BOSS
- **All memory lives at the boss's side** — one central PAI store (markdown,
  filesystem-indexed). Employees do **not** keep their own durable memory.
- Employees **fetch the context they need FROM the boss** at runtime (via MCP
  `read_memory`).
- When the user **trains/tunes** an employee, that is recorded **at the boss**.
- This is what makes employees **fully dynamic (create ↔ destroy)** without losing
  knowledge — the knowledge persists centrally, not in the disposable worker.
- Per-employee md stores + searching them were rejected as "过于 dynamic."
- **No vector DB / RAG / memory engine** — markdown only, boss-side. (Long-term
  employees may have a soul doc, but the bulk lives centrally.)
- **Progressive disclosure (PAI pattern) — so the boss memory never explodes.**
  Do NOT write everything into one memory md (it would blow up the context). The
  boss memory is an **index**: a lean md that says *where* things are (pointers /
  paths / one-line summaries). The actual content lives in **separate detail
  files**. An agent reads the index first, then **opens only the specific file(s)**
  its current task needs. `read_memory` supports "read index → read a pointed-to
  file" (scoped), never a dump-everything load. `write_memory` appends to a detail
  file and updates the index. The boss "只是知道记忆存在啥地方."
- **PAI is binary-agnostic — NOT codex-specific.** The boss memory (INDEX +
  MEMORY/) is plain markdown read via the MCP `read_memory` tool, so it works
  identically whether an agent runs claude or codex. The ONLY per-CLI thing is the
  *entry* memory file each binary auto-reads on launch — **`CLAUDE.md` for claude,
  `AGENTS.md` for codex** — and Holon **dual-writes both** (same content) so the
  Secretary/employees work on either binary. (`AGENTS.md` looking codex-flavored is
  just the entry-file convention; the shared PAI store underneath is the same.)

## 6. Display (human-facing) — clean reading surface, not raw CLI
- The owner sees the Secretary's **natural-language replies** in a **clean reading
  surface** (chat style) — **option (a): only the agent's conversational reply**,
  hiding input echo + tool-call noise.
- Sourced **raw from the tmux**, then **deterministic formatting** (strip ANSI /
  spinner / box-drawing / prompt chrome; apply a fixed clean format). This
  formatting layer **is needed**.
- **No semantic secondary processing** (不做二次加工): never run another LLM to
  re-summarize/rewrite the reply.
- The raw terminal stays attachable via tmux for direct owner driving / debugging.

## 7. Drop Hermes (later slice)
Remove Hermes ACP client, `hermes-plugin-holon-owner`, the TCP bridge, the
worker-dispatcher, and the BYOK / LLM-provider engine. All AI work goes through CLI
agents. (Reference removal map: see v1 §5 + the Explore audit in the manager's
notes.)

## 8. Slices (revised, one testable step each)
1. **Holon MCP** (`list_live_agents / dispatch / read_agent_output / create_agent /
   retire_agent / read_memory / write_memory`) thin-wrapping core, + **lean
   Secretary persona** (CLAUDE.md/AGENTS.md) + the **boss-side memory store**
   skeleton. → testable: a claude session with the MCP can list/dispatch/read a
   dummy worker and read/write boss memory; no API key.
2. **Secretary live tmux + display redirect** to the clean reading surface (a) with
   deterministic formatting (reuse CliTerminal stream; strip chrome; show reply
   only). Owner chat input → Secretary tmux. Owner chat no longer uses Hermes.
3. **Dynamic employee lifecycle**: `create_agent(short|long)`, live roster UI,
   `retire_agent`; wire employees to fetch context from boss-side memory.
4. **Strip Hermes + BYOK** (the v1 §5 removal map).
5. **E2E verify**: dynamic create → dispatch → read → summarize → retire; memory
   persists at boss across employee death; no Hermes process; no API key.

## 9. Execution model
- Implementation → **Codex** (Windows worktree `C:\dev\holon-cli-rewrite`, repointed
  to `feat/cli-only-minimal`). The manager (this Claude session) owns planning,
  slicing, testing, quality, and the closed loop; Codex does the hard implementation.
- Branch: `feat/cli-only-minimal` (the cli-only work branch).

## 10. Two deployment models (don't conflate)
- **Personal / local (this build)**: each user's own machine, their own CLI
  subscription, **no API keys, no DB to configure** (local markdown + sqlite). The
  ONLY setup = log into `claude`/`codex` once. Lightweight; this is the OSS wedge +
  reputation play. Keeps the cost + ban-safety advantages.
- **Cloud / server (future, paid open-core)**: multi-tenant hosted → **needs a real
  DB** and **must use API keys** (you can't run each user's personal CLI subscription
  on a server — ToS-banned + can't auth as them). Loses the subscription economics +
  ban-safety; it's the "heavy" model, but it's where teams/enterprise pay (SSO, audit,
  admin). 
- **Don't fork the product.** Keep two things pluggable: the **runtime adapter**
  (local→official CLI / cloud→API) and the **storage backend** (local→markdown+sqlite
  / cloud→DB). Same orchestration + memory + UI on top. Build local now; only keep
  these interfaces clean so cloud is a later swap, not a rewrite.

## 11. Universal control plane (adopt existing tmux; fleet; mobile)
- The manager can **attach to EXISTING tmux sessions**, not only ones Holon spawns —
  `SubstrateCliAgent.external_session` (ADR-040 mode B) + tmux multi-attach already
  enable this. Surface it: a roster action to **adopt a running session** by name.
- One desktop app = a **control plane over many agents AND many managers** (a fleet),
  Holon-spawned or pre-existing.
- **Mobile = a thin remote client** to the host's Holon backend (LAN/network); it
  can't run tmux itself, so it renders the streams + sends input remotely (ties into
  the existing mobile track / LAN pairing). Same backend.
- Cross-machine = tmux-over-SSH (the mobile track's Mac SSH cascade pattern). Add a
  permission/auth boundary before allowing adoption of arbitrary sessions.

## 12. Embedded-terminal UX requirement (don't trap page scroll)
When rendering a tmux session in an embedded xterm, the terminal must **not hijack the
page's mouse-wheel scroll**: wheel over the small terminal scrolls the terminal's
scrollback only while it can; at the scrollback boundary (or when content fits) the
wheel must **chain to the page** (big window) so the surrounding app scrolls. Configure
xterm/viewport `overscroll-behavior` + boundary wheel-propagation (and consider
focus-gated capture). tmux mouse mode stays OFF. Bad scroll containment = bad UX.

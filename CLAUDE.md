# CLAUDE.md — Manage Your CLI

Project instructions for Claude Code working in this repo. Read this first.

## What this is

**Manage Your CLI** — a thin shell that turns your **CLI subscriptions** (Claude
Code, Codex, Gemini, Qwen, …) into a managed **team of agents**: a lean
**Secretary** you chat with, plus **dynamic employees** it creates and dispatches.
Intelligence comes entirely from the CLIs; this app only adds **context + memory +
orchestration + UI**. Subscription-only — **no API keys**.

## North Star (the one rule)

**Thin shell. All intelligence is the CLI's. We add only (1) context/prompt and
(2) memory.** No RAG, no vector DB, no orchestration engine, no bespoke "AI" layer.
Any proposal to add a "smart" layer must justify itself against this — default no;
push the intelligence into the CLI's own prompt/memory instead.

## Architecture

- **Secretary (owner-facing)** = a **warm headless CLI process** (`claude --print
  --input-format stream-json …`, default Haiku + `--effort low`), kept always-warm
  (pre-spawned on chat open; ~1s/turn). Clean streamed output — no TUI scrape.
  `apps/web/lib/warm-agent.ts` + `apps/web/app/api/v1/chat/owner/stream`.
- **Employees (workers)** = official CLI in their own **persistent tmux** (watchable,
  driveable). Created/retired dynamically; default short-term, long-term on request.
- **Holon MCP** (`packages/holon-mcp`) = the orchestration toolset the Secretary
  uses: `list_live_agents / dispatch / read_agent_output / create_agent / retire_agent
  / read_memory / write_memory`. Thin wrappers over `@holon/core`.
- **Memory = files at the boss** (`~/holon-agents/boss/`): `INDEX.md` + `MEMORY/`
  detail files, **progressive disclosure** (read index → open the needed file). Each
  agent also has its native `CLAUDE.md`/`AGENTS.md` (per-cwd). Employees fetch context
  from the boss; a periodic **memory-manager** agent consolidates short→long term.
  Markdown only — **no vector DB**.
- **Multi-CLI adapter** (planned): one `CliAdapter` interface; claude/codex/gemini/qwen
  plug in; each CLI's auth is the user's own login. Provider-agnostic — even
  Hermes-as-a-CLI could be an adapter.

## Layout

- `apps/web` — the UI (chat with the Secretary · `/members` roster · `/connectors`
  create-CLI-agent · `/me`). Next.js.
- `packages/core` — staff, CLI session/dispatch/screen, Secretary, boss-memory.
- `packages/api-contract` — zod schemas/types. `packages/holon-mcp` — the MCP server.

## Branch model (auto-managed)

- **`dev`** = work branch. **`main`** = stable. Build/verify on `dev`; promote `dev`→`main`
  when typecheck + production build are green. Don't commit unverified work to `main`.

## Build / run

```
corepack pnpm install
corepack pnpm -F api-contract typecheck && corepack pnpm -F core typecheck \
  && corepack pnpm -F holon-mcp typecheck && corepack pnpm -F web typecheck
bash scripts/build-web.sh          # production standalone
# serve standalone on a port, bound 0.0.0.0; HOLON_OPEN_DEMO=1 for single-user (no device token)
```

Engineering rules: no bare `try/catch` (classify + surface), no silent failure,
flat-roster (no staff owns staff), audit on state changes.

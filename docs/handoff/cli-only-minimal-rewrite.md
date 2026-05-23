# HANDOFF — CLI-only minimal Holon (drop Hermes)

Date: 2026-05-23
For: a fresh agent on a NEW branch off `main`. Goal = rewrite Holon's agent
runtime to be **pure-CLI**, dropping Hermes entirely. **Keep all UI and all
product requirements EXACTLY as they are now** — this is a runtime/engine swap,
not a product redesign.

---

## 1. One-line goal

Replace the Hermes ACP runtime with **CLI agents (Claude Code / Codex) driven via
tmux**, manage memory via **markdown files** (PAI-style, see §6), and require
**only CLI subscriptions — no API keys**. The web UI looks and behaves the same.

## 2. The architecture we converged on (the whole point)

Three roles, two input paths, everything is a CLI:

```
You (owner)
  ├─ direct → a CLI staff's terminal (see/drive it yourself; always available)
  └─ ask    → Sr Manager (the chat box) → reads worker output → summarises back
Sr Manager  = the chat window. A CLI agent (claude/codex), NOT Hermes.
Manager/workers = CLI agents (claude/codex) in tmux, each in its own cwd.
```

- **Everything is a CLI.** No Hermes ACP, no holon-owner plugin, no worker-dispatcher.
- **Memory is native to the CLI** (CLAUDE.md / AGENTS.md in each agent's cwd +
  the CLI's own session resume `claude -c`). Holon does **not** build a memory
  engine — it manages md files (§6) and tmux sessions.
- **Both inputs hit the same live tmux session** (tmux is multi-attach), so the
  owner typing in the terminal AND the Sr Manager dispatching reach the *same*
  agent with the *same* memory.

## 3. Why no Hermes / no API keys (the rationale — don't re-litigate)

- **Token economics**: the manager is light-token (cheap), the workers are
  heavy-token (expensive). Subscriptions (flat fee) cover the heavy work; that
  advantage **only exists locally** (the official CLI on the user's own machine).
- **Ban-safety (verified 2026-05-23)**: vendors ban *third-party apps reusing a
  subscription OAuth token in their own HTTP client* (OpenClaw/Cline pattern) and
  *cloud services running subscriptions*. They do **not** (and largely cannot)
  detect *driving the OFFICIAL `claude`/`codex` CLI via tmux keystrokes* — that's
  the official client making normal requests from the user's own device/IP. So
  **pure-CLI-via-tmux on the user's machine = low risk**; API keys aren't needed.
- Distribution: **desktop/local** = each user's own subscription (this design).
  A **cloud SaaS** would have to use API keys (out of scope here).

Sources captured in chat: Anthropic ToS enforcement (Jan/Feb/Apr/Jun 2026),
OpenAI Codex auth docs. The CLI-via-tmux path is the safe one.

## 4. What to KEEP (do not touch the look/behaviour)

- **All web UI**: `/today /inbound /deliverables /members /skills /references
  /connectors /me`, the chat surface layout, styling, i18n (en/zh). Same.
- **All product requirements** as they are today.
- **The CLI plumbing already built (REUSE, don't rewrite):**
  - `packages/core/src/cli-session-service.ts` — tmux launch/input/stream/resize/
    kill, **auto-launch the binary** (cwd default `~/holon-agents/<id>`,
    `pretrustClaudeFolder` so claude skips the trust dialog), `sendPrompt`
    (paste-buffer multi-line), `captureCliOutput` (read screen+scrollback).
  - `packages/core/src/cli-dispatch-service.ts` — `dispatchCliTask` (inject a
    prompt into a running agent) + screen-based "is an agent running" guard
    (`looksLikeBareShell` — DON'T use tmux pane_current_command, it lies).
  - BFF: `apps/web/app/api/v1/staff/[id]/cli/{launch,input,stream,exec,resize,
    dispatch,output,memory}/route.ts`.
  - `apps/web/app/members/_components/CliTerminal.tsx` — xterm terminal shell.
  - Connectors CLI create flow (`apps/web/app/connectors/page.tsx`): Claude Code /
    Codex cards → create a `cli_agent` staff (binary, cwd, args, auto_launch).
  - `SubstrateCliAgent` schema (`packages/api-contract/src/entities/staff.ts`):
    `binary, args_template, cwd, auto_launch, external_session, approval_rules`.

## 5. What to REMOVE / REPLACE (the actual work)

1. **Hermes runtime** — remove the dependency on `deps/hermes` (gitignored),
   `packages/hermes-plugin-holon-owner`, `apps/web/lib/hermes-acp-client.ts`,
   `scripts/hermes-tcp-bridge.mjs`, `packages/core/src/worker-dispatcher.ts`.
2. **The chat surface backend** — today the assistant-ui chat talks to Hermes
   (ACP). Re-point it at a **"Sr Manager" CLI session** (a `cli_agent`, claude or
   codex) using the SAME I/O the workers use (`sendPrompt` + stream + the
   screen-based read-back). Keep the chat UI visuals; swap the backend to a CLI
   shell. (The chat box becomes a nicely-rendered shell over the manager CLI.)
3. **The LLM-provider / BYOK engine layer** — `llm-provider-resolver`,
   `llm-gateway`, the connector "大语言模型 · API key" category, `active_llm_provider`.
   Not needed: there's no Hermes LLM to feed. (Leave the cards/UI if removing them
   breaks the layout — but they have no runtime role anymore.)
4. **Anything that injected Holon-managed memory into prompts** — superseded by
   native md-file memory (§6). `cli_memory` (owner-state-persistence) can go.

Keep missions/inbound/deliverables/skills/references as product features (data +
UI). They no longer route through Hermes; wire any AI action they need to the
manager CLI (`dispatchCliTask` / `captureCliOutput`) instead.

## 6. Memory = markdown files (PAI-style)

Model after danielmiessler/Personal_AI_Infrastructure (text-first, filesystem as
index, no DB; context over models; AI-operable):

- **Per-agent memory** = `CLAUDE.md` (claude) / `AGENTS.md` (codex) in that
  agent's `cwd` (default `~/holon-agents/<staff-id>/`). The CLI reads it every
  launch; `claude -c` resumes the prior session. This IS the agent's long-term
  memory — Holon just makes sure the cwd exists and (optionally) lets the owner
  edit the md.
- **Global / manager memory** = a PAI-style tree the Sr Manager's cwd points at,
  e.g. `~/holon-agents/manager/` with `CLAUDE.md` + a `MEMORY/` (work, knowledge,
  observations) + `TELOS.md`-ish owner-goals + a roster note. The Sr Manager (a
  CLI) reads/edits these md files itself (AI-operable).
- Holon's job re memory = (a) create/own the folder layout, (b) optionally a
  simple md viewer/editor in the UI. **No vector DB, no RAG, no memory engine.**

## 7. Auth model

- **CLI subscriptions only.** Each agent = the official `claude` / `codex` binary,
  logged in on the machine (Claude Max / ChatGPT). No `ANTHROPIC_API_KEY` /
  `OPENAI_API_KEY` required anywhere. Drop the BYOK key UI's runtime role.
- The owner authenticates the CLIs once (`claude` / `codex` login) on the machine;
  Holon never holds tokens.

## 8. Gotchas already solved (carry them over — they cost real debugging)

- **Trust dialog**: claude stalls on a first-time "trust this folder?" prompt →
  pre-write `projects[cwd].hasTrustDialogAccepted=true` in `~/.claude.json`
  (`pretrustClaudeFolder`). Without it the agent drops to bash.
- **Multi-line prompt**: send via tmux `paste-buffer` (one bracketed paste) +
  Enter, NOT `send-keys -l` (each newline = a separate Enter → lines run as
  commands). See `sendPrompt`.
- **Agent-running detection**: tmux `pane_current_command` reports `bash` even
  while claude/codex's TUI is running. Detect via the SCREEN
  (`captureCliOutput` + agent-chrome regex), see `looksLikeBareShell`.
- **tmux size**: `new-session -x120 -y32` + `window-size manual` +
  `resizeCliSession` from the frontend, or the cursor lands wrong.
- **Default cwd**: never let an agent run in a random dir; default to
  `~/holon-agents/<id>` (workspace + memory anchor).
- **Build hygiene**: build the web release via `scripts/build-web.sh` (isolates
  `HOLON_DB_PATH`), and ALWAYS restart `scripts/serve-production-wsl.sh` after a
  build (a build regenerates chunk hashes; a live server then 404s old chunks).

## 9. Suggested slices (one testable step at a time)

1. **Sr Manager = a CLI session**: make the chat box a shell over a `cli_agent`
   "manager" (reuse CliTerminal + sendPrompt + captureCliOutput). Owner can chat
   with it; it can `dispatchCliTask` / `read_cli_output` to workers.
2. **md-file memory layout**: create the `~/holon-agents/<id>/CLAUDE.md` +
   manager PAI tree; optional UI md editor.
3. **Strip Hermes**: remove the ACP client, plugin, bridge, worker-dispatcher,
   LLM-provider engine layer. Make all AI actions go through the manager CLI.
4. **Verify**: hire a Codex worker + a manager from /connectors; chat the manager
   → it dispatches → reads back → summarises; owner can also drive the worker
   terminal directly. No Hermes process running, no API key set.

## 10. Current state of `main` (your fork point)

`main` already has the full CLI plumbing (§4) working *alongside* Hermes. Your job
is to make CLI the ONLY runtime and remove Hermes. ADR-040
(`docs/decisions/040-cli-staff-dual-runtime.md`) records the CLI-staff design.
The connectors flow already creates `cli_agent` staff; CliTerminal already runs
them; dispatch/read_cli_output already exist. Build on these.

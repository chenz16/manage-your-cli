# EXECUTION PLAN — CLI-only minimal Holon (manager breakdown)

Owner: Chen (CEO). Manager: Claude (7×24, plan/split/test/quality/design only).
Implementer: **Codex** (heavy implementation). Branch: `feat/cli-only-minimal` off `main`.
Source brief: [`cli-only-minimal-rewrite.md`](./cli-only-minimal-rewrite.md). Date: 2026-05-23.

This is the manager's executable breakdown of the brief — concrete slices, each one
testable on its own, sized for a single Codex dispatch, with explicit acceptance gates.

---

## 0. Architecture decisions (resolved — do not re-litigate)

The brief left a few open points; resolved here using the brief as authority so Codex
gets one unambiguous target.

| # | Question | Decision |
|---|----------|----------|
| D1 | Owner chat (Sr Manager) runtime | A **`cli_agent`** (claude/codex) in tmux, the "manager" staff. `/api/v1/chat/owner/stream` drives it via `sendPrompt` + stream/`captureCliOutput`. |
| D2 | Chat-box UX | **Keep the assistant-ui bubble chat.** Owner types → prompt to manager CLI → screen read-back → render reply as an assistant bubble. The raw manager terminal stays available (CliTerminal) for direct drive. Same visuals as today. |
| D3 | Per-staff 1:1 chat | For `cli_agent` staff: `/api/v1/staff/[id]/chat` → `dispatchCliTask` + `captureCliOutput`. CLI is the only runtime; non-CLI staff types are not supported at runtime. |
| D4 | Workspace context injection | **Native md files** (CLAUDE.md / AGENTS.md in each cwd). Drop the per-turn Hermes `pre_llm_call` snapshot hook. Manager reads/edits its own PAI tree. |
| D5 | Holon-managed memory (`cli_memory`) | **Removed.** Memory = md files only. No DB memory, no RAG, no vector store. |
| D6 | BYOK / LLM-provider layer | **Runtime role removed.** No API keys required anywhere. Cards/UI may stay if removal breaks layout, but carry no runtime. Direct-LLM features (describe-mode catalog create, wechat-specialist, admin/polish) get rerouted to the manager CLI OR downgraded to non-AI (direct-mode only) — see Slice 4. |

---

## 1. Closed-loop wiring (manager ↔ Codex ↔ branch)

- I (manager, WSL `/home/chenz/project/holon-engineering`) own the branch
  `feat/cli-only-minimal` and all **non-code** artifacts (this plan, ADR, USER-TODO).
- **Codex implements code on the SAME WSL working tree** (probed for reachability via
  `scripts/codex-agent.sh -C '\\wsl$\Ubuntu-22.04\home\chenz\project\holon-engineering'`),
  so there is one working tree and no git ping-pong. Fallback if 9P too slow: a
  dedicated Windows worktree synced through `origin`.
- To avoid concurrent-edit collisions: **Codex touches code; I touch docs.** We never
  edit the same file in the same round.
- After each Codex delivery I run the quality gate (typecheck + curl + user-flow), then
  commit. Codex does not commit; I commit verified work.

---

## 2. Slices (one testable step at a time)

### Slice 1 — md-file memory layout (additive, zero-risk)
**Goal:** the filesystem memory model exists before anything depends on it.
- On `cli_agent` launch, ensure `~/holon-agents/<staff-id>/` exists and seed a
  `CLAUDE.md` (claude) / `AGENTS.md` (codex) from a role template if absent.
- Create the manager PAI tree `~/holon-agents/manager/`: `CLAUDE.md` + `MEMORY/`
  (work / knowledge / observations) + `TELOS.md` (owner goals) + a roster note.
- (Defer optional UI md editor unless trivial.)
- **Accept:** launching a cli_agent creates its cwd + seed md; manager dir scaffolds on
  first manager launch; no behavior change to existing flows; all typechecks pass.

### Slice 2 — Sr Manager = a CLI session (the core swap)
**Goal:** the chat box is backed by the manager CLI, not Hermes.
- Designate/auto-provision a "manager" `cli_agent`. Re-point
  `apps/web/app/api/v1/chat/owner/stream/route.ts`: replace `promptOwner()` with
  `sendPrompt` to the manager session + SSE stream/read-back of the reply. **Keep the
  exact SSE event contract** (`text`/`done`/`error`) so the chat UI is untouched.
- Audit `runtime: 'cli'` instead of `'hermes-acp'`.
- **Accept:** owner sends a chat message → manager CLI replies → renders as a bubble;
  no Hermes spawn; SSE shape unchanged; chat page still 200s.

### Slice 3 — Per-staff 1:1 chat → CLI
**Goal:** staff chat runs on the staff's own CLI session.
- Re-point `apps/web/app/api/v1/staff/[id]/chat/route.ts`: replace `promptSession()`
  with `dispatchCliTask` + `captureCliOutput` for `cli_agent` staff. Keep the system
  prompt / scope / grounding content, delivered via the dispatch preamble.
- **Accept:** 1:1 chat with a hired cli_agent returns a reply via its tmux session; no
  `promptSession`; route still returns the `{ reply }` contract.

### Slice 4 — Strip Hermes + BYOK runtime
**Goal:** CLI is the ONLY runtime; no Hermes, no API keys.
- Remove: `apps/web/lib/hermes-acp-client.ts`, `packages/hermes-plugin-holon-owner`,
  `scripts/hermes-tcp-bridge.mjs`, `packages/core/src/worker-dispatcher.ts`, the
  `deps/hermes` spawn, and the Tauri (`src-tauri`) Hermes process management.
- Remove runtime role of `llm-provider-resolver` / `llm-gateway` /
  `active_llm_provider`; remove `cli_memory` (owner-state-persistence memory funcs) +
  its `/cli/memory` route.
- Reroute remaining direct-LLM features (describe-mode catalog create, wechat-specialist,
  admin/polish) → manager CLI, or downgrade to direct-mode-only where AI isn't essential.
- Clean dangling refs (`forgetSession`, `warmBridge`, `notifyTauriProviderChanged`, etc.).
- **Accept:** no Hermes process, no `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`/`DEEPSEEK_API_KEY`
  required to boot or chat; all three typechecks pass; chat + staff chat + dispatch all
  work; `grep -ri hermes apps packages` returns only comments/historical docs.

### Slice 5 — Verify (manager-owned, no Codex)
- From `/connectors`: hire a Codex worker + a manager. Chat the manager → it
  `dispatchCliTask` to the worker → `captureCliOutput` → summarizes back. Owner can also
  drive the worker terminal directly. Confirm: zero Hermes processes, zero API keys set.
- Produce a verification note with evidence (commands + output) per the brief §9.4.

---

## 3. Gotchas to carry into every Codex brief (from brief §8)
Trust-dialog pre-accept; multi-line prompt via `paste-buffer`; agent-running detection via
SCREEN not `pane_current_command`; tmux `-x120 -y32` + manual window-size; default cwd
`~/holon-agents/<id>`; build via `scripts/build-web.sh` + restart the production server.

## 4. Quality gate (run after every slice, before commit)
1. `pnpm -F api-contract typecheck && pnpm -F core typecheck && pnpm -F web typecheck`
2. `curl -s -o /dev/null -w "%{http_code}\n"` every touched route
3. User-flow simulation of the slice's accept criteria + 2-3 adversarial variants
4. `tail` the dev log for HMR/runtime errors

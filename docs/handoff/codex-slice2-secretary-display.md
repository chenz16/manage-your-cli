# CODEX SPEC — Slice 2: Secretary live tmux + display redirect (clean reading surface)

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

Parent (authoritative): `docs/handoff/cli-only-architecture-v2.md` (read §0 North Star,
§2 Roles, §6 Display). Branch: `feat/cli-only-minimal`. Worktree: `C:\dev\holon-cli`
(already on the branch — `git fetch origin feat/cli-only-minimal && git reset --hard
origin/feat/cli-only-minimal`, then `corepack pnpm install`).

## 0. North Star (do not violate)
Holon is a **thin shell**; all intelligence is the CLI's. This slice adds **only**
deterministic display formatting — **NO semantic reprocessing** (never call an LLM to
rewrite/summarize the Secretary's reply). Keep it boring and rule-based.

## 1. Goal (one testable slice)
Make the owner chat surface a **live, clean reading view of the Secretary's persistent
tmux session**: owner types → goes to the Secretary's tmux; the Secretary's reply
streams back **deterministically formatted** (option a). The owner chat **no longer
uses Hermes**. Keep the existing chat UI visuals.

## 2. Build

### 2a. (small, do first) Fix the persistence require-in-ESM defect
`packages/core/.../owner-state-persistence` (or wherever the audit
`persistence.open_failed: "require is not defined"` originates) uses `require()` in an
ESM module. Replace with a proper ESM `import` (or `createRequire(import.meta.url)`),
so the persistence layer opens when the package is run via tsx/ESM (the MCP runtime).
Verify the audit no longer fires in the holon-mcp self-test.

### 2b. Secretary staff + persistent tmux
Add `getOrCreateSecretaryStaff()` in core: a well-known Secretary `cli_agent` (stable
role/slug, e.g. role_label 'Sr Manager'/'Secretary'), `cwd ~/holon-agents/secretary/`,
binary from owner config (default `claude`), `auto_launch:true`. Idempotent (reuse if
present). It uses the Slice-1 scaffold (CLAUDE.md/AGENTS.md + Holon MCP registered).
Launch its persistent tmux via the existing `cli-session-service`.

### 2c. Deterministic display formatter (SALVAGE, don't reinvent)
The old `manager-chat-service.ts` (git history at cd6fa49/621124e) already wrote a
**deterministic** screen stripper (isSeparator / isInputBox / isStatus / strip the
answer bullet `●⏺⎿` / strip ANSI). **Salvage that logic** into a small reusable
formatter (e.g. `packages/core/src/cli-screen-format.ts`), but adapt it from the old
*turn-based* use to a **continuous-stream** transform over the live tmux output:
- strip ANSI / control codes / spinners / box-drawing / the input prompt chrome;
- show only the **agent's conversational reply**; hide input echo + tool-call noise (a);
- pure/deterministic — no LLM, no network.
Do NOT resurrect the headless `runManagerTurn` request/response wrapper; this is a
stream formatter over the persistent session.

### 2d. Re-point the owner chat backend to the Secretary
`apps/web/app/api/v1/chat/owner/stream/route.ts` (consumed by `owner-adapter.ts`):
- Resolve the Secretary staff; ensure its session is launched.
- Owner's latest message → send to the Secretary tmux (`sendPrompt`, paste-buffer for
  multi-line).
- Stream the Secretary's tmux output via `subscribeOutput` → the deterministic
  formatter → emit the EXISTING SSE contract `{type:'text', text:<cumulative clean
  reply>}` then `{type:'done'}`. Preserve the SSE shape so `owner-adapter.ts` and the
  chat UI are unchanged. (tool_call/tool_update/language_changed may be dropped for
  now — owner chat is the Secretary terminal.)
- **Remove the `resolveActiveProvider()` 503 gate** from the owner-chat path (CLI-only
  needs no LLM provider). Do NOT import `hermes-acp-client` here anymore.
- `chat/warm`: warm the Secretary tmux instead of Hermes (or no-op). No Hermes spawn.
- Audit: keep the shape, set `runtime:'secretary-cli'`.
- Owner can still `tmux attach` the Secretary session directly (raw) — don't break that.

## 3. Constraints / hygiene
- **No API keys; no Hermes calls** on the owner-chat path (don't delete Hermes files
  yet — that's Slice 4 — just stop using them here).
- Keep the chat UI visuals (assistant-ui shell). Only the backend source changes.
- Typecheck green: `corepack pnpm -F api-contract typecheck && -F core typecheck && -F
  holon-mcp typecheck && -F web typecheck`.
- Do NOT run `next dev`/`next build` (shared `.next`). Typecheck + (if feasible) a
  scripted stream-formatter unit test only.
- Engineering Rules: #4 no silent failure / no bare try-catch; #8 audit; #5 flat roster.
- Do NOT touch: Hermes files (Slice 4), mobile/*, repo-root CLAUDE.md, docs/architecture/*.

## 4. Acceptance
1. All typechecks green; persistence.open_failed no longer fires in the self-test.
2. The owner-chat route sources from the Secretary tmux (not Hermes); no
   `resolveActiveProvider` 503; no `hermes-acp-client` import on that path.
3. A unit test of the formatter: given a captured raw tmux screen (ANSI + spinner +
   input box + tool lines + the reply), it returns ONLY the clean reply text.
4. Report: files changed, what you salvaged from old manager-chat-service.ts, the exact
   SSE events emitted, how owner input reaches the tmux, and exact commands for me to
   integration-test (ideally: drive the Secretary session and see clean reply via the
   route).

## 5. Git
Work on `feat/cli-only-minimal`. NOTE: your sandbox can't reach the npm registry, so
you likely can't `pnpm install`/typecheck/commit — that's fine: implement + leave a
clear report; **I verify, fix, and commit on the WSL side.** If you CAN commit, use the
standard Co-Authored-By trailer; otherwise just report files changed.

# Changelog

All notable changes to **Manage Your CLI** are kept here. The format
follows [Keep a Changelog](https://keepachangelog.com/) and dates are
ISO-8601.

## [Unreleased]

The first public-release-ready cut. Branch: `feat/native-stt-hardening`.

### Added

- **Release-shape docs**: top-level [`INSTALL.md`](INSTALL.md) (one-page
  WSL/Linux install + run), [`scripts/check-deps.sh`](scripts/check-deps.sh)
  (pre-flight required/optional dep audit with distro-specific install
  hints), [`scripts/dev/README.md`](scripts/dev/README.md) (developer-only
  iOS/Mac/Android pipeline env reference).
- **Health observability**: `GET /api/v1/health` returns the live
  process registry — warm secretaries, tmux employees, discovered
  process-tree children, in-process Task / `mcp__holon__*` subagents —
  with per-entry `pidAlive`. Both desk and mobile render a 10px
  green/yellow/red/gray status dot wired to it.
- **Robustness layer**: `ProcessRegistry` + heartbeat ticker (30s) +
  process-tree scan + auto-respawn for dead tmux employees (per-CLI:
  `claude --resume <session>` / codex / gemini / qwen with the right
  interactive flags) + warm session-id persistence to
  `~/.holon/warm-sessions.json` so the secretary keeps memory across
  HMR / idle reap / restarts.
- **Multi-secretary-project on desk**: parity with the mobile model. The
  topbar Switcher does CRUD inline (switch, create, ✏️ rename,
  🗑 delete). `/members` filters strictly by the active project's
  `tags: project:<id>` so an employee belongs to a project, not a
  global pool. ChatRuntime posts `project_id`; transcripts hydrate
  per-project.
- **Shared TTS sanitizer** (`packages/core/src/sanitize-for-tts.ts`):
  desk endpoint `/api/v1/connectors/voice/tts` and mobile `speak()` now
  filter through the same implementation — strips fenced code blocks,
  URLs (http/https/mailto/file), markdown formatting, emojis / `\p{S}`
  symbols / arrows / dingbats / variation selectors, file paths
  (≥2 slashes), HTML entities, runaway repeats. 17 vitest cases.
- **Stream-json Task tap**: warm secretary's stdout parser registers
  every `Task` tool call and every `mcp__holon__*` dispatch as a
  `task-subagent` entry — owner can see in-process subagents in
  `/api/v1/health` (they have no OS pid). Closed-out on `tool_result`.
- **systemd-user unit**: `scripts/install-desk-systemd.sh` installs an
  idempotent unit (`holon-desk.service`, `Restart=always`) so the desk
  auto-starts on WSL boot and recovers from crashes.
- **TopbarMe**: desk topbar shows the live owner name from `/api/v1/me`
  with computed initials, replacing the hardcoded `Chen · laptop-desk`
  chip.

### Changed

- `.env.example` rewritten to reflect the personal-edition defaults —
  documents the toggles owners actually use (`HOLON_OPEN_DEMO`,
  `HOLON_LAN_ACCESS`, `HOLON_SECRETARY_MODEL`/`EFFORT`), drops the dead
  DeepSeek / Hermes-API-base lines.
- `README.md` install section points at `INSTALL.md` and
  `scripts/check-deps.sh` as the canonical entry point.
- Desk-side new components (HealthDot, SecretaryProjectSwitcher) use
  the existing warm Bauhaus tokens (`--blue / --green / --red /
  --gold / --ink / --line / --bg-alt`) instead of mixing in an iOS
  palette.
- iOS-side scripts moved from `scripts/` to `scripts/dev/`; all
  hardcoded values (Mac SSH host, Apple ID, app-specific password,
  Team ID, iPhone UUID, keychain password) replaced with `:?required`
  env reads.
- Legacy holon-engineering worktree scripts (`promote.sh`,
  `dev-daemon.sh`, `mobile-promote.sh`, etc.) moved to
  `scripts/legacy/`.

### Fixed

- **Summarizer never produced any text** — `apps/web/lib/adopted-
  summarizer.ts` was reading the wrong stream-json event types
  (`type === 'message'` doesn't exist; `result` events carry text in
  `ev.result` not `ev.message.content`). Ported the correct parser
  from `warm-agent.ts`. Audit log now shows `appended` events instead
  of `skipped_short, len:0` on every turn.
- **Production build broke on a fresh clone**: `auth.ts` and
  `lib/encrypted-token-storage.ts` used to `throw` at module load when
  `HOLON_TOKEN_ENC_KEY` was unset. Replaced with `console.warn` +
  silent during `NEXT_PHASE=phase-production-build`. NextAuth route
  marked `dynamic: 'force-dynamic'` so Next skips static page-data
  collection. Verified `git clone → pnpm install → next build` end to
  end on a pristine box.
- Webpack-related: `node:`-scheme imports in heartbeat / process-
  registry / tmux-discovery rewritten to `eval('require')(...)` so the
  health route bundle survives. tmux-discovery fetches the staff list
  via the desk's own HTTP API instead of importing `@holon/core` to
  avoid pulling the entire core graph into the instrumentation chunk.
- Smoke test (`scripts/slice5-smoke.sh`) used to write
  `smoke/slice5_<epoch>` to boss memory on every run — 17 accumulated
  entries polluted every agent's boot context. Pinned to `smoke/slice5`
  so subsequent runs overwrite.
- iOS direct-push pipeline: bake build SHA into `sw.js` CACHE_VERSION
  so the WKWebView service worker invalidates across `.ipa` reinstalls;
  re-apply NSAllowsArbitraryLoads to Info.plist on every build
  (regenerated by `cap add ios`); detect `devicectl` install failure
  instead of reporting `DONE` on missing-device errors.

### Removed

- Hardcoded personal information across the production tree:
  `chen.zhang6@gmail.com`, `zuolinliu@10.0.0.123`, `123456`,
  `R78Y6F9R6K`, `wamt-drzr-...`, `/home/chenz/...`, `/Users/zuolinliu/...`.
  Now zero hits across `*.sh / *.ts / *.tsx / *.md / *.json` outside
  `docs/` / `legacy/` / `dist/` / `.next/`.

### Owner-gated (not in this release)

- LICENSE choice
- NextAuth removal (would cascade to Gmail OAuth — needs explicit
  scope decision)
- Long-term secretary memory consolidator (sleep-time `CLAUDE.md`
  rewrite)
- Event-driven secretary follow-up (settle-watch on dispatch → push
  synthetic msg to warm secretary)
- Harvest-on-retire (reclaim dying employee memory into boss store)
- Desk UI language mix (EN chrome vs ZH onboarding)

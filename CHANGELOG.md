# Changelog

All notable changes to **Manage Your CLI** are kept here. The format
follows [Keep a Changelog](https://keepachangelog.com/) and dates are
ISO-8601.

## [Unreleased]

Post-0.3.1 — next release window.

### Known follow-ups

- iOS .ipa (owner secrets not yet provided)
- Tauri code signing (SmartScreen warning on first install)
- Logo iteration (5 SVG candidates as inventory at `docs/brand/candidates/holon-cc/`)
- ADR §4.9 HR veto path migration (path resolved; impl pending — task #19 area)
- Backlog: #8 self-test DB iso, #12 NextAuth removal (owner not authorized), #18 desk UI lang mix (owner direction pending), #19 sleep-time consolidator

---

## [0.3.1] — 2026-05-30 (state isolation + role-templates seed + HR transcript scoring)

### Added

- **Test/release state isolation** ([ADR](docs/adr/test-release-state-isolation.md))
  — `HOLON_AGENTS_HOME` + `HOLON_STATE_ROOT` env overrides so dev tests don't
  pollute owner's real state. Mobile: `NEXT_PUBLIC_HOLON_ENV` namespacing on
  localStorage (default `prod` = byte-identical to today). Integration test
  asserts real `$HOME` untouched.
- **Role-templates catalog** — 22 ROLE.md total (3 from slice 1 + 19 seed:
  12 work + 7 role-play). Non-clinical / non-legal-advice framing for the
  regulated thinking-partner roles. Catalog seed test asserts compose_with
  graph closure + tag coverage.
- **HR Path B real-transcript scoring** — warm-agent persists stream-json
  events to `~/.holon/transcripts/<key>.jsonl` (50MB rotation); `@holon/core`
  exports `readRecentTurns` / `readSince`. HR scorer tightens
  `dispatched-not-DIY` / `read-INDEX-before-act` / `role-fidelity` rubric
  items against actual events instead of just the dispatch result string.
- **Tauri Windows installer infrastructure** —
  `.github/workflows/desk-installer.yml` builds `Holon_*_x64-setup.exe` on
  windows-latest, auto-attaches to release on `release.published`.

### Changed

- **Build artifact rename** — `myc-desk-standalone-*.tar.gz` →
  `holon-desk-standalone-*.tar.gz`; `holon-mobile-debug-{ver}-{sha}.apk` →
  `holon-mobile-v{ver}-{sha}.apk` (drop -debug suffix). Tauri
  `Holon_*_x64-setup.exe` already aligned.
- **README**: Glossary section clarifies MYC (repo codename) vs Holon
  (umbrella + desk product) vs 微作 Weizo (mobile in-app brand).

### Fixed

- `apps/web/lib/warm-agent.ts`: `transcriptsDir()` uses `holonStateRoot()`
  helper instead of unresolved `homedir()` call (PR #28 had the bug).

### Verified

- Typecheck clean: api-contract / core / holon-mcp / web.
- `@holon/core` tests: **120 passed** (was 98) / 16 skipped.
- `@holon/web` tests: **73 passed** (was 61).
- `bash scripts/build-web.sh` production standalone build green.
- Fresh tarball self-test: extract → `PORT=3210 bash run.sh` → `curl /api/v1/ping` 200.

### Release artifacts

- 📦 `holon-desk-standalone-v0.3.1.tar.gz` — Linux/WSL/Mac desk (30MB)
- 📦 `Holon_0.3.1_x64-setup.exe` — Windows installer (via GHA, ~80MB)
- 📦 `holon-mobile-v*.apk` — Android sideload (debug-signed)

---

## [0.3.0] — 2026-05-30 (post-Hermes-decouple cut)

### Added (post-Hermes-decouple)

- **Pre-built desk standalone tarball** (`scripts/package-desk-standalone.sh`)
  — stages the Next.js standalone output + `.next/static` + `public/` into a
  drop-in `myc-desk-standalone-${VERSION}.tar.gz` with `run.sh` and a
  recipient-facing README. Attached to GitHub Releases (`gh release upload
  v0.3.0 ... --clobber`) so a non-developer can extract, run one command,
  and reach the desk at `http://localhost:3110` without cloning the repo or
  running `pnpm build`. Script strips Next's trace-leaked `.ts`/`.tsx` files
  and patches the standalone tracer's missing `@next/env` symlink.
- **Role-templates library + composition spec** ([ADR](docs/adr/role-templates-and-persona-composition.md))
  — agents have a *nominal* role + composition of *actual* roles
  merged at create-time. Nominal wins identity/voice; behaviors/
  responsibilities/knowledge unioned via the HR rule-hash; do/don't
  collisions surfaced not auto-resolved. Karpathy's LLM Wiki cited as
  architectural cousin; 5 curated sources + 22-role catalog seed (15
  work + 7 role-play).
- **Role-templates slice 1 runtime** (commit `384fcb8`) — loader,
  composer, persona renderer, `writeRoleComposition` memory-file
  integration mirroring HR's `writeHrCorrection`; `holon-create-agent`
  SKILL.md scaffold with inline catalog; 3 seed `ROLE.md` (secretary +
  7x24-manager lifted from owner memory; code-reviewer authored).
- **Architecture doc sync** — six existing arch docs updated to
  System 0/1/2 + multi-CLI adapter terminology; two new docs:
  [`memory-update-flow.md`](docs/architecture/memory-update-flow.md) +
  [`hr-evaluator.md`](docs/architecture/hr-evaluator.md).
- **Doc + design audit** ([report](docs/reviews/audit-2026-05-30-docs-and-design.md))
  — critical pass over the whole shipped wave.

### Changed (post-Hermes-decouple)

- **Formal decouple from sister-repo `holon-engineering` runtime
  (Hermes).** `manage-your-cli` runs entirely on the user's CLI
  subscriptions (claude / codex / gemini / qwen) via the multi-CLI
  adapter. All Hermes references that described the runtime as live
  in this repo have been removed or moved to clearly-bracketed
  `Lineage` callouts.
  - UI: Hermes (HTTP API) connector card removed from
    `apps/web/app/connectors/page.tsx`.
  - Tauri scaffold (`apps/web/src-tauri/`) moved to
    `apps/web/legacy-src-tauri/`; `tauri:*` npm scripts and the
    `@tauri-apps/cli` devDep removed.
  - Sister-repo build paths parked:
    `scripts/build-all.sh` →
    `scripts/legacy/build-all.sh`;
    `.github/workflows/windows-installer.yml` →
    `.github/workflows/legacy/windows-installer.yml`;
    plus the Windows installer + slice-5 smoke scripts.
  - Live MYC scripts washed in place: `serve-production-wsl.sh`,
    `dev-prewarm.sh`, `start-production.sh`, `oauth-test-mode-on.sh`,
    `.env.test.local.example`. `HOLON_HERMES_PORT` dropped from
    live env (still exists only in `legacy-src-tauri/`).
  - Sister-repo arch spec docs moved to `docs/architecture/legacy/`:
    `owner-assistant-tools.md`, `runtime-adapter-interface.md`,
    `worker-dispatcher.md`. Five sister-repo install docs moved to
    `docs/install/legacy/`.
- **README** primary-purpose framing sharpened: *boss/manager view
  of workers, stable team, secretary as buffer, supports
  micromanagement, extremely optimized for mobile management, don't
  reinvent the wheel*. Memory-update flow diagram inserted between
  System 0/1/2 and the shell-vs-gateway axes. Per-CLI install links
  added.
- **Pre-commit hygiene**: `scripts/install-git-hooks.sh` (off-by-
  default narrow-path guard) + `scripts/git-commit-narrow.sh`
  (path-scoped commit wrapper) prevent bundling unrelated staged
  files across concurrent sub-agents.

### Fixed (post-Hermes-decouple)

- `apps/web/app/api/v1/boss-memory/route.ts`: discriminate
  `BossMemoryBudgetExceeded` (413) from `BossMemoryError` (500);
  pre-existing typecheck error blocked production builds.
- Webpack `node:` scheme imports in HR modules — `eval('require')`
  + bare module names (mirrors `heartbeat.ts` pattern). Production
  build now green.

### Verified

- Typecheck clean across `api-contract` / `core` / `holon-mcp` / `web`.
- `@holon/core` tests: **98 passed** / 16 skipped.
- `@holon/web` tests: **56 passed**.
- `bash scripts/build-web.sh` production standalone build green.
- `grep -rli "hermes" apps/ packages/ scripts/ .github/ | grep -v "/legacy/" | grep -v "/.next/"` → no live-runtime references; only inline `[Lineage]` notes (≤ 3) + 2 test-file string fixtures.

### Known follow-ups (next release window)

- ADR §4.9: HR promotion-veto persistence across re-scaffold.
- Warm-agent stream-json transcript persistence — tightens 3 of 5
  HR rubric heuristics.
- Role-templates slice 2: bulk-seed remaining 19 roles from
  `f/awesome-chatgpt-prompts` + wire MCP tool for the
  `holon-create-agent` skill's runtime discovery.
- Backlog: #8 self-test DB isolation, #12 NextAuth removal (owner
  not yet authorized), #18 desk UI language mix (owner direction
  pending), #19 sleep-time CLAUDE.md consolidator.

---

## [0.2.0] — 2026-05-30 (HR + memory-as-skill + multi-CLI hardening)

### Added (post-CHANGELOG-init)

- **HR evaluator + two-path behavior correction** ([ADR](docs/adr/hr-evaluator-and-behavior-correction.md))
  — owner-HR agent (System 2) + secretary-HR inline loop step. Path A
  writes persistent rules to `## HR-Corrections` in the target's per-CLI
  memory file (rule-hash idempotent). Path B enqueues a synthetic message
  that's prepended on the next inbound (non-preemptive). ≥3 Path-B fires
  in 24h auto-promote to Path A with 🔴 owner accept/edit/revert.
  Promotion-veto store at `~/holon-agents/boss/owner/hr/promotion-vetoes.json`.
- **Memory-as-skill** ([ADR](docs/adr/memory-as-skill.md)) — recall lifted
  from secretary persona prompt to Claude Code Skill. Two skills shipped:
  `skills/holon-memory-recall` (secretary scope) and
  `skills/holon-owner-recall` (owner-CLI scope). Install hook at agent
  boot (`installRecallSkill` in `cli-memory-scaffold.ts`).
- **Settle-watch + synthetic-producer registry** (closes Task #20) —
  3-minute idle detection on warm secretaries; producer registry for any
  out-of-band message source; non-preemptive next-turn prepend queue on
  the warm-agent input stream.
- **Multi-CLI employee hardening** — per-binary memory file matrix
  (`CLAUDE.md` / `AGENTS.md` / `GEMINI.md` / `QWEN.md`), shared STT-
  correction protocol injected into both Secretary persona and employee
  template, cross-CLI `--resume` flag in heartbeat respawn, first-launch
  auth-picker guards for codex / gemini / qwen.
- **README**: memory-update flow diagram (read on demand via Skill;
  write-up via harvest-on-retire; write-down via HR Path A/B). Comparison
  table sharpened with *auto-create persistent employee teams* and
  *hierarchical memory recycling* rows. Per-CLI install links to each
  CLI's docs + repo (Claude Code, Codex, Gemini CLI, Qwen Code).
- **Tooling**: `scripts/install-git-hooks.sh` + `scripts/git-commit-narrow.sh`
  — off-by-default path-scoped commit guard, prevents accidentally
  bundling unrelated previously-staged files.

### Fixed (post-CHANGELOG-init)

- `apps/web/app/api/v1/boss-memory/route.ts`: discriminate
  `BossMemoryBudgetExceeded` (now returns 413 with usage details) from
  `BossMemoryError` (500); was a pre-existing typecheck error.
- Webpack `node:` scheme imports in HR modules — switched to
  `eval('require')` + bare module names (mirrors `heartbeat.ts` pattern).

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

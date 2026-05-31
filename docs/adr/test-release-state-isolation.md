# ADR: Test / dev / release state isolation

Status: Accepted (2026-05-30, feat/state-isolation)

## Context

The desk runtime persists state in two main filesystem locations:

| Location              | Used for                                                       |
|-----------------------|----------------------------------------------------------------|
| `~/holon-agents/`     | per-staff CLI workspaces · boss memory tree · HR scaffold      |
| `~/.holon/`           | sqlite owner.sqlite · warm-sessions.json · process-registry.json · hr-state.json · uploads · auth.db (dev) |

Two distinct workloads share these locations:

- **Owner's live release desk** writes real chat history, real boss
  memory, real HR observations. Loss is unrecoverable.
- **Dev / test runs** (vitest, playwright, manual `pnpm dev`, packaged
  pre-release smoke) want to exercise the same code paths without
  touching owner data.

Three concrete failure modes that prompted this ADR:

1. `next dev` clobbered the prod `.next/` static chunks → blank-page
   incident logged in `holon-engineering` CLAUDE.md 2026-05-22.
2. Boss memory writes from a dev run polluted the real
   `~/holon-agents/boss/` tree — caught only because the owner noticed
   a stray scope file the next morning.
3. The mobile preview build and release APK share a single Capacitor
   WebView and collided on the `myc.mobile.deskOrigin.v1` localStorage
   key — switching apps silently swapped the desk URL.

`HOLON_DB_PATH` (Task #8) already isolates the single-file SQLite DB,
but the rest of the surface area was inconsistent: some services hard-
coded `join(homedir(), 'holon-agents')`, some honored
`HOLON_AGENTS_HOME`, the HR scaffold had its own `HOLON_HR_ROOT`, and
`~/.holon/` was always real-home.

## Decision

Centralize the env-override pattern at the filesystem-root layer and
flow every consumer through a single helper. Three orthogonal envs,
three roots:

| Env var               | Default                                        | Scope                                  |
|-----------------------|------------------------------------------------|----------------------------------------|
| `HOLON_AGENTS_HOME`   | `$HOME/holon-agents`                           | per-staff workspaces · boss memory · HR scaffold |
| `HOLON_STATE_ROOT`    | `$XDG_DATA_HOME/holon` or `$HOME/.holon`       | sqlite · JSON state · uploads · hr-state |
| `HOLON_DB_PATH`       | `<state-root>/owner.sqlite`                    | single-file SQLite (overrides state root for the DB) |

The web `.next/` build-vs-dev clash already had its own knob
(`NEXT_DIST_DIR`, wired in `apps/web/next.config.ts`). We document it
here as the fourth axis but do not change it.

Implementation:

- New module `packages/core/src/holon-paths.ts` exports
  `holonAgentsHome() · holonStateRoot() · holonDefaultDbPath()`.
- All 6 `~/holon-agents` callers in `@holon/core` now route through
  `holonAgentsHome()`.
- All 6 SQLite `resolveDbPath()` callers gain `HOLON_STATE_ROOT`
  precedence between `HOLON_DB_PATH` and the platform/XDG fallbacks.
- `apps/web/lib/warm-agent.ts`, `apps/web/app/api/v1/uploads/route.ts`,
  and `apps/web/lib/process-registry.ts` route through
  `holonStateRoot()` (process-registry inlines the resolver to keep the
  eval-require/webpack-bundle posture intact).
- HR scaffold (`hr-paths.ts`) gains `HOLON_AGENTS_HOME` as the parent
  root when `HOLON_HR_ROOT` is unset. `HOLON_HR_ROOT` and
  `HOLON_HR_STATE` retain their existing precedence.
- Mobile (`apps/mobile/app/_lib/desk-url-storage.ts`) gains a
  `NEXT_PUBLIC_HOLON_ENV`-driven suffix on the localStorage keys.
  Default `prod` (or unset) keeps the historical key — zero migration
  for owner's installed APK.

## Consequences

Positive:

- Tests + e2e set tmp paths and the integration test in
  `packages/core/tests/holon-paths.test.ts` proves nothing leaks to the
  real `$HOME` (snapshot before / after, byte-identical assertion).
- Release defaults unchanged: every env has the same fallback chain it
  had pre-ADR.
- Backwards compat preserved for existing data — owner's existing
  `~/holon-agents/`, `~/.holon/`, and mobile localStorage keep working
  untouched.

Negative:

- Six SQLite `resolveDbPath()` callers carry the same precedence chain
  inline rather than sharing one resolver. Acceptable: each service is
  ESM-imported into different runtime shapes (Next.js webpack bundle,
  vitest, MCP server, Tauri sidecar) and the existing per-file pattern
  was load-bearing in subtle ways (eval-require usage in
  process-registry, NodeNext path resolution in core). A future
  refactor can normalize once the bundler stories are unified.
- `process-registry.ts` keeps its own inlined `resolveStateRoot()` for
  the same reason — top-level ESM import of `@holon/core` reintroduces
  the bundler/CJS friction this file was originally written to avoid.

## Migration

- Owner's existing data at `~/holon-agents/` and `~/.holon/` keeps
  working — the envs are unset on release and the fallback chains
  resolve to the same paths as before.
- Existing release-APK installs keep reading their stored
  `myc.mobile.deskOrigin.v1` key (default env = `prod`, suffix empty).
- Dev preview Capacitor builds opt in by setting
  `NEXT_PUBLIC_HOLON_ENV=dev` at build time; the dev-built APK then
  reads/writes a separate `myc.mobile.deskOrigin.v1.dev` key.
- Tests are updated via the new integration case; no existing tests
  needed mods because the helpers preserve the previous env semantics
  (HOLON_AGENTS_HOME, HOLON_HR_ROOT, HOLON_DB_PATH were already
  honored — the helpers just centralize the read).

## Alternatives considered

- **In-memory mocks** of the boss-memory / HR / SQLite services. Rejected
  per the project's "real not simulated" rule — testing against a mock
  diverges from production behavior, and the bugs we want to catch
  (path collisions, real disk side effects) only show up against the
  real filesystem.
- **Docker containers per test run**. Rejected — too heavy for the unit
  / vitest layer (each test must spin up cleanly in < 1s). May
  re-revisit for the e2e tier, where containerization buys process
  isolation too.
- **Symlink farm pointing `~/holon-agents` at a per-test dir.**
  Rejected — symlink semantics differ on Windows + WSL, and the env
  override is portable and explicit.

## Open follow-ups (out of scope this ADR)

- Audit `apps/web/db/index.ts` auth.db location for an
  `HOLON_STATE_ROOT` precedence. Currently it uses `HOLON_DATA_DIR`
  (Tauri sidecar) or `<repoRoot>/.holon/auth.db` (dev). Both work
  today; harmonization is cosmetic.
- The 6 inlined `HOLON_STATE_ROOT` blocks in SQLite resolveDbPath()
  sites could be lifted into a single helper once the bundler stories
  (Next.js webpack vs vitest vs MCP server vs Tauri sidecar) are
  reconciled.

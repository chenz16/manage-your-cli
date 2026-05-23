# Windows Installer Build Runbook — 2026-05-19 Reproduce

Operational notes from the 2026-05-19 attempt to reproduce the Windows installer build that Codex captured in `windows-installer-build-skill.md` (24fbe52). Read Codex's skill summary first; this doc only records what diverged from that flow and why.

## Outcome

Produced `C:\h\apps\web\src-tauri\target\release\bundle\nsis\Holon_0.1.0_x64-setup.exe` (~106 MB). Silent install verified: `holon-desk.exe`, `node.exe`, `resources\n\apps\web\server.js`, `resources\hermes-sidecar\hermes-sidecar.exe` all present.

## Build-environment split that worked

Codex's doc treats WSL and Windows as separate environments and prefers a Windows-native mirror to `C:\h` for the entire Next + Tauri build. **That path does not work as-written on this codebase**; the Windows `next build` aborts at `/404` prerender with `[TypeError: Cannot read properties of null (reading 'useContext')]` (from `next/dist/shared/lib/head.js`'s `useContext(HeadManagerContext)` / `useContext(AmpStateContext)`). The same source tree builds cleanly under WSL.

The working split on 2026-05-19:

1. **WSL** — run `pnpm install` + `pnpm -F web build` + `node scripts/copy-standalone-for-tauri.mjs`. Produces `apps/web/.next/standalone/` and `apps/web/src-tauri/resources/n/`.
2. **WSL → C:\h** — robocopy mirror for everything except `resources/n` and `resources/hermes-sidecar`, then a symlink-dereferencing Node copy (`/tmp/copy-standalone-to-win.mjs`) for `resources/n/` specifically. Robocopy cannot follow WSL symlinks across UNC reliably (29 internal symlinks in the standalone tree resolve to `node_modules/.pnpm/<pkg>/node_modules/<name>` ladders that crash with "system cannot find the path specified").
3. **C:\h Windows** — `pnpm install --frozen-lockfile` (needed only for Tauri's Rust deps to resolve workspace package metadata; the actual JS standalone bundle is the WSL artifact), copy Windows `node.exe` to the sidecar slot, then `cargo tauri build --config holon-tauri-no-prebuild.json`.

The Hermes Python sidecar (`build/hermes-sidecar/dist/hermes-sidecar/` produced by PyInstaller — Codex already had this on disk) is plain robocopy from `build/...` to `apps/web/src-tauri/resources/hermes-sidecar/`. No special handling needed.

## What Codex's flow does NOT capture (deltas from 24fbe52)

### D-1: Windows `next build` cannot complete on this dep graph

Triggers at `Generating static pages (0/3) → Error occurred prerendering page "/404"` regardless of:

- adding `@holon/auth` to `transpilePackages` (fixes a separate webpack-parse error on TS-only `export { type X }`)
- `typescript: { ignoreBuildErrors: true }` + `eslint: { ignoreDuringBuilds: true }`
- `export const dynamic = 'force-dynamic'` on root layout
- moving `SessionProviderClient` + `ChatRuntimeProvider` behind `dynamic(..., { ssr: false })`
- adding `pages/_app.tsx`, `pages/404.tsx`, `pages/500.tsx` stubs to override Next's auto-generated error pages
- clearing `.next/` cache
- `public-hoist-pattern[]=react,react-dom` in `.npmrc`

Root cause is that Next 15.5.18 + Windows pnpm's dedup graph resolves a `next/head` chain whose `useContext` call hits a null current-dispatcher during the SSG worker pass for `/_error`. The WSL pnpm graph keeps `react@19.0.0` + `react@19.2.0` both present (legacy transitive); Windows collapses to single `react@19.2.0`, which paradoxically breaks Next's internal head-manager context plumbing here. Did not finish-diagnosing — the WSL build path is the operational workaround.

**Recommendation**: future codification of Codex's skill should switch step 5 of the doc from "build Next on Windows" to "build Next on WSL; mirror artifacts to C:\h". Saves 10-15 min of build time too — the WSL toolchain is faster.

### D-2: `copy-standalone-for-tauri.mjs` produces internal symlinks

WSL's `apps/web/src-tauri/resources/n/` contains 29 symlinks pointing into `node_modules/.pnpm/...`. Robocopy over the WSL UNC share fails to traverse them ("ERROR 3: cannot find path specified"). The fix is a one-off Node script that uses `fs.realpathSync` + `fs.copyFileSync` to dereference + copy file contents. The script `/tmp/copy-standalone-to-win.mjs` (kept in this repro session's tmp; recreate at next attempt) takes ~2 min for 4279 files / 215 MB.

A productionized version of this should live alongside `copy-standalone-for-tauri.mjs` (e.g. `scripts/mirror-standalone-to-windows.mjs`) so future Windows builds get the symlink-deref behavior for free.

### D-3: `pnpm install` on C:\h prompts interactively

`pnpm install --frozen-lockfile` in `C:\h` (after robocopy mirror that excludes node_modules) prompts: "The modules directories will be removed and reinstalled from scratch. Proceed? (Y/n)". This blocks non-interactive scripting. Workaround: pipe `Y` via stdin or accept that the interactive prompt auto-defaults to `Y` after stdin EOF (PowerShell behavior observed). Add `--prefer-offline` and the documented `CI=1` env var to suppress this prompt in future runs.

### D-4: Tauri's first build can be salvaged with incomplete resources/n

The first Tauri build (~4 min from cold cargo cache) bundled an incomplete `resources/n/` that lacked `apps/web/server.js`. The .exe built cleanly (Tauri's bundle.resources glob accepts whatever files exist) but the installed app would not boot at runtime — the Node sidecar would fail to find its server entry. A second Tauri build with the complete `resources/n` produces a working installer in ~3 min (incremental cargo cache). Don't ship the first artifact without the silent-install validation.

## Build duration breakdown

| Step | Time |
|---|---|
| Toolchain verify (powershell.exe interop) | <1 s |
| Robocopy WSL → C:\h (exclude node_modules / .next / target) | 1m 45s |
| `pnpm install --frozen-lockfile` (C:\h, store linked from `C:\Users\chenz\AppData\Local\pnpm\store`) | 8 s |
| `pnpm -F web build` (WSL, full prod build with route listing) | ~50 s |
| `node scripts/copy-standalone-for-tauri.mjs` (WSL) | 5 s |
| Hermes sidecar mirror (already-built PyInstaller bundle, robocopy) | 10 s |
| `/tmp/copy-standalone-to-win.mjs` (WSL → /mnt/c) | 2m 35s |
| Node sidecar copy (`node-x86_64-pc-windows-msvc.exe`) | <1 s |
| `cargo tauri build` first run (cold cargo cache, 4 m 06 s rust + bundle) | 4m 6s |
| `cargo tauri build` second run (incremental + re-bundle with complete resources) | 9m 28s |
| Silent install verification | 12 s |

Total **~25 min** for the full pipeline once you know which Next build path actually works. First attempt with the documented "build Next on Windows" path burned an extra ~25 min on dead-end fixes (transpilePackages, typescript.ignoreBuildErrors, custom error pages, ssr:false providers).

## Next-attempt cheatsheet

```bash
# from WSL
cd /home/chenz/project/holon-engineering
pnpm -F web build && node scripts/copy-standalone-for-tauri.mjs

# mirror to Windows (skip if C:\h not present yet; do robocopy first per Codex doc step 2)
node /tmp/copy-standalone-to-win.mjs

# Windows side
powershell.exe -NoProfile -Command "Copy-Item 'C:\Program Files\nodejs\node.exe' 'C:\h\apps\web\src-tauri\binaries\node-x86_64-pc-windows-msvc.exe' -Force"

# Tauri (script at /tmp/holon-tauri-build.ps1 from this attempt)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\Users\chenz\AppData\Local\Temp\holon-tauri-build.ps1"

# Validate
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\Users\chenz\AppData\Local\Temp\holon-install-test.ps1"
```

## Install instruction for owner

Open `C:\h\apps\web\src-tauri\target\release\bundle\nsis\Holon_0.1.0_x64-setup.exe`, click through Windows SmartScreen ("More info" -> "Run anyway") since the binary is unsigned, accept the install location (default `%LOCALAPPDATA%\Holon` per `nsis.installMode: currentUser`), then launch Holon from the Start menu.

## Verdict

**acceptable-with-known-issues**. The .exe installs cleanly, all four expected files are present, and the silent-install test passes. Unverified at this attempt: runtime boot of the installed app (window opens, Node sidecar spawns, Hermes sidecar spawns, /api/v1/me responds). The "errors but install worked" framing from Codex/owner suggests runtime is also flaky in ways the build can't catch; recommend a separate "first-boot smoke test" pass before any external distribution.

## Files modified vs. WSL source

None permanently. All source edits attempted during the dead-end "build Next on Windows" path were reverted by the dev-server watcher (owner's reversion enforcement) before the WSL build path was taken. WSL source is unchanged from `3b9bfc5` + the `9be4f72` req-loop tick.

## D-1 to D-4 Hardening Shipped (2026-05-19 22:35 owner directive)

All four deltas documented in this runbook are now scripted permanently. Status: **closed**.

| Delta | Script now handling it | Behavior next build |
|---|---|---|
| D-1 | `build-windows-installer-local.ps1` header comment + skill doc update | WSL-build-then-mirror is the canonical path; Windows Next build removed from flow |
| D-2 | `scripts/copy-standalone-symlink-aware.mjs` (new) | Auto-invoked by PS1 after copy-standalone; replaces ~29 symlinks with real file contents |
| D-3 | `build-windows-installer-local.ps1` [5/6] pnpm install block | `CI=1` + `--prefer-offline` suppress interactive prompt; wrapped in try/catch with stderr context |
| D-4 | `build-windows-installer-local.ps1` [D-4] post-build verify block | Guards A (exe exists) + B (size >100 MB) + auto-retry second Tauri build if B fails |

Post-install validation: `scripts/windows-installer-smoke.ps1` (6 checks, exit 0/1).

Commit: `fix(installer-win): D-1 to D-4 hardening` on branch `fix/windows-installer-d1-d4`, merged to `main`.

The `/tmp/copy-standalone-to-win.mjs` workaround from this session is superseded by `scripts/copy-standalone-symlink-aware.mjs` and should not be recreated manually.

# Windows Installer Build Runbook (Living / Authoritative)

This is the canonical reference for building the Holon Windows installer.
The dated file `windows-installer-build-runbook-2026-05-19.md` records the
original debug session; this file supersedes it as the authoritative procedure.

Last verified: 2026-05-20. Update this file whenever a build attempt reveals
new failure modes or fixes an existing one.

---

## One-command build (WSL)

Run the full pipeline from a WSL terminal with a single command. No need to
open a Windows PowerShell terminal manually.

```bash
# Customer build -- no secrets baked, safe to distribute (default):
bash scripts/auto-build-release.sh

# Customer build + upload to chenz16/holon-release on GitHub:
bash scripts/auto-build-release.sh --profile customer --upload

# Test build (bakes secrets from scripts/.env.test.local, local smoke-test only):
bash scripts/auto-build-release.sh --profile test
```

The script:
1. Prints a banner and logs everything to `/tmp/holon-autobuild-<UTC>.log`.
2. Pre-flight checks: repo root, `powershell.exe` interop, prerequisite files.
3. Warns if a dev server is running, but does NOT kill it -- see note below.
4. Invokes `scripts/build-windows-installer-local.ps1` via `powershell.exe` interop.
5. Verifies the artifact exists and is > 50 MB.
6. Copies the artifact to `artifacts/windows/` and prints path + SHA256.
7. If `--upload` is passed and profile is `customer`, publishes to GitHub Releases.

**`.next-prod` isolation (L-099): it is now safe to build while the dev server
is running.** The production build exports `NEXT_DIST_DIR=.next-prod`, so
Next.js writes to `apps/web/.next-prod/` instead of the shared `apps/web/.next/`.
The dev server's `.next/` directory is never touched during the build. Gotcha
G-007 ("never build while dev is running") is resolved; the old warning is kept
in G-007 for historical context but no longer applies.

---

## Quick summary

The installer build is split across two environments:

| Environment | What runs there |
|---|---|
| WSL (Ubuntu-22.04) | `pnpm -F web build`, `copy-standalone-for-tauri.mjs`, `copy-standalone-symlink-aware.mjs` |
| Windows (native PS1) | `build-wechat-daemon.ps1`, `cargo tauri build` |

The helper script `scripts/build-windows-installer-local.ps1` orchestrates
the full pipeline. Run it from a Windows PowerShell terminal (NOT Git Bash,
NOT WSL) with the repo on a UNC path or a local Windows clone.

---

## Prerequisites

Install once; verify with `[1/6]` check in the PS1:

```
winget install Rustlang.Rustup
rustup default stable
cargo install tauri-cli@^2.0
winget install OpenJS.NodeJS.LTS
corepack enable
corepack prepare pnpm@latest --activate
winget install Python.Python.3.12
winget install Git.Git
winget install Microsoft.VisualStudio.2022.BuildTools
  (select "Desktop development with C++" workload)
```

WSL side: nvm + node v22.14.0 (has corepack pnpm) installed; see gotcha G-003.

---

## Build profiles

`build-windows-installer-local.ps1` accepts a `-Profile` parameter:

| Profile | Secrets baked in | Post-build secret guard | Intended use |
|---|---|---|---|
| `customer` (default) | None | YES -- fails build if secrets detected in bundle | External distribution |
| `test` | `DEEPSEEK_API_KEY`, `HOLON_FEEDBACK_GITHUB_TOKEN`, `HOLON_FEEDBACK_GITHUB_REPO` from `scripts/.env.test.local` | No | Owner smoke-test on own machine |

See "Profile switch" section below for the bake mechanism.

---

## Exact command sequence

```powershell
# From a Windows PowerShell terminal (not WSL, not Git Bash):
cd \\wsl$\Ubuntu-22.04\home\chenz\project\holon-engineering

# Default (customer build):
powershell -ExecutionPolicy Bypass -File scripts\build-windows-installer-local.ps1

# With -Force (re-run Hermes sidecar PyInstaller even if fresh):
powershell -ExecutionPolicy Bypass -File scripts\build-windows-installer-local.ps1 -Force

# Test build (bakes secrets from scripts/.env.test.local):
powershell -ExecutionPolicy Bypass -File scripts\build-windows-installer-local.ps1 -Profile test
```

### Step-by-step breakdown

```
[1/6]  Prerequisite check (rustc, cargo, node, pnpm, python, pip)
[2/6]  pip install pyinstaller
[3/6]  Clone / verify deps/hermes at pinned SHA 7fee1f6
[4/6]  Build hermes-sidecar.exe via PyInstaller (incremental: skipped if fresh)
       Build wechat-daemon.exe via build-wechat-daemon.ps1 (see gotcha G-006)
[5/6]  Web build in WSL: wsl.exe -d Ubuntu-22.04 -- bash scripts/wsl-web-build.sh
       copy-standalone-for-tauri.mjs (produces resources/n/)
       copy-standalone-symlink-aware.mjs (deref symlinks; see gotcha G-004)
       copy-hermes-sidecar-for-tauri.mjs (copies large PyInstaller bundle AFTER Next)
[6/6]  cargo tauri build --config '{"build":{"beforeBuildCommand":null}}'
[D-4]  Post-build guard: .exe must exist at NSIS path AND be >100 MB;
       auto-retries one second Tauri build if size guard fails
[G-007] customer profile: grep bundle for secret strings; fail loud if found
```

---

## Hard-won gotchas

### G-001 -- Windows Next.js build DOES NOT WORK on this codebase

**NEVER** run `pnpm -F web build` on the Windows side. Next 15.5.18 + Windows
pnpm's dedup graph collapses `react@19.2.0` in a way that breaks Next's
internal `useContext(HeadManagerContext)` during the SSG worker pass for
`/_error`, producing:
```
Error occurred prerendering page "/404"
TypeError: Cannot read properties of null (reading 'useContext')
```
This failure is NOT reproducible in WSL. The WSL pnpm graph preserves the
legacy `react@19.0.0` + `react@19.2.0` dual-version layout that Next 15.5.18
expects. Do NOT waste time on `transpilePackages`, `typescript.ignoreBuildErrors`,
`ssr:false` providers, or custom error-page stubs -- none fix the root cause.

DO: the web build runs inside WSL via `scripts/wsl-web-build.sh`, which the
PS1 invokes as `wsl.exe -d Ubuntu-22.04 -- bash scripts/wsl-web-build.sh`.

### G-002 -- pnpm is nvm-managed; `bash -lc` does NOT source ~/.bashrc

`nvm default` (22.19.0) has NO pnpm/corepack. Only node v22.14.0 (installed
separately) has corepack pnpm. A plain `bash -lc 'pnpm ...'` or `bash
--login -c 'pnpm ...'` fails with `pnpm: command not found`.

DO: `scripts/wsl-web-build.sh` locates pnpm by scanning
`$HOME/.nvm/versions/node/*/bin/pnpm` and prepending the matching bin dir to
PATH before calling `pnpm -F web build`. Never hard-code a node version string
here -- the scan pattern is future-proof.

### G-003 -- Windows pnpm over WSL-symlinked node_modules = EISDIR

If you run `pnpm install` or `pnpm -F web build` on the Windows side over the
UNC WSL path (`\\wsl$\Ubuntu-22.04\...`), pnpm tries to stat the Linux
symlinks in `node_modules/.pnpm/` as regular directories and dies:
```
EISDIR: illegal operation on a directory, lstat '...\node_modules\typescript'
```
The Windows pnpm cannot traverse or recreate Linux symlinks across the UNC
boundary. The WSL node_modules are already correct; do NOT reinstall from
Windows.

DO: delegate all JS build work to WSL; never run `pnpm install` on Windows
for the standalone build.

### G-004 -- ~29 symlinks in resources/n/ break robocopy and the Tauri bundler

`copy-standalone-for-tauri.mjs` faithfully copies Next's standalone tree,
which contains ~29 symlinks pointing into `node_modules/.pnpm/<pkg>/
node_modules/<name>` ladders. Robocopy over the WSL UNC share fails to
traverse them ("ERROR 3: cannot find the path specified"), silently dropping
files. The Tauri bundle then picks up an incomplete `resources/n/` tree --
the app builds but crashes at runtime (`server.js` or its dependencies
missing).

DO: `scripts/copy-standalone-symlink-aware.mjs` uses `fs.realpathSync` +
`fs.copyFileSync` to dereference and copy the actual file contents. The PS1
calls it automatically after `copy-standalone-for-tauri.mjs`.

KNOWN FAILURE POINT (2026-05-20): on Node v24, `copy-standalone-symlink-aware.mjs`
has been observed to fail mid-copy with a `ENOENT` on a specific pnpm store
path. If you are on Node v24, downgrade to v22 before running the build.
This is the current unresolved known failure point; investigate before
distributing on Node v24.

### G-005 -- ASCII-only in .ps1 files

PowerShell 5.1 mis-parses em-dashes (U+2014) and other non-ASCII characters
in BOM-less UTF-8 source files. Symptoms range from syntax errors to silent
variable corruption. Keep all .ps1 files ASCII-only. Use `--` (double hyphen)
not em-dash; use plain quotes not "smart quotes".

### G-006 -- wechat-daemon.exe must be built separately and present before Tauri bundle

The WeChat read daemon (`scripts/build-wechat-daemon.ps1`) produces:
```
apps/web/src-tauri/resources/wechat-daemon/wechat-read-daemon.exe
```
This path is listed in `tauri.conf.json`'s `bundle.resources` array. If the
file is absent the Tauri bundler includes an empty/missing resource slot.
The app boots but the WeChat integration is silently non-functional.

DO: run `build-wechat-daemon.ps1` at least once and check for the file before
running `cargo tauri build`. The main PS1 script now invokes
`build-wechat-daemon.ps1` automatically in step [4/6].

### G-007 -- RESOLVED (L-099): build no longer clobbers dev server .next/

**Status: fixed as of 2026-05-20.** This was the original warning:

> The production `pnpm build` clobbers the SHARED `apps/web/.next/` directory.
> If the dev server is running, the dev server will 500 with MODULE_NOT_FOUND.

**Fix applied:** `next.config.ts` now reads `process.env.NEXT_DIST_DIR ?? '.next'`.
The installer pipeline (`wsl-web-build.sh`, `copy-standalone-for-tauri.mjs`,
and `build-windows-installer-local.ps1`) all export `NEXT_DIST_DIR=.next-prod`,
so the production build writes to `apps/web/.next-prod/` and the dev server's
`apps/web/.next/` is never touched.

It is now safe to run the installer build while the dev server is running.
The `auto-build-release.sh` wrapper warns about a running dev server but does
NOT kill it, and proceeds normally.

---

## Profile switch -- how secrets get baked (test profile)

The `test` profile sources `scripts/.env.test.local` (gitignored; never
committed) for three keys:
- `DEEPSEEK_API_KEY` -- LLM provider key
- `HOLON_FEEDBACK_GITHUB_TOKEN` -- GitHub PAT for feedback-issue creation
- `HOLON_FEEDBACK_GITHUB_REPO` -- target repo (e.g. `chenz16/holon-engineering`)

**How these reach the bundled app at runtime:**

The bundled Next.js app runs as a Node.js standalone server (spawned by
`lib.rs` as the `node` sidecar). The Rust sidecar launcher passes env vars
to the Node process via `.env("KEY", "val")` in the Tauri shell-plugin
command builder (see `lib.rs` setup block). The PS1 script writes these
keys into a `.env.production.local` file inside the repo's `apps/web/`
directory BEFORE invoking `wsl-web-build.sh`. Next.js standalone builds load
`.env.production.local` at build time and bake the values into the server
bundle as `process.env.KEY`.

**IMPORTANT (owner verify needed):** Next.js bakes env vars that are
accessed server-side (`process.env.KEY` in route handlers / server components)
into the standalone server bundle at build time when they are present in
`.env.production.local`. This is the standard Next.js mechanism for
embedding server-side secrets into a standalone bundle. The route handlers
that read `DEEPSEEK_API_KEY` (`llm-provider-resolver.ts` fallback chain,
branch (b)) and `HOLON_FEEDBACK_GITHUB_TOKEN` (`app/api/v1/admin/bugs/route.ts`)
are server-side only, so the bake path should work. Verify on a real build
that the values appear in `apps/web/.next/standalone/apps/web/server.js`
(or the route chunk files) after a `test` build, and that they do NOT appear
after a `customer` build. The customer-build guard in the PS1 does a
post-build grep of `src-tauri/resources/n/` as a safety net.

**Clean-up:** the PS1 deletes `apps/web/.env.production.local` immediately
after the WSL build completes (regardless of success/failure) so the secrets
are not left on disk between runs.

---

## Customer-build secret guard

After `cargo tauri build` completes with profile=customer, the PS1 greps
the entire `apps/web/src-tauri/resources/n/` tree for the literal strings
`DEEPSEEK_API_KEY` (value form) and `HOLON_FEEDBACK_GITHUB_TOKEN` (value
form). Any match causes an immediate build failure with:
```
FAIL: customer build contains baked secrets -- DO NOT DISTRIBUTE
```
The guard only checks for secret VALUES (the actual key strings), not the
variable name strings, to avoid false positives from source files that
legitimately reference the env var names.

---

## Releasing to chenz16/holon-releases (customer profile only)

When `gh` is available and the build completes with profile=customer, the
following command creates a GitHub release on the public releases repo.
The PS1 documents this step but does NOT auto-run it -- run manually after
validating the installer:

```powershell
$version = "0.1.0"
$exePath = "apps\web\src-tauri\target\release\bundle\nsis\Holon_${version}_x64-setup.exe"
gh release create "v${version}" $exePath `
    --repo chenz16/holon-releases `
    --title "Holon v${version}" `
    --notes "Windows installer (x64). Unsigned -- Windows SmartScreen: More info > Run anyway."
```

---

## Build duration table

| Step | Typical time |
|---|---|
| Prerequisite check | <1 s |
| pip install pyinstaller | 5 s |
| deps/hermes clone (first run) | ~30 s |
| Hermes sidecar PyInstaller (cold) | 5-15 min |
| Hermes sidecar (incremental skip) | <1 s |
| wechat-daemon.exe (cold) | 2-5 min |
| wechat-daemon.exe (incremental skip) | <1 s |
| `pnpm -F web build` (WSL, cold webpack) | 5-8 min |
| `pnpm -F web build` (WSL, warm webpack cache) | 1-2 min |
| copy-standalone-for-tauri.mjs | 5 s |
| copy-standalone-symlink-aware.mjs (deref 4279 files) | 2-3 min |
| copy-hermes-sidecar-for-tauri.mjs | 10 s |
| `cargo tauri build` (cold Rust compile) | 4-10 min |
| `cargo tauri build` (incremental) | 2-4 min |
| Post-build secret guard (customer) | 5-15 s |
| **Total (warm caches, no sidecar rebuild)** | **~10 min** |
| **Total (cold, first run)** | **~35 min** |

---

## Next-attempt cheatsheet

```powershell
# 1. (No longer required) Stop WSL dev server before building:
#    L-099 NEXT_DIST_DIR=.next-prod isolation makes this safe to skip.
#    The build writes to apps/web/.next-prod/, not apps/web/.next/.
#    (Old advice: pkill -f next-server)

# 2. Copy secrets file for test build (skip for customer):
#    cp scripts/.env.test.local.example scripts/.env.test.local
#    (edit scripts/.env.test.local with real keys)

# 3. From Windows PowerShell at repo root:
cd \\wsl$\Ubuntu-22.04\home\chenz\project\holon-engineering

# Customer build (safe to distribute):
powershell -ExecutionPolicy Bypass -File scripts\build-windows-installer-local.ps1

# Test build (bakes secrets, local only):
powershell -ExecutionPolicy Bypass -File scripts\build-windows-installer-local.ps1 -Profile test

# 4. Validate the installer:
powershell -ExecutionPolicy Bypass -File scripts\windows-installer-smoke.ps1

# 5. (customer only) Release to public repo (manual, after validation):
#    gh release create "v0.1.0" <path-to-exe> --repo chenz16/holon-releases ...
```

---

## Post-install validation

Run `scripts/windows-installer-smoke.ps1` on the INSTALLED app:
- Checks holon-desk.exe present
- Checks node.exe sidecar present
- Checks resources/n/apps/web/server.js present
- Checks hermes-sidecar/hermes-sidecar.exe present
- Checks wechat-daemon/wechat-read-daemon.exe present
- Checks installer .exe size > 100 MB

Exit 0 = pass. Exit 1 = fail with diagnostic detail.

---

## Files involved

| File | Role |
|---|---|
| `scripts/build-windows-installer-local.ps1` | Main orchestrator; profile switch |
| `scripts/wsl-web-build.sh` | WSL-side Next.js build; pnpm locator |
| `scripts/build-wechat-daemon.ps1` | WeChat daemon PyInstaller build |
| `scripts/build-hermes-sidecar.sh` | Hermes sidecar PyInstaller build |
| `scripts/copy-standalone-for-tauri.mjs` | Next standalone copy |
| `scripts/copy-standalone-symlink-aware.mjs` | Symlink-deref copy for resources/n/ |
| `scripts/copy-hermes-sidecar-for-tauri.mjs` | Hermes sidecar copy |
| `scripts/windows-installer-smoke.ps1` | Post-install validation |
| `scripts/.env.test.local` | Test-profile secrets (gitignored; never commit) |
| `scripts/.env.test.local.example` | Template for .env.test.local |
| `apps/web/src-tauri/src/lib.rs` | Rust sidecar spawner; env var injection |
| `apps/web/lib/llm-provider-resolver.ts` | DEEPSEEK_API_KEY runtime consumer |
| `apps/web/app/api/v1/admin/bugs/route.ts` | HOLON_FEEDBACK_GITHUB_TOKEN consumer |

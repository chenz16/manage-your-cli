# Windows Installer Build Skill Summary

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

Last updated: 2026-05-19

This document captures the operational skill for building and debugging the Holon Engineering Windows NSIS installer from WSL or native Windows. The canonical local Codex skill is `holon-windows-installer`; this file is the repo-tracked summary so future agents and operators do not have to rediscover the same packaging failures.

## Operating Model

Treat WSL and Windows as separate build environments.

- Patch source in the WSL repo.
- Verify `pnpm -F web build` in WSL when useful.
- Produce the final Windows installer from a native Windows short path such as `C:\h`.
- Copy the tested installer back to a known artifact path only after a Windows-local silent install succeeds.

Do not rely on `cmd.exe` from a UNC working directory. If launching Windows tools from WSL, use PowerShell:

```powershell
powershell.exe -NoProfile -Command '<command>'
```

When child `.cmd` shims are involved, run them through a helper that starts `cmd.exe` from a local Windows directory and uses `pushd` to map the UNC repo path to a temporary drive letter.

## Build Flow

Use this flow for the Holon NSIS installer:

1. Confirm Windows tools exist:

```powershell
Get-Command rustc,cargo,node,pnpm,python,pip -ErrorAction SilentlyContinue |
  Select-Object Name,Source
```

2. Build or refresh the Hermes sidecar. When Git Bash is operating on a WSL share, keep shell filesystem operations relative after `cd` into the repo. Do not pass absolute `//wsl.localhost/...` paths to `mkdir -p`.

3. Keep Hermes staging filtered. Exclude `.venv`, `.git`, `__pycache__`, `.pytest_cache`, `.mypy_cache`, `.ruff_cache`, `*.pyc`, and `*.pyo`. A sidecar around 150-200 MB is expected; a 450+ MB sidecar usually means the virtualenv or caches were bundled.

4. Prefer a Windows-native mirror:

```powershell
$src = "\\wsl.localhost\Ubuntu-22.04\home\chenz\project\holon-engineering"
$dst = "C:\h"
$xd = @(
  "node_modules", ".git", ".next", "target", ".turbo", ".cache", ".venv",
  "work", "spec", "hermes-runtime",
  "$src\node_modules", "$src\apps\web\node_modules", "$src\apps\mobile\node_modules",
  "$src\apps\web\.next", "$src\apps\web\src-tauri\target", "$src\deps\hermes\.venv"
)
robocopy $src $dst /MIR /R:1 /W:1 /NFL /NDL /NJH /NJS /XD $xd /XF "*.log"
if ($LASTEXITCODE -gt 7) { exit $LASTEXITCODE }
```

5. In `C:\h`, install Windows dependencies and build Next before copying large Tauri resources:

```powershell
Set-Location C:\h
$env:NODE_OPTIONS = "--max-old-space-size=16384"
pnpm install --frozen-lockfile
pnpm -F web build
node scripts\copy-standalone-for-tauri.mjs
node scripts\copy-hermes-sidecar-for-tauri.mjs
```

6. Ensure the Windows Node sidecar exists at Tauri's target-triple path:

```powershell
Copy-Item "C:\Program Files\nodejs\node.exe" `
  "C:\h\apps\web\src-tauri\binaries\node-x86_64-pc-windows-msvc.exe" -Force
```

Using the pinned sidecar fetch script is better for release reproducibility, but copying the installed Windows Node is acceptable to unblock local packaging if the installed Node satisfies the standalone runtime.

7. Build Tauri with `beforeBuildCommand` disabled because the workflow has already built Next and copied resources:

```powershell
$cfg = Join-Path $env:TEMP "holon-tauri-no-prebuild.json"
'{"build":{"beforeBuildCommand":null}}' | Set-Content -Path $cfg -Encoding ASCII
Set-Location C:\h\apps\web\src-tauri
cargo tauri build --config $cfg
$code = $LASTEXITCODE
Remove-Item $cfg -Force
exit $code
```

## Source Fixes To Keep

These fixes are part of the current packaging knowledge and should stay unless deliberately replaced:

- `apps/web/next.config.ts` loads repo-root `.env` at config-load time. `instrumentation.ts` is too late for `next build` page-data route imports and production module-load guards.
- `scripts/build-windows-installer-local.ps1` runs Next before copying `resources/hermes-sidecar`, and disables Tauri's `beforeBuildCommand` during the final Cargo/Tauri build.
- `scripts/build-hermes-sidecar.sh` stages Hermes runtime data and excludes virtualenv/cache trees before PyInstaller `--add-data`.
- `scripts/copy-standalone-for-tauri.mjs`, `apps/web/src-tauri/tauri.conf.json`, and `apps/web/src-tauri/src/lib.rs` use `resources/n` instead of `resources/next-server` to reduce Windows NSIS install path length.

## Known Failure Modes

`pnpm -F web build` hangs or OOMs at `Creating an optimized production build`:

- Usually caused by copying the large Hermes sidecar before `next build`, Tauri rerunning `pnpm build` after resources are populated, or running Windows pnpm from a WSL UNC path.
- Fix by building Next first, disabling Tauri prebuild with `{"build":{"beforeBuildCommand":null}}`, and building from `C:\h`.

`Failed to collect page data for /api/v1/integrations/auth/session`:

- If the nested error mentions `HOLON_TOKEN_ENC_KEY`, Next imported the route before root `.env` was loaded.
- Fix by loading root `.env` in `apps/web/next.config.ts` with `loadEnvConfig(findRepoRoot(), process.env.NODE_ENV !== 'production', console, true)`.

Git Bash sidecar build fails with `mkdir: cannot create directory '//wsl.localhost': Read-only file system`:

- Git Bash can `cd` into WSL UNC shares, but absolute `mkdir -p //wsl.localhost/...` can fail.
- Fix by using relative paths after `cd` into the repo and passing native Windows absolute paths only to native tools such as PyInstaller.

PyInstaller fails under `deps/hermes/.venv` or `__pycache__`:

- The Hermes virtualenv or caches were included in `--add-data`.
- Fix by staging a filtered Hermes runtime tree.

Tauri reports `resource path binaries\node-x86_64-pc-windows-msvc.exe doesn't exist`:

- Tauri rewrites `externalBin` to a target-triple filename.
- Place Windows `node.exe` at `apps\web\src-tauri\binaries\node-x86_64-pc-windows-msvc.exe`.

Windows pnpm reports `next is not recognized`:

- Linux/WSL `node_modules` leaked into the Windows build.
- Mirror to `C:\h` without `node_modules`, then run Windows `pnpm install --frozen-lockfile`.

NSIS fails or the installer asks to `Ignore` deep `resources\next-server\node_modules\.pnpm\...` files:

- This is a Windows path-length problem.
- Use the shortened resource path `resources/n`, rebuild, and validate with silent install.

## Validation

After producing `Holon_0.1.0_x64-setup.exe`, run a silent install from a native Windows path:

```powershell
if (Test-Path C:\h\install-test) { Remove-Item C:\h\install-test -Recurse -Force }
$p = Start-Process -FilePath "C:\h\apps\web\src-tauri\target\release\bundle\nsis\Holon_0.1.0_x64-setup.exe" `
  -ArgumentList "/S","/D=C:\h\install-test" -Wait -PassThru
Write-Host "EXIT=$($p.ExitCode)"
Get-ChildItem C:\h\install-test -Recurse -File |
  Select-Object FullName,Length | Select-Object -First 30
```

A valid install contains:

- `holon-desk.exe`
- `node.exe`
- `resources\n\apps\web\server.js`
- `resources\hermes-sidecar\hermes-sidecar.exe`

Do not hand off an installer that only succeeded after clicking `Ignore`. That skipped at least one file and must be rebuilt.

## D-1 to D-4 Hardening (2026-05-19)

The 2026-05-19 reproduce session (`windows-installer-build-runbook-2026-05-19.md`, commit fee2d7e) identified four deltas from this skill that are now scripted permanently. See the runbook for full diagnostic context; this section records what handles each delta in the committed codebase.

### D-1: Windows `next build` cannot complete

Root cause: Next 15.5.18 + Windows pnpm collapses the React version graph in a way that breaks Next's internal head-manager context during the SSG worker pass. WSL pnpm keeps both `react@19.0.0` and `react@19.2.0` present (legacy transitive), which avoids the breakage.

**Canonical path (not a workaround):** Build Next on WSL, then mirror the standalone artifact to `C:\h` for Tauri bundling only. Step 5 of the Build Flow above must be understood as: "run `pnpm -F web build` on WSL; mirror `apps/web/.next/standalone` to `C:\h`". Native Windows Next build is not supported and will not be pursued.

This is baked into `scripts/build-windows-installer-local.ps1` as the authoritative pipeline. The [5/6] step that runs `pnpm -F web build` is expected to run on WSL (or via SSH to a WSL/Mac host); the Windows-side PS1 handles only `pnpm install` + `cargo tauri build`.

### D-2: `copy-standalone-for-tauri.mjs` produces ~29 internal symlinks

`copy-standalone-for-tauri.mjs` faithfully copies Next.js's standalone tree including symlinks into `node_modules/.pnpm/...` chains. Those chains do not exist on Windows, so `robocopy` errors with "ERROR 3" and Tauri silently drops the files from the bundle.

**Fix:** `scripts/copy-standalone-symlink-aware.mjs` (new, 2026-05-19 hardening). Run it after `copy-standalone-for-tauri.mjs` to dereference every symlink in `resources/n/` in-place, replacing each symlink with real file contents via `fs.realpathSync + fs.copyFileSync`.

`build-windows-installer-local.ps1` now runs this automatically between the standalone copy and the Hermes sidecar copy.

Usage standalone:
```
node scripts/copy-standalone-symlink-aware.mjs [TARGET_DIR]
node scripts/copy-standalone-symlink-aware.mjs --help
```

### D-3: `pnpm install` on `C:\h` prompts interactively

When `node_modules` was excluded from the robocopy mirror, pnpm prompts "The modules directories will be removed and reinstalled from scratch. Proceed? (Y/n)". This blocks scripted pipelines.

**Fix:** `build-windows-installer-local.ps1` now sets `$env:CI = "1"` and `$env:PNPM_DEDICATED_SHAMEFULLY_HOIST = "true"` before the install call, and passes `--prefer-offline` to suppress the interactive prompt. The call is wrapped in `try/catch` that re-emits with stderr context if it fails.

### D-4: Tauri may bundle an incomplete `resources/n/` silently

Tauri's `bundle.resources` glob accepts whatever is on disk; if `resources/n/` was incomplete (e.g., `apps/web/server.js` absent due to D-2 symlink breakage) the .exe builds but the app cannot boot. The 2026-05-19 session required a second Tauri build after fixing the symlink issue.

**Fix:** `build-windows-installer-local.ps1` now validates the .exe after `cargo tauri build`:
- Guard A: confirms the .exe exists at the expected NSIS path.
- Guard B: checks .exe size > 100 MB (a complete bundle is ~106 MB; an incomplete one is substantially smaller).
- If Guard B fails, the script automatically triggers a second `cargo tauri build` (incremental, ~3 min) before aborting.

**Post-install smoke test:** `scripts/windows-installer-smoke.ps1` validates the running app with 6 checks (see below).

### Smoke Test: `scripts/windows-installer-smoke.ps1`

Run on Windows after installing the .exe:
```powershell
powershell -ExecutionPolicy Bypass -File scripts\windows-installer-smoke.ps1
```

The 6 checks in order:
1. `server.js` present in installed `resources\n\apps\web\server.js` (static, before launch)
2. `holon-desk.exe` in process list within 10 s of launch
3. `node.exe` (Next.js sidecar) running within 30 s (D-4 guard)
4. `hermes-sidecar.exe` running within 30 s
5. HTTP GET to localhost port (3000-3010, 8080) returns 200 within 60 s
6. `%LOCALAPPDATA%\com.holon.desk\logs\` directory created

Exit 0 = all pass. Exit 1 = one or more failed (details printed inline).

Check 6 is currently a soft WARN (counted as pass) until the `18e8314` log-dir init commit ships in a future installer. It becomes a hard fail at iter-020+.

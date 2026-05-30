# build-windows-installer-local.ps1 -- Holon V1 Personal Edition Windows installer
# Run from native Windows PowerShell (NOT WSL bash). Idempotent -- re-runnable.
#
# Why local: GitHub Actions Windows runner billing failed; this builds the same
# .exe / .msi artifacts directly on your Windows + Rust + MSVC toolchain.
#
# Usage (Windows PowerShell):
#   cd C:\dev\holon-engineering
#
#   # Customer build (no secrets baked in; post-build secret guard; safe to distribute):
#   powershell -ExecutionPolicy Bypass -File scripts\build-windows-installer-local.ps1
#
#   # Test build (bakes secrets from scripts\.env.test.local; local .exe only):
#   powershell -ExecutionPolicy Bypass -File scripts\build-windows-installer-local.ps1 -Profile test
#
#   # Force rebuild even if incremental cache is fresh:
#   powershell -ExecutionPolicy Bypass -File scripts\build-windows-installer-local.ps1 -Force
#
# Profiles:
#   customer (default) -- no secrets baked; post-build grep guard asserts bundle
#                         contains no DEEPSEEK_API_KEY or HOLON_FEEDBACK_GITHUB_TOKEN
#                         values; safe to upload to chenz16/holon-releases.
#   test               -- reads scripts\.env.test.local (gitignored) for
#                         DEEPSEEK_API_KEY, HOLON_FEEDBACK_GITHUB_TOKEN,
#                         HOLON_FEEDBACK_GITHUB_REPO; bakes them into the Next.js
#                         standalone bundle via apps\web\.env.production.local;
#                         that file is written before the WSL build and deleted
#                         after (regardless of success/failure). Do NOT upload
#                         a test-profile .exe -- it contains plaintext secrets.
#
# Output: apps\web\src-tauri\target\release\bundle\nsis\*.exe
#         apps\web\src-tauri\target\release\bundle\msi\*.msi
#
# Incremental cache (TD-010):
#   [4/6] PyInstaller bundle is SKIPPED if hermes-sidecar.exe is newer than
#         sidecar_main.py AND deps/hermes/.git/HEAD. Saves 5-15 min per cycle.
#         Pass -Force to always rebuild the sidecar.
#   [5/6] Next.js: pnpm -F web build does its OWN clean of .next-prod/standalone,
#         but the webpack incremental cache at apps/web/.next-prod/cache/webpack
#         IS preserved across runs and accelerates the second-and-later
#         pnpm builds from 5-8 min cold to 1-2 min warm. Do NOT delete
#         apps/web/.next-prod/cache manually between runs.
#
# Note: ASCII-only on purpose. PowerShell 5.1 mis-parses em-dashes / Unicode
# in BOM-less UTF-8 source files; sticking to ASCII keeps it portable.

param(
    [switch]$Force,
    [ValidateSet('customer','test')]
    [string]$Profile = 'customer'
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot

function Invoke-CmdInDir {
    param(
        [Parameter(Mandatory=$true)][string]$Dir,
        [Parameter(Mandatory=$true)][string]$Command
    )
    $previous = Get-Location
    $cmdFile = Join-Path $env:TEMP ("holon-build-" + [System.Guid]::NewGuid().ToString("N") + ".cmd")
    try {
        # cmd.exe cannot even start with a UNC current directory. Launch it
        # from a local Windows path, then let cmd's pushd map the UNC target
        # to a temporary drive letter for child .cmd/.exe tools like pnpm.
        @"
@echo on
pushd "$Dir"
if errorlevel 1 exit /b %ERRORLEVEL%
$Command
set HOLON_EXIT=%ERRORLEVEL%
popd
exit /b %HOLON_EXIT%
"@ | Set-Content -Path $cmdFile -Encoding ASCII
        Set-Location $env:SystemRoot
        Write-Host "    [cmd] $cmdFile"
        Get-Content $cmdFile | ForEach-Object { Write-Host "    [cmd] $_" }
        cmd.exe /d /c call $cmdFile
        return $LASTEXITCODE
    } finally {
        Remove-Item $cmdFile -Force -ErrorAction SilentlyContinue
        Set-Location $previous
    }
}

# Refresh PATH from registry -- if this script is launched from WSL bash
# (powershell.exe interop) the PATH inherits Linux paths and misses Windows
# User/Machine PATH (cargo, pnpm, etc.). Re-read both scopes at script start.
$env:PATH = [System.Environment]::GetEnvironmentVariable('PATH','Machine') + ';' + `
            [System.Environment]::GetEnvironmentVariable('PATH','User') + ';' + `
            "$env:USERPROFILE\.cargo\bin" + ';' + `
            "$env:LOCALAPPDATA\pnpm"

Write-Host ""
Write-Host "==> Build profile: $Profile" -ForegroundColor Cyan
if ($Profile -eq 'test') {
    Write-Host "    [test] Secrets will be baked from scripts\.env.test.local" -ForegroundColor Yellow
    Write-Host "    [test] DO NOT distribute the resulting .exe -- it contains plaintext secrets" -ForegroundColor Yellow
} else {
    Write-Host "    [customer] No secrets baked; post-build secret guard active" -ForegroundColor Green
}

Write-Host ""
Write-Host "==> [1/6] Prerequisite check" -ForegroundColor Cyan
$missing = @()
foreach ($cmd in @('rustc', 'cargo', 'node', 'pnpm', 'python', 'pip')) {
    $tool = Get-Command $cmd -ErrorAction SilentlyContinue
    if (-not $tool) {
        $missing += $cmd
        Write-Host "    [x] $cmd missing" -ForegroundColor Red
    } else {
        Write-Host "    [ok] $cmd at $($tool.Source)" -ForegroundColor Green
    }
}
if ($missing.Count -gt 0) {
    Write-Host ""
    Write-Host "Missing tools. Install via:" -ForegroundColor Yellow
    if ($missing -contains 'rustc' -or $missing -contains 'cargo') {
        Write-Host "  winget install Rustlang.Rustup ; rustup default stable"
    }
    if ($missing -contains 'node' -or $missing -contains 'pnpm') {
        Write-Host "  winget install OpenJS.NodeJS.LTS ; corepack enable ; corepack prepare pnpm@latest --activate"
    }
    if ($missing -contains 'python' -or $missing -contains 'pip') {
        Write-Host "  winget install Python.Python.3.12"
    }
    Write-Host "  + MSVC build tools: winget install Microsoft.VisualStudio.2022.BuildTools (with Desktop C++ workload)"
    Write-Host ""
    Write-Host "Re-run this script after installing." -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "==> [2/6] Install PyInstaller (used by build-hermes-sidecar)" -ForegroundColor Cyan
pip install --quiet pyinstaller
if ($LASTEXITCODE -ne 0) { Write-Host "pip install failed" -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "==> [3/6] Clone deps/hermes pinned (matches GHA workflow)" -ForegroundColor Cyan
$depsHermes = Join-Path $repoRoot 'deps\hermes'
if (-not (Test-Path $depsHermes)) {
    Write-Host "    cloning deps/hermes (pinned SHA 7fee1f6) ..."
    Push-Location (Split-Path -Parent $depsHermes)
    git clone --filter=blob:none https://github.com/nousresearch/hermes-agent.git hermes
    if ($LASTEXITCODE -ne 0) {
        Write-Host "    !! git clone failed -- Hermes may be private, you may need to clone manually" -ForegroundColor Yellow
        Write-Host "    !! and check out SHA 7fee1f6 to deps/hermes/" -ForegroundColor Yellow
        Pop-Location
        exit 1
    }
    Push-Location hermes
    git checkout 7fee1f6
    Pop-Location
    Pop-Location
} else {
    Write-Host "    [ok] deps/hermes already present"
}
pip install --quiet -e $depsHermes

Write-Host ""
Write-Host "==> [4/6] Build sidecars (Hermes PyInstaller + WeChat daemon)" -ForegroundColor Cyan
Push-Location $repoRoot

# TD-010 incremental skip-if-fresh: avoid the 5-15 min PyInstaller cold run
# when neither the sidecar entry point nor the upstream Hermes SHA has moved.
$sidecarExe   = Join-Path $repoRoot 'build\hermes-sidecar\dist\hermes-sidecar\hermes-sidecar.exe'
$sidecarMain  = Join-Path $repoRoot 'packages\hermes-plugin-holon-owner\sidecar_main.py'
$hermesHead   = Join-Path $repoRoot 'deps\hermes\.git\HEAD'

$skipSidecar = $false
if (-not $Force -and (Test-Path $sidecarExe) -and (Test-Path $sidecarMain) -and (Test-Path $hermesHead)) {
    $exeMtime  = (Get-Item $sidecarExe).LastWriteTimeUtc
    $mainMtime = (Get-Item $sidecarMain).LastWriteTimeUtc
    $headMtime = (Get-Item $hermesHead).LastWriteTimeUtc
    if (($exeMtime -gt $mainMtime) -and ($exeMtime -gt $headMtime)) {
        $skipSidecar = $true
    }
}

if ($skipSidecar) {
    Write-Host "    [4/6] SKIP hermes-sidecar -- bundle is fresh (use -Force to rebuild)" -ForegroundColor Green
} else {
    if ($Force) {
        Write-Host "    -Force passed; rebuilding sidecar unconditionally" -ForegroundColor Yellow
    }
    # build-hermes-sidecar.sh detects MINGW/MSYS uname -- needs Git Bash to run
    $gitBash = "$env:ProgramFiles\Git\bin\bash.exe"
    if (Test-Path $gitBash) {
        & $gitBash -c "cd '$($repoRoot -replace '\\','/')' && bash scripts/build-hermes-sidecar.sh"
    } else {
        Write-Host "    !! Git Bash not found at $gitBash" -ForegroundColor Yellow
        Write-Host "    !! Install Git for Windows: winget install Git.Git" -ForegroundColor Yellow
        Pop-Location
        exit 1
    }
    if ($LASTEXITCODE -ne 0) { Write-Host "    Hermes sidecar build failed" -ForegroundColor Red; Pop-Location; exit 1 }
}

# Build WeChat daemon exe (G-006: must be present before Tauri bundle).
# build-wechat-daemon.ps1 is idempotent and skips if the exe is already fresh.
$wechatExe = Join-Path $repoRoot 'apps\web\src-tauri\resources\wechat-daemon\wechat-read-daemon.exe'
if (-not $Force -and (Test-Path $wechatExe)) {
    Write-Host "    [4/6] SKIP wechat-daemon -- exe already present (use -Force to rebuild)" -ForegroundColor Green
} else {
    Write-Host "    [4/6] Building wechat-read-daemon.exe ..."
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $repoRoot 'scripts\build-wechat-daemon.ps1')
    if ($LASTEXITCODE -ne 0) {
        Write-Host "    !! build-wechat-daemon.ps1 failed (exit $LASTEXITCODE)" -ForegroundColor Yellow
        Write-Host "    !! WeChat daemon will be absent from the installer -- non-fatal for core app" -ForegroundColor Yellow
    }
}

Pop-Location

Write-Host ""
Write-Host "==> [5/6] Build Next.js standalone (Windows native), then copy Tauri resources" -ForegroundColor Cyan
Push-Location $repoRoot

# PLATFORM FIX (2026-05-21): Build runs natively on Windows. The repo is cloned
# to C:\dev\holon-engineering with Windows-native pnpm install (no WSL symlinks).
# pnpm -F web build runs directly via cmd.exe. No NEXT_DIST_DIR override needed
# because the native Windows checkout does not share .next with a separate dev
# server (WSL dev server is retired). Output goes to apps\web\.next\standalone.

# ─── Test-profile: write secrets into apps/web/.env.production.local ─────────
# Next.js standalone bakes server-side process.env.KEY values from
# .env.production.local at build time. This is the mechanism that allows
# DEEPSEEK_API_KEY and HOLON_FEEDBACK_GITHUB_TOKEN to reach the bundled
# route handlers (llm-provider-resolver.ts fallback chain (b) and
# app/api/v1/admin/bugs/route.ts) without being passed as runtime env vars.
# The file is deleted after the WSL build regardless of success/failure.
$envProductionLocal = Join-Path $repoRoot 'apps\web\.env.production.local'
$envTestLocalPath   = Join-Path $repoRoot 'scripts\.env.test.local'
$wroteEnvFile = $false

if ($Profile -eq 'test') {
    if (-not (Test-Path $envTestLocalPath)) {
        Write-Host "    [test] ERROR: scripts\.env.test.local not found" -ForegroundColor Red
        Write-Host "    [test] Copy scripts\.env.test.local.example to scripts\.env.test.local" -ForegroundColor Yellow
        Write-Host "    [test] and fill in real secret values, then re-run." -ForegroundColor Yellow
        Pop-Location
        exit 1
    }
    Write-Host "    [test] Reading secrets from scripts\.env.test.local ..." -ForegroundColor Yellow

    # Parse KEY=VALUE lines; ignore comments and blank lines.
    $testSecrets = @{}
    Get-Content $envTestLocalPath | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith('#')) {
            $idx = $line.IndexOf('=')
            if ($idx -gt 0) {
                $key = $line.Substring(0, $idx).Trim()
                $val = $line.Substring($idx + 1).Trim()
                $testSecrets[$key] = $val
            }
        }
    }

    $allowedKeys = @('DEEPSEEK_API_KEY','HOLON_FEEDBACK_GITHUB_TOKEN','HOLON_FEEDBACK_GITHUB_REPO')
    $envLines = @()
    foreach ($key in $allowedKeys) {
        if ($testSecrets.ContainsKey($key) -and $testSecrets[$key] -ne '') {
            $envLines += "$key=$($testSecrets[$key])"
            Write-Host "    [test] baking: $key (value masked)" -ForegroundColor Yellow
        } else {
            Write-Host "    [test] WARNING: $key not set in .env.test.local -- skipping" -ForegroundColor Yellow
        }
    }

    if ($envLines.Count -eq 0) {
        Write-Host "    [test] ERROR: no valid secrets found in scripts\.env.test.local" -ForegroundColor Red
        Pop-Location
        exit 1
    }

    # Write apps/web/.env.production.local (ASCII -- no BOM; no Unicode secrets)
    $envLines | Set-Content -Path $envProductionLocal -Encoding ASCII
    $wroteEnvFile = $true
    Write-Host "    [test] Wrote $envProductionLocal ($($envLines.Count) keys)" -ForegroundColor Yellow
}

# TD-010 informational: detect when standalone is already fresher than every
# source file under apps/web.
$standaloneDir = Join-Path $repoRoot 'apps\web\.next\standalone'
if (Test-Path $standaloneDir) {
    $standaloneMtime = (Get-Item $standaloneDir).LastWriteTimeUtc
    $webRoot = Join-Path $repoRoot 'apps\web'
    $newestSrc = Get-ChildItem -Path $webRoot -Recurse -File `
        -Include '*.ts', '*.tsx', '*.json' -ErrorAction SilentlyContinue `
        | Where-Object { $_.FullName -notmatch '\\\.next\\' -and $_.FullName -notmatch '\\node_modules\\' } `
        | Sort-Object LastWriteTimeUtc -Descending `
        | Select-Object -First 1
    if ($newestSrc -and ($standaloneMtime -gt $newestSrc.LastWriteTimeUtc)) {
        Write-Host "    [5/6] note: .next/standalone is fresher than newest source ($($newestSrc.Name))" -ForegroundColor Green
        Write-Host "    [5/6] note: pnpm -F web build will likely be a no-op; webpack cache should hit" -ForegroundColor Green
    }
}

# Run the Next.js build natively on Windows. pnpm + node are on the system PATH
# (installed via winget). No WSL interop needed -- the repo is a Windows-native
# checkout with Windows-native node_modules.
Write-Host "    [5/6] running: pnpm -F web build (Windows native)" -ForegroundColor Cyan
$buildExit = Invoke-CmdInDir $repoRoot "pnpm -F web build"

# Clean up .env.production.local IMMEDIATELY after WSL build -- regardless of
# success or failure. Secrets must not linger on disk between runs.
if ($wroteEnvFile -and (Test-Path $envProductionLocal)) {
    Remove-Item $envProductionLocal -Force -ErrorAction SilentlyContinue
    Write-Host "    [test] Deleted $envProductionLocal (secrets removed from disk)" -ForegroundColor Yellow
}

if ($buildExit -ne 0) {
    Write-Host "    Next.js build failed with exit code $buildExit" -ForegroundColor Red
    Write-Host "    To debug, open a terminal and run:" -ForegroundColor Yellow
    Write-Host "      cd C:\dev\holon-engineering && pnpm -F web build" -ForegroundColor Yellow
    Pop-Location
    exit 1
}
# No NEXT_DIST_DIR override -- Windows native build uses default .next directory.
$copyStandaloneExit = Invoke-CmdInDir $repoRoot "node scripts\copy-standalone-for-tauri.mjs"
if ($copyStandaloneExit -ne 0) { Write-Host "    copy-standalone failed" -ForegroundColor Red; Pop-Location; exit 1 }

# D-2 fix: dereference symlinks in resources/n/ so robocopy + Tauri bundler
# can pick up all ~4279 files without "ERROR 3: cannot find path" failures.
# copy-standalone-for-tauri.mjs faithfully copies Next's standalone tree which
# contains ~29 node_modules symlinks pointing into pnpm store ladders; those
# paths do not exist on Windows and silently drop files from the bundle.
Write-Host "    [D-2] dereferencing symlinks in resources/n/ ..."
$symlinkDerefExit = Invoke-CmdInDir $repoRoot "node scripts\copy-standalone-symlink-aware.mjs apps\web\src-tauri\resources\n"
if ($symlinkDerefExit -ne 0) {
    Write-Host "    symlink-deref failed (exit $symlinkDerefExit) -- resources/n may have broken symlinks" -ForegroundColor Red
    Write-Host "    KNOWN FAILURE: on Node v24 this step fails with ENOENT on pnpm store paths." -ForegroundColor Yellow
    Write-Host "    If you are on Node v24, downgrade to Node v22 and retry." -ForegroundColor Yellow
    Pop-Location
    exit 1
}

# Copy the large PyInstaller sidecar only AFTER Next has finished. Earlier
# revisions populated apps/web/src-tauri/resources/hermes-sidecar before
# `next build`; on Windows that placed a ~487 MB tree under the app dir while
# Next's standalone file tracer was walking the project, which correlated with
# repeated OOM / hang failures. Tauri only needs this tree during bundling.
$copyHermesExit = Invoke-CmdInDir $repoRoot "node scripts\copy-hermes-sidecar-for-tauri.mjs"
if ($copyHermesExit -ne 0) { Write-Host "    copy-hermes-sidecar failed" -ForegroundColor Red; Pop-Location; exit 1 }
Pop-Location

Write-Host ""
Write-Host "==> [6/6] Build Tauri (cargo + NSIS + WiX) -- 5-15 min cold compile" -ForegroundColor Cyan
Push-Location (Join-Path $repoRoot 'apps\web\src-tauri')
# The script already ran `pnpm -F web build` and copied standalone output in
# [5/6]. Override Tauri's beforeBuildCommand here so `cargo tauri build` does
# not run Next a second time after resources/hermes-sidecar has been copied.
$tauriConfigOverride = '{"build":{"beforeBuildCommand":null}}'
$tauriDir = Join-Path $repoRoot 'apps\web\src-tauri'
$tauriExit = Invoke-CmdInDir $tauriDir "cargo tauri build --config `"$tauriConfigOverride`""
Pop-Location

if ($tauriExit -ne 0) {
    Write-Host ""
    Write-Host "!! cargo tauri build failed (exit $tauriExit)" -ForegroundColor Red
    Write-Host "Common causes:"
    Write-Host "  - MSVC build tools not installed -> winget install Microsoft.VisualStudio.2022.BuildTools"
    Write-Host "  - tauri-cli not installed -> cargo install tauri-cli@^2.0"
    exit $tauriExit
}

# D-4 fix: verify that the Tauri build produced a non-trivial .exe before
# declaring success. The 2026-05-19 session produced one .exe from an
# incomplete resources/n/ (missing server.js) which built cleanly but failed
# at runtime. Two guards below:
#   Guard A: .exe exists at the expected NSIS path
#   Guard B: .exe is >100 MB (a complete bundle with resources/n + hermes-sidecar
#            is ~106 MB; anything smaller means resources were not bundled).
# If Guard B fails (size <100 MB) we emit a WARN and offer an auto-retry.
# This matches the 2026-05-19 pattern: second Tauri build with complete
# resources/ always succeeded.
Write-Host ""
Write-Host "==> [D-4] Post-build artifact verification" -ForegroundColor Cyan
$bundleNsisDir = Join-Path $repoRoot 'apps\web\src-tauri\target\release\bundle\nsis'
$exePath = Join-Path $bundleNsisDir 'Holon_0.1.0_x64-setup.exe'

if (-not (Test-Path $exePath)) {
    Write-Host "!! FAIL: Tauri build did not produce the expected .exe at:" -ForegroundColor Red
    Write-Host "!!   $exePath" -ForegroundColor Red
    Write-Host "!! Check cargo tauri build output above for bundle error messages." -ForegroundColor Red
    exit 1
}

$exeSizeMB = [math]::Round((Get-Item $exePath).Length / 1MB, 1)
$exeAgeSec = [math]::Round(((Get-Date).ToUniversalTime() - (Get-Item $exePath).LastWriteTimeUtc).TotalSeconds, 0)
Write-Host "    [ok] $exePath ($exeSizeMB MB, ${exeAgeSec}s old)" -ForegroundColor Green

if ($exeSizeMB -lt 100) {
    Write-Host ""
    Write-Host "    [WARN D-4] .exe is only $exeSizeMB MB -- expected >100 MB with full resources." -ForegroundColor Yellow
    Write-Host "    [WARN D-4] resources/n may have been incomplete during bundle (D-4 pattern)." -ForegroundColor Yellow
    Write-Host "    [WARN D-4] Attempting automatic second Tauri build (incremental cargo cache ~3 min)..." -ForegroundColor Yellow
    Push-Location (Join-Path $repoRoot 'apps\web\src-tauri')
    $tauriExit2 = Invoke-CmdInDir $tauriDir "cargo tauri build --config `"$tauriConfigOverride`""
    Pop-Location
    if ($tauriExit2 -ne 0) {
        Write-Host "!! Second Tauri build also failed (exit $tauriExit2)" -ForegroundColor Red
        exit $tauriExit2
    }
    $exeSizeMB2 = [math]::Round((Get-Item $exePath).Length / 1MB, 1)
    if ($exeSizeMB2 -lt 100) {
        Write-Host "!! FAIL: second build .exe still only $exeSizeMB2 MB. Inspect resources/n manually." -ForegroundColor Red
        exit 1
    }
    Write-Host "    [ok] second build produced $exeSizeMB2 MB -- proceeding" -ForegroundColor Green
} elseif ($exeAgeSec -gt 300) {
    Write-Host "    [WARN D-4] .exe is ${exeAgeSec}s old -- may be from a previous run, not this build." -ForegroundColor Yellow
}

# ─── Customer-profile secret guard ────────────────────────────────────────────
# After a customer build, grep the entire resources/n/ tree for secret VALUE
# patterns. Any match means secrets were accidentally baked in (e.g. a stale
# .env.production.local was picked up). Fail loud -- do NOT distribute.
#
# We grep for the KNOWN SECRET VALUE strings, not just variable name strings,
# to avoid false positives from source files that legitimately reference the
# env var NAMES. The test secrets from .env.test.local have their values
# captured here; if the file doesn't exist we skip the value-match check for
# that key (the variable-name check is still done as a sanity guard).
if ($Profile -eq 'customer') {
    Write-Host ""
    Write-Host "==> [G-007] Customer build: checking bundle for baked secrets" -ForegroundColor Cyan
    $resourcesN = Join-Path $repoRoot 'apps\web\src-tauri\resources\n'
    $secretFound = $false

    if (Test-Path $resourcesN) {
        # Check for env var NAMES that should not be baked into a customer build
        # (the NAMES appearing in source is fine; baked VALUES is not --
        # but we can't grep for unknown values, so we also check if the name
        # appears as an assignment context that indicates a baked value).
        # More reliably: if .env.test.local exists, check for its actual values.
        if (Test-Path $envTestLocalPath) {
            Get-Content $envTestLocalPath | ForEach-Object {
                $line = $_.Trim()
                if ($line -and -not $line.StartsWith('#')) {
                    $idx = $line.IndexOf('=')
                    if ($idx -gt 0) {
                        $key = $line.Substring(0, $idx).Trim()
                        $val = $line.Substring($idx + 1).Trim()
                        if ($val -and $val -ne '' -and
                            ($key -eq 'DEEPSEEK_API_KEY' -or $key -eq 'HOLON_FEEDBACK_GITHUB_TOKEN')) {
                            # Search for the actual secret VALUE in the bundle
                            $hits = Get-ChildItem -Path $resourcesN -Recurse -File |
                                Select-String -Pattern ([regex]::Escape($val)) -SimpleMatch -Quiet
                            if ($hits) {
                                Write-Host "!! FAIL: customer build contains baked secret value for $key" -ForegroundColor Red
                                Write-Host "!! DO NOT DISTRIBUTE -- secret found in resources/n/ bundle" -ForegroundColor Red
                                $secretFound = $true
                            }
                        }
                    }
                }
            }
        }

        # Regardless of .env.test.local: check for obvious baked-secret patterns
        # (a real API key value will start with known prefixes)
        $apiKeyPattern = 'sk-[A-Za-z0-9]{20,}'
        $ghPatPattern  = 'ghp_[A-Za-z0-9]{20,}'
        foreach ($pattern in @($apiKeyPattern, $ghPatPattern)) {
            $hits = Get-ChildItem -Path $resourcesN -Recurse -File |
                Select-String -Pattern $pattern -Quiet
            if ($hits) {
                Write-Host "!! FAIL: customer build may contain a baked secret (pattern: $pattern)" -ForegroundColor Red
                Write-Host "!! Run with -Profile test if you intended to bake secrets." -ForegroundColor Red
                $secretFound = $true
            }
        }
    }

    if ($secretFound) {
        Write-Host ""
        Write-Host "!! customer build must not contain baked secrets -- aborting" -ForegroundColor Red
        Write-Host "!! Check for stale apps\web\.env.production.local and delete it, then re-run." -ForegroundColor Red
        exit 1
    }
    Write-Host "    [ok] No baked secrets detected in customer build" -ForegroundColor Green
}

Write-Host ""
Write-Host "==> DONE ($Profile profile)" -ForegroundColor Green
$bundleDir = Join-Path $repoRoot 'apps\web\src-tauri\target\release\bundle'
Write-Host "Artifacts in: $bundleDir"
Get-ChildItem -Recurse -Path $bundleDir -Include '*.exe', '*.msi' | ForEach-Object {
    Write-Host "  $($_.FullName) ($([math]::Round($_.Length / 1MB, 1)) MB)"
}
Write-Host ""
Write-Host "Next step: run scripts\windows-installer-smoke.ps1 on the INSTALLED app to verify runtime boot." -ForegroundColor Cyan

if ($Profile -eq 'test') {
    Write-Host ""
    Write-Host "  [test] This .exe contains baked secrets. DO NOT upload to chenz16/holon-releases." -ForegroundColor Yellow
    Write-Host "  [test] For a distributable build, re-run with -Profile customer (the default)." -ForegroundColor Yellow
} else {
    Write-Host ""
    Write-Host "  [customer] To release to chenz16/holon-releases (after smoke test passes):" -ForegroundColor Cyan
    $exeDisplay = Join-Path $bundleNsisDir 'Holon_0.1.0_x64-setup.exe'
    Write-Host "    gh release create `"v0.1.0`" `"$exeDisplay`" --repo chenz16/holon-releases --title `"Holon v0.1.0`" --notes `"Windows installer (x64). Unsigned -- Windows SmartScreen: More info > Run anyway.`"" -ForegroundColor Gray
    Write-Host "  (Run manually after validating smoke test -- the script does not auto-push.)" -ForegroundColor Cyan
}

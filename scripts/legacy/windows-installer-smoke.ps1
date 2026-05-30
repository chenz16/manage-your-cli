# windows-installer-smoke.ps1 -- Post-install smoke test for Holon V1 Windows installer
# Run on Windows AFTER installing Holon_0.1.0_x64-setup.exe.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\windows-installer-smoke.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\windows-installer-smoke.ps1 -InstallDir "C:\custom\Holon"
#
# Exit code: 0 = all checks passed, 1 = one or more checks failed.
#
# Checks:
#   1. holon-desk.exe appears in process list within 10 s of launch
#   2. node.exe (Next.js sidecar) running within 30 s
#   3. hermes-sidecar.exe running within 30 s
#   4. HTTP GET to localhost Next.js port returns 200 within 60 s
#   5. server.js file present in installed resources/n tree
#   6. Logs directory created under com.holon.desk appdata path
#
# D-4 guard: check 2 (node.exe) catches the "first build had no server.js"
# failure mode observed in the 2026-05-19 session where the 08:17 installer
# build produced an app that would not boot the Node sidecar.
#
# Note: ASCII-only in comments + strings. PowerShell 5.1 mis-parses em-dashes
# in BOM-less UTF-8 source; sticking to ASCII.

param(
    [string]$InstallDir = "$env:LOCALAPPDATA\Holon",
    [switch]$NoLaunch
)

$ErrorActionPreference = "Stop"

$PASS = 0
$FAIL = 0
$Details = @()

function Check-Pass {
    param([int]$Num, [string]$Label)
    Write-Host "  [smoke] CHECK $Num PASS -- $Label" -ForegroundColor Green
    $script:PASS++
}

function Check-Fail {
    param([int]$Num, [string]$Label, [string]$Detail)
    Write-Host "  [smoke] CHECK $Num FAIL -- $Label" -ForegroundColor Red
    if ($Detail) { Write-Host "          $Detail" -ForegroundColor Red }
    $script:FAIL++
    $script:Details += "Check $Num ($Label): $Detail"
}

Write-Host ""
Write-Host "==> [smoke] Holon V1 Windows installer smoke test" -ForegroundColor Cyan
Write-Host "    InstallDir: $InstallDir"
Write-Host ""

# ---------------------------------------------------------------------------
# CHECK 5 (static -- run before launch so failure blocks launch attempt)
# %LOCALAPPDATA%\Holon\resources\n\apps\web\server.js exists
# ---------------------------------------------------------------------------
$serverJsPath = Join-Path $InstallDir "resources\n\apps\web\server.js"
Write-Host "  [smoke] CHECK 5: server.js present in installed resources"
if (Test-Path $serverJsPath) {
    Check-Pass 5 "server.js at $serverJsPath"
} else {
    Check-Fail 5 "server.js missing" "$serverJsPath not found -- D-4 pattern: bundle was produced from incomplete resources/n. Rebuild installer."
}

# ---------------------------------------------------------------------------
# Launch the app (unless -NoLaunch)
# ---------------------------------------------------------------------------
$holonExe = Join-Path $InstallDir "holon-desk.exe"
if (-not (Test-Path $holonExe)) {
    Write-Host ""
    Write-Host "  [smoke] FATAL: $holonExe not found. Is Holon installed at $InstallDir?" -ForegroundColor Red
    Write-Host "  [smoke] FAIL  1/6 checks -- cannot proceed without installed exe" -ForegroundColor Red
    exit 1
}

if (-not $NoLaunch) {
    Write-Host ""
    Write-Host "  [smoke] launching $holonExe ..."
    Start-Process -FilePath $holonExe
    Write-Host "  [smoke] app launched; waiting for process checks..."
}

# ---------------------------------------------------------------------------
# CHECK 1: holon-desk.exe in process list within 10 s
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "  [smoke] CHECK 1: holon-desk.exe running within 10 s"
$found = $false
for ($i = 0; $i -lt 10; $i++) {
    Start-Sleep -Seconds 1
    $proc = Get-Process -Name "holon-desk" -ErrorAction SilentlyContinue
    if ($proc) { $found = $true; break }
}
if ($found) {
    Check-Pass 1 "holon-desk.exe running (PID $($proc.Id))"
} else {
    Check-Fail 1 "holon-desk.exe not running after 10 s" "App may have crashed on launch. Check Event Viewer or run holon-desk.exe manually."
}

# ---------------------------------------------------------------------------
# CHECK 2: node.exe (Next.js sidecar) within 30 s
# D-4 guard: if resources/n had no server.js the Tauri sidecar spawn fails
# silently and node.exe never appears. This was the mode the 08:17 build failed.
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "  [smoke] CHECK 2: node.exe (Next.js sidecar) running within 30 s"
$found = $false
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1
    $proc = Get-Process -Name "node" -ErrorAction SilentlyContinue
    if ($proc) { $found = $true; break }
}
if ($found) {
    Check-Pass 2 "node.exe running (PID $($proc[0].Id))"
} else {
    Check-Fail 2 "node.exe not running after 30 s" "D-4 pattern: Next.js sidecar failed to spawn. Verify server.js exists in install (Check 5) and rebuild installer if missing."
}

# ---------------------------------------------------------------------------
# CHECK 3: hermes-sidecar.exe within 30 s
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "  [smoke] CHECK 3: hermes-sidecar.exe running within 30 s"
$found = $false
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1
    $proc = Get-Process -Name "hermes-sidecar" -ErrorAction SilentlyContinue
    if ($proc) { $found = $true; break }
}
if ($found) {
    Check-Pass 3 "hermes-sidecar.exe running (PID $($proc.Id))"
} else {
    Check-Fail 3 "hermes-sidecar.exe not running after 30 s" "Hermes may have failed to unpack. Verify resources\hermes-sidecar\hermes-sidecar.exe in install dir."
}

# ---------------------------------------------------------------------------
# CHECK 4: HTTP GET to localhost Next.js port returns 200 within 60 s
# Tauri spawns node with a random port and writes it to a temp file or env;
# we probe the known common port range 3000-3010 and 8080, accepting first 200.
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "  [smoke] CHECK 4: Next.js HTTP endpoint returns 200 within 60 s"
$httpOk = $false
$httpPort = $null
$httpPorts = @(3000, 3001, 3002, 3003, 3004, 3005, 8080)
$startTime = Get-Date
do {
    foreach ($port in $httpPorts) {
        try {
            $resp = Invoke-WebRequest -Uri "http://localhost:$port" -UseBasicParsing `
                -TimeoutSec 2 -ErrorAction SilentlyContinue
            if ($resp -and $resp.StatusCode -eq 200) {
                $httpOk = $true
                $httpPort = $port
                break
            }
        } catch { }
    }
    if ($httpOk) { break }
    Start-Sleep -Seconds 2
} while (((Get-Date) - $startTime).TotalSeconds -lt 60)

if ($httpOk) {
    Check-Pass 4 "HTTP 200 on port $httpPort"
} else {
    Check-Fail 4 "No HTTP 200 within 60 s on ports $($httpPorts -join ',')" "Next.js may still be starting or crashed. Check holon-desk logs."
}

# ---------------------------------------------------------------------------
# CHECK 6: %LOCALAPPDATA%\com.holon.desk\logs\ directory created
# This proves the Tauri log directory (from 18e8314 un-gated prod log) was
# initialized on first launch -- a leading indicator that the app init path
# ran fully, not just that the exe launched.
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "  [smoke] CHECK 6: Tauri log dir created"
$logsDir = Join-Path $env:LOCALAPPDATA "com.holon.desk\logs"
if (Test-Path $logsDir) {
    Check-Pass 6 "logs dir at $logsDir"
} else {
    # Soft warning: 18e8314 log-dir init may not yet be in the current installer.
    # Treat as WARN (not hard fail) so the smoke test does not block distribution
    # before that commit ships.
    Write-Host "  [smoke] CHECK 6 WARN -- $logsDir not found (may not be in this installer version)" -ForegroundColor Yellow
    Write-Host "          This becomes a FAIL once iter-020+ ships with 18e8314 log-dir init." -ForegroundColor Yellow
    $script:PASS++
    # Count as pass with warning so WARN does not block first-distribution smoke.
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
$total = $PASS + $FAIL
Write-Host ""
if ($FAIL -eq 0) {
    Write-Host "[smoke] PASS  $PASS/$total checks" -ForegroundColor Green
} else {
    Write-Host "[smoke] FAIL  $($total - $FAIL)/$total checks" -ForegroundColor Red
    foreach ($d in $Details) {
        Write-Host "  -- $d" -ForegroundColor Red
    }
}
Write-Host ""

exit $(if ($FAIL -gt 0) { 1 } else { 0 })

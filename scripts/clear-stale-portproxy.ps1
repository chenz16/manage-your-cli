# clear-stale-portproxy.ps1 — one-time cleanup.
#
# WSL is now in MIRRORED networking mode (.wslconfig networkingMode=mirrored),
# so WSL services bind the host's interfaces directly and the old netsh
# portproxy rules are obsolete AND harmful: they still hold 0.0.0.0:<port>
# (forwarding to a dead NAT IP), which blocks the WSL desk from binding 3110
# (EADDRINUSE) and makes the phone's connection fail.
#
# This removes the stale portproxy rules. After mirrored mode, NO portproxy is
# ever needed again — the desk on 0.0.0.0:3110 is reachable at the host LAN IP.
#
# Run once (self-elevates):  powershell -ExecutionPolicy Bypass -File clear-stale-portproxy.ps1

$ErrorActionPreference = 'Continue'
$isAdmin = ([Security.Principal.WindowsPrincipal] `
  [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Write-Host 'Elevating...' -ForegroundColor Yellow
  Start-Process powershell -Verb RunAs -ArgumentList @(
    '-ExecutionPolicy','Bypass','-File',"`"$($MyInvocation.MyCommand.Path)`"")
  return
}

foreach ($p in 3110, 3002, 8080) {
  netsh interface portproxy delete v4tov4 listenport=$p listenaddress=0.0.0.0 2>$null | Out-Null
  Write-Host "deleted portproxy :$p"
}
Write-Host ''
Write-Host 'Remaining portproxy rules:' -ForegroundColor Cyan
netsh interface portproxy show v4tov4
Write-Host ''
Write-Host 'DONE. Mirrored networking now serves the desk directly at the host LAN IP.' -ForegroundColor Green

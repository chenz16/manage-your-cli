# install-desk-forward-task.ps1 — make the WSL→LAN port forward SELF-HEAL.
#
# Why: WSL2 gets a new NAT IP on every reboot, so the netsh portproxy that lets
# the phone reach the desk goes stale → "断线". win-forward-desk.ps1 fixes it but
# must be re-run each time. This registers a Scheduled Task that re-runs it
# automatically: at logon AND every 3 minutes, with highest privileges (netsh
# portproxy/firewall need elevation). Run this ONCE, elevated:
#
#   powershell -ExecutionPolicy Bypass -File scripts\install-desk-forward-task.ps1
#
# After this the phone stays reachable across reboots with zero manual steps.

param([int[]]$Ports = @(3110, 3002, 8080))

$ErrorActionPreference = 'Stop'
$taskName = 'HolonDeskForward'

# Resolve the repo's forwarder script to an absolute Windows path.
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$fwd  = Join-Path $here 'win-forward-desk.ps1'
if (-not (Test-Path $fwd)) { throw "forwarder not found: $fwd" }

# Must be elevated (netsh portproxy/firewall require admin).
$isAdmin = ([Security.Principal.WindowsPrincipal] `
  [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Write-Host "Not elevated — relaunching as Administrator..." -ForegroundColor Yellow
  Start-Process powershell -Verb RunAs -ArgumentList @(
    '-ExecutionPolicy','Bypass','-File',"`"$($MyInvocation.MyCommand.Path)`"")
  return
}

# One action per port (each runs the forwarder for that port).
$actions = foreach ($p in $Ports) {
  New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$fwd`" -Port $p"
}

# Triggers: at user logon + a repeating heartbeat every 3 min (covers WSL
# restarts that happen without a logon). Heartbeat = a one-time trigger with a
# repetition interval (PowerShell has no native "every N min" trigger).
$atLogon = New-ScheduledTaskTrigger -AtLogOn
$every3  = New-ScheduledTaskTrigger -Once -At (Get-Date) `
  -RepetitionInterval (New-TimeSpan -Minutes 3) `
  -RepetitionDuration ([TimeSpan]::MaxValue)

$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" `
  -LogonType Interactive -RunLevel Highest
$settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -MultipleInstances IgnoreNew

Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

Register-ScheduledTask -TaskName $taskName `
  -Action $actions -Trigger @($atLogon, $every3) `
  -Principal $principal -Settings $settings `
  -Description 'Self-heal WSL→LAN port forward for the Holon desk (phone reachability).' | Out-Null

# Kick it once now so the portproxy is correct immediately.
Start-ScheduledTask -TaskName $taskName

Write-Host "Registered '$taskName' — forwards ports $($Ports -join ', ') at logon + every 3 min." -ForegroundColor Green
Write-Host "The phone will stay reachable across reboots with no manual steps."

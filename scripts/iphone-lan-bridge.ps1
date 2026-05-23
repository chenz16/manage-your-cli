# iphone-lan-bridge.ps1 - expose WSL2's mobile server to the Windows
# host's LAN IP so an iPhone on the same Wi-Fi can open the URL in Safari.
#
# Usage: launched by iphone-lan-bridge.bat (3002 dev) or
#        iphone-pwa-bridge.bat (3003 prod, for PWA install testing).
# Both auto-elevate to admin. Re-run after WSL restart to re-bind new IP.

param(
  [int]$Port = 3002,
  [string]$Label = "dev"
)

$ErrorActionPreference = "Stop"
$PORT = $Port
$RULE_NAME = "WSL Holon Mobile $PORT"

# Admin check (no backtick line-continuation - fails on LF-only files).
$currentUser = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($currentUser)
$isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Write-Host "ERROR: must run as Administrator" -ForegroundColor Red
  Write-Host "Tip: launch via iphone-lan-bridge.bat (auto-elevates)."
  exit 1
}

# 1. Find WSL2's eth0 IP dynamically (changes per WSL restart).
$wslIp = (wsl.exe -- hostname -I).Trim().Split(" ")[0]
if (-not $wslIp) {
  Write-Host "ERROR: could not find WSL IP - is WSL running?" -ForegroundColor Red
  exit 1
}
Write-Host "[1/4] WSL2 IP: $wslIp" -ForegroundColor Cyan

# 2. Drop any existing portproxy on 3002 (idempotent), then add fresh.
$null = netsh interface portproxy delete v4tov4 listenport=$PORT listenaddress=0.0.0.0 2>$null
$null = netsh interface portproxy add v4tov4 listenport=$PORT listenaddress=0.0.0.0 connectport=$PORT connectaddress=$wslIp
Write-Host "[2/4] netsh portproxy: 0.0.0.0:$PORT -> ${wslIp}:$PORT" -ForegroundColor Cyan

# 3. Firewall rule (TCP inbound). Profile=Any — covers Public networks
# where Windows mis-identifies the home Wi-Fi (saw it as "Public" for
# Magnolina even though it's a private home network). Re-apply on every
# run so Profile change picks up on existing rules.
Get-NetFirewallRule -DisplayName $RULE_NAME -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
$null = New-NetFirewallRule -DisplayName $RULE_NAME -Direction Inbound -Protocol TCP -Action Allow -LocalPort $PORT -Profile Any
Write-Host "[3/4] firewall rule (re-)applied: '$RULE_NAME' inbound TCP $PORT, Profile=Any" -ForegroundColor Cyan

# 4. Echo the LAN URL.
$lanIp = $null
$candidates = Get-NetIPAddress -AddressFamily IPv4
foreach ($c in $candidates) {
  $ip = $c.IPAddress
  if ($ip -like "10.*" -or $ip -like "192.168.*") {
    $lanIp = $ip
    break
  }
}
if (-not $lanIp) { $lanIp = "<your-windows-lan-ip>" }

Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "  iPhone (same Wi-Fi) -> Safari ($Label):" -ForegroundColor Green
Write-Host "  http://${lanIp}:${PORT}" -ForegroundColor Yellow
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
if ($Label -eq "prod") {
  Write-Host "Prod build - PWA install works (Safari share -> Add to Home Screen)."
} else {
  Write-Host "Dev build - PWA install disabled (SW off in dev per M-L-019)."
  Write-Host "For PWA install: run iphone-pwa-bridge.bat (port 3003)."
}
Write-Host "(Re-run after each WSL restart to re-bind the new WSL IP.)"

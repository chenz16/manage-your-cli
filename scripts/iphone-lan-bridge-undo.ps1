# Undo iphone-lan-bridge.ps1 - remove port-forward + firewall rule.
# Run as Administrator.

$PORT = 3002
$RULE_NAME = "WSL Holon Mobile 3002"

$currentUser = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($currentUser)
$isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Write-Host "ERROR: must run as Administrator" -ForegroundColor Red
  exit 1
}

$null = netsh interface portproxy delete v4tov4 listenport=$PORT listenaddress=0.0.0.0 2>$null
Get-NetFirewallRule -DisplayName $RULE_NAME -ErrorAction SilentlyContinue | Remove-NetFirewallRule
Write-Host "Removed portproxy + firewall rule for $PORT" -ForegroundColor Green

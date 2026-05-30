# win-forward-desk.ps1 — expose a WSL2 desk port to the LAN so a phone on the
# same Wi-Fi can reach it. WSL2 binds inside its own NAT; Windows forwards
# localhost but NOT the LAN interface — this adds the portproxy + firewall rule.
# Run as Administrator.  Usage:  powershell -ExecutionPolicy Bypass -File win-forward-desk.ps1 -Port 3110
param([int]$Port = 3110)
$ErrorActionPreference = 'Continue'
$log = "$env:USERPROFILE\win-forward-desk.log"
function W($m){ $m | Tee-Object -FilePath $log -Append }
"--- $(Get-Date -Format o)  port=$Port ---" | Set-Content $log

# Current WSL IP (changes across reboots — always re-detect).
$wslIp = (wsl hostname -I).Trim().Split(' ')[0]
if (-not $wslIp) { W "FAIL: could not read WSL IP (is WSL running?)"; exit 1 }
W "WSL IP: $wslIp"

# Replace any stale rule for this port, then add fresh.
netsh interface portproxy delete v4tov4 listenport=$Port listenaddress=0.0.0.0 2>$null | Out-Null
netsh interface portproxy add v4tov4 listenport=$Port listenaddress=0.0.0.0 connectport=$Port connectaddress=$wslIp | Out-Null
netsh advfirewall firewall delete rule name="WSL desk $Port" 2>$null | Out-Null
netsh advfirewall firewall add rule name="WSL desk $Port" dir=in action=allow protocol=TCP localport=$Port | Out-Null

W "portproxy:"
(netsh interface portproxy show v4tov4 | Out-String).Trim() | Tee-Object -FilePath $log -Append

# LAN IP the phone should target.
$lan = (Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -like '10.*' -or $_.IPAddress -like '192.168.*' -or $_.IPAddress -like '172.2*' } |
  Where-Object { $_.InterfaceAlias -notlike '*WSL*' -and $_.InterfaceAlias -notlike '*vEthernet*' } |
  Select-Object -First 1).IPAddress
W ""
W "DONE. On the phone (same Wi-Fi) pair the desk address to:  http://${lan}:$Port"
W "(log: $log)"

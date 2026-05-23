@echo off
REM iphone-pwa-bridge.bat — wrapper for iphone-lan-bridge.ps1 PROD mode.
REM Exposes port 3003 (mobile-prod-preview.sh) so iPhone Safari can
REM install Holon as a real PWA (dev port 3002 has SW disabled).
REM Auto-elevates to Administrator.

cd /d "%~dp0"

net session >nul 2>&1
if %errorLevel% NEQ 0 (
  echo Requesting Administrator rights...
  powershell -Command "Start-Process '%~f0' -Verb RunAs"
  exit /b
)

echo.
echo Running iphone-lan-bridge.ps1 -Port 3003 -Label prod (admin)...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0iphone-lan-bridge.ps1" -Port 3003 -Label prod

echo.
echo ============================================================
echo  Prod URL above. iPhone Safari -^> Share -^> Add to Home Screen.
echo  Make sure scripts/mobile-prod-preview.sh is running in WSL first.
echo ============================================================
pause

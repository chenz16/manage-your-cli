@echo off
REM iphone-lan-bridge.bat — double-click wrapper for iphone-lan-bridge.ps1
REM Auto-elevates to Administrator, runs the PowerShell setup, pauses so
REM the URL stays visible.

cd /d "%~dp0"

REM Self-elevate if not already admin.
net session >nul 2>&1
if %errorLevel% NEQ 0 (
  echo Requesting Administrator rights...
  powershell -Command "Start-Process '%~f0' -Verb RunAs"
  exit /b
)

echo.
echo Running iphone-lan-bridge.ps1 (admin mode)...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0iphone-lan-bridge.ps1"

echo.
echo ============================================================
echo  Read the URL above, open Safari on iPhone (same Wi-Fi), go.
echo ============================================================
pause

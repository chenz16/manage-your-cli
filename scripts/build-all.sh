#!/usr/bin/env bash
# build-all.sh — 一键完整 build pipeline（Windows native）
# Usage: bash scripts/build-all.sh
set -euo pipefail
cd "$(dirname "$0")/.."

echo "=== [1/6] Clean ==="
rm -rf apps/web/.next apps/web/src-tauri/resources/n
echo "done"

echo "=== [2/6] Next.js build ==="
NODE_OPTIONS="--max-old-space-size=8192" pnpm -F web build
ls apps/web/.next/standalone/apps/web/server.js || { echo "FAIL: no server.js"; exit 1; }
echo "done"

echo "=== [3/6] Copy standalone ==="
node scripts/copy-standalone-for-tauri.mjs
node scripts/copy-standalone-symlink-aware.mjs
ls apps/web/src-tauri/resources/n/apps/web/server.js || { echo "FAIL: server.js not copied"; exit 1; }
echo "done"

echo "=== [4/6] Copy sidecar ==="
node scripts/copy-hermes-sidecar-for-tauri.mjs
echo "done"

echo "=== [5/6] Verify ==="
# server.js
ls apps/web/src-tauri/resources/n/apps/web/server.js > /dev/null
# styled-jsx
find apps/web/src-tauri/resources/n -name "styled-jsx" -type d | head -1 | grep -q styled-jsx || { echo "FAIL: styled-jsx missing"; exit 1; }
# hermes sidecar
ls apps/web/src-tauri/resources/hermes-sidecar/hermes-sidecar.exe > /dev/null
# node binary
ls apps/web/src-tauri/binaries/node-x86_64-pc-windows-msvc.exe > /dev/null
echo "all verified"

echo "=== [6/6] Cargo + NSIS ==="
cd apps/web/src-tauri
cargo tauri build --config '{"build":{"beforeBuildCommand":null}}'
echo ""
echo "=== BUILD COMPLETE ==="
ls -lh target/release/bundle/nsis/Holon_*.exe

# Optional: auto-install (silent) + launch
if [ "${1:-}" = "--install" ]; then
  echo "=== AUTO INSTALL ==="
  EXE=$(ls -t apps/web/src-tauri/target/release/bundle/nsis/Holon_*.exe | head -1)
  taskkill //F //IM holon-desk.exe 2>/dev/null || true
  sleep 2
  cmd.exe /c "$EXE /S" 2>&1
  echo "installed. launching..."
  sleep 3
  cmd.exe /c start "" "%LOCALAPPDATA%\Holon\holon-desk.exe" 2>&1
  echo "launched"
fi

# Auto smoke test after install
if [ "${1:-}" = "--install" ] || [ "${1:-}" = "--test" ]; then
  echo "=== SMOKE TEST ==="
  sleep 10
  # Check app process
  tasklist 2>/dev/null | grep -i holon-desk && echo "✅ app running" || echo "❌ app NOT running (crashed?)"
  # Check 3000 port
  for i in 1 2 3 4 5 6; do
    CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ 2>/dev/null)
    if [ "$CODE" = "200" ]; then
      echo "✅ localhost:3000 responding (attempt $i)"
      break
    fi
    echo "⏳ attempt $i: $CODE — waiting 10s..."
    sleep 10
  done
  [ "$CODE" = "200" ] && echo "=== SMOKE PASS ===" || echo "=== SMOKE FAIL ==="
fi

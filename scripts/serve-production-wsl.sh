#!/usr/bin/env bash
# serve-production-wsl.sh — serve the RELEASE (production standalone) build for the
# OWNER to test from a Windows browser. Bound to 0.0.0.0 so it's reachable via the
# WSL IP (WSL2 NAT-mode localhost-forwarding to Windows is unreliable).
#
# Owner tests this (precompiled, fast nav). Dev server is for Claude's own testing.
# Prereq: production build exists (corepack pnpm -F web build) and the WeChat reader
# is running on Windows (scripts/launch-wechat-reader-windows.sh).
#
# Usage: bash scripts/serve-production-wsl.sh
set -uo pipefail
cd "$(dirname "$0")/.."
PORT="${PORT:-3000}"
STANDALONE="apps/web/.next/standalone/apps/web"
[ -f "$STANDALONE/server.js" ] || { echo "❌ no standalone build — run: corepack pnpm -F web build"; exit 1; }

echo "[1/4] stopping anything on :$PORT (dev or old prod) ..."
for p in $(pgrep -f "next-server|next dev|standalone/apps/web/server.js" 2>/dev/null); do kill "$p" 2>/dev/null || true; done
sleep 2

echo "[2/4] copying static + public into standalone (Next doesn't bundle them) ..."
mkdir -p "$STANDALONE/.next/static"
cp -r apps/web/.next/static/* "$STANDALONE/.next/static/" 2>/dev/null || true
cp -r apps/web/public "$STANDALONE/" 2>/dev/null || true

echo "[3/4] launching Hermes TCP bridge + production standalone on 0.0.0.0:$PORT ..."
set -a; [ -f .env ] && . ./.env; set +a
GW="$(ip route show default | awk '{print $3}' | head -1)"
export WECHAT_READ_URL="${WECHAT_READ_URL:-http://$GW:8766}"
# We always bind 0.0.0.0 (owner reaches us via the WSL IP). Without this, authjs
# throws UntrustedHost on /api/auth/session (500) → the page's session state breaks
# after any client reload (e.g. the language switcher) → "clicking does nothing".
export AUTH_TRUST_HOST="${AUTH_TRUST_HOST:-true}"
HERMES_PORT="${HOLON_HERMES_PORT:-8767}"

# No Tauri here → the prod build's Hermes client (Branch A) needs a TCP socket
# at 127.0.0.1:HOLON_HERMES_PORT. Provide it via our stdio<->TCP bridge.
if ! (exec 3<>/dev/tcp/127.0.0.1/"$HERMES_PORT") 2>/dev/null; then
  HOLON_HERMES_PORT="$HERMES_PORT" nohup node scripts/hermes-tcp-bridge.mjs > /tmp/holon-hermes-bridge.log 2>&1 & disown
  echo "  hermes bridge pid $! on 127.0.0.1:$HERMES_PORT"
  sleep 2
else
  echo "  hermes bridge already on :$HERMES_PORT"
fi

export NODE_ENV=production HOSTNAME=0.0.0.0 PORT="$PORT" HOLON_HERMES_PORT="$HERMES_PORT"
nohup node "$STANDALONE/server.js" > /tmp/holon-prod.log 2>&1 & disown
echo "  standalone pid $! · WECHAT_READ_URL=$WECHAT_READ_URL · HOLON_HERMES_PORT=$HERMES_PORT"

echo "[4/4] waiting for :$PORT then prewarming routes ..."
for i in $(seq 1 40); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://localhost:$PORT" 2>/dev/null)" = "200" ] && break
  command sleep 1
done
WSLIP="$(ip -4 addr show eth0 | grep -oP 'inet \K[\d.]+')"
for p in / /inbound /deliverables /members /skills /references /connectors /me /today; do
  curl -s -o /dev/null --max-time 20 "http://localhost:$PORT$p" 2>/dev/null
done
echo "✅ production up. Owner URL: http://$WSLIP:$PORT  (localhost:$PORT also works on WSL)"

#!/usr/bin/env bash
# mobile-prod-preview.sh — build + serve mobile in production mode on
# port 3003 so iPhone Safari can install it as a real PWA.
#
# Background: dev server (port 3002) intentionally disables the Service
# Worker (M-L-019) so HMR chunks stay fresh. PWA install requires SW
# active. This script ships the prod build (SW enabled, hashed chunks
# immutable) on a separate port so dev iteration on 3002 stays unaffected.
#
# Usage:
#   scripts/mobile-prod-preview.sh         # build + start on 3003
#   scripts/mobile-prod-preview.sh stop    # kill the 3003 server
#   scripts/mobile-prod-preview.sh restart # rebuild + restart
#
# iPhone testing:
#   1. Run this script
#   2. Run scripts/iphone-lan-bridge.ps1 3003 on Windows (admin) — see
#      its docstring; the .bat wrapper passes the port automatically when
#      named iphone-pwa-bridge.bat. Or extend the existing 3002 rule.
#   3. iPhone Safari -> http://<windows-lan-ip>:3003 -> share -> Add to
#      Home Screen.

set -u
cd "$(dirname "$0")/.." || exit 1

PORT=3003
LOG=/tmp/holon-mobile-prod.log
PIDFILE=/tmp/holon-mobile-prod.pid

ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }
log() { echo "[prod-preview $(ts)] $*"; }

stop() {
  if [ -f "$PIDFILE" ]; then
    pid=$(cat "$PIDFILE")
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid"
      log "killed pid $pid"
    fi
    rm -f "$PIDFILE"
  fi
  # Catch any orphans still listening on the port.
  pkill -f "next start --port $PORT" 2>/dev/null || true
}

start() {
  log "building apps/mobile (production, distDir=.next-prod via HOLON_PROD_PREVIEW=1)"
  if ! HOLON_PROD_PREVIEW=1 pnpm -F mobile build 2>&1 | tee -a "$LOG" | tail -3; then
    log "FAIL: build failed; see $LOG"
    return 1
  fi
  log "starting prod server on port $PORT (does NOT collide with dev .next)"
  cd apps/mobile || return 1
  HOLON_PROD_PREVIEW=1 nohup pnpm start --port $PORT > "$LOG" 2>&1 &
  echo $! > "$PIDFILE"
  cd - >/dev/null || return 1
  for i in $(seq 1 30); do
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 2 "http://localhost:$PORT/" 2>/dev/null || echo 000)
    if [ "$code" = "200" ]; then
      log "up after ${i}s · http://localhost:$PORT/"
      return 0
    fi
    sleep 1
  done
  log "FAIL: did not respond within 30s; see $LOG"
  return 1
}

case "${1:-start}" in
  stop)    stop ;;
  restart) stop; sleep 1; start ;;
  start|*) start ;;
esac

#!/usr/bin/env bash
# dev-self-heal.sh — restart port 3001 dev server with clean .next/cache.
# Invoked by promote.sh when gate 2 detects HMR cache corruption (L-006).
# ~30s; logs to /tmp/holon-dev3001.log.
set -u
DEV=/home/chenz/project/holon-engineering-dev
PORT=3001
ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }
log() { echo "[dev-self-heal $(ts)] $*"; }

log "killing existing dev on port $PORT"
kill $(pgrep -f "next dev --port $PORT") 2>/dev/null || true
sleep 2
cd "$DEV/apps/web" || { log "FATAL: dev apps/web not found"; exit 1; }
rm -rf .next/cache
log "starting fresh dev on port $PORT"
PORT=$PORT nohup npx next dev --port $PORT > /tmp/holon-dev3001.log 2>&1 &
disown
# Wait up to 30s for /
for i in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$PORT/")
  if [ "$code" = "200" ]; then
    log "dev ready after ${i}s"
    exit 0
  fi
  sleep 1
done
log "FAIL: dev did not come up within 30s"
exit 1

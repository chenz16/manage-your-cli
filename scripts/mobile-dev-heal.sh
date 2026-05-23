#!/usr/bin/env bash
# mobile-dev-heal.sh — detect Next.js dev-server chunk-cache corruption
# (chunks 404 → no React hydration → dead UI), auto-restart on detect.
#
# M-G-009: user hit dead UI on 2026-05-18T13:30Z because /me HTML referenced
# main-app.js + polyfills.js + app/me/page.js paths that all 404'd. Cron QA
# checked route HTTP 200 (HTML was fine) but didn't see chunks were broken.
# This script closes that gap. Hook into mobile-QA cron tick.
#
# Exit codes: 0 = healthy or healed; 2 = healed (restarted); 1 = unrecoverable.
set -u
PORT=3002
MOBILE=/home/chenz/project/holon-engineering-mobile/apps/mobile
LOG=/tmp/holon-mobile-dev-heal.log
ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }
log() { echo "[mobile-dev-heal $(ts)] $*" | tee -a "$LOG"; }

# 1. Server up at all?
code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 "http://localhost:$PORT/me" 2>/dev/null || echo 000)
if [ "$code" != "200" ]; then
  log "route /me returned $code — server down or hung; restarting"
  goto_restart=1
else
  goto_restart=0
fi

# 2. If server is up, verify the chunks the HTML references actually serve 200.
if [ "$goto_restart" = "0" ]; then
  html=$(curl -s --max-time 5 "http://localhost:$PORT/me")
  bad=0
  total=0
  for js in $(echo "$html" | grep -oE '_next/static/chunks/[^"]+\.js' | sort -u); do
    total=$((total + 1))
    jc=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 "http://localhost:$PORT/$js" 2>/dev/null)
    if [ "$jc" != "200" ]; then
      bad=$((bad + 1))
      log "chunk $jc /$js"
    fi
  done
  if [ "$bad" -gt 0 ]; then
    log "$bad/$total chunks 404 → chunk-cache corruption; restarting"
    goto_restart=1
  fi
fi

if [ "$goto_restart" = "0" ]; then
  exit 0
fi

# 3. Restart clean.
log "killing next dev on port $PORT"
pkill -f "next dev --port $PORT" 2>/dev/null || true
sleep 2
cd "$MOBILE" || { log "FATAL: $MOBILE not found"; exit 1; }
log "clearing .next"
rm -rf .next
log "starting fresh"
nohup pnpm dev > /tmp/holon-mobile-dev.log 2>&1 &
disown
for i in $(seq 1 45); do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 2 "http://localhost:$PORT/me" 2>/dev/null || echo 000)
  if [ "$code" = "200" ]; then
    log "dev ready after ${i}s"
    # Re-verify chunks after restart so we don't loop on a half-compiled state.
    sleep 2
    bad=0
    for js in $(curl -s --max-time 5 "http://localhost:$PORT/me" | grep -oE '_next/static/chunks/[^"]+\.js' | sort -u); do
      jc=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 "http://localhost:$PORT/$js" 2>/dev/null)
      [ "$jc" != "200" ] && bad=$((bad + 1))
    done
    if [ "$bad" = "0" ]; then
      log "healed: routes 200 + chunks 200"
      exit 2
    fi
    log "WARN: route 200 but $bad chunks still 404 — Next still compiling? exiting 2 anyway"
    exit 2
  fi
  sleep 1
done
log "FAIL: dev did not come back within 45s"
exit 1

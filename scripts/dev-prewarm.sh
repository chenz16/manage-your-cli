#!/usr/bin/env bash
# dev-prewarm.sh — pre-compile every nav route + warm the Hermes bridge so the
# owner never eats Next.js dev's on-demand per-route compile (1-2s first visit).
# Run AFTER the dev server answers on :3000. Safe to re-run (idempotent).
#
# Why: `next dev` compiles routes lazily on first request. Without this, the
# first click on each nav item (/inbound, /members, /skills, …) is slow. This
# walks them all once up front.
set -uo pipefail
BASE="${1:-http://localhost:3000}"

echo "[prewarm] waiting for $BASE ..."
for i in $(seq 1 60); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "$BASE" 2>/dev/null)" = "200" ] && break
  command sleep 1
done

ROUTES=( / /inbound /deliverables /members /skills /references /connectors /me /today /onboarding )
echo "[prewarm] compiling ${#ROUTES[@]} routes ..."
for p in "${ROUTES[@]}"; do
  t=$(curl -s -o /dev/null -w '%{time_total}' --max-time 40 "$BASE$p" 2>/dev/null)
  printf '  %-14s %ss\n' "$p" "$t"
done

# Warm the Hermes ACP bridge (first-hello latency) in the background.
curl -s -o /dev/null --max-time 30 "$BASE/api/v1/chat/warm" 2>/dev/null && echo "[prewarm] hermes bridge warmed" || echo "[prewarm] bridge warm skipped"
echo "[prewarm] done — nav should be instant now."

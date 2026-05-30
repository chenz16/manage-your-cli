#!/usr/bin/env bash
# mobile-status.sh — one-shot pipeline state summary for the mobile track.
#
# Usage: bash scripts/mobile-status.sh
# Reads only — never writes, commits, or pushes. Safe to run anytime.

MOBILE=${MOBILE_REPO:?MOBILE_REPO required}
RELEASE=${RELEASE_REPO:?RELEASE_REPO required}

echo "===== HOLON MOBILE PIPELINE STATUS · $(date -u +%Y-%m-%dT%H:%M:%SZ) ====="
echo

echo "─── Branches ───"
cd "$MOBILE" 2>/dev/null && {
  git fetch origin --quiet 2>&1
  echo "mobile-v1 local : $(git rev-parse --short mobile-v1)"
  echo "mobile-v1 remote: $(git rev-parse --short origin/mobile-v1 2>/dev/null || echo MISSING)"
  echo "main      remote: $(git rev-parse --short origin/main 2>/dev/null || echo MISSING)"
  ahead=$(git rev-list --count origin/main..origin/mobile-v1 2>/dev/null || echo "?")
  echo "mobile-v1 → main: $ahead commits unmerged (waiting for next promote)"
}
echo

echo "─── tmux sessions ───"
tmux ls 2>/dev/null | grep -E "holon" || echo "  none"
echo

echo "─── M001 plan progress ───"
plan="$MOBILE/iterations/M001-mobile-bootstrap/plan.md"
if [ -f "$plan" ]; then
  awk '/^## Pass #[0-9]+/ {
    if      ($0 ~ /\[x[] ]/)   shipped++
    else if ($0 ~ /\[~ /)      in_flight++
    else if ($0 ~ /\[blocked/) blocked++
    else                       open++
    total++
  }
  END {
    printf "  total %d · shipped %d · in-flight %d · blocked %d · open %d\n",
      total, shipped+0, in_flight+0, blocked+0, open+0
  }' "$plan"
  echo
  echo "  Detail:"
  grep -E '^## Pass #' "$plan" | sed 's/^/    /'
fi
echo

echo "─── Open M-L-NNN local deltas ───"
deltas="$MOBILE/docs/mobile-deltas.md"
grep -nE '^- \[ \] M-L-' "$deltas" 2>/dev/null | head -5 | sed 's/^/  /' || echo "  (none open)"
echo

echo "─── Open M-G-NNN global deltas ───"
grep -nE '^- \[ \] M-G-' "$deltas" 2>/dev/null | head -5 | sed 's/^/  /' || echo "  (none open)"
echo

echo "─── In-flight claims ([~ ...]) ───"
grep -rEH '\[~ [^]]+\]' "$MOBILE/docs/" "$MOBILE/iterations/M"*/ 2>/dev/null | sed 's/^/  /' || echo "  (none)"
echo

echo "─── Last 6 mobile-v1 commits ───"
cd "$MOBILE" 2>/dev/null && git log --oneline -6 mobile-v1 | sed 's/^/  /'
echo

echo "─── Dev server (port 3002) ───"
for r in / /me /chat /today /deliverables; do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 2 "http://localhost:3002${r}")
  echo "  3002$r → $code"
done
echo

echo "─── Last 4 promote ticks ───"
tail -20 /tmp/holon-mobile-promote.log 2>/dev/null | grep -E "promoted|no-op|FAIL|skip:" | tail -4 | sed 's/^/  /' || echo "  (promote log empty)"
echo

echo "─── Daemon tail (5 lines) ───"
tmux capture-pane -t holon-mobile-daemon -p 2>/dev/null | grep -vE '^\s*$' | tail -5 | sed 's/^/  /' || echo "  (daemon not running)"
echo

echo "─── Mac iOS SSH (${MAC_SSH_HOST_IP:-host}:22) ───"
if timeout 3 bash -c 'cat < /dev/tcp/${MAC_SSH_HOST_IP:-host}/22 2>/dev/null' >/dev/null 2>&1; then
  echo "  port 22 OPEN"
  if timeout 3 ssh -o BatchMode=yes -o StrictHostKeyChecking=no ${MAC_SSH_HOST:-user@host} 'xcrun --version 2>/dev/null | head -1' 2>/dev/null; then
    echo "  passwordless SSH OK + Xcode reachable"
  else
    echo "  port open but SSH auth failed (pubkey not authorized?)"
  fi
else
  echo "  port 22 closed — Remote Login not enabled on Mac (or firewall)"
fi
echo

echo "===== END ====="

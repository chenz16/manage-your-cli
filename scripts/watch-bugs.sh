#!/usr/bin/env bash
# watch-bugs.sh — block until the owner submits a NEW in-app bug report, then exit.
#
# Purpose: auto-pickup. Claude runs this in the background; when it exits (a new
# bug dir appeared under bugs/), the harness notifies Claude, who processes the
# new report(s) via the /bugs workflow and re-arms this watcher. So the owner
# just submits a bug and Claude grabs it — no need to remind Claude.
#
# Poll-based (no inotify in this WSL). Baselines the current bug dirs at start
# and fires on the FIRST newly-created bug dir (not on the existing backlog).
#
# Usage: nohup bash scripts/watch-bugs.sh > /tmp/holon-bug-watch.log 2>&1 &
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
INTERVAL="${BUG_WATCH_INTERVAL:-15}"

snapshot() { ls -d bugs/bug-* 2>/dev/null | sort; }
BASE="$(snapshot)"
echo "[watch-bugs] armed at $(date -u +%H:%M:%SZ); baseline $(echo "$BASE" | grep -c . ) bug dirs; polling every ${INTERVAL}s"

while true; do
  CUR="$(snapshot)"
  NEW="$(comm -13 <(printf '%s\n' "$BASE") <(printf '%s\n' "$CUR") | grep -E 'bugs/bug-' || true)"
  if [ -n "$NEW" ]; then
    echo "=== NEW BUG REPORT(S) ==="
    while IFS= read -r d; do
      [ -d "$d" ] || continue
      route=$(grep -m1 'Route:' "$d/report.md" 2>/dev/null | sed 's/.*Route:\*\* //')
      echo "▶ $d | $route"
      echo "   $(tail -1 "$d/report.md" 2>/dev/null)"
    done <<< "$NEW"
    echo "=== ACTION: process these via the /bugs workflow, then re-arm watch-bugs.sh ==="
    exit 0
  fi
  sleep "$INTERVAL"
done

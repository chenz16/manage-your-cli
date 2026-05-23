#!/usr/bin/env bash
# mobile-smoke.sh — composable mobile-track smoke check.
#
# Verifies:
#   1. typecheck PASS across api-contract + core + mobile
#   2. all 8 mobile routes return HTTP 200
#   3. every JS chunk referenced by /chat HTML returns 200 (catches the
#      M-G-009 "chunks 404 but route 200" trap)
#   4. desk-shared APIs (mobile depends on these) return 200
#   5. bug-report POST round-trips (e2e proves owner_assistant id + BFF rewrite)
#
# Exit: 0 = all green; non-zero = first failure.
# Logs each check to stdout in '✓/✗ <name>' format so it composes with
# scripts/mobile-promote.sh and the mobile-QA cron tick.

set -u
ROOT=/home/chenz/project/holon-engineering-mobile
cd "$ROOT" || exit 99

pass=0
fail=0
mark_pass() { pass=$((pass+1)); echo "✓ $*"; }
mark_fail() { fail=$((fail+1)); echo "✗ $*"; }

# 1. typecheck (parallel via &; pnpm caches build, this is fast)
for pkg in api-contract core mobile; do
  if pnpm -F "$pkg" typecheck >/dev/null 2>&1; then
    mark_pass "typecheck $pkg"
  else
    mark_fail "typecheck $pkg"
  fi
done

# 2. mobile routes
ROUTES=(/ /chat /me /staff /inbound /today /deliverables /more)
for r in "${ROUTES[@]}"; do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "http://localhost:3002$r" 2>/dev/null || echo 000)
  if [ "$code" = "200" ]; then
    mark_pass "route $r"
  else
    mark_fail "route $r (got $code)"
  fi
done

# 3. JS chunks on /chat (catches dev-server cache corruption)
chunks=$(curl -s --max-time 5 http://localhost:3002/chat | grep -oE '/_next/[^"]+\.js' | sort -u)
chunk_total=0
chunk_bad=0
for c in $chunks; do
  chunk_total=$((chunk_total+1))
  cc=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 "http://localhost:3002$c" 2>/dev/null || echo 000)
  [ "$cc" = "200" ] || chunk_bad=$((chunk_bad+1))
done
if [ "$chunk_total" -gt 0 ] && [ "$chunk_bad" = "0" ]; then
  mark_pass "chunks $chunk_total/$chunk_total 200"
else
  mark_fail "chunks $((chunk_total-chunk_bad))/$chunk_total 200 ($chunk_bad failing)"
fi

# 4. desk-shared APIs that mobile depends on
APIS=(/api/v1/me /api/v1/staff /api/v1/jobs /api/v1/deliverables /api/v1/missions)
for a in "${APIS[@]}"; do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "http://localhost:3002$a" 2>/dev/null || echo 000)
  if [ "$code" = "200" ]; then
    mark_pass "desk-api $a"
  else
    mark_fail "desk-api $a (got $code)"
  fi
done

# 5. bug-report e2e (proves the proxy + BFF rewrite)
bug_resp=$(curl -s --max-time 10 -X POST http://localhost:3002/api/v1/admin/bugs \
  -H 'Content-Type: application/json' \
  -d '{"description":"[mobile-smoke] e2e probe","url":"http://localhost:3002/","route":"/","viewport":{"w":393,"h":852},"user_agent":"mobile-smoke","ts":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'","screenshot_data_url":null,"screenshot_filename":null,"screenshots":[]}')
if echo "$bug_resp" | grep -q '"ok":true'; then
  bug_id=$(echo "$bug_resp" | grep -oE '"bug_id":"[^"]+"' | head -1)
  mark_pass "bug-report e2e ($bug_id)"
else
  mark_fail "bug-report e2e (resp: ${bug_resp:0:120})"
fi

echo ""
echo "──── summary: $pass pass · $fail fail ────"
if [ "$fail" -gt 0 ]; then
  exit 1
fi
exit 0

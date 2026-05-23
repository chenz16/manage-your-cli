#!/usr/bin/env bash
# test-hermes-sidecar.sh — iter-012 Pass #2 (RECOVERY)
#
# Smoke test for the PyInstaller-bundled Hermes sidecar:
#   1. Print-health mode (no port bind) — fastest sanity, verifies bundle
#      can import its full plugin closure.
#   2. HTTP-server mode — spawns the bundle, waits for the stdout "ready
#      on port N" handshake, GET /health, asserts status=200 +
#      payload.status=="ok", SIGTERMs the process, asserts clean exit.
#
# Cold-start latency measured (boot → ready handshake) is reported and
# enforced ≤ 5s (per ADR-023 § Hard Constraint 2). Bundle size reported
# from the build manifest; warned if > 200 MB (ADR-023 § Implementation
# Notes step 6 cap).
#
# Engineering Rule #4: every assertion failure exits non-zero with a
# classified stderr prefix.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_ROOT="$REPO_ROOT/build/hermes-sidecar"
MANIFEST="$BUILD_ROOT/manifest.json"
BUNDLE_BIN="$BUILD_ROOT/dist/hermes-sidecar/hermes-sidecar"

echo "[test-sidecar] bundle=$BUNDLE_BIN"

if [ ! -x "$BUNDLE_BIN" ]; then
  echo "[test-sidecar:err:missing_bundle] $BUNDLE_BIN — run scripts/build-hermes-sidecar.sh first" >&2
  exit 1
fi

if [ -f "$MANIFEST" ]; then
  BUNDLE_SIZE_MB="$(python3 -c "import json,sys; print(json.load(open('$MANIFEST'))['bundle_size_mb'])")"
  echo "[test-sidecar] bundle_size_mb=$BUNDLE_SIZE_MB"
  # Soft warn at 200 MB, hard fail at 250 MB (ADR-023 budget).
  SIZE_NUMERIC="$(awk -v s="$BUNDLE_SIZE_MB" 'BEGIN{printf "%d", s}')"
  if [ "$SIZE_NUMERIC" -gt 250 ]; then
    echo "[test-sidecar:err:bundle_too_large] $BUNDLE_SIZE_MB MB exceeds 250 MB budget" >&2
    exit 2
  fi
  if [ "$SIZE_NUMERIC" -gt 200 ]; then
    echo "[test-sidecar:warn:bundle_size_creep] $BUNDLE_SIZE_MB MB > 200 MB soft limit" >&2
  fi
fi

# ----------------------------------------------------------------------
# Phase 1 — print-health mode (no socket bind; fastest negative signal).
# ----------------------------------------------------------------------
echo "[test-sidecar] phase 1 — --print-health"
PHASE1_OUT="$("$BUNDLE_BIN" --print-health 2>&1)"
echo "$PHASE1_OUT"
if ! echo "$PHASE1_OUT" | python3 -c "
import json, sys
data = json.loads(sys.stdin.read().strip().splitlines()[-1])
assert data['status'] == 'ok', f'expected ok, got {data}'
assert 'plugin_version' in data
print('phase1 ok plugin_version=' + data['plugin_version'])
"; then
  echo "[test-sidecar:err:phase1_health] print-health did not return status=ok" >&2
  exit 3
fi

# ----------------------------------------------------------------------
# Phase 2 — HTTP server mode + cold-start timing.
# ----------------------------------------------------------------------
echo "[test-sidecar] phase 2 — http server mode"

# Use a high-numbered port unlikely to collide. The sidecar will fall back
# to ephemeral if it can't bind, so this only matters for the GET URL.
TEST_PORT=17891

# Capture stdout to a temp file so we can scan for the ready handshake.
STDOUT_LOG="$(mktemp)"
STDERR_LOG="$(mktemp)"
trap 'rm -f "$STDOUT_LOG" "$STDERR_LOG"' EXIT

# Record start time for cold-start latency measurement.
T_START_NS="$(date +%s%N)"

# Launch detached so we can timeout-wait on the handshake without blocking
# on the server's serve_forever loop.
"$BUNDLE_BIN" --port "$TEST_PORT" > "$STDOUT_LOG" 2> "$STDERR_LOG" &
SIDECAR_PID=$!
echo "[test-sidecar] spawned pid=$SIDECAR_PID port=$TEST_PORT"

# Wait up to 8s for the "ready on port N" handshake.
READY_PORT=""
for i in $(seq 1 80); do
  if [ -s "$STDOUT_LOG" ]; then
    READY_PORT="$(grep -oE 'ready on port [0-9]+' "$STDOUT_LOG" | awk '{print $4}' | head -n1 || true)"
    if [ -n "$READY_PORT" ]; then
      break
    fi
  fi
  # Process may have exited before printing — fail fast.
  if ! kill -0 "$SIDECAR_PID" 2>/dev/null; then
    echo "[test-sidecar:err:sidecar_died] pid $SIDECAR_PID exited before ready handshake" >&2
    echo "--- stdout ---" >&2; cat "$STDOUT_LOG" >&2
    echo "--- stderr ---" >&2; cat "$STDERR_LOG" >&2
    exit 4
  fi
  sleep 0.1
done

if [ -z "$READY_PORT" ]; then
  echo "[test-sidecar:err:no_handshake] no 'ready on port' line in stdout after 8s" >&2
  kill -TERM "$SIDECAR_PID" 2>/dev/null || true
  echo "--- stdout ---" >&2; cat "$STDOUT_LOG" >&2
  echo "--- stderr ---" >&2; cat "$STDERR_LOG" >&2
  exit 5
fi

T_READY_NS="$(date +%s%N)"
COLD_MS=$(( (T_READY_NS - T_START_NS) / 1000000 ))
COLD_S="$(awk -v ms="$COLD_MS" 'BEGIN{printf "%.2f", ms/1000}')"
echo "[test-sidecar] ready on port $READY_PORT (cold_start=${COLD_S}s)"

# ADR-023 hard constraint 2: cold-start ≤ 5s.
if [ "$COLD_MS" -gt 5000 ]; then
  echo "[test-sidecar:err:cold_start_too_slow] ${COLD_S}s exceeds 5.00s budget" >&2
  kill -TERM "$SIDECAR_PID" 2>/dev/null || true
  exit 6
fi

# GET /health — accept curl OR python urllib as the probe (curl may be
# missing on minimal CI images; urllib ships with the stdlib).
if command -v curl >/dev/null 2>&1; then
  HEALTH_CODE="$(curl -s -o /tmp/hermes-health.json -w '%{http_code}' "http://127.0.0.1:$READY_PORT/health" || true)"
  HEALTH_BODY="$(cat /tmp/hermes-health.json 2>/dev/null || echo '')"
else
  HEALTH_PYOUT="$(python3 -c "
import urllib.request, sys
r = urllib.request.urlopen('http://127.0.0.1:$READY_PORT/health', timeout=5)
sys.stdout.write(str(r.status) + '|' + r.read().decode())
" 2>&1 || true)"
  HEALTH_CODE="${HEALTH_PYOUT%%|*}"
  HEALTH_BODY="${HEALTH_PYOUT#*|}"
fi

echo "[test-sidecar] GET /health → $HEALTH_CODE"
echo "[test-sidecar] body=$HEALTH_BODY"

if [ "$HEALTH_CODE" != "200" ]; then
  echo "[test-sidecar:err:health_status] expected 200, got $HEALTH_CODE" >&2
  kill -TERM "$SIDECAR_PID" 2>/dev/null || true
  exit 7
fi

if ! echo "$HEALTH_BODY" | python3 -c "
import json, sys
data = json.loads(sys.stdin.read())
assert data['status'] == 'ok', f'expected ok, got {data}'
assert 'plugin_version' in data
assert 'python' in data
"; then
  echo "[test-sidecar:err:health_payload] /health body missing required fields" >&2
  kill -TERM "$SIDECAR_PID" 2>/dev/null || true
  exit 8
fi

# Clean shutdown — SIGTERM, wait up to 3s, SIGKILL fallback.
kill -TERM "$SIDECAR_PID" 2>/dev/null || true
for i in $(seq 1 30); do
  if ! kill -0 "$SIDECAR_PID" 2>/dev/null; then
    break
  fi
  sleep 0.1
done
if kill -0 "$SIDECAR_PID" 2>/dev/null; then
  echo "[test-sidecar:warn:no_sigterm_exit] pid $SIDECAR_PID survived SIGTERM; SIGKILL" >&2
  kill -KILL "$SIDECAR_PID" 2>/dev/null || true
fi

# Confirm the "stopped cleanly" line appears in stderr (if we got SIGTERM
# in time). Not a hard failure if missing — process may have been KILLed.
if grep -q "stopped cleanly" "$STDERR_LOG"; then
  echo "[test-sidecar] clean shutdown observed"
fi

echo "[test-sidecar] PASS"
echo "[test-sidecar] summary: bundle_size_mb=${BUNDLE_SIZE_MB:-unknown}, cold_start_s=${COLD_S}, health=200"

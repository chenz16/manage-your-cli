#!/usr/bin/env bash
# slice5-smoke.sh — Slice 5 E2E smoke test: Holon thin-shell promises.
#
# Checks (in order):
#   1. Server up: GET /api/v1/ping → 200
#   2. Boss memory: POST /api/v1/boss-memory → write; GET → read back same value
#   3. Staff lifecycle: create → list includes → retire → gone
#   4. Team-pack import: youtube-creator → at least 1 staff created or skipped → cleanup
#   5. No Hermes / API-key calls in log post-startup
#
# Exit: 0 = all PASS; non-zero = at least 1 FAIL.
# Idempotent: unique TS prefix + retire-on-cleanup.
#
# Env:
#   DESK_URL             default http://localhost:3110
#   HOLON_DEVICE_TOKEN   device token; if unset tries device-tokens.json
#
# Requires: curl, grep, python3  (jq used if available at /tmp/jq or in PATH)

set -euo pipefail

DESK_URL="${DESK_URL:-http://localhost:3110}"
TS=$(date +%s)

# ── jq / json helper ────────────────────────────────────────────────────────
JQ_BIN=""
if command -v jq >/dev/null 2>&1; then JQ_BIN="jq"
elif [ -x /tmp/jq ]; then JQ_BIN="/tmp/jq"
fi

jq_or_py() {
  # Usage: jq_or_py <jq-expr> <json-string>
  local expr="$1" json="$2"
  if [ -n "$JQ_BIN" ]; then
    echo "$json" | $JQ_BIN -r "$expr" 2>/dev/null || echo ""
  else
    python3 -c "
import sys, json
try:
    d = json.loads(sys.argv[2])
    # evaluate simple .field and .field1 | length patterns
    expr = sys.argv[1]
    if expr == '.ok':
        print('true' if d.get('ok') else 'false')
    elif expr == '.id':
        print(d.get('id', ''))
    elif expr == '.text':
        print(d.get('text', ''))
    elif expr == '.scope':
        print(d.get('scope', ''))
    elif expr == '.created | length':
        print(len(d.get('created', [])))
    elif expr == '.skipped | length':
        print(len(d.get('skipped', [])))
    elif expr.startswith('.created[]'):
        for x in d.get('created', []):
            print(x)
    elif 'length' in expr and 'items' in expr:
        # .items[]? | select(.id==\$id) | length — simplified
        print(0)
    else:
        print('')
except Exception:
    print('')
" "$expr" "$json" 2>/dev/null || echo ""
  fi
}

list_includes_id() {
  local json="$1" id="$2"
  if [ -n "$JQ_BIN" ]; then
    echo "$json" | $JQ_BIN -r --arg id "$id" '[.items[]? | select(.id==$id)] | length' 2>/dev/null || echo "0"
  else
    python3 -c "
import sys, json
try:
    d = json.loads(sys.argv[1])
    count = sum(1 for s in d.get('items',[]) if s.get('id') == sys.argv[2])
    print(count)
except Exception:
    print(0)
" "$json" "$id" 2>/dev/null || echo "0"
  fi
}

list_active_id() {
  local json="$1" id="$2"
  if [ -n "$JQ_BIN" ]; then
    echo "$json" | $JQ_BIN -r --arg id "$id" '[.items[]? | select(.id==$id and .status=="active")] | length' 2>/dev/null || echo "1"
  else
    python3 -c "
import sys, json
try:
    d = json.loads(sys.argv[1])
    count = sum(1 for s in d.get('items',[]) if s.get('id') == sys.argv[2] and s.get('status') == 'active')
    print(count)
except Exception:
    print(1)
" "$json" "$id" 2>/dev/null || echo "1"
  fi
}

find_id_by_name() {
  local json="$1" name="$2"
  if [ -n "$JQ_BIN" ]; then
    echo "$json" | $JQ_BIN -r --arg n "$name" '.items[]? | select(.name==$n) | .id' 2>/dev/null | head -1 || echo ""
  else
    python3 -c "
import sys, json
try:
    d = json.loads(sys.argv[1])
    for s in d.get('items',[]):
        if s.get('name') == sys.argv[2]:
            print(s.get('id',''))
            break
except Exception:
    pass
" "$json" "$name" 2>/dev/null || echo ""
  fi
}

list_created_names() {
  local json="$1"
  if [ -n "$JQ_BIN" ]; then
    echo "$json" | $JQ_BIN -r '.created[]?' 2>/dev/null || echo ""
  else
    python3 -c "
import sys, json
try:
    d = json.loads(sys.argv[1])
    for x in d.get('created',[]):
        print(x)
except Exception:
    pass
" "$json" 2>/dev/null || echo ""
  fi
}

count_field() {
  local json="$1" field="$2"
  if [ -n "$JQ_BIN" ]; then
    echo "$json" | $JQ_BIN -r ".${field} | length" 2>/dev/null || echo "0"
  else
    python3 -c "
import sys, json
try:
    d = json.loads(sys.argv[1])
    print(len(d.get(sys.argv[2],[])))
except Exception:
    print(0)
" "$json" "$field" 2>/dev/null || echo "0"
  fi
}

get_field() {
  local json="$1" field="$2"
  if [ -n "$JQ_BIN" ]; then
    echo "$json" | $JQ_BIN -r ".${field}" 2>/dev/null || echo ""
  else
    python3 -c "
import sys, json
try:
    d = json.loads(sys.argv[1])
    v = d.get(sys.argv[2],'')
    if isinstance(v, bool):
        print('true' if v else 'false')
    elif v is None:
        print('')
    else:
        print(v)
except Exception:
    print('')
" "$json" "$field" 2>/dev/null || echo ""
  fi
}

# ── token resolution ────────────────────────────────────────────────────────
TOKEN="${HOLON_DEVICE_TOKEN:-}"
if [ -z "$TOKEN" ]; then
  TOKEN_FILE="${HOME}/.holon/device-tokens.json"
  if [ -f "$TOKEN_FILE" ] && [ -n "$JQ_BIN" ]; then
    TOKEN=$($JQ_BIN -r 'if type=="object" then (.tokens//.[]) | if type=="array" then .[0] else . end elif type=="array" then .[0] else "" end' "$TOKEN_FILE" 2>/dev/null || true)
  fi
fi

curl_auth() {
  if [ -n "$TOKEN" ]; then
    curl -s --max-time 10 -H "x-holon-device-token: $TOKEN" "$@"
  else
    curl -s --max-time 10 "$@"
  fi
}

pass=0
fail=0

mark_pass() { pass=$((pass+1)); echo "  PASS  $*"; }
mark_fail() { fail=$((fail+1)); echo "  FAIL  $*"; }

# ── Check 1: Server up ───────────────────────────────────────────────────────
echo "=== Check 1: Server up ==="
PING_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$DESK_URL/api/v1/ping" 2>/dev/null || echo 000)
if [ "$PING_CODE" = "200" ]; then
  mark_pass "ping $DESK_URL/api/v1/ping → $PING_CODE"
else
  mark_fail "ping $DESK_URL/api/v1/ping → $PING_CODE (expected 200)"
fi

# ── Check 2: Boss memory APIs ────────────────────────────────────────────────
echo ""
echo "=== Check 2: Boss memory write + read ==="
# Fixed scope so each smoke run OVERWRITES instead of accumulating new
# entries in boss INDEX.md (entries are auto-injected into every agent's
# boot context — runaway smoke entries pollute all agents' tokens).
SMOKE_SCOPE="smoke/slice5"
SMOKE_VALUE="hello-${TS}"

WRITE_RESP=$(curl_auth -X POST "$DESK_URL/api/v1/boss-memory" \
  -H "Content-Type: application/json" \
  -d "{\"scope\":\"${SMOKE_SCOPE}\",\"text\":\"${SMOKE_VALUE}\"}" 2>/dev/null || echo "{}")

WRITE_OK=$(get_field "$WRITE_RESP" "ok")
if [ "$WRITE_OK" = "true" ]; then
  mark_pass "boss-memory write scope=$SMOKE_SCOPE"
else
  mark_fail "boss-memory write failed: $WRITE_RESP"
fi

READ_RESP=$(curl_auth "$DESK_URL/api/v1/boss-memory?scope=${SMOKE_SCOPE}" 2>/dev/null || echo "{}")
READ_TEXT=$(get_field "$READ_RESP" "text")
if echo "$READ_TEXT" | grep -qF "$SMOKE_VALUE"; then
  mark_pass "boss-memory read value present in scope=$SMOKE_SCOPE"
else
  mark_fail "boss-memory read: expected '$SMOKE_VALUE' in text; got: $READ_TEXT"
fi

# ── Check 3: Staff lifecycle ─────────────────────────────────────────────────
echo ""
echo "=== Check 3: Staff lifecycle (create → list → retire) ==="
STAFF_NAME="smoke-${TS}"

CREATE_RESP=$(curl_auth -X POST "$DESK_URL/api/v1/staff" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"${STAFF_NAME}\",\"role_label\":\"Smoke Probe\"}" 2>/dev/null || echo "{}")

STAFF_ID=$(get_field "$CREATE_RESP" "id")
if [ -n "$STAFF_ID" ] && [ "$STAFF_ID" != "null" ]; then
  mark_pass "staff create name=$STAFF_NAME id=$STAFF_ID"
else
  mark_fail "staff create failed: $CREATE_RESP"
  STAFF_ID=""
fi

if [ -n "$STAFF_ID" ]; then
  LIST_RESP=$(curl_auth "$DESK_URL/api/v1/staff" 2>/dev/null || echo "{}")
  FOUND=$(list_includes_id "$LIST_RESP" "$STAFF_ID")
  if [ "$FOUND" = "1" ]; then
    mark_pass "staff list includes id=$STAFF_ID"
  else
    mark_fail "staff list does not include id=$STAFF_ID (found=$FOUND)"
  fi

  DELETE_RESP=$(curl_auth -X DELETE "$DESK_URL/api/v1/staff/${STAFF_ID}" 2>/dev/null || echo "{}")
  DELETE_OK=$(get_field "$DELETE_RESP" "ok")
  if [ "$DELETE_OK" = "true" ]; then
    mark_pass "staff retire id=$STAFF_ID"
  else
    mark_fail "staff retire failed: $DELETE_RESP"
  fi

  LIST_AFTER=$(curl_auth "$DESK_URL/api/v1/staff" 2>/dev/null || echo "{}")
  STILL_ACTIVE=$(list_active_id "$LIST_AFTER" "$STAFF_ID")
  if [ "$STILL_ACTIVE" = "0" ]; then
    mark_pass "staff archived/missing after retire id=$STAFF_ID"
  else
    mark_fail "staff still active after retire id=$STAFF_ID"
  fi
fi

# ── Check 4: Team-pack import ────────────────────────────────────────────────
echo ""
echo "=== Check 4: Team-pack import (youtube-creator) ==="
IMPORT_RESP=$(curl_auth -X POST "$DESK_URL/api/v1/team-packs/youtube-creator/import" \
  -H "Content-Type: application/json" \
  -d '{"conflict":"rename"}' 2>/dev/null || echo "{}")

CREATED_COUNT=$(count_field "$IMPORT_RESP" "created")
SKIPPED_COUNT=$(count_field "$IMPORT_RESP" "skipped")
TOTAL=$(( CREATED_COUNT + SKIPPED_COUNT ))

if [ "$TOTAL" -gt 0 ]; then
  mark_pass "team-pack import youtube-creator: created=$CREATED_COUNT skipped=$SKIPPED_COUNT total=$TOTAL"
else
  mark_fail "team-pack import returned 0 staff: $IMPORT_RESP"
fi

# Cleanup: retire any newly created staff
if [ "$CREATED_COUNT" -gt 0 ]; then
  CLEANUP_PASS=0
  CLEANUP_FAIL=0
  while IFS= read -r SNAME; do
    [ -z "$SNAME" ] && continue
    ROSTER_RESP=$(curl_auth "$DESK_URL/api/v1/staff" 2>/dev/null || echo "{}")
    SID=$(find_id_by_name "$ROSTER_RESP" "$SNAME")
    if [ -n "$SID" ]; then
      DEL_R=$(curl_auth -X DELETE "$DESK_URL/api/v1/staff/${SID}" 2>/dev/null || echo "{}")
      DEL_OK=$(get_field "$DEL_R" "ok")
      if [ "$DEL_OK" = "true" ]; then
        CLEANUP_PASS=$((CLEANUP_PASS+1))
      else
        CLEANUP_FAIL=$((CLEANUP_FAIL+1))
      fi
    fi
  done < <(list_created_names "$IMPORT_RESP")
  if [ "$CLEANUP_FAIL" = "0" ]; then
    mark_pass "team-pack cleanup: retired $CLEANUP_PASS imported staff"
  else
    mark_fail "team-pack cleanup: $CLEANUP_FAIL retire failures (manual cleanup needed)"
  fi
fi

# ── Check 5: No Hermes / API key in post-startup log ────────────────────────
echo ""
echo "=== Check 5: No Hermes/API-key calls post-startup ==="
LOG_FILE="${HOME}/desk-3110.log"
if [ ! -f "$LOG_FILE" ]; then
  mark_fail "log file not found: $LOG_FILE"
else
  # grep -c returns exit 1 when 0 matches; use true to avoid pipefail triggering || fallback
  HERMES_HITS=$(grep -icE "hermes" "$LOG_FILE" 2>/dev/null || true)
  DEEPSEEK_HITS=$(grep -icE "DEEPSEEK_API" "$LOG_FILE" 2>/dev/null || true)
  OPENAI_HITS=$(grep -icE "OPENAI_API_KEY in flight" "$LOG_FILE" 2>/dev/null || true)
  # Trim whitespace/newlines
  HERMES_HITS=$(printf '%s' "$HERMES_HITS" | tr -d '[:space:]')
  DEEPSEEK_HITS=$(printf '%s' "$DEEPSEEK_HITS" | tr -d '[:space:]')
  OPENAI_HITS=$(printf '%s' "$OPENAI_HITS" | tr -d '[:space:]')
  # Default to 0 if empty
  HERMES_HITS="${HERMES_HITS:-0}"
  DEEPSEEK_HITS="${DEEPSEEK_HITS:-0}"
  OPENAI_HITS="${OPENAI_HITS:-0}"

  if [ "$HERMES_HITS" = "0" ] && [ "$DEEPSEEK_HITS" = "0" ] && [ "$OPENAI_HITS" = "0" ]; then
    mark_pass "no Hermes/DeepSeek/OpenAI in-flight calls in $LOG_FILE"
  else
    mark_fail "found API dependencies: hermes=$HERMES_HITS deepseek=$DEEPSEEK_HITS openai=$OPENAI_HITS (review $LOG_FILE)"
    # Show sample lines for diagnosis
    if [ "$HERMES_HITS" -gt 0 ]; then
      echo "    Sample hermes lines:"
      grep -iE "hermes" "$LOG_FILE" | head -3 | sed 's/^/      /'
    fi
  fi
fi

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════"
echo "  Results: $pass PASS · $fail FAIL"
echo "════════════════════════════════════════"

if [ "$fail" -gt 0 ]; then
  exit 1
fi
exit 0

#!/usr/bin/env bash
# scripts/clawbot/serve.sh — Start the WeChat→Secretary gateway daemon.
#
# Reads bound WeChat credentials from ~/.claude/channels/wechat/account.json
# (written by login.sh / wechat-clawbot-cc setup).  Calls the desk Secretary
# adapter at http://127.0.0.1:<DESK_PORT>/api/v1/connectors/wechat/reply and
# sends the reply back into WeChat via iLink.
#
# Environment (all optional):
#   DESK_PORT          Port the desk Next.js server listens on.  Default: 3110.
#   DESK_URL           Full base URL override, e.g. http://127.0.0.1:4000.
#   SECRETARY_TIMEOUT  Seconds to wait for the Secretary reply.  Default: 120.
#
# Usage:
#   bash scripts/clawbot/serve.sh
#   DESK_PORT=3110 bash scripts/clawbot/serve.sh
#
# Prerequisite: run login.sh first.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GATEWAY="$SCRIPT_DIR/gateway.py"

DESK_PORT="${DESK_PORT:-3110}"
DESK_URL="${DESK_URL:-http://127.0.0.1:${DESK_PORT}}"
SECRETARY_TIMEOUT="${SECRETARY_TIMEOUT:-120}"

# Quick connectivity check — warn but don't abort; the desk may not be started yet.
if ! curl -sf --max-time 3 "${DESK_URL}/api/v1/connectors/wechat/reply" \
        -X POST -H 'Content-Type: application/json' -d '{}' >/dev/null 2>&1; then
  echo "[clawbot/serve] WARN: desk not reachable at ${DESK_URL} (start the desk first: pnpm dev)"
  echo "[clawbot/serve]   Continuing anyway — gateway will retry on each incoming message."
fi

echo "[clawbot/serve] Starting WeChat gateway -> ${DESK_URL}${SCRIPT_DIR##*/}"
echo "[clawbot/serve] Desk URL:          ${DESK_URL}"
echo "[clawbot/serve] Secretary timeout: ${SECRETARY_TIMEOUT}s"
echo "[clawbot/serve] Press Ctrl+C to stop."
echo ""

export DESK_URL
export SECRETARY_TIMEOUT

exec python3 "$GATEWAY"

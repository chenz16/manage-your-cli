#!/usr/bin/env bash
# Holon LiteLLM proxy launcher — Phase 0 of budget-aware orchestration.
# See docs/research/budget-aware-agent-orchestration.md (Phase 0).
#
# Sources the gitignored repo-root .env (DEEPSEEK_API_KEY, LITELLM_MASTER_KEY),
# then starts the OpenAI-compatible LiteLLM proxy from the isolated .venv-litellm
# venv on 127.0.0.1:4000 in the background (nohup), waits until it's ready, and
# prints the URL. Per-request cost lines are appended to a local file by the
# scripts/litellm_cost_logger.py callback (HOLON_LITELLM_COST_LOG).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

PORT="${LITELLM_PORT:-4000}"
HOST="127.0.0.1"
PROXY_LOG="/tmp/holon-litellm.log"
COST_LOG="${HOLON_LITELLM_COST_LOG:-/tmp/holon-litellm-cost.log}"
VENV_BIN="$REPO_ROOT/.venv-litellm/bin"

if [[ ! -x "$VENV_BIN/litellm" ]]; then
  echo "ERROR: litellm not found at $VENV_BIN/litellm" >&2
  echo "  Create it with: uv venv .venv-litellm && VIRTUAL_ENV=.venv-litellm uv pip install 'litellm[proxy]'" >&2
  exit 1
fi

if [[ ! -f "$REPO_ROOT/.env" ]]; then
  echo "ERROR: repo-root .env not found (need DEEPSEEK_API_KEY + LITELLM_MASTER_KEY)" >&2
  exit 1
fi

# Source .env (auto-export every var) — keeps secrets out of argv/committed files.
set -a
# shellcheck disable=SC1091
. "$REPO_ROOT/.env"
set +a

if [[ -z "${LITELLM_MASTER_KEY:-}" ]]; then
  echo "ERROR: LITELLM_MASTER_KEY not set in .env" >&2
  exit 1
fi

# The cost-logger callback module lives in scripts/ — put it on PYTHONPATH so
# litellm can import "litellm_cost_logger".
export PYTHONPATH="$REPO_ROOT/scripts${PYTHONPATH:+:$PYTHONPATH}"
export HOLON_LITELLM_COST_LOG="$COST_LOG"

# Don't start a second instance on the same port.
if curl -s -o /dev/null "http://${HOST}:${PORT}/health/readiness" 2>/dev/null; then
  echo "LiteLLM proxy already running at http://${HOST}:${PORT}"
  exit 0
fi

echo "Starting LiteLLM proxy on http://${HOST}:${PORT} (log: $PROXY_LOG, cost log: $COST_LOG)..."
nohup "$VENV_BIN/litellm" \
  --config "$REPO_ROOT/litellm-config.yaml" \
  --host "$HOST" \
  --port "$PORT" \
  > "$PROXY_LOG" 2>&1 &
PROXY_PID=$!
echo "  pid=$PROXY_PID"

# Wait until the readiness endpoint responds (max ~60s).
for _ in $(seq 1 60); do
  if curl -s -o /dev/null "http://${HOST}:${PORT}/health/readiness" 2>/dev/null; then
    echo "READY: http://${HOST}:${PORT}"
    echo "  models: $(curl -s "http://${HOST}:${PORT}/v1/models" -H "Authorization: Bearer ${LITELLM_MASTER_KEY}" | sed 's/{.*//')OK"
    exit 0
  fi
  if ! kill -0 "$PROXY_PID" 2>/dev/null; then
    echo "ERROR: proxy process exited early — see $PROXY_LOG" >&2
    tail -n 30 "$PROXY_LOG" >&2 || true
    exit 1
  fi
  sleep 1
done

echo "ERROR: proxy did not become ready within 60s — see $PROXY_LOG" >&2
exit 1

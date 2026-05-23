#!/usr/bin/env bash
# serve-https-proxy.sh
# Starts a self-signed HTTPS reverse proxy in front of the Holon prod server.
# Gives the owner's Windows browser a secure context (needed for mic/SpeechRecognition).
#
# Usage: ./scripts/serve-https-proxy.sh [--foreground]
#   --foreground  run in foreground (default: background with nohup)
#
# Env overrides:
#   HTTPS_PORT   listening port  (default 3443)
#   TARGET_PORT  upstream port   (default 3000)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CERTS_DIR="${REPO_ROOT}/.certs"
CERT="${CERTS_DIR}/cert.pem"
KEY="${CERTS_DIR}/key.pem"
PROXY_SCRIPT="${REPO_ROOT}/scripts/https-proxy.mjs"
HTTPS_PORT="${HTTPS_PORT:-3443}"
TARGET_PORT="${TARGET_PORT:-3000}"
LOG_FILE="/tmp/holon-https-proxy.log"

# ── 1. Detect WSL eth0 IP ────────────────────────────────────────────────────
WSL_IP="$(ip -4 addr show eth0 2>/dev/null | grep -oP 'inet \K[\d.]+' || true)"
if [[ -z "${WSL_IP}" ]]; then
  echo "[serve-https-proxy] WARNING: could not detect eth0 IP; using 127.0.0.1" >&2
  WSL_IP="127.0.0.1"
fi

# ── 2. Generate cert if missing (regenerate on WSL restart when cert absent) ─
mkdir -p "${CERTS_DIR}"
if [[ ! -f "${CERT}" || ! -f "${KEY}" ]]; then
  echo "[serve-https-proxy] Generating self-signed cert (SAN: localhost, 127.0.0.1, ${WSL_IP}) ..."
  openssl req -x509 -newkey rsa:2048 -nodes \
    -keyout "${KEY}" \
    -out "${CERT}" \
    -days 825 \
    -subj "/CN=holon-local" \
    -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:${WSL_IP}" \
    2>&1
  echo "[serve-https-proxy] Cert written to ${CERTS_DIR}"
fi

# ── 3. Kill any existing proxy on that port ──────────────────────────────────
EXISTING_PID="$(lsof -ti tcp:"${HTTPS_PORT}" 2>/dev/null || true)"
if [[ -n "${EXISTING_PID}" ]]; then
  echo "[serve-https-proxy] Stopping existing process on :${HTTPS_PORT} (pid ${EXISTING_PID})"
  kill "${EXISTING_PID}" 2>/dev/null || true
  sleep 0.5
fi

# ── 4. Launch proxy ──────────────────────────────────────────────────────────
FOREGROUND=false
for arg in "$@"; do
  [[ "${arg}" == "--foreground" ]] && FOREGROUND=true
done

export HTTPS_PORT TARGET_PORT WSL_IP

if [[ "${FOREGROUND}" == "true" ]]; then
  exec node "${PROXY_SCRIPT}"
else
  nohup node "${PROXY_SCRIPT}" > "${LOG_FILE}" 2>&1 &
  PROXY_PID=$!
  disown "${PROXY_PID}"
  sleep 1
  if kill -0 "${PROXY_PID}" 2>/dev/null; then
    echo "[serve-https-proxy] Proxy started (pid ${PROXY_PID}), log: ${LOG_FILE}"
    echo "[serve-https-proxy] Owner URL: https://${WSL_IP}:${HTTPS_PORT}"
    echo "[serve-https-proxy] (Click through the cert warning once — then mic works.)"
  else
    echo "[serve-https-proxy] ERROR: proxy failed to start. Check ${LOG_FILE}" >&2
    cat "${LOG_FILE}" >&2
    exit 1
  fi
fi

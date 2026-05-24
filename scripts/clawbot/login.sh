#!/usr/bin/env bash
# WeChat ClawBot QR Login
# Usage: ./scripts/clawbot/login.sh
#
# Fetches a real QR from Tencent's iLink endpoint, renders it in the terminal,
# then polls until the owner scans + confirms with WeChat iOS.
# On success, token is saved to ~/.claude/channels/wechat/account.json (mode 0600).
#
# Powered by: wechat-clawbot (nightsailer/wechat-clawbot, MIT)
# Idempotent: re-running always fetches a fresh QR (prompts if existing creds found).

set -euo pipefail

if ! command -v wechat-clawbot-cc &>/dev/null; then
  echo "[clawbot] wechat-clawbot-cc not found — installing..."
  pip install wechat-clawbot --quiet
fi

exec wechat-clawbot-cc setup

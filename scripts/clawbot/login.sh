#!/usr/bin/env bash
# scripts/clawbot/login.sh — Bind a WeChat account via QR scan (one-time setup).
#
# Runs `wechat-clawbot-cc setup`, which:
#   1. Fetches a QR code from the iLink bot service.
#   2. Displays it as ASCII art in the terminal (requires `qrcode` Python pkg).
#   3. Waits for you to scan it with your WeChat app (iOS, mainland China account).
#   4. Saves the bound bot_token + account_id to ~/.claude/channels/wechat/account.json.
#
# Usage:
#   bash scripts/clawbot/login.sh
#
# After this succeeds, run serve.sh to start the message gateway.

set -euo pipefail

echo "[clawbot/login] Starting WeChat QR bind via wechat-clawbot-cc ..."
exec wechat-clawbot-cc setup

#!/usr/bin/env bash
# User-triggered local TTS setup for the WSL web build.
# Uses uv (no sudo, no python3-venv needed). Synthesizes via edge-tts
# (Microsoft Edge neural voices — no local model files, no spaCy, no torch).
# Requires internet access at runtime to reach Microsoft's TTS endpoint.
#
# Run:  bash scripts/install-tts-wsl.sh
set -euo pipefail
cd "$(dirname "$0")/.."
UV="$(command -v uv || echo "$HOME/.local/bin/uv")"
echo "[tts] creating venv with uv (no sudo needed)..."
"$UV" venv .venv-tts --python 3.10
echo "[tts] installing edge-tts stack (no model downloads needed)..."
"$UV" pip install --python .venv-tts edge-tts fastapi "uvicorn[standard]"
echo "[tts] starting local TTS on 0.0.0.0:8770 (internet required for voice synthesis)..."
echo "[tts] in Holon /connectors set TTS engine = Local, URL = http://127.0.0.1:8770, then Health check / Test voice."
exec .venv-tts/bin/python scripts/cosyvoice-server.py --host 0.0.0.0 --port 8770

#!/usr/bin/env bash
# User-triggered local STT (SenseVoice) setup for the WSL web build.
# Uses uv (no sudo, no python3-venv needed). Engine runs in WSL, so the
# connector STT URL stays http://127.0.0.1:8769.
#
# Run:  bash scripts/install-stt-wsl.sh
set -euo pipefail
cd "$(dirname "$0")/.."
UV="$(command -v uv || echo "$HOME/.local/bin/uv")"
echo "[stt] creating venv with uv (no sudo needed)…"
"$UV" venv .venv-stt --python 3.10
echo "[stt] installing SenseVoice stack (funasr + torch; first time is large)…"
"$UV" pip install --python .venv-stt funasr modelscope fastapi "uvicorn[standard]" python-multipart torch torchaudio
echo "[stt] starting SenseVoice on 0.0.0.0:8769 (first run downloads the model ~900MB; leave this window open)…"
echo "[stt] when it says it's listening, in Holon /connectors set the STT engine = SenseVoice, URL = http://127.0.0.1:8769, then Health check."
exec .venv-stt/bin/python scripts/sensevoice-server.py --host 0.0.0.0 --port 8769

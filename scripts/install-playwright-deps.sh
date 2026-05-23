#!/usr/bin/env bash
# install-playwright-deps.sh
#
# Installs the system libraries Playwright's Chromium needs on Ubuntu/WSL2.
# Prompts for your sudo password once. Handles the libasound2 → libasound2t64
# rename in Ubuntu 24.04.
#
# Usage:
#   ./scripts/install-playwright-deps.sh

set -euo pipefail

echo "==> Installing Playwright Chromium system libs (sudo will prompt for password)…"

CANDIDATES=(
  libnspr4
  libnss3
  libnssutil3
  libatk1.0-0
  libatk1.0-0t64
  libatk-bridge2.0-0
  libatk-bridge2.0-0t64
  libcups2
  libcups2t64
  libdrm2
  libxkbcommon0
  libxcomposite1
  libxdamage1
  libxfixes3
  libxrandr2
  libgbm1
  libpango-1.0-0
  libcairo2
  libasound2
  libasound2t64
)

# Only ask apt to install packages that actually exist in the user's apt index.
TO_INSTALL=()
for pkg in "${CANDIDATES[@]}"; do
  if apt-cache show "$pkg" >/dev/null 2>&1; then
    TO_INSTALL+=("$pkg")
  fi
done

echo "    will install: ${TO_INSTALL[*]}"

sudo apt-get update -qq
sudo apt-get install -y "${TO_INSTALL[@]}"

echo ""
echo "==> Done. Verifying Chromium can launch…"
CHROMIUM_BIN="$HOME/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell"
if [ -x "$CHROMIUM_BIN" ]; then
  if "$CHROMIUM_BIN" --version 2>/dev/null; then
    echo "==> ✓ Chromium launches cleanly. Ready for screenshot script."
  else
    echo "==> ⚠ Chromium installed but still failing to launch — show the error to the coordinator."
    "$CHROMIUM_BIN" --version
  fi
else
  echo "==> ⚠ Chromium binary not found at $CHROMIUM_BIN — pnpm -F web add -D playwright + npx playwright install chromium may not have completed."
fi

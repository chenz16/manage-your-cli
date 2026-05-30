#!/usr/bin/env bash
# WSL-side Next.js web build for the Windows installer pipeline.
#
# WHY this exists: the Windows installer build (build-windows-installer-local.ps1)
# cannot run `pnpm -F web build` on the Windows side -- pnpm/node are installed via
# nvm INSIDE WSL and the repo's node_modules are Linux-symlinked (Windows pnpm hits
# EISDIR). So the PS script invokes this script via `wsl.exe ... bash <thisfile>`.
#
# WHY not just `bash -lc 'pnpm -F web build'`: pnpm is nvm-managed and only added to
# PATH by ~/.bashrc, which a non-interactive login shell does NOT source. Worse,
# `nvm use default` resolves to a node version that does NOT have pnpm/corepack
# enabled. So we locate the node bin dir that ACTUALLY contains pnpm and prepend it.
set -euo pipefail

REPO="/home/chenz/project/holon-engineering"

# Find the nvm node bin directory that actually has a pnpm executable.
PNPM_PATH="$(ls "$HOME"/.nvm/versions/node/*/bin/pnpm 2>/dev/null | head -1 || true)"
if [ -z "$PNPM_PATH" ]; then
  echo "ERROR: no pnpm found under $HOME/.nvm/versions/node/*/bin/ -- is pnpm enabled (corepack) on any nvm node?" >&2
  exit 1
fi
export PATH="$(dirname "$PNPM_PATH"):$PATH"

echo "wsl-web-build: using $(command -v pnpm) ($(pnpm --version)), node $(node --version)"

# L-099: if NEXT_DIST_DIR is set (e.g. .next-prod by the installer pipeline),
# export it so next.config.ts routes the build output to the isolated dir and
# never clobbers the dev server's .next/ while it is running.
if [ -n "${NEXT_DIST_DIR:-}" ]; then
  echo "wsl-web-build: NEXT_DIST_DIR=${NEXT_DIST_DIR} (isolated build dir)"
  export NEXT_DIST_DIR
fi

cd "$REPO"
exec pnpm -F web build

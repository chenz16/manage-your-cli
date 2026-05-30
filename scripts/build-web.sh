#!/usr/bin/env bash
# build-web.sh — build the web release with an ISOLATED throwaway owner DB.
#
# WHY: `next build` boots the persistence layer during prerender (it hydrates
# owner state for server components like /inbound, /me, /connectors). Run
# against the real owner DB (~/.holon/owner.sqlite), the build's boot/normalize
# path was wiping the owner's live config — specifically the STT/TTS provider
# selection — every time we rebuilt the release. That was the root cause of the
# recurring "🔊 还没有配置文字转语音" after each promote: the owner sets an engine,
# we rebuild, the rebuild clobbers it back to null.
#
# Pointing HOLON_DB_PATH at a throwaway file for the duration of the build keeps
# the build hermetic — it can read/write its scratch DB freely and the owner's
# real config is never touched. Cross-platform: HOLON_DB_PATH wins over the
# Linux ~/.holon and the Windows %LOCALAPPDATA% defaults (see resolveDbPath in
# packages/core/src/owner-state-persistence.ts), so the Windows installer build
# should use this too.
#
# Usage: bash scripts/build-web.sh
set -uo pipefail
cd "$(dirname "$0")/.."

# If nvm 22.19 is installed (common WSL/Linux dev box layout), prepend it to
# PATH so a non-interactive shell finds it. Otherwise rely on whatever node
# the user already has on PATH (apt, fnm, brew, etc.) — their choice wins.
if [ -d "$HOME/.nvm/versions/node/v22.19.0/bin" ]; then
  export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"
fi
SCRATCH="${HOLON_BUILD_DB_PATH:-$(mktemp -t holon-build-db-XXXXXX.sqlite)}"
export HOLON_DB_PATH="$SCRATCH"
echo "[build-web] isolated HOLON_DB_PATH=$HOLON_DB_PATH (owner DB untouched)"

corepack pnpm -F @holon/web build
rc=$?

rm -f "$SCRATCH" "$SCRATCH-shm" "$SCRATCH-wal" 2>/dev/null || true
exit $rc

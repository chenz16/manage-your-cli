#!/usr/bin/env bash
# check-deps.sh — pre-flight for installing Manage Your CLI on a fresh
# WSL2 / Linux box. Reports MISSING / OK for each dependency; never
# installs anything (the user is the boss; this just tells them what's
# wrong so they can fix it).
#
# Usage:  bash scripts/check-deps.sh
# Exit code: 0 if everything required is present, 1 otherwise.

set -u

red()    { printf '\033[31m%s\033[0m' "$*"; }
green()  { printf '\033[32m%s\033[0m' "$*"; }
yellow() { printf '\033[33m%s\033[0m' "$*"; }
gray()   { printf '\033[90m%s\033[0m' "$*"; }

REQUIRED_OK=1

check_required() {
  local name="$1" cmd="$2" hint="$3" minver="${4:-}"
  if command -v "$cmd" >/dev/null 2>&1; then
    local ver
    ver=$("$cmd" --version 2>&1 | head -1 | tr -d '\r')
    printf '  [%s] %-14s %s\n' "$(green ' OK ')" "$name" "$(gray "$ver")"
  else
    printf '  [%s] %-14s %s\n' "$(red 'MISS')" "$name" "$hint"
    REQUIRED_OK=0
  fi
}

check_optional() {
  local name="$1" cmd="$2" hint="$3"
  if command -v "$cmd" >/dev/null 2>&1; then
    local ver
    ver=$("$cmd" --version 2>&1 | head -1 | tr -d '\r')
    printf '  [%s] %-14s %s\n' "$(green ' OK ')" "$name" "$(gray "$ver")"
  else
    printf '  [%s] %-14s %s\n' "$(yellow 'OPT ')" "$name" "$hint"
  fi
}

echo
echo "── Required for desk ──"
check_required "node"   "node"   "install via nvm: 'curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/master/install.sh | bash && nvm install 22'"
check_required "pnpm"   "pnpm"   "enable via 'corepack enable && corepack prepare pnpm@9.10.0 --activate'"
check_required "tmux"   "tmux"   "Debian/Ubuntu: 'sudo apt-get install -y tmux'"
check_required "git"    "git"    "Debian/Ubuntu: 'sudo apt-get install -y git'"

echo
echo "── Required for at least one CLI subscription ──"
echo "  (the secretary + employees ARE these CLIs — pick one or more)"
check_optional "claude"  "claude"  "https://docs.anthropic.com/claude-code (subscription, run 'claude' once to log in)"
check_optional "codex"   "codex"   "https://github.com/openai/codex (subscription)"
check_optional "gemini"  "gemini"  "https://ai.google.dev/gemini-cli (subscription)"
check_optional "qwen"    "qwen"    "https://github.com/QwenLM/qwen-code (subscription)"

if ! command -v claude >/dev/null && ! command -v codex >/dev/null \
   && ! command -v gemini >/dev/null && ! command -v qwen >/dev/null; then
  echo "  $(red 'WARN') no CLI found — install at least one above before running."
  REQUIRED_OK=0
fi

echo
echo "── Recommended (used by some features; missing = feature off) ──"
check_optional "python3" "python3" "Debian/Ubuntu: 'sudo apt-get install -y python3' (TTS server, smoke scripts)"
check_optional "curl"    "curl"    "Debian/Ubuntu: 'sudo apt-get install -y curl' (smoke tests, sanity)"
check_optional "jq"      "jq"      "Debian/Ubuntu: 'sudo apt-get install -y jq' (smoke output formatting)"

echo
echo "── Optional (Android dev side-load) ──"
check_optional "adb"     "adb"     "from Android Platform Tools; only needed to push debug APKs from this box"
check_optional "java"    "java"    "OpenJDK 21+ via 'sudo apt-get install -y openjdk-21-jdk' — only for building APKs locally"

echo
echo "── Optional (cross-network reach mobile↔desk) ──"
check_optional "tailscale" "tailscale" "https://tailscale.com/download — Holon works on plain LAN; Tailscale is only for cellular / remote networks"

echo
if [ "$REQUIRED_OK" -eq 1 ]; then
  echo "$(green '✓') required deps OK. Next: 'corepack pnpm install' then './scripts/install-desk-systemd.sh' if you want auto-restart."
  exit 0
else
  echo "$(red '✗') missing required deps above — install them then re-run."
  exit 1
fi

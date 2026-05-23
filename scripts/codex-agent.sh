#!/usr/bin/env bash
# codex-agent.sh — drive the Windows-native Codex CLI as a subagent from WSL.
#
# Codex is installed on Windows (npm -g @openai/codex, logged in via ChatGPT).
# WSL can't see it on PATH (interop PATH gap), and \\wsl$ paths are slow for
# Codex, so this wrapper:
#   1. writes the prompt to a Windows-visible temp file (avoids cmd.exe quoting),
#   2. runs `codex exec` non-interactively via cmd.exe with node/npm on PATH,
#   3. captures the agent's final message and prints it to stdout.
#
# Usage:
#   scripts/codex-agent.sh "Refactor X in apps/web/..."
#   echo "long prompt..." | scripts/codex-agent.sh -
#   scripts/codex-agent.sh -C 'C:\dev\holon-engineering' -s read-only "Audit Y"
#
# Flags:
#   -C <win-dir>   Windows working dir (default: C:\dev\holon-engineering)
#   -s <mode>      sandbox: read-only | workspace-write | danger-full-access
#                  (default: workspace-write)
#   -m <model>     model override (passed to codex -m)
#   --             end of flags; rest is the prompt
#
# Exit code mirrors codex's. Final message also saved alongside full log.
set -euo pipefail

WIN_DIR='C:\dev\holon-engineering'
SANDBOX='workspace-write'
MODEL=''
NODE='C:\Program Files\nodejs'

while [[ $# -gt 0 ]]; do
  case "$1" in
    -C) WIN_DIR="$2"; shift 2 ;;
    -s) SANDBOX="$2"; shift 2 ;;
    -m) MODEL="$2"; shift 2 ;;
    --) shift; break ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    *) break ;;
  esac
done

# Collect prompt: from remaining args, or stdin if "-" / empty.
PROMPT="${*:-}"
if [[ -z "$PROMPT" || "$PROMPT" == "-" ]]; then
  PROMPT="$(cat)"
fi
if [[ -z "${PROMPT// }" ]]; then
  echo "codex-agent: empty prompt" >&2; exit 2
fi

# Windows-visible temp dir (maps to C:\Users\chenz\AppData\Local\Temp\...).
WIN_TMP_ROOT="/mnt/c/Users/chenz/AppData/Local/Temp"
RUN="codex-agent-$$-$(date +%s)"
WSL_DIR="$WIN_TMP_ROOT/$RUN"
mkdir -p "$WSL_DIR"
PROMPT_FILE="$WSL_DIR/prompt.txt"
OUT_FILE="$WSL_DIR/last.txt"
printf '%s' "$PROMPT" > "$PROMPT_FILE"

WIN_PROMPT="C:\\Users\\chenz\\AppData\\Local\\Temp\\$RUN\\prompt.txt"
WIN_OUT="C:\\Users\\chenz\\AppData\\Local\\Temp\\$RUN\\last.txt"

MODEL_FLAG=""
[[ -n "$MODEL" ]] && MODEL_FLAG="-m $MODEL"

# Build the Windows command. codex exec reads the prompt from stdin ("-").
# We pipe the prompt into cmd.exe from WSL (bash-side stdin) rather than using a
# cmd-side `< file` redirect, which trips a "volume label" error under interop.
# NOTE: -C / -o paths are passed UNQUOTED. The node `.cmd` shim keeps literal
# quote chars in argv (→ os error 123), so quoting breaks it. Our paths (C:\dev,
# %TEMP%) have no spaces. If WIN_DIR ever contains a space, switch to 8.3 short
# names instead of quoting.
CMD="set PATH=$NODE;%APPDATA%\\npm;%PATH% && codex exec --skip-git-repo-check -s $SANDBOX -C $WIN_DIR $MODEL_FLAG -o $WIN_OUT -"

echo "[codex-agent] dir=$WIN_DIR sandbox=$SANDBOX ${MODEL:+model=$MODEL}" >&2
echo "[codex-agent] running…" >&2

set +e
( cd /mnt/c && cmd.exe /c "$CMD" < "$PROMPT_FILE" 2>&1 | tr -d '\r' )
RC=$?
set -e

echo "----- codex final message -----"
if [[ -f "$OUT_FILE" ]]; then
  cat "$OUT_FILE"
else
  echo "(no final-message file produced; see streamed log above)" >&2
fi
echo "-------------------------------"
echo "[codex-agent] exit=$RC  log dir=$WSL_DIR" >&2
exit $RC

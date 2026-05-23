#!/usr/bin/env bash
# auto-build-release.sh -- One-command WSL launcher for the Holon Windows installer.
#
# Runs from WSL at the repo root. Invokes the PS1 orchestrator via powershell.exe
# interop, then copies and optionally uploads the resulting .exe artifact.
#
# Usage examples:
#   bash scripts/auto-build-release.sh
#   bash scripts/auto-build-release.sh --profile customer
#   bash scripts/auto-build-release.sh --profile test
#   bash scripts/auto-build-release.sh --profile customer --upload
#
# NEXT_DIST_DIR=.next-prod is exported automatically so the production build
# writes to apps/web/.next-prod/ and never clobbers the running dev server's
# apps/web/.next/ directory. It is safe to build while dev is running.
#
# --upload is only allowed with --profile customer; test builds contain baked
# secrets and MUST NOT be uploaded to a public repo.
#
# Output artifact is copied to artifacts/windows/ with sha256 printed.
# Logs are tee'd to /tmp/holon-autobuild-<UTC>.log.
#
# ASCII-only (no Unicode) to match the style of build-windows-installer-local.ps1.

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROFILE="customer"
UPLOAD=0
LOG_FILE="/tmp/holon-autobuild-$(date -u '+%Y%m%dT%H%M%SZ').log"

# Artifact path produced by cargo tauri build (matches D-4 check in PS1).
# Pattern: apps/web/src-tauri/target/release/bundle/nsis/Holon_<ver>_x64-setup.exe
TAURI_BUNDLE_DIR="${REPO_ROOT}/apps/web/src-tauri/target/release/bundle/nsis"
ARTIFACTS_DIR="${REPO_ROOT}/artifacts/windows"

# Tauri.conf.json version (read at runtime so this script does not need editing
# on each version bump).
TAURI_CONF="${REPO_ROOT}/apps/web/src-tauri/tauri.conf.json"

# The PS1 is run from the Windows side. The interop path is the \\wsl$\ UNC
# form required for cmd/powershell to reach into WSL from the Windows host.
# The WSL distro name is resolved from /etc/os-release; falls back to Ubuntu-22.04.
WSL_DISTRO=""
if [ -f /etc/os-release ]; then
  # WSL sets WSLENV and registers itself; the distro name is in the registry but
  # is not easily reachable from WSL. Use the hostname heuristic first, then the
  # wslpath utility if available.
  WSL_DISTRO="$(wslvar WSL_DISTRO_NAME 2>/dev/null || true)"
fi
# wslvar may not be present; fall back to the known distro.
if [ -z "$WSL_DISTRO" ]; then
  WSL_DISTRO="Ubuntu-22.04"
fi

# UNC form of the repo root for powershell.exe interop.
# Example: \\wsl$\Ubuntu-22.04\home\chenz\project\holon-engineering
UNC_REPO_ROOT="\\\\wsl\$\\${WSL_DISTRO}${REPO_ROOT}"

PS1_SCRIPT='scripts\build-windows-installer-local.ps1'

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------

while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile)
      PROFILE="${2:?'--profile requires customer|test'}"
      shift 2
      ;;
    --upload)
      UPLOAD=1
      shift
      ;;
    -h|--help)
      grep '^#' "$0" | head -40 | sed 's/^# //'
      exit 0
      ;;
    *)
      echo "ERROR: unknown argument: $1" >&2
      echo "Usage: bash scripts/auto-build-release.sh [--profile customer|test] [--upload]" >&2
      exit 1
      ;;
  esac
done

if [[ "$PROFILE" != "customer" && "$PROFILE" != "test" ]]; then
  echo "ERROR: --profile must be customer or test (got: ${PROFILE})" >&2
  exit 1
fi

if [[ "$UPLOAD" -eq 1 && "$PROFILE" == "test" ]]; then
  echo "ERROR: --upload is REFUSED for --profile test." >&2
  echo "       Test builds contain baked secrets (DEEPSEEK_API_KEY, HOLON_FEEDBACK_GITHUB_TOKEN)." >&2
  echo "       DO NOT upload a test build to a public repo." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Banner + log setup
# ---------------------------------------------------------------------------

{
  echo "========================================================"
  echo " Holon Windows installer auto-build"
  echo " Profile : ${PROFILE}"
  echo " Upload  : $([ "$UPLOAD" -eq 1 ] && echo 'YES (customer release)' || echo 'no')"
  echo " Started : $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
  echo " Log     : ${LOG_FILE}"
  echo " Repo    : ${REPO_ROOT}"
  echo " UNC     : ${UNC_REPO_ROOT}"
  echo "========================================================"
  echo ""
} | tee -a "$LOG_FILE"

# Redirect all output through tee for the remainder of the script.
exec > >(tee -a "$LOG_FILE") 2>&1

# ---------------------------------------------------------------------------
# Pre-flight checks
# ---------------------------------------------------------------------------

echo "[preflight] Checking environment..."

# Check 1: repo root sanity
if [ ! -f "${REPO_ROOT}/pnpm-workspace.yaml" ]; then
  echo "ERROR: pnpm-workspace.yaml not found at ${REPO_ROOT} -- wrong directory?" >&2
  exit 1
fi
if [ ! -f "${REPO_ROOT}/scripts/build-windows-installer-local.ps1" ]; then
  echo "ERROR: scripts/build-windows-installer-local.ps1 not found at ${REPO_ROOT}" >&2
  exit 1
fi
echo "[preflight] [ok] repo root: ${REPO_ROOT}"

# Check 2: powershell.exe reachable via WSL interop
if ! command -v powershell.exe &>/dev/null; then
  echo "ERROR: powershell.exe not found. WSL interop must be enabled." >&2
  echo "       Enable via: Windows Settings > Apps > Optional Features > WSL interop" >&2
  echo "       Or check that /proc/sys/fs/binfmt_misc/WSLInterop exists." >&2
  exit 1
fi
echo "[preflight] [ok] powershell.exe: $(command -v powershell.exe)"

# Check 3: tauri.conf.json exists (needed for version extraction + upload)
if [ ! -f "${TAURI_CONF}" ]; then
  echo "ERROR: ${TAURI_CONF} not found" >&2
  exit 1
fi
echo "[preflight] [ok] tauri.conf.json found"

# Check 4: warn (do NOT kill) if dev server is running
if pgrep -f "next-server" &>/dev/null; then
  echo ""
  echo "[preflight] [INFO] A Next.js dev server (next-server) is currently running."
  echo "[preflight] [INFO] This is SAFE -- NEXT_DIST_DIR=.next-prod isolation (L-099)"
  echo "[preflight] [INFO] ensures the production build writes to apps/web/.next-prod/"
  echo "[preflight] [INFO] and never clobbers apps/web/.next/ used by the dev server."
  echo ""
fi

echo "[preflight] All checks passed."
echo ""

# ---------------------------------------------------------------------------
# Invoke the PS1 via powershell.exe interop
# ---------------------------------------------------------------------------

echo "[build] Invoking PS1 orchestrator via powershell.exe interop..."
echo "[build] Profile: ${PROFILE}"
echo "[build] UNC path: ${UNC_REPO_ROOT}"
echo ""

# Export NEXT_DIST_DIR so the WSL build step inside the PS1 (wsl-web-build.sh,
# invoked via wsl.exe inside the PS1) inherits it via env. The PS1 itself passes
# env NEXT_DIST_DIR=.next-prod explicitly to wsl.exe, so this is belt-and-suspenders.
export NEXT_DIST_DIR=.next-prod

# NOTE on the interop invocation form:
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "..."
# is used rather than -File because -File on a UNC path requires the file to
# already exist in Windows path space; -Command with Set-Location + dot-sourcing
# is more reliable across WSL interop versions.
#
# The PS1 itself refreshes PATH from the Windows registry at startup, so cargo,
# pnpm, etc. are available even though the WSL PATH does not include them.

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "
  \$ErrorActionPreference = 'Stop';
  Set-Location '${UNC_REPO_ROOT}';
  & '.\\scripts\\build-windows-installer-local.ps1' -Profile ${PROFILE}
"
PS1_EXIT=$?

if [ "$PS1_EXIT" -ne 0 ]; then
  echo ""
  echo "ERROR: build-windows-installer-local.ps1 exited with code ${PS1_EXIT}" >&2
  echo "       Check the log above for the failure step." >&2
  exit "$PS1_EXIT"
fi

echo ""
echo "[build] PS1 orchestrator completed successfully."
echo ""

# ---------------------------------------------------------------------------
# Artifact verification
# ---------------------------------------------------------------------------

echo "[artifact] Locating .exe in ${TAURI_BUNDLE_DIR} ..."

# Extract version from tauri.conf.json (plain grep; no jq dependency required).
VERSION="$(grep '"version"' "${TAURI_CONF}" | head -1 | sed 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')"
if [ -z "$VERSION" ]; then
  echo "ERROR: could not extract version from ${TAURI_CONF}" >&2
  exit 1
fi
echo "[artifact] Version: ${VERSION}"

EXE_PATH="${TAURI_BUNDLE_DIR}/Holon_${VERSION}_x64-setup.exe"

if [ ! -f "$EXE_PATH" ]; then
  # Try glob in case version string differs slightly.
  EXE_PATH="$(ls "${TAURI_BUNDLE_DIR}/"*x64-setup.exe 2>/dev/null | head -1 || true)"
  if [ -z "$EXE_PATH" ] || [ ! -f "$EXE_PATH" ]; then
    echo "ERROR: no .exe found under ${TAURI_BUNDLE_DIR}/" >&2
    echo "       Expected: Holon_${VERSION}_x64-setup.exe" >&2
    exit 1
  fi
  echo "[artifact] [warn] found by glob (not exact version name): ${EXE_PATH}"
fi

EXE_SIZE_BYTES="$(stat -c%s "${EXE_PATH}")"
EXE_SIZE_MB="$(echo "scale=1; ${EXE_SIZE_BYTES} / 1048576" | bc)"

echo "[artifact] Path: ${EXE_PATH}"
echo "[artifact] Size: ${EXE_SIZE_MB} MB (${EXE_SIZE_BYTES} bytes)"

# Size guard: a complete installer bundle is >100 MB; fail loudly below 50 MB.
# Using 50 MB here (the task requires >50 MB, the PS1 uses >100 MB for its
# guard); if below 100 MB we warn but do not fail (the PS1 already retried).
if [ "$EXE_SIZE_BYTES" -lt 52428800 ]; then
  echo "ERROR: .exe is only ${EXE_SIZE_MB} MB -- expected >50 MB for a complete bundle." >&2
  echo "       Resources likely missing. Check [D-4] guard output above." >&2
  exit 1
fi
if [ "$EXE_SIZE_BYTES" -lt 104857600 ]; then
  echo "[artifact] [WARN] size is ${EXE_SIZE_MB} MB (expected >100 MB). May indicate incomplete resources/n/."
fi

echo "[artifact] [ok] size check passed"

# Copy to artifacts/windows/
mkdir -p "${ARTIFACTS_DIR}"
DEST_EXE="${ARTIFACTS_DIR}/$(basename "${EXE_PATH}")"
cp "${EXE_PATH}" "${DEST_EXE}"
echo "[artifact] Copied to: ${DEST_EXE}"

# SHA256
SHA256="$(sha256sum "${DEST_EXE}" | awk '{print $1}')"
echo "[artifact] SHA256: ${SHA256}"

echo ""

# ---------------------------------------------------------------------------
# Optional upload to chenz16/holon-release
# ---------------------------------------------------------------------------

if [ "$UPLOAD" -eq 1 ]; then
  echo "[upload] Uploading to chenz16/holon-release ..."

  if ! command -v gh &>/dev/null; then
    echo "ERROR: 'gh' (GitHub CLI) not found. Install it or skip --upload." >&2
    exit 1
  fi

  TAG="v${VERSION}"
  RELEASE_TITLE="Holon ${TAG}"
  RELEASE_NOTES="Windows installer (x64, ${TAG}). Unsigned -- Windows SmartScreen will warn: click More info > Run anyway."

  # Create the release if it does not already exist; upload if it does.
  if gh release view "$TAG" --repo chenz16/holon-release &>/dev/null; then
    echo "[upload] Release ${TAG} already exists; uploading asset..."
    gh release upload "$TAG" "${DEST_EXE}" --repo chenz16/holon-release --clobber
  else
    echo "[upload] Creating release ${TAG} and uploading asset..."
    gh release create "$TAG" "${DEST_EXE}" \
      --repo chenz16/holon-release \
      --title "${RELEASE_TITLE}" \
      --notes "${RELEASE_NOTES}"
  fi

  echo "[upload] Done. Release: https://github.com/chenz16/holon-release/releases/tag/${TAG}"
  echo ""
fi

# ---------------------------------------------------------------------------
# Final summary
# ---------------------------------------------------------------------------

echo "========================================================"
echo " Build complete!"
echo " Profile : ${PROFILE}"
echo " Artifact: ${DEST_EXE}"
echo " Size    : ${EXE_SIZE_MB} MB"
echo " SHA256  : ${SHA256}"
echo " Log     : ${LOG_FILE}"
echo " Time    : $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "========================================================"

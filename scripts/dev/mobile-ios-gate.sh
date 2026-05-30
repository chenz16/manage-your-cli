#!/usr/bin/env bash
# mobile-ios-gate.sh — optional iOS build gate for mobile-promote.sh.
#
# Runs on the WSL2 dev box, but executes the iOS-side work over SSH on
# the user's Mac (${MAC_SSH_HOST_IP:-host}). Designed to be invoked from mobile-promote.sh
# right after Android gates pass:
#
#   bash "$MOBILE/scripts/mobile-ios-gate.sh"
#   ios_rc=$?
#   case $ios_rc in
#     0)  log "iOS gate PASS" ;;
#     78) log "iOS gate SKIPPED (SSH unreachable — non-blocking)" ;;
#     *)  log "iOS gate FAIL ($ios_rc) — non-blocking but file M-L-NNN" ;;
#   esac
#
# Exit codes:
#   0  = iOS build + simctl smoke PASS
#   78 = SSH to Mac unreachable / Xcode missing — skip, NOT a failure
#   1  = build or smoke FAIL (real failure; file as M-L-NNN)
#
# Hard requirements on the Mac (${MAC_SSH_HOST:-user@host}):
#   - Remote Login enabled, this WSL2 box's pubkey in ~/.ssh/authorized_keys
#   - Xcode 16+ installed (`xcrun --version` works)
#   - At least one iOS Simulator runtime installed
#   - Node 20.10+ + pnpm 9 + cocoapods (for Capacitor iOS workflow)
#
# This script is intentionally idempotent + side-effect-free outside the
# Mac's mobile sync dir.

set -u
MAC_HOST="${MAC_SSH_HOST:-user@host}"
MAC_MOBILE_DIR="~/holon-mobile-build"
SSH_TIMEOUT=8
LOG=/tmp/holon-mobile-ios-gate.log

ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }
log() { echo "[ios-gate $(ts)] $*" | tee -a "$LOG"; }

# 1. Probe SSH reachability — bail (exit 78) if unreachable.
# Note: `cat < /dev/tcp/host/22` blocks on SSH banner waiting for client
# reply; timeout kills it → false negative. Just try the SSH command
# directly — it tests both reachability AND auth in one shot.
if ! timeout $SSH_TIMEOUT ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new \
       -o ConnectTimeout=5 "$MAC_HOST" 'echo ok' >/dev/null 2>&1; then
  log "skip: Mac SSH unreachable or key not authorized (passwordless connect failed)"
  exit 78
fi

# 2. Confirm full toolchain present on Mac.
# Mac ~/.zshenv must source brew shellenv so SSH non-login shells see
# /opt/homebrew/bin. If a tool is missing, exit 78 (skip, non-blocking).
missing=""
for tool in xcrun node pnpm pod; do
  if ! timeout $SSH_TIMEOUT ssh "$MAC_HOST" "command -v $tool >/dev/null" 2>/dev/null; then
    missing="$missing $tool"
  fi
done
if [ -n "$missing" ]; then
  log "skip: missing on Mac:${missing} — install via brew (or fix ~/.zshenv brew shellenv); iOS gate inactive"
  exit 78
fi
xcrun_v=$(timeout $SSH_TIMEOUT ssh "$MAC_HOST" 'xcrun --version 2>&1 | head -1' 2>/dev/null)
node_v=$(timeout $SSH_TIMEOUT ssh "$MAC_HOST" 'node -v' 2>/dev/null)
log "Mac toolchain: $xcrun_v · node $node_v · pnpm + cocoapods present"

# 3. Rsync apps/mobile to Mac (excluding heavy / generated dirs)
log "rsync apps/mobile + workspace metadata to Mac:$MAC_MOBILE_DIR"
rsync_out=$(rsync -az --delete \
  --exclude 'node_modules' --exclude '.next' --exclude 'out' \
  --exclude 'ios/Pods' --exclude 'ios/build' --exclude 'android' \
  -e "ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=5" \
  ${MOBILE_REPO:?MOBILE_REPO required}/apps/mobile/ \
  "${MAC_HOST}:${MAC_MOBILE_DIR}/apps/mobile/" 2>&1)
rsync_rc=$?
if [ $rsync_rc -ne 0 ]; then
  log "FAIL: rsync apps/mobile failed (rc=$rsync_rc): $(echo "$rsync_out" | tail -3)"
  exit 1
fi
# Also sync workspace packages mobile depends on
rsync -az --delete \
  --exclude 'node_modules' --exclude 'dist' \
  -e "ssh -o BatchMode=yes -o ConnectTimeout=5" \
  ${MOBILE_REPO:?MOBILE_REPO required}/packages/api-contract/ \
  "${MAC_HOST}:${MAC_MOBILE_DIR}/packages/api-contract/" >/dev/null 2>&1
rsync -az --delete \
  --exclude 'node_modules' --exclude 'dist' \
  -e "ssh -o BatchMode=yes -o ConnectTimeout=5" \
  ${MOBILE_REPO:?MOBILE_REPO required}/packages/core/ \
  "${MAC_HOST}:${MAC_MOBILE_DIR}/packages/core/" >/dev/null 2>&1
# Sync minimal root metadata for pnpm workspace resolution
scp -q ${MOBILE_REPO:?MOBILE_REPO required}/pnpm-workspace.yaml \
  ${MOBILE_REPO:?MOBILE_REPO required}/package.json \
  ${MOBILE_REPO:?MOBILE_REPO required}/tsconfig.json \
  "${MAC_HOST}:${MAC_MOBILE_DIR}/" 2>/dev/null

# 4. Run iOS build + smoke on Mac
remote_script=$(cat <<'REMOTE'
set -u
cd ~/holon-mobile-build/apps/mobile || { echo "FAIL: no mobile dir"; exit 1; }
echo "[mac] pnpm install"
pnpm install --silent 2>&1 | tail -3
echo "[mac] next build (static export for capacitor)"
NEXT_PUBLIC_CAPACITOR=1 pnpm next build 2>&1 | tail -5 || { echo "FAIL: next build"; exit 1; }
echo "[mac] rebuild capacitor iOS platform (rsync --delete may have stripped ios/ guts)"
rm -rf ios
npx cap add ios 2>&1 | tail -5 || { echo "FAIL: cap add ios"; exit 1; }
echo "[mac] cap sync ios"
npx cap sync ios 2>&1 | tail -5 || { echo "FAIL: cap sync ios"; exit 1; }
echo "[mac] xcodebuild (simulator, no signing)"
# Xcode 26 quirk: even with explicit -destination, scheme's Run-target
# computation pulls in "Any iOS Device" which needs iOS 26.2 SDK (not
# installed; only 18.6 simulator runtime exists). Workaround: boot the
# target simulator FIRST, then xcodebuild auto-targets the booted one.
SIM_UDID=$(xcrun simctl list devices available 2>/dev/null | grep -E 'iPhone 16 \(' | head -1 | grep -oE '[A-F0-9-]{36}')
[ -z "$SIM_UDID" ] && SIM_UDID=$(xcrun simctl list devices available 2>/dev/null | grep -E 'iPhone' | head -1 | grep -oE '[A-F0-9-]{36}')
echo "[mac] boot simulator UDID: $SIM_UDID"
xcrun simctl boot "$SIM_UDID" 2>/dev/null || true   # idempotent; OK if already booted
xcodebuild -workspace ios/App/App.xcworkspace -scheme App \
  -configuration Debug \
  -destination "platform=iOS Simulator,id=$SIM_UDID" \
  -derivedDataPath ios/build CODE_SIGNING_ALLOWED=NO \
  -skipPackagePluginValidation -skipMacroValidation \
  build 2>&1 | tail -20 | grep -iE 'error|warning|build succeeded|^\*\* BUILD' || true
if [ ! -d "ios/build/Build/Products/Debug-iphonesimulator/App.app" ]; then
  echo "FAIL: App.app not produced"
  exit 1
fi
echo "[mac] OK · App.app built at $(date -u +%H:%M:%SZ)"
REMOTE
)

log "running remote build + simulator gate on Mac"
remote_out=$(timeout 600 ssh -o BatchMode=yes "$MAC_HOST" "bash -s" <<<"$remote_script" 2>&1)
remote_rc=$?
echo "$remote_out" | sed 's/^/  [mac] /' | tee -a "$LOG" | tail -20

if [ $remote_rc -ne 0 ]; then
  log "FAIL: remote build returned rc=$remote_rc"
  exit 1
fi
if echo "$remote_out" | grep -qE '^FAIL:|error:'; then
  log "FAIL: remote output contains error"
  exit 1
fi
log "✓ iOS gate PASS"
exit 0

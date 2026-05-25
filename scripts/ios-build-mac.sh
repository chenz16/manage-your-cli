#!/usr/bin/env bash
# ios-build-mac.sh — build the Weizo mobile app for iOS on the user's Mac over SSH.
# Adapts the old mobile-ios-gate.sh to the myc-mobile repo path. Key-based SSH
# (pubkey installed 2026-05-25). Simulator build (no signing) — validates the
# whole iOS pipeline; real-device .ipa needs the owner's Apple signing.
set -u
SRC=/home/chenz/project/myc-mobile
MAC_HOST="zuolinliu@10.0.0.123"
MAC_DIR="~/holon-mobile-build"
SSH="ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=8"
ts() { date -u +%H:%M:%SZ; }
log() { echo "[ios-build $(ts)] $*"; }

log "rsync apps/mobile + packages to Mac"
rsync -az --delete \
  --exclude node_modules --exclude .next --exclude out \
  --exclude ios/Pods --exclude ios/build --exclude android \
  -e "$SSH" "$SRC/apps/mobile/" "${MAC_HOST}:${MAC_DIR}/apps/mobile/" || { log "FAIL rsync mobile"; exit 1; }
for p in api-contract core; do
  rsync -az --delete --exclude node_modules --exclude dist \
    -e "$SSH" "$SRC/packages/$p/" "${MAC_HOST}:${MAC_DIR}/packages/$p/" || { log "FAIL rsync $p"; exit 1; }
done
scp -q "$SRC/pnpm-workspace.yaml" "$SRC/package.json" "$SRC/tsconfig.json" "${MAC_HOST}:${MAC_DIR}/" 2>/dev/null

log "remote build on Mac (pnpm install → next build → cap → xcodebuild sim)"
$SSH "$MAC_HOST" 'bash -s' <<'REMOTE' 2>&1 | sed 's/^/  [mac] /'
set -u
export PATH="/opt/homebrew/bin:$PATH"
cd ~/holon-mobile-build/apps/mobile || { echo "FAIL: no mobile dir"; exit 1; }
echo "[mac] pnpm install"; pnpm install --silent 2>&1 | tail -3
echo "[mac] next build (capacitor static export)"
NEXT_PUBLIC_CAPACITOR=1 pnpm next build 2>&1 | tail -6 || { echo "FAIL: next build"; exit 1; }
echo "[mac] fresh capacitor iOS platform"
rm -rf ios; npx --yes cap add ios 2>&1 | tail -4 || { echo "FAIL: cap add ios"; exit 1; }
npx --yes cap sync ios 2>&1 | tail -4 || { echo "FAIL: cap sync ios"; exit 1; }
echo "[mac] xcodebuild simulator (no signing)"
SIM=$(xcrun simctl list devices available | grep -E 'iPhone 16 \(' | head -1 | grep -oE '[A-F0-9-]{36}')
[ -z "$SIM" ] && SIM=$(xcrun simctl list devices available | grep -E 'iPhone' | head -1 | grep -oE '[A-F0-9-]{36}')
echo "[mac] sim UDID: $SIM"; xcrun simctl boot "$SIM" 2>/dev/null || true
xcodebuild -workspace ios/App/App.xcworkspace -scheme App -configuration Debug \
  -destination "platform=iOS Simulator,id=$SIM" -derivedDataPath ios/build \
  CODE_SIGNING_ALLOWED=NO -skipPackagePluginValidation -skipMacroValidation build \
  2>&1 | tail -25 | grep -iE 'error|build succeeded|^\*\* BUILD' || true
if [ -d "ios/build/Build/Products/Debug-iphonesimulator/App.app" ]; then
  echo "[mac] OK · App.app built"
else
  echo "FAIL: App.app not produced"; exit 1
fi
REMOTE
log "done (rc=$?)"

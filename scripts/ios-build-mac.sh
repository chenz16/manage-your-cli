#!/usr/bin/env bash
# ios-build-mac.sh — build the Weizo mobile app for the iOS Simulator on the
# user's Mac over (key-based) SSH. Reproducible one-command build.
# VERIFIED working 2026-05-25: ** BUILD SUCCEEDED ** / App.app produced.
#
# Real-device .ipa still needs the owner's Apple signing (CODE_SIGNING) + the
# final install hop is Mac-tethered or TestFlight (can't push .ipa from WSL).
#
# Fixes baked in (root causes found 2026-05-25):
#  1. root package.json pins packageManager pnpm@9.10.0 but Mac has pnpm 11 + no
#     corepack → pnpm tries to self-switch and HANGS. → install with
#     --config.manage-package-manager-versions=false
#  2. @holon/core depends on @holon/auth → must sync packages/auth too.
#  3. @capacitor-community/text-to-speech@8 (really for Capacitor 8; app is Cap 6)
#     pod needs iOS deployment target >13 → raise Podfile `platform :ios` to 15.0
#     (Capacitor's own post_install propagates it to every pod). TECH DEBT: pin
#     TTS to a Capacitor-6 version (^6) to drop this patch.
set -u
SRC=/home/chenz/project/myc-mobile
MAC="zuolinliu@10.0.0.123"
MD="~/holon-mobile-build"
SSH="ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=8"
ts() { date -u +%H:%M:%SZ; }
log() { echo "[ios-build $(ts)] $*"; }

log "rsync apps/mobile + workspace packages (incl auth) to Mac"
rsync -az --delete --exclude node_modules --exclude .next --exclude out \
  --exclude ios/Pods --exclude ios/build --exclude android \
  -e "$SSH" "$SRC/apps/mobile/" "${MAC}:${MD}/apps/mobile/" || { log "FAIL rsync mobile"; exit 1; }
for p in api-contract auth core; do
  rsync -az --delete --exclude node_modules --exclude dist \
    -e "$SSH" "$SRC/packages/$p/" "${MAC}:${MD}/packages/$p/" || { log "FAIL rsync $p"; exit 1; }
done
scp -q "$SRC/pnpm-workspace.yaml" "$SRC/package.json" "$SRC/tsconfig.json" "${MAC}:${MD}/" 2>/dev/null

log "remote build on Mac"
$SSH "$MAC" 'bash -s' <<'REMOTE' 2>&1 | sed 's/^/  [mac] /'
set -u
export PATH=/opt/homebrew/bin:$PATH
cd ~/holon-mobile-build/apps/mobile || { echo FAIL: no mobile dir; exit 1; }
echo "[1/5] pnpm install"
pnpm install --config.manage-package-manager-versions=false 2>&1 | tail -4 || { echo FAIL-install; exit 1; }
echo "[2/5] next build (capacitor static export)"
NEXT_PUBLIC_CAPACITOR=1 pnpm exec next build 2>&1 | tail -4 || { echo FAIL-next; exit 1; }
echo "[3/5] regen capacitor iOS platform"
rm -rf ios
npx --yes @capacitor/cli@6 add ios  2>&1 | tail -2 || true   # internal pod install fails @13.0 — ignore; Podfile generated
npx --yes @capacitor/cli@6 sync ios 2>&1 | tail -2 || true
echo "[4/5] raise deployment target + pod install"
( cd ios/App && sed -i '' "s/platform :ios, .*/platform :ios, '15.0'/" Podfile && pod install 2>&1 | tail -6 ) || { echo FAIL-pod; exit 1; }
echo "[5/5] xcodebuild simulator (no signing)"
SIM=$(xcrun simctl list devices available | grep -E 'iPhone 16 \(' | head -1 | grep -oE '[A-F0-9-]{36}')
[ -z "$SIM" ] && SIM=$(xcrun simctl list devices available | grep iPhone | head -1 | grep -oE '[A-F0-9-]{36}')
xcrun simctl boot "$SIM" 2>/dev/null || true
xcodebuild -workspace ios/App/App.xcworkspace -scheme App -configuration Debug \
  -destination "platform=iOS Simulator,id=$SIM" -derivedDataPath ios/build \
  CODE_SIGNING_ALLOWED=NO -skipPackagePluginValidation -skipMacroValidation build \
  2>&1 | grep -iE 'error:|BUILD SUCCEEDED|BUILD FAILED' | head -20
if [ -d ios/build/Build/Products/Debug-iphonesimulator/App.app ]; then
  echo "OK · App.app built"
else
  echo "FAIL: App.app not produced"; exit 1
fi
REMOTE
log "done"

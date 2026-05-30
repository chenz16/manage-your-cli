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
#  3. @capacitor-community/text-to-speech was @8 (Cap 8 only, needed iOS >=15)
#     → downgraded to ^5.1.0 (Cap 6 compat, iOS deployment target 13.0).
#     Platform stays at 13.0 (Capacitor default).
set -u
SRC="$(cd "$(dirname "$0")/../.." && pwd)"
MAC="${MAC_SSH_HOST:?MAC_SSH_HOST required}"
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
echo "[4/5] raise deployment target + pod install + ATS exception"
( cd ios/App && sed -i '' "s/platform :ios, .*/platform :ios, '13.0'/" Podfile && pod install 2>&1 | tail -6 ) || { echo FAIL-pod; exit 1; }
# iOS blocks cleartext HTTP by default → app can't reach the http:// LAN desk.
# Add an ATS exception (dev). TECH DEBT: tighten to NSAllowsLocalNetworking +
# exception domains for production / App Store.
PL=ios/App/App/Info.plist
/usr/libexec/PlistBuddy -c "Delete :NSAppTransportSecurity" "$PL" 2>/dev/null
/usr/libexec/PlistBuddy -c "Add :NSAppTransportSecurity dict" "$PL"
/usr/libexec/PlistBuddy -c "Add :NSAppTransportSecurity:NSAllowsArbitraryLoads bool true" "$PL"
echo "ATS: $(/usr/libexec/PlistBuddy -c 'Print :NSAppTransportSecurity:NSAllowsArbitraryLoads' "$PL")"
# Voice input (@capacitor-community/speech-recognition) hard-CRASHES on tap if
# these usage strings are missing — iOS kills the app instead of prompting.
for KEY in NSSpeechRecognitionUsageDescription NSMicrophoneUsageDescription NSCameraUsageDescription; do
  /usr/libexec/PlistBuddy -c "Delete :$KEY" "$PL" 2>/dev/null
done
/usr/libexec/PlistBuddy -c "Add :NSSpeechRecognitionUsageDescription string '微作用语音识别把你说的话转成文字发给小秘。'" "$PL"
/usr/libexec/PlistBuddy -c "Add :NSMicrophoneUsageDescription string '微作需要麦克风来录制你的语音输入。'" "$PL"
# 扫一扫 (getUserMedia video) hard-CRASHES without this camera usage string.
/usr/libexec/PlistBuddy -c "Add :NSCameraUsageDescription string '微作用相机扫码连接其他 AI Agent / 桌面端。'" "$PL"
echo "Speech: $(/usr/libexec/PlistBuddy -c 'Print :NSSpeechRecognitionUsageDescription' "$PL")"
echo "Mic: $(/usr/libexec/PlistBuddy -c 'Print :NSMicrophoneUsageDescription' "$PL")"
echo "Camera: $(/usr/libexec/PlistBuddy -c 'Print :NSCameraUsageDescription' "$PL")"
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

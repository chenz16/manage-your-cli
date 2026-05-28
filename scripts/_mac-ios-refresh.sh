#!/bin/bash
# Runs ON the Mac. Rebuild web bundle (capacitor + desk origin) → cap copy → xcodebuild → reinstall sim → shot.
export PATH=/opt/homebrew/bin:$PATH
cd ~/holon-mobile-build/apps/mobile || exit 1
echo "[next build] $(date +%H:%M:%S)"
NEXT_PUBLIC_CAPACITOR=1 NEXT_PUBLIC_DESK_ORIGIN=http://10.0.0.195:3110 pnpm exec next build 2>&1 | tail -3 || { echo FAIL-next; exit 1; }
echo "[cap copy] $(date +%H:%M:%S)"
npx --yes @capacitor/cli@6 copy ios 2>&1 | tail -2 || { echo FAIL-copy; exit 1; }
SIM=$(xcrun simctl list devices booted | grep iPhone | head -1 | grep -oE '[A-F0-9-]{36}')
[ -z "$SIM" ] && SIM=$(xcrun simctl list devices available | grep -E 'iPhone 16 \(' | head -1 | grep -oE '[A-F0-9-]{36}')
xcrun simctl boot "$SIM" 2>/dev/null || true
echo "[xcodebuild] $(date +%H:%M:%S)"
xcodebuild -workspace ios/App/App.xcworkspace -scheme App -configuration Debug \
  -destination "platform=iOS Simulator,id=$SIM" -derivedDataPath ios/build \
  CODE_SIGNING_ALLOWED=NO -skipPackagePluginValidation -skipMacroValidation build \
  2>&1 | grep -iE 'error:|BUILD SUCCEEDED|BUILD FAILED' | head -8
APP=ios/build/Build/Products/Debug-iphonesimulator/App.app
[ -d "$APP" ] || { echo NO-APP; exit 1; }
xcrun simctl terminate "$SIM" com.holon.mobile 2>/dev/null || true
xcrun simctl install "$SIM" "$APP" && echo installed
xcrun simctl launch "$SIM" com.holon.mobile && echo launched
sleep 4
xcrun simctl io "$SIM" screenshot /tmp/weizo-sim.png && echo shot

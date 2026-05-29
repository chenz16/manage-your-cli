#!/usr/bin/env bash
# ios-testflight-build.sh — full build #N + TestFlight upload pipeline.
# Runs FROM WSL: rsyncs to Mac, then drives xcodebuild+altool over SSH.
#
# Requires: SSH key already authed to zuolinliu@10.0.0.123, app-specific
# password configured in keychain or env. App-specific pwd: wamt-drzr-lnve-pcvx.
set -u
SRC=/home/chenz/project/myc-mobile
MAC="zuolinliu@10.0.0.123"
MD="~/holon-mobile-build"
APPLE_ID="chen.zhang6@gmail.com"
APP_PWD="wamt-drzr-lnve-pcvx"
TEAM="R78Y6F9R6K"
SSH="ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=8"
ts() { date -u +%H:%M:%SZ; }
log() { echo "[ios-tf $(ts)] $*"; }

log "[1/6] rsync source to Mac"
# NOTE: --exclude ios because ios/ is gitignored locally and only exists on
# Mac (Capacitor maintains it). Without this, --delete wipes it and cap sync
# fails with "ios platform has not been added yet".
rsync -az --delete --exclude node_modules --exclude .next --exclude out \
  --exclude ios --exclude android \
  -e "$SSH" "$SRC/apps/mobile/" "${MAC}:${MD}/apps/mobile/" \
  || { log "FAIL rsync mobile"; exit 1; }
for p in api-contract auth core; do
  rsync -az --delete --exclude node_modules --exclude dist \
    -e "$SSH" "$SRC/packages/$p/" "${MAC}:${MD}/packages/$p/" \
    || { log "FAIL rsync $p"; exit 1; }
done
rsync -az -e "$SSH" "$SRC/package.json" "$SRC/pnpm-workspace.yaml" "$SRC/pnpm-lock.yaml" \
  "${MAC}:${MD}/" || { log "FAIL rsync root"; exit 1; }

log "[2/6] pnpm install + web build + cap sync on Mac"
$SSH "$MAC" "cd $MD && pnpm install --config.manage-package-manager-versions=false 2>&1 | tail -20 && \
  cd apps/mobile && pnpm exec next build 2>&1 | tail -10 && \
  pnpm exec cap sync ios 2>&1 | tail -10" || { log "FAIL install/build"; exit 1; }

log "[3/6] bump build number"
NEXT=$($SSH "$MAC" "cd $MD/apps/mobile/ios/App && agvtool next-version -all 2>&1 | grep 'Setting version' | grep -oE '[0-9]+\$'")
log "build number now: $NEXT"

log "[4/6] xcodebuild archive"
$SSH "$MAC" "cd $MD/apps/mobile/ios/App && rm -rf build/App.xcarchive && \
  xcodebuild -workspace App.xcworkspace -scheme App -configuration Release \
    -destination 'generic/platform=iOS' \
    -archivePath build/App.xcarchive \
    DEVELOPMENT_TEAM=$TEAM CODE_SIGN_STYLE=Automatic \
    archive 2>&1 | tail -30" || { log "FAIL archive"; exit 1; }

log "[5/6] exportArchive → .ipa"
$SSH "$MAC" "cat > $MD/apps/mobile/ios/App/ExportOptions.plist <<'PLIST'
<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">
<plist version=\"1.0\">
<dict>
  <key>method</key><string>app-store</string>
  <key>teamID</key><string>$TEAM</string>
  <key>signingStyle</key><string>automatic</string>
  <key>uploadBitcode</key><false/>
  <key>uploadSymbols</key><true/>
</dict>
</plist>
PLIST"
$SSH "$MAC" "cd $MD/apps/mobile/ios/App && rm -rf build/export && \
  xcodebuild -exportArchive \
    -archivePath build/App.xcarchive \
    -exportPath build/export \
    -exportOptionsPlist ExportOptions.plist 2>&1 | tail -15" || { log "FAIL export"; exit 1; }

log "[6/6] altool upload to TestFlight"
$SSH "$MAC" "cd $MD/apps/mobile/ios/App/build/export && IPA=\$(ls *.ipa | head -1) && \
  xcrun altool --upload-app -f \"\$IPA\" -t ios \
    -u $APPLE_ID -p $APP_PWD 2>&1 | tail -10" || { log "FAIL upload"; exit 1; }

log "DONE — build #$NEXT uploaded. Watch for 'Build available' email then add tester in App Store Connect."

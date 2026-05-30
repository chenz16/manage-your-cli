#!/usr/bin/env bash
# ios-direct-push.sh — solo-dev S-tier iteration. Build → development-sign →
# devicectl install over Tailscale-as-LAN. Bypasses TestFlight (no Apple
# processing wait); ~30s end-to-end after first cold pod install.
#
# Pipeline:
#   1. rsync apps/mobile + packages to Mac (excludes ios/, android/ which only
#      live on Mac — Capacitor regenerates ios/ if missing).
#   2. pnpm install + next build + cap sync ios on Mac.
#   3. xcodebuild archive (Release, automatic signing, team $APPLE_TEAM_ID).
#   4. exportArchive method=development (so .ipa is dev-signed, not app-store).
#   5. devicectl install over Tailscale LAN.
#
# Why the keychain unlocks: headless SSH sessions can't pop a GUI prompt for
# the login keychain, and codesign + devicectl both need it unlocked.
set -u
# Required env (developer-only — never commit values to this file):
#   MAC_SSH_HOST            user@host of the Mac that owns Xcode + signing keys
#   APPLE_TEAM_ID           your Apple Developer team id (10-char)
#   IPHONE_DEVICE_UUID      target device's CoreDevice identifier
#   MAC_KEYCHAIN_PWD        login-keychain pwd so xcodebuild can codesign over SSH
#   MAC_BUILD_DIR           remote dir on the Mac for sync'd source
#                           (default: ~/holon-mobile-build)
#   NEXT_PUBLIC_DESK_ORIGIN URL the iPhone bundle should call (your desk's
#                           tailnet/LAN/public origin). Default fallback in
#                           the build step below requires you to set this.
SRC="${SRC:-$(cd "$(dirname "$0")/../.." && pwd)}"
MAC="${MAC_SSH_HOST:?MAC_SSH_HOST is required (e.g. user@10.0.0.x)}"
MD="${MAC_BUILD_DIR:-~/holon-mobile-build}"
TEAM="${APPLE_TEAM_ID:?APPLE_TEAM_ID is required}"
IPHONE="${IPHONE_DEVICE_UUID:?IPHONE_DEVICE_UUID is required}"
MAC_PWD="${MAC_KEYCHAIN_PWD:?MAC_KEYCHAIN_PWD is required}"
SSH="ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=8"
ts() { date -u +%H:%M:%SZ; }
log() { echo "[ios-push $(ts)] $*"; }

# Bake the current git SHA into the SW CACHE_VERSION so each build gets a
# unique cache name → the SW's activate handler purges previous build's
# cached /_next/static, otherwise WKWebView serves yesterday's bundle even
# after a fresh .ipa install (DESK_ORIGIN, JS, all stale).
BUILD_SHA=$(git -C "$SRC" rev-parse --short HEAD)
log "[0/5] bake build SHA $BUILD_SHA into sw.js"
sed -i.bak "s|__BUILD_SHA__|$BUILD_SHA|g" "$SRC/apps/mobile/public/sw.js"
trap "[ -f '$SRC/apps/mobile/public/sw.js.bak' ] && mv '$SRC/apps/mobile/public/sw.js.bak' '$SRC/apps/mobile/public/sw.js'" EXIT

log "[1/5] rsync"
rsync -az --delete --exclude node_modules --exclude .next --exclude out \
  --exclude ios --exclude android -e "$SSH" \
  "$SRC/apps/mobile/" "${MAC}:${MD}/apps/mobile/" || { log FAIL rsync; exit 1; }
for p in api-contract auth core; do
  rsync -az --delete --exclude node_modules --exclude dist -e "$SSH" \
    "$SRC/packages/$p/" "${MAC}:${MD}/packages/$p/" || { log FAIL "rsync $p"; exit 1; }
done
rsync -az -e "$SSH" "$SRC/package.json" "$SRC/pnpm-workspace.yaml" "$SRC/pnpm-lock.yaml" \
  "${MAC}:${MD}/" || { log FAIL "rsync root"; exit 1; }

# CRITICAL: Capacitor static export inlines NEXT_PUBLIC_DESK_ORIGIN at build
# time. Without this, the bundle bakes localhost:3000 and the phone tries to
# reach itself for desk API calls → falls back to last-good cached state and
# silently looks "one build behind". Owner-visible symptom: iPhone shows old
# project / staff list while Android (which bakes the right URL) is correct.
# Use desk's Tailscale IP so the iPhone reaches it over the tailnet.
DESK_ORIGIN="${NEXT_PUBLIC_DESK_ORIGIN:?NEXT_PUBLIC_DESK_ORIGIN is required (e.g. http://your-desk-tailscale-ip:3110)}"
log "[2/5] pnpm install + next build (DESK_ORIGIN=$DESK_ORIGIN) + cap sync"
$SSH "$MAC" "cd $MD && pnpm install --config.manage-package-manager-versions=false 2>&1 | tail -5 && \
  cd apps/mobile && NEXT_PUBLIC_CAPACITOR=1 NEXT_PUBLIC_DESK_ORIGIN=$DESK_ORIGIN pnpm exec next build 2>&1 | tail -3 && \
  pnpm exec cap sync ios 2>&1 | tail -5" || { log FAIL build; exit 1; }

log "[2.5/5] patch Info.plist — allow cleartext HTTP (desk over Tailscale)"
# iOS App Transport Security blocks http:// by default. The desk runs plain
# HTTP over Tailscale's encrypted tunnel, so cleartext at the iOS layer is
# safe. Without this, Holon shows "load failed" even though the bundle and
# DESK_ORIGIN are correct. `cap add ios` regenerates Info.plist from a
# template that has no ATS dict → re-apply on every build.
$SSH "$MAC" "PLIST=$MD/apps/mobile/ios/App/App/Info.plist && \
  /usr/libexec/PlistBuddy -c 'Delete :NSAppTransportSecurity' \"\$PLIST\" 2>/dev/null; \
  /usr/libexec/PlistBuddy -c 'Add :NSAppTransportSecurity dict' \"\$PLIST\" && \
  /usr/libexec/PlistBuddy -c 'Add :NSAppTransportSecurity:NSAllowsArbitraryLoads bool true' \"\$PLIST\"" \
  || { log FAIL ats-patch; exit 1; }

log "[3/5] archive (auto-sign, team $TEAM)"
$SSH "$MAC" "security unlock-keychain -p $MAC_PWD ~/Library/Keychains/login.keychain-db && \
  cd $MD/apps/mobile/ios/App && rm -rf build/App.xcarchive && \
  xcodebuild -workspace App.xcworkspace -scheme App -configuration Release \
    -destination 'generic/platform=iOS' \
    -archivePath build/App.xcarchive \
    DEVELOPMENT_TEAM=$TEAM CODE_SIGN_STYLE=Automatic \
    -allowProvisioningUpdates archive 2>&1 | tail -5" || { log FAIL archive; exit 1; }

log "[4/5] export development-signed ipa"
$SSH "$MAC" "cd $MD/apps/mobile/ios/App && cat > ExportOptionsDev.plist <<'PLIST'
<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">
<plist version=\"1.0\">
<dict>
  <key>method</key><string>development</string>
  <key>teamID</key><string>$TEAM</string>
  <key>signingStyle</key><string>automatic</string>
  <key>stripSwiftSymbols</key><true/>
</dict>
</plist>
PLIST"
$SSH "$MAC" "security unlock-keychain -p $MAC_PWD ~/Library/Keychains/login.keychain-db && \
  cd $MD/apps/mobile/ios/App && rm -rf build/export-dev && \
  xcodebuild -exportArchive -archivePath build/App.xcarchive \
    -exportPath build/export-dev -exportOptionsPlist ExportOptionsDev.plist \
    -allowProvisioningUpdates 2>&1 | tail -5" || { log FAIL export; exit 1; }

log "[5/5] devicectl install to iPhone over Tailscale LAN"
# `tail` would swallow xcrun's non-zero exit. Use grep -q on success marker.
INSTALL_OUT=$($SSH "$MAC" "security unlock-keychain -p $MAC_PWD ~/Library/Keychains/login.keychain-db && \
  xcrun devicectl device install app --device $IPHONE \
    $MD/apps/mobile/ios/App/build/export-dev/App.ipa 2>&1")
echo "$INSTALL_OUT" | tail -5
if echo "$INSTALL_OUT" | grep -q "App installed:"; then
  log "DONE — Holon updated on iPhone."
else
  log "FAIL devicectl — iPhone unreachable or install rejected. ipa is at $MD/apps/mobile/ios/App/build/export-dev/App.ipa on Mac; retry once Tailscale path to iPhone is stable."
  exit 1
fi

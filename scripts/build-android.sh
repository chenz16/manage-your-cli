#!/usr/bin/env bash
# build-android.sh — repeatable Android APK build for Holon mobile.
#
# Proven 2026-05-18: bypasses Android Studio GUI entirely. Uses:
#   - Linux JDK 21 (Microsoft OpenJDK) at ~/.local/jdk/jdk-21.0.11+10
#   - Windows-side Android SDK at /mnt/c/Users/<user>/AppData/Local/Android/Sdk
#     (winget'd Android Studio populated it: platforms/android-36.1,
#     build-tools/36.1.0+37.0.0, platform-tools, accepted licenses)
#   - Capacitor 6 deps from apps/mobile/package.json
#   - npx cap add/sync android writes apps/mobile/android/ (gitignored)
#   - Linux gradlew (the wrapper script) calls Linux JDK + Windows SDK paths
#
# Output: apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk
# Time: ~10 min cold build, ~2 min incremental.

set -u
MOBILE_REPO=/home/chenz/project/holon-engineering-mobile
APP_DIR="$MOBILE_REPO/apps/mobile"
JDK="${JDK_PATH:-$HOME/.local/jdk/jdk-21.0.11+10}"
ANDROID_SDK="${ANDROID_SDK_PATH:-/mnt/c/Users/$USER/AppData/Local/Android/Sdk}"

ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }
log() { echo "[build-android $(ts)] $*"; }

# Pre-flight: verify JDK + SDK presence
if [ ! -x "$JDK/bin/java" ]; then
  log "FAIL: JDK not found at $JDK · run: mkdir -p ~/.local/jdk && curl -sL https://aka.ms/download-jdk/microsoft-jdk-21-linux-x64.tar.gz | tar -xz -C ~/.local/jdk"
  exit 1
fi
if [ ! -d "$ANDROID_SDK/platforms" ]; then
  log "FAIL: Android SDK not at $ANDROID_SDK/platforms · winget install Google.AndroidStudio (Windows-side)"
  exit 1
fi

export JAVA_HOME="$JDK"
export PATH="$JDK/bin:$PATH"
export ANDROID_HOME="$ANDROID_SDK"
export ANDROID_SDK_ROOT="$ANDROID_SDK"

cd "$APP_DIR" || { log "FAIL: $APP_DIR not found"; exit 1; }

log "1/5 next build (static export for Capacitor)"
# M-L-046 — the Capacitor static export inlines NEXT_PUBLIC_DESK_ORIGIN at
# build time (deskOrigin(), apps/mobile/app/_lib/desk-origin.ts). With it unset
# the localhost:3000 fallback is baked into the APK and every desk call hits the
# phone itself — a silently-broken install (Engineering Rule #4). Require it;
# the host is the owner's call, supplied at build time, never hardcoded (Rule #11).
if [ -z "${NEXT_PUBLIC_DESK_ORIGIN:-}" ]; then
  log "FAIL: NEXT_PUBLIC_DESK_ORIGIN unset · APK would inline the localhost:3000 fallback and every desk call would hit the phone. Re-run as: NEXT_PUBLIC_DESK_ORIGIN=https://<desk-host> $0"
  exit 1
fi
NEXT_PUBLIC_CAPACITOR=1 NEXT_PUBLIC_DESK_ORIGIN="$NEXT_PUBLIC_DESK_ORIGIN" pnpm exec next build 2>&1 | tail -5
if [ ! -d "out" ]; then
  log "FAIL: next build did not produce out/ directory"
  exit 1
fi

if [ ! -d "android" ]; then
  log "2/5 capacitor adding Android platform (first time)"
  npx cap add android 2>&1 | tail -5 || { log "FAIL: cap add android"; exit 1; }
else
  log "2/5 capacitor sync Android (platform already added)"
  npx cap sync android 2>&1 | tail -5 || { log "FAIL: cap sync android"; exit 1; }
fi

# Regenerate icon + splash from resources/ (Crown brand, M-L-015).
# Capacitor default placeholder otherwise. Output overwrites
# android/app/src/main/res/mipmap-* (gitignored).
if [ -f "$APP_DIR/resources/icon.svg" ]; then
  log "2.5/5 @capacitor/assets generate (icon + splash from resources/)"
  npx @capacitor/assets generate --android \
    --iconBackgroundColor "#F8F6EF" \
    --splashBackgroundColor "#F8F6EF" 2>&1 | tail -5 \
    || { log "FAIL: @capacitor/assets generate"; exit 1; }
fi

log "3/5 gradlew assembleDebug (cold ~10min, incremental ~2min)"
cd "$APP_DIR/android" || { log "FAIL: android/ missing"; exit 1; }
echo "sdk.dir=$ANDROID_SDK" > local.properties
./gradlew assembleDebug --no-daemon 2>&1 | tail -10
gradle_rc=${PIPESTATUS[0]}
if [ "$gradle_rc" != "0" ]; then
  log "FAIL: gradle assembleDebug exit $gradle_rc"
  exit 1
fi

APK="$APP_DIR/android/app/build/outputs/apk/debug/app-debug.apk"
if [ ! -f "$APK" ]; then
  log "FAIL: APK not produced at $APK"
  exit 1
fi
size=$(du -h "$APK" | cut -f1)
log "4/5 ✓ APK ready: $APK ($size)"
log "Install on a connected Android device or emulator:"
log "  $ANDROID_SDK/platform-tools/adb.exe install -r '$APK'"
exit 0

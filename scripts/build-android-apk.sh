#!/usr/bin/env bash
# build-android-apk.sh — reproducible Android APK build for Holon mobile V1.
#
# Builds a sideload-ready debug APK from a clean tree. Strict mode: any
# step failure aborts (next build, cap sync, gradle assembleDebug) — no
# silent fallback to a stale apps/mobile/out/. Outputs the APK to
# dist/holon-mobile-debug-{versionName}-{shortSha}.apk for easy download
# + sideload.
#
# Two-environment matrix (both tested 2026-05-18):
#   1. WSL2 + Windows Android SDK
#      - JDK:  ~/.local/jdk/jdk-21.0.11+10 (Microsoft OpenJDK 21)
#      - SDK:  /mnt/c/Users/$USER/AppData/Local/Android/Sdk
#              (winget'd Android Studio populated platforms/android-36.1,
#              build-tools/36.1.0, platform-tools, accepted licenses)
#   2. Linux CI (.github/workflows/android-apk.yml)
#      - JDK:  actions/setup-java@v4 (zulu 17 — Capacitor 6.x baseline)
#      - SDK:  android-actions/setup-android@v3
#      - JDK_PATH + ANDROID_SDK_PATH env vars override the WSL2 defaults
#
# Usage:
#   scripts/build-android-apk.sh                  # debug APK (default)
#   JDK_PATH=/custom/jdk scripts/build-android-apk.sh
#   ANDROID_SDK_PATH=/custom/sdk scripts/build-android-apk.sh
#
# Release-signed APK is V1.1 scope (needs keystore + ADR). Debug APK
# sideloads fine on real devices — shows "unsigned" warning on first
# install, then runs identically.
#
# Time: ~3 min cold next-build, ~10 min cold gradle, ~2 min gradle incremental.

set -euo pipefail

MOBILE_REPO="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="$MOBILE_REPO/apps/mobile"
DIST_DIR="$MOBILE_REPO/dist"
JDK="${JDK_PATH:-$HOME/.local/jdk/jdk-21.0.11+10}"
ANDROID_SDK="${ANDROID_SDK_PATH:-/mnt/c/Users/$USER/AppData/Local/Android/Sdk}"

ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }
log() { echo "[build-android-apk $(ts)] $*"; }
fail() { log "FAIL: $*"; exit 1; }

# ---------- 0/6 · pre-flight checks ----------
log "0/6 pre-flight"

# JDK presence (Capacitor 6.x requires Java 17+; we ship 21 to match local).
if [ ! -x "$JDK/bin/java" ]; then
  fail "JDK not found at $JDK
  Install (WSL2): mkdir -p ~/.local/jdk && curl -sL https://aka.ms/download-jdk/microsoft-jdk-21-linux-x64.tar.gz | tar -xz -C ~/.local/jdk
  Or override:    JDK_PATH=/path/to/jdk $0"
fi
jdk_ver="$("$JDK/bin/java" -version 2>&1 | head -1)"
log "  JDK: $jdk_ver"

# Android SDK presence (must have platforms + build-tools + platform-tools).
if [ ! -d "$ANDROID_SDK/platforms" ]; then
  fail "Android SDK not at $ANDROID_SDK/platforms
  Install (WSL2): winget install Google.AndroidStudio (Windows side) — first launch populates the SDK
  Or override:    ANDROID_SDK_PATH=/path/to/sdk $0"
fi
log "  SDK: $ANDROID_SDK"

# pnpm + node sanity (mobile build needs the workspace).
command -v pnpm >/dev/null 2>&1 || fail "pnpm not on PATH"
[ -d "$APP_DIR" ] || fail "mobile app dir missing: $APP_DIR"

# Capture short SHA + version metadata for the output APK filename.
short_sha="$(git -C "$MOBILE_REPO" rev-parse --short HEAD 2>/dev/null || echo nogit)"
version_name="$(grep -oP 'versionName "\K[^"]+' "$APP_DIR/android/app/build.gradle" 2>/dev/null || echo 0.0.0)"
log "  sha: $short_sha · version: $version_name"

export JAVA_HOME="$JDK"
export PATH="$JDK/bin:$PATH"
export ANDROID_HOME="$ANDROID_SDK"
export ANDROID_SDK_ROOT="$ANDROID_SDK"

# ---------- 1/6 · next build (static export for Capacitor) ----------
log "1/6 next build (NEXT_PUBLIC_CAPACITOR=1 → static export to apps/mobile/out/)"
cd "$APP_DIR"
# M-L-046 — a Capacitor static export inlines NEXT_PUBLIC_DESK_ORIGIN at build
# time (deskOrigin(), apps/mobile/app/_lib/desk-origin.ts). With it unset the
# fallback localhost:3000 gets baked into the APK and every desk call resolves
# to the phone itself — a silently-broken install (Engineering Rule #4).
# Require it explicitly; the host is the owner's call, supplied at build time,
# never hardcoded here (Rule #11).
[ -n "${NEXT_PUBLIC_DESK_ORIGIN:-}" ] || fail "NEXT_PUBLIC_DESK_ORIGIN unset · the APK would inline the localhost:3000 fallback and every desk call would hit the phone. Re-run as: NEXT_PUBLIC_DESK_ORIGIN=https://<desk-host> $0"
# Clean out/ so a partial/stale build cannot mask a real failure (was the
# 2026-05-18 silent-fallback bug in scripts/build-android.sh).
rm -rf out
# Stamp the build so the 我 tab can show exactly which APK is installed (owner asked
# to verify the right build is on the phone). SHA from git; date in local YYYY-MM-DD.
BUILD_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
BUILD_DATE="$(date +%Y-%m-%d)"
log "stamping build: sha=$BUILD_SHA date=$BUILD_DATE"
NEXT_PUBLIC_CAPACITOR=1 NEXT_PUBLIC_DESK_ORIGIN="$NEXT_PUBLIC_DESK_ORIGIN" \
  NEXT_PUBLIC_BUILD_SHA="$BUILD_SHA" NEXT_PUBLIC_BUILD_DATE="$BUILD_DATE" \
  pnpm exec next build 2>&1 | tail -8
[ -d out ] || fail "next build did not produce apps/mobile/out/ · static export config is broken (commonly: a dynamic [param] route is missing generateStaticParams)"

# ---------- 2/6 · capacitor sync ----------
if [ ! -d "$APP_DIR/android" ]; then
  log "2/6 cap add android (first time — populates android/ scaffold)"
  npx cap add android 2>&1 | tail -5 || fail "cap add android"
else
  log "2/6 cap sync android (platform already added)"
  npx cap sync android 2>&1 | tail -5 || fail "cap sync android"
fi

# ---------- 2.5/6 · patch AndroidManifest.xml (CAMERA + RECORD_AUDIO) ----------
# Idempotent: each permission is inserted only if not already present.
# Insert right before the first <application line so the XML remains valid.
MANIFEST="$APP_DIR/android/app/src/main/AndroidManifest.xml"
[ -f "$MANIFEST" ] || fail "AndroidManifest.xml not found at $MANIFEST (cap add/sync must have failed)"

log "2.5/6 patching AndroidManifest.xml — camera + audio permissions"

patch_manifest_line() {
  local line="$1"
  if ! grep -qF "$line" "$MANIFEST"; then
    # Insert the line immediately before the first <application line.
    sed -i "/<application/i\\    $line" "$MANIFEST"
    log "  inserted: $line"
  else
    log "  already present: $line"
  fi
}

patch_manifest_line '<uses-permission android:name="android.permission.CAMERA" />'
patch_manifest_line '<uses-permission android:name="android.permission.RECORD_AUDIO" />'
# Capacitor's WebChromeClient.onPermissionRequest grants WebView AUDIO_CAPTURE
# (getUserMedia audio) only when BOTH RECORD_AUDIO and MODIFY_AUDIO_SETTINGS are
# held. Without this, mic is granted at the OS level but getUserMedia still throws
# NotAllowedError. Required for the 微作 voice-input button.
patch_manifest_line '<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />'
patch_manifest_line '<uses-feature android:name="android.hardware.camera" android:required="false" />'

# Android 11 (API 30) package-visibility rules: apps must declare a <queries>
# intent-filter for any implicit intent they fire. The
# @capacitor-community/speech-recognition plugin starts the system recognizer
# via ACTION_RECOGNIZE_SPEECH. Without this <queries> block the PackageManager
# returns "no recognizer" on Android 11+ and plugin.available() returns false.
#
# Idempotent: only inserts if the block is not already present.
# Inserted before </manifest> (safe regardless of whether <queries> already
# exists — the block is self-contained).
log "2.5/6 patching AndroidManifest.xml — speech recognizer queries block"
if ! grep -q 'RECOGNIZE_SPEECH' "$MANIFEST"; then
  # Insert a <queries> block before the closing </manifest> tag.
  sed -i 's|</manifest>|    <queries>\n        <intent>\n            <action android:name="android.speech.RecognitionService" />\n        </intent>\n        <intent>\n            <action android:name="android.speech.action.RECOGNIZE_SPEECH" />\n        </intent>\n    </queries>\n</manifest>|' "$MANIFEST"
  grep -q 'RECOGNIZE_SPEECH' "$MANIFEST" \
    || fail "speech recognizer queries block did not take — check sed invocation"
  log "  inserted: <queries> RECOGNIZE_SPEECH block"
else
  log "  already present: RECOGNIZE_SPEECH in <queries>"
fi

# Patch android:usesCleartextTraffic="true" into the <application> tag so
# CapacitorHttp native requests to http:// (LAN desk) are not blocked by
# Android's cleartext-traffic policy. Idempotent: only adds if not present.
log "2.5/6 patching AndroidManifest.xml — usesCleartextTraffic"
if ! grep -q 'usesCleartextTraffic' "$MANIFEST"; then
  # Capacitor scaffolds the tag as `<application` alone on its own (indented)
  # line with attributes on the following lines. Insert the attribute right
  # after `<application` on that line. SINGLE substitution only — a second
  # cascading `s/<application /.../` would re-match the space this one adds and
  # duplicate the attribute (invalid XML → manifest-merge build failure).
  sed -i -E 's/^([[:space:]]*)<application[[:space:]]*$/\1<application android:usesCleartextTraffic="true"/' "$MANIFEST"
  grep -q 'usesCleartextTraffic' "$MANIFEST" \
    || fail "usesCleartextTraffic patch did not take — check sed invocation"
  log "  inserted: android:usesCleartextTraffic=\"true\""
else
  log "  already present: android:usesCleartextTraffic"
fi

# Patch android:windowSoftInputMode="adjustResize" on the MainActivity <activity>
# tag so the Android WebView (and thus the visual viewport) shrinks when the
# soft keyboard opens. Without this the keyboard overlays the chat composer and
# env(keyboard-inset-height) / visualViewport.height stay wrong.
# Idempotent: only patches if windowSoftInputMode is not already set.
log "2.5/6 patching AndroidManifest.xml — windowSoftInputMode=adjustResize"
if ! grep -q 'windowSoftInputMode' "$MANIFEST"; then
  # Capacitor scaffolds the <activity> tag MULTI-LINE (tag name on its own line,
  # each attribute on a following line), so a single-line `<activity ...name=...`
  # match fails. Instead append the attribute as a new line right AFTER the
  # MainActivity android:name= line (which is unique to MainActivity).
  sed -i '/android:name="[^"]*MainActivity"/a\            android:windowSoftInputMode="adjustResize"' "$MANIFEST" \
    || fail "windowSoftInputMode sed failed"
  grep -q 'windowSoftInputMode' "$MANIFEST" \
    || fail "windowSoftInputMode patch did not take — check sed invocation"
  log "  inserted: android:windowSoftInputMode=\"adjustResize\""
else
  log "  already present: android:windowSoftInputMode"
fi

# Hard verification — build must not proceed without the permission.
grep -q 'android.permission.CAMERA' "$MANIFEST" \
  || fail "CAMERA permission still absent in $MANIFEST after patching — check sed invocation"
log "  manifest verified: CAMERA present"

# ---------- 2.6/6 · bump Gradle wrapper to 8.9 (JDK-21 / BouncyCastle 1.79 compat) ----------
# Capacitor scaffolds gradle-8.2.1 which fails with "Unsupported class file major
# version 65" when BouncyCastle 1.79 (pulled by the TTS plugin) is on the classpath
# under JDK 21. Gradle 8.9 resolves this. Patch is idempotent: only rewrite if the
# version is not already 8.9.
GRADLE_WRAPPER="$APP_DIR/android/gradle/wrapper/gradle-wrapper.properties"
[ -f "$GRADLE_WRAPPER" ] || fail "gradle-wrapper.properties not found at $GRADLE_WRAPPER"

if grep -q 'gradle-8\.9-' "$GRADLE_WRAPPER"; then
  log "2.6/6 Gradle wrapper already at 8.9 — no change needed"
else
  log "2.6/6 bumping Gradle wrapper to 8.9"
  sed -i 's|distributionUrl=.*|distributionUrl=https\\://services.gradle.org/distributions/gradle-8.9-all.zip|' \
    "$GRADLE_WRAPPER"
  grep -q 'gradle-8\.9-' "$GRADLE_WRAPPER" \
    || fail "Gradle wrapper bump to 8.9 did not take — check sed invocation"
  log "  gradle-wrapper.properties distributionUrl → gradle-8.9-all.zip"
fi

# ---------- 3/6 · assets (icon + splash from resources/) ----------
if [ -f "$APP_DIR/resources/icon.svg" ]; then
  log "3/6 @capacitor/assets generate (icon + splash from resources/)"
  npx @capacitor/assets generate --android \
    --iconBackgroundColor "#F8F6EF" \
    --splashBackgroundColor "#F8F6EF" 2>&1 | tail -3 \
    || fail "@capacitor/assets generate"
else
  log "3/6 SKIP: resources/icon.svg missing — using Capacitor default icon"
fi

# ---------- 4/6 · gradle assembleDebug ----------
log "4/6 gradlew assembleDebug (cold ~10min, incremental ~2min)"
cd "$APP_DIR/android"
echo "sdk.dir=$ANDROID_SDK" > local.properties
./gradlew assembleDebug --no-daemon 2>&1 | tail -10
APK_SRC="$APP_DIR/android/app/build/outputs/apk/debug/app-debug.apk"
[ -f "$APK_SRC" ] || fail "APK not produced at $APK_SRC (gradle reported success but no file)"

# ---------- 5/6 · copy to dist/ with versioned filename ----------
mkdir -p "$DIST_DIR"
APK_OUT="$DIST_DIR/holon-mobile-debug-${version_name}-${short_sha}.apk"
cp "$APK_SRC" "$APK_OUT"
size_h="$(du -h "$APK_OUT" | cut -f1)"
size_b="$(stat -c %s "$APK_OUT" 2>/dev/null || wc -c < "$APK_OUT")"
log "5/6 APK copied: $APK_OUT ($size_h · ${size_b} bytes)"

# ---------- 6/6 · install instructions ----------
log "6/6 DONE · APK ready"
cat <<EOF

  ============================================
    APK:  $APK_OUT
    Size: $size_h
    AppID: com.holon.mobile · version $version_name ($short_sha)
  ============================================

  Install on an Android device:

  A. USB (developer mode on, USB debugging on):
       $ANDROID_SDK/platform-tools/adb.exe install -r '$APK_OUT'

  B. Sideload (no USB):
       1. Copy the APK to the phone (email / WeChat / file-share)
       2. Phone Settings → Security → "Install unknown apps" → allow your
          file-manager or browser (one-time)
       3. Tap the APK in the file-manager → Install → Open
       4. Confirm bundle ID: com.holon.mobile

  Smoke checklist: see docs/install/android.md

EOF

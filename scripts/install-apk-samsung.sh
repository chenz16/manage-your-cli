#!/usr/bin/env bash
# install-apk-samsung.sh — push the Weizo (微作) debug APK straight onto a
# USB-connected Samsung (or any Android) phone from WSL.
#
# Why a script (not a bare adb line): the phone is plugged into *Windows*, so
# WSL2's own adb can't see USB — we must call the *Windows* adb.exe (it owns the
# USB stack). This wraps that + device detection + clear "what to fix" errors.
#
# Usage:
#   scripts/install-apk-samsung.sh                 # installs dist/weizo-mobile-debug-current.apk
#   scripts/install-apk-samsung.sh path/to.apk     # installs a specific APK
#   LAUNCH=1 scripts/install-apk-samsung.sh         # also launch the app after install
#
# Prereqs on the phone (one-time):
#   Settings → About phone → tap "Build number" 7× → Developer options ON
#   Settings → Developer options → "USB debugging" ON
#   Plug into the PC via USB → on the phone tap "Allow" on the RSA fingerprint prompt
#
# Wireless alternative (no USB cable): see the WIRELESS note printed on no-device.

set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
ADB="${ADB:-/mnt/c/Users/$USER/AppData/Local/Android/Sdk/platform-tools/adb.exe}"
APP_ID="com.holon.mobile"

# Resolve the APK: arg > newest dist/*.apk > staged current.apk.
APK="${1:-}"
if [ -z "$APK" ]; then
  APK="$(ls -t "$REPO"/dist/*.apk 2>/dev/null | head -1 || true)"
fi
[ -n "$APK" ] && [ -f "$APK" ] || {
  echo "FAIL: no APK found."
  echo "  Pass one explicitly:  $0 path/to/app-debug.apk"
  echo "  Or build one:          NEXT_PUBLIC_DESK_ORIGIN=http://100.105.92.4:3006 scripts/build-android-apk.sh"
  exit 1
}

[ -x "$ADB" ] || {
  echo "FAIL: Windows adb.exe not found at: $ADB"
  echo "  Override with:  ADB=/path/to/adb.exe $0"
  exit 1
}

echo "== APK:  $APK ($(du -h "$APK" | cut -f1))"
echo "== adb:  $ADB"

# adb.exe wants a Windows path for the APK arg; translate if wslpath exists.
APK_WIN="$APK"
command -v wslpath >/dev/null 2>&1 && APK_WIN="$(wslpath -w "$APK")"

# --- device check ---
"$ADB" start-server >/dev/null 2>&1 || true
DEVLINES="$("$ADB" devices | sed '1d' | grep -E '\sdevice$' || true)"
if [ -z "$DEVLINES" ]; then
  cat <<EOF

FAIL: no authorized device detected by adb.

  Fix (USB):
    1. Phone: Settings → About phone → tap "Build number" 7× (enables Developer options)
    2. Phone: Settings → Developer options → turn ON "USB debugging"
    3. Plug the phone into this PC via USB
    4. On the phone, tap "Allow" on the "Allow USB debugging?" prompt
    5. Re-run:  $0

  WIRELESS alternative (Android 11+, no cable):
    Phone: Developer options → "Wireless debugging" → "Pair device with pairing code"
      $ADB pair <phone-ip>:<pair-port>     # enter the 6-digit code shown
      $ADB connect <phone-ip>:<debug-port>
    then re-run this script.

  ($("$ADB" devices | sed '1d' | tr -s ' ' || echo 'devices list empty'))
EOF
  exit 1
fi

DEVCOUNT="$(echo "$DEVLINES" | wc -l)"
echo "== device(s): "; echo "$DEVLINES" | sed 's/^/     /'
SERIAL_ARG=()
if [ "$DEVCOUNT" -gt 1 ]; then
  FIRST="$(echo "$DEVLINES" | head -1 | awk '{print $1}')"
  echo "== multiple devices; targeting first: $FIRST  (override: ADB_SERIAL=... )"
  SERIAL_ARG=(-s "${ADB_SERIAL:-$FIRST}")
fi

# --- install ---
echo "== installing (reinstall, keep data)…"
"$ADB" "${SERIAL_ARG[@]}" install -r "$APK_WIN"

echo "== installed: $APP_ID"
if [ "${LAUNCH:-0}" = "1" ]; then
  echo "== launching…"
  "$ADB" "${SERIAL_ARG[@]}" shell monkey -p "$APP_ID" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 \
    && echo "== launched" || echo "(launch failed — open 微作 manually)"
fi

cat <<EOF

DONE. Open 微作 on the phone, then pair to the desk:
  桌面端地址:  http://100.105.92.4:3006     (Tailscale IP — phone must be on the same tailnet)
  配对码:      from desk → /connectors → Connect Phone → 开始配对
EOF

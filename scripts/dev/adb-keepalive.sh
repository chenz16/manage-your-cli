#!/usr/bin/env bash
# Keep the wireless-adb link to the Samsung alive 7×24. Re-connects every 30s.
ADB=/mnt/c/Users/chenz/AppData/Local/Android/Sdk/platform-tools/adb.exe
TARGET="${1:-10.0.0.225:5555}"
while true; do
  state=$("$ADB" -s "$TARGET" get-state 2>/dev/null)
  if [ "$state" != "device" ]; then
    "$ADB" connect "$TARGET" >/dev/null 2>&1
  fi
  sleep 30
done

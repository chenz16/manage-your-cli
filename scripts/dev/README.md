# scripts/dev — developer-only iOS / Mac / Android pipelines

These scripts are NOT part of the user release. They're for the maintainer
to build and push debug builds to physical devices over a tailnet/LAN.

## What lives here

| Script | What it does |
| --- | --- |
| `ios-direct-push.sh` | Build → development-sign → `devicectl install` to a paired iPhone over Tailscale (or LAN). 30s closed loop. |
| `ios-testflight-build.sh` | Same archive, but `method=app-store` export + `xcrun altool` upload to TestFlight (slow, public-distribution path). |
| `ios-build-mac.sh` | Simulator-only build of the mobile app on the maintainer's Mac via SSH. |
| `_mac-ios-refresh.sh` | The on-Mac half of `ios-build-mac.sh`. Driven over SSH; not invoked directly. |
| `mobile-ios-gate.sh` | Smoke-gate the iOS pipeline (`./scripts/dev/mobile-ios-gate.sh`) before promoting. |
| `mobile-status.sh` | Status board for the iOS + Android pipelines. |
| `adb-keepalive.sh` | Reconnect `adb` to a network-connected Android device when the link drops. |

## Required environment

Set these before running any iOS/Mac script. The scripts hard-fail with a
clear `?required` message if missing.

```bash
# Mac side (one box with Xcode + your signing keys)
export MAC_SSH_HOST=user@10.0.0.x          # the maintainer Mac
export MAC_KEYCHAIN_PWD=...                # login.keychain pwd (so headless
                                            # codesign / devicectl can unlock)
export MAC_BUILD_DIR=~/holon-mobile-build  # remote source dir, optional

# Apple Developer Program
export APPLE_TEAM_ID=ABCDE12345            # 10-char team id
export APPLE_ID=you@example.com            # only for TestFlight upload
export APPLE_APP_SPECIFIC_PWD=xxxx-xxxx-xxxx-xxxx
  # appleid.apple.com → "App-Specific Passwords" → generate one

# Target device (for direct push)
export IPHONE_DEVICE_UUID=01234567-89AB-CDEF-...
  # see: xcrun devicectl list devices

# Mobile bundle target URL (NEXT_PUBLIC_* are baked at build time)
export NEXT_PUBLIC_DESK_ORIGIN=http://your-desk-ip:3110
```

## SSH setup

The Mac box must accept SSH from your build box without a password prompt:

```bash
# from your build box, copy your pub key to the Mac
ssh-copy-id "$MAC_SSH_HOST"
```

## Apple Developer Program — required for both direct push AND TestFlight

A free Apple ID alone cannot sign apps that run >7 days on a device. The
$99/year Developer Program gives you:

- Proper development certificates (1-year validity)
- A Team ID (the `APPLE_TEAM_ID` you set above)
- TestFlight access for sharing builds to other testers

Set up the team and bundle id (`com.holon.mobile` by default in
`apps/mobile/capacitor.config.ts`) once at developer.apple.com →
"Certificates, Identifiers & Profiles".

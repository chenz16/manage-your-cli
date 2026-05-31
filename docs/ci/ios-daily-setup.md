# iOS daily-build job — enabling guide

The `macos-ios` job in `.github/workflows/daily-build.yml` is currently
**disabled** via `if: false`. This doc is the runbook for owner to wire the
four Apple secrets the job needs, then flip it on.

Why disabled at slice 1: Tauri + Android need no extra secrets, but iOS
signing requires a developer cert + provisioning profile that only the owner
can export from the Mac. Rather than blocking the whole pipeline waiting on
that, slice 1 ships desk + Android live and keeps iOS as a tested-but-dormant
scaffold.

## What you'll need

- The `holon-build` keychain on the Mac (already set up; holds the Apple
  Developer cert + private key).
- Access to https://developer.apple.com → Certificates, Identifiers & Profiles.
- `APPLE_TEAM_ID = R78Y6F9R6K` (known; safe to embed).

## Step 1 — Export the developer certificate as a .p12

On the Mac:

```bash
# Identify the cert (look for "Apple Development: <your name>")
security find-identity -v -p codesigning ~/Library/Keychains/holon-build.keychain-db

# Export (Keychain Access GUI is easier — File ▸ Export Items ▸ .p12 ▸ set password).
# Or via CLI (needs the keychain unlocked):
security export -k ~/Library/Keychains/holon-build.keychain-db \
  -t identities -f pkcs12 -P 'CHOOSE_A_STRONG_PASSWORD' \
  -o ~/Downloads/holon-ios-dev-cert.p12
```

Then base64-encode for the secret value:

```bash
base64 -i ~/Downloads/holon-ios-dev-cert.p12 | pbcopy
# (clipboard now has the base64 blob; paste it into the GitHub secret)
```

## Step 2 — Download / generate the provisioning profile

Either:

- **Easier**: open Xcode → Preferences → Accounts → Download Manual Profiles,
  then grab the relevant `.mobileprovision` from
  `~/Library/MobileDevice/Provisioning Profiles/`.
- **Web**: https://developer.apple.com/account/resources/profiles/list →
  create or download an existing **Development** profile that matches the
  `com.holon.mobile` app ID (or whatever bundle id `apps/mobile/ios/App` uses).

Base64 it:

```bash
base64 -i ~/Library/MobileDevice/Provisioning\ Profiles/holon-nightly.mobileprovision | pbcopy
```

## Step 3 — Add the four secrets

In GitHub: repo → Settings → Secrets and variables → Actions → New repository secret.

| Secret name                    | Value                                                       |
| ------------------------------ | ----------------------------------------------------------- |
| `APPLE_DEV_CERT_P12`           | base64 blob from Step 1                                     |
| `APPLE_DEV_CERT_PWD`           | the `CHOOSE_A_STRONG_PASSWORD` you set in Step 1            |
| `PROVISIONING_PROFILE_BASE64`  | base64 blob from Step 2                                     |
| `APPLE_TEAM_ID`                | `R78Y6F9R6K`                                                |

## Step 4 — Flip the workflow on

Edit `.github/workflows/daily-build.yml`, find the `macos-ios:` job, and
change:

```yaml
    if: false   # DISABLED — see docs/ci/ios-daily-setup.md to enable
```

to:

```yaml
    if: ${{ always() }}   # parallel with windows/android, runs even if prepare-release-only
```

Commit on a branch + PR + merge. Next 06:00 UTC cron tick will build + upload
`holon-mobile-nightly.ipa` to the rolling `nightly` release.

## Step 5 — Verify

Trigger manually first instead of waiting for cron:

```bash
gh workflow run daily-build.yml --ref main
gh run watch
```

The `nightly` release should now show three artifacts:

- `Holon_*_x64-setup.exe`
- `holon-mobile-nightly.apk`
- `holon-mobile-nightly.ipa`  ← new

## Rotating / revoking

- Cert expires → re-export from Mac (Step 1), update `APPLE_DEV_CERT_P12`.
- Profile expires (~1 year on dev profiles) → re-download (Step 2), update
  `PROVISIONING_PROFILE_BASE64`.
- Lost / compromised → revoke the cert in developer.apple.com, then redo
  Steps 1 + 3.

## What this scaffold does NOT do (yet)

- **Distribution profile / App Store upload.** The export plist uses
  `method=development` → the .ipa is sideload-only via Xcode/Apple Configurator,
  matching the Android debug-APK posture. App Store / TestFlight is V1.1 work
  (needs an App Store Connect API key + a separate distribution profile).
- **Automatic re-keying.** When the cert or profile rotates, owner must
  re-upload the secret manually. fastlane match would automate this but adds
  an OSS dep + a private repo for the match storage — defer until daily-build
  has been running for a quarter.

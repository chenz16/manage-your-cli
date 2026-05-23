# Install Holon on your Android phone (APK — 5 minutes)

This is the Android install guide for Holon Personal Edition V1. You
install it as a native APK sideload — no Play Store listing, no Google
developer account, no review queue. The APK is a thin Capacitor wrapper
around the same mobile UI that ships as the iPhone PWA.

> **Why APK, not Play Store?** V1 ships fast and is locally hosted by
> your PC; a Play Store listing adds 1-2 weeks of review + developer-
> account friction with no V1 user benefit. An APK is a 30-second
> install and updates as a fresh APK download. Play Store ship is V2
> work once cloud-relay lands.

> **China primary target.** Per user 2026-05-18, Android is the primary
> Holon mobile target (iPhone is the secondary). This doc is the V1
> primary install path; `docs/install/iphone-pwa.md` is the secondary.

---

## Before you start

You need **all four** of these:

1. **Your PC is running Holon.** The desk server must be live on your
   PC — that's where your AI staff actually run. (Windows install
   guide: see `docs/install/windows.md` once published; until then,
   follow the repo `README.md` "How to get started" section to bring
   up `pnpm dev` on port 3000, then `scripts/iphone-pwa-bridge.bat` to
   open the LAN bridge on port 3003 — the Android app uses the same
   bridge as iPhone PWA.)
2. **Your Android phone is on the same Wi-Fi as the PC.** APK install
   needs LAN reachability — there's no cloud bridge in V1.
3. **Android 5.1 (API 22) or newer.** Capacitor 6.x `minSdkVersion` is
   22. Any Android phone sold in the last 9 years works.
4. **"Install unknown apps" enabled** for the source you'll install
   from (your browser, file-manager, or chat app). Android blocks APK
   sideload by default — this is a one-time toggle, not a permission
   the APK itself requests.

---

## Step A — get the APK onto your phone

### Option 1: download from a GitHub Actions build (recommended)

Each push to a `v*-mobile` tag (or a manual workflow run) of the
`android-apk` workflow uploads the APK as a build artifact:

1. Open <https://github.com/chenz16/holon-engineering/actions/workflows/android-apk.yml>
   in your phone's browser.
2. Tap the most recent successful run.
3. Scroll to **Artifacts** at the bottom → tap
   **holon-mobile-debug-{version}-{sha}**.
4. GitHub downloads it as a `.zip`. Tap to extract → you get
   `holon-mobile-debug-{version}-{sha}.apk`.

> **GitHub login on phone?** You'll need to sign in to GitHub to
> download workflow artifacts (this is a GitHub policy, not a Holon
> choice). On phone, the GitHub mobile site signs in once and stays
> signed in.

### Option 2: build locally + transfer

On your PC (WSL2 / Linux / Mac):

```bash
scripts/build-android-apk.sh
```

Output:

```
dist/holon-mobile-debug-{version}-{shortSha}.apk
```

Then transfer to phone via USB, WeChat self-message, email, or any
file-share. Last known good build was **4.5 MB** (2026-05-18, debug,
unsigned).

### Option 3: USB install via ADB (developers only)

If your phone has USB debugging on:

```bash
$ANDROID_SDK_ROOT/platform-tools/adb install -r \
  dist/holon-mobile-debug-{version}-{shortSha}.apk
```

(WSL2: use `adb.exe` from the Windows-side SDK at
`/mnt/c/Users/$USER/AppData/Local/Android/Sdk/platform-tools/adb.exe`.)

---

## Is this safe? (read this before Step B)

If you're new to Android sideload, the next screens look alarming:
"unknown sources", "unsigned app", "developer / not from the Play
Store". These are normal warnings for *any* APK that doesn't come from
the Play Store — they are not specific to Holon and they do not mean
the file is malware. Here is what each warning actually means, and
how to verify the APK you have is the one you wanted.

**Why is the APK "unsigned" / "debug-signed"?** V1 ships an APK
signed with Android's *debug* keystore — the same key every developer
gets when they install Android Studio. It is not malware. Holon ships
this way in V1 because (a) there is no Play Store listing yet (V2
work) and (b) a release-keystore signature only buys you a softer
"unknown developer" warning, not a free pass — sideload still requires
the same toggle. Release signing lands in V1.1 (see `Step D` →
"Deferred to V1.1 / V2" at the bottom). Until then, the warning text
is Android being honest about the keystore, not a tampering signal.

**Does "Install unknown apps" weaken my whole phone?** No. Android's
toggle is **per-source**: when you flip it on for Chrome (or Files,
or WeChat), only *that one app* can launch APK installs. Every other
app on the phone is still blocked from doing so. You can also flip
the toggle back off as soon as Holon is installed (instructions
below). The toggle is one-shot trust for one app, not a phone-wide
permission.

**How do I know the APK file hasn't been tampered with?** Three
self-checks, in order of strength:

1. **Bundle ID** must read **`com.holon.mobile`** in Settings → Apps
   → Holon → Advanced after install. Any other ID = wrong/forged APK
   — uninstall immediately. (This is the simplest tampering check.)
2. **File size** should be ~4.5 MB (debug build, 2026-05-18). A
   wildly different size (e.g. 50 KB or 80 MB) means the file is
   truncated, repackaged, or a different artifact.
3. **SHA-256 checksum** — compute it yourself and match against the
   value posted alongside the APK in the GitHub Actions run
   (Artifacts section → `*.sha256` file, once V1.1 ships the
   workflow update). To compute:
   - **Windows**: `certutil -hashfile holon-mobile-debug-*.apk SHA256`
   - **Mac / Linux**: `shasum -a 256 holon-mobile-debug-*.apk`
   - **WSL**: `sha256sum holon-mobile-debug-*.apk`
   If the values don't match, the file was modified between
   download and install — re-download from a clean network.

> **China-network note.** If you got the APK over WeChat, Telegram,
> or a non-GitHub mirror, the bundle-ID check is the load-bearing
> one — any tampered or repackaged Holon-lookalike will fail it.

---

## Step B — install the APK

1. On the phone, open the file-manager (or wherever the downloaded
   APK lives) and tap the APK.
2. Android shows a security prompt:
   > **此应用未经授权来源 / Install unknown apps**
   Tap **设置 / Settings** → toggle on the per-source permission for
   the app that's launching the install (Chrome, Files, WeChat, etc.).
   Back out → tap the APK again → **安装 / Install**.
   See "Is this safe?" above for why this toggle is per-source (not
   phone-wide) and how to revert it.
3. Wait ~10 seconds → **打开 / Open**.
4. Confirm the bundle ID in Settings → Apps → Holon → Advanced:
   should be **`com.holon.mobile`**. (If it's a different ID, you
   installed the wrong APK — uninstall + retry from Step A.)

> **First-launch warning: "Unsigned app" / "developer build".** V1
> ships a *debug*-signed APK, not a release-signed one (release
> signing is V1.1 work — see "Is this safe?" above for the full
> explanation). On first install some launchers show a "developer /
> unsigned" badge — tap **安装 / Install anyway**. The APK still runs
> identically; the badge is a sideload-trust hint, not a tampering
> alert.

### Turn the "Install unknown apps" toggle back off (recommended)

Once Holon is installed, you don't need the toggle on anymore.
Holon updates by you downloading a new APK and toggling on again
for that one install — not by silent background install. To revert:

1. Settings → Apps → Special access → **Install unknown apps**.
2. Find the app you toggled on earlier (Chrome / Files / WeChat /
   etc.) → tap → toggle **off**.

Your phone is now back to the same install-blocking posture it had
before Step A.

---

## Step C — connect to PC (what "pair" means here)

> **"Pair" in V1 is not a Bluetooth-style dance.** There is no code to
> enter, no QR to scan, no confirmation prompt on the PC. The APK was
> built with your PC's LAN URL baked in (step B / `build-android-apk.sh`
> embedded it via `capacitor.config.ts`) — that build-time URL *is* the
> pairing. If you've already installed the APK, you are already
> connected; there is no further pair action to take.

The first time you open Holon on Android:

1. Holon opens to `/chat` — the work-bench chat (full-screen, no
   browser chrome — that's the native shell).
2. The app calls the PC's BFF at `http://<lan-ip>:3003` (or `:3002`
   in dev). All state — staff roster, today's work, deliverables,
   missions — comes from the PC.

> **No discovery, no "PC IP" entry screen in V1.** The phone reaches
> the PC by its LAN IP only — the Capacitor build embeds the bridge
> target at build time (per `capacitor.config.ts` + `next.config.ts`
> proxy). If your PC's LAN IP or WSL IP changes, the connection
> silently fails — and because there's no "re-pair" button, the fix
> is: (a) re-run `scripts/iphone-pwa-bridge.bat` on the PC if only
> the WSL-side IP changed (the LAN IP stays the same), or (b) rebuild
> + reinstall the APK if the PC's LAN IP itself changed (the URL is
> baked in at build time).
>
> **V2 will add a real "pair to PC" first-launch screen** with QR-code
> scan + LAN discovery so the URL is not baked into the build. The
> design is in `docs/mobile-architecture-principles.md` under
> "pairing-flow-v2".

If the PC server is up and the phone is on the same Wi-Fi, you're
connected. Type a test message: *"看一下收件请求"* or *"团队里都有谁？"*

---

## Step D — smoke checklist (run on real device before declaring V1 mobile shipped)

Tick each item on your actual phone. Don't claim "Android APK ready"
until all eight pass.

- [ ] App opens to `/chat` (no crash, no white screen)
- [ ] Bottom tab bar visible: 工作台 · 收件 · 成员 · 今日 · 交付 · 更多
- [ ] Status indicator green (PC reachable) — usually visible as
      data populating without "加载中..." stuck
- [ ] `/today` shows the PC's current jobs (not "无任务" if PC has
      jobs queued)
- [ ] `/deliverables` shows recent CEO deliverables (PDFs / slides /
      memos from completed jobs)
- [ ] `/staff` shows the staff roster (我的员工 + 内置专家 sections)
- [ ] Tap a staff card → `/staff/<id>` opens with that staff's name +
      role + active-jobs section
      > **Known V1 limitation (M-L-036 backlog):** the `/staff/[id]`
      > dynamic route does not yet ship a static export in the APK
      > (blocker: Capacitor's `output: 'export'` requires
      > `generateStaticParams` for dynamic params). This item will
      > fail on a clean APK until M-L-036 lands. Mark as ⏸ until
      > fixed.
- [ ] In `/chat`, @-mention a staff member → message delivers to PC
      server (verify PC-side: `tail /tmp/holon-dev.log` should show
      the inbound assistant-ui request)
- [ ] Bug-report button visible at bottom-right (red bug icon) and
      tapping it opens the bug-report sheet

Record the date + version + which items pass/fail in the project's
ship checklist before announcing V1 Android.

---

## Daily use

- **Same Wi-Fi as the PC** → tap icon → use Holon. That's it.
- **Different Wi-Fi (e.g. you're out)** → Holon won't load. V1 has
  no cloud relay. The PC is the source of truth; the phone is a
  view of it. V2 adds the cloud-relay path so the phone keeps
  working when you leave your LAN.
- **PC asleep** → Holon won't load. Wake the PC; the LAN bridge
  survives Windows sleep on 2026-05 builds, but the WSL-side
  `mobile-prod-preview` doesn't always — if the phone shows
  "connection refused" after the PC wakes, SSH into WSL (or open
  Windows Terminal → Ubuntu) and run
  `scripts/mobile-prod-preview.sh restart`.

---

## Troubleshooting

### "App not installed" or "Parse error" during install

The APK is corrupted or for the wrong CPU arch.

1. Re-download the APK (GitHub artifact zips sometimes truncate on
   flaky networks).
2. Verify the file is ≥ 4 MB (last known good: ~4.5 MB).
3. If you built locally, re-run `scripts/build-android-apk.sh` and
   check the final log line for the byte count.

### Install blocked — "For your security, your phone is not allowed to install unknown apps from this source"

You haven't enabled "Install unknown apps" for the source.

1. Settings → Apps → Special access → Install unknown apps.
2. Find the app that's trying to install (Chrome, Files, WeChat,
   Telegram, etc.) → toggle on.
3. Back to the APK → tap → install.

### Holon opens but shows "无法连接到服务器" / "Connection refused"

The phone cannot reach the PC. Check, in order:

1. **Same Wi-Fi?** Phone and PC both on the same SSID. Phone not
   on cellular. Phone not on a guest network with client isolation.
2. **PC server up?** On the PC, open `http://localhost:3003` in
   Edge/Chrome on the PC itself. If that doesn't work, run
   `scripts/mobile-prod-preview.sh` (WSL) to start the prod-preview
   server.
3. **Firewall?** Re-run `scripts/iphone-pwa-bridge.bat` on the PC
   (auto-elevates to admin; re-applies the firewall rule + WSL2
   port-forward).
4. **WSL IP changed?** Re-run the bridge bat after every WSL or
   Windows restart — WSL2's eth0 IP is ephemeral.
5. **PC LAN IP changed?** Routers can hand out a new DHCP lease.
   On PC run `ipconfig`; if the IP differs from what the APK was
   built against, the APK needs a rebuild with the new URL embedded
   (V1 limitation; V2 pairing screen fixes this).

### Old version cached after PC update

Capacitor caches the bundled `out/` inside the APK. To force a refresh:

1. Phone → Settings → Apps → Holon → Storage → Clear cache + Clear
   data.
2. Reopen Holon.

If that doesn't help, the easiest path is to uninstall and reinstall
the latest APK from Step A.

### Bug-report button doesn't submit

The bug report POSTs to the same BFF as the rest of the app, so a
silent failure means the phone briefly lost LAN connectivity. Take
a screenshot manually and re-submit; the report endpoint is
idempotent.

---

## What works on V1 Android APK

- All eight mobile routes: 工作台 (chat) · 收件 · 成员 · 今日 · 交付 ·
  更多 · 我 · staff list
- Chinese chrome throughout (matches iPhone PWA)
- Pull-to-refresh on data-bearing pages
- Bug report (red bug FAB, bottom-right)
- Native full-screen launch (no browser chrome)
- Capacitor splash screen with Crown brand (Holon ink + paper palette)

## What's deferred to V1.1 / V2

- **V1.1**: release-signed APK (debug-signed for now — sideload-only;
  GHA workflow has the optional release path wired but needs a
  keystore + `signingConfigs` block in `app/build.gradle`)
- **V1.1**: `/staff/[id]` static export (blocker: M-L-036 in
  `docs/dev-queue.md`)
- **V2**: Play Store listing (cloud relay must ship first)
- **V2**: LAN discovery + first-launch pairing screen (no more
  rebuild-on-IP-change)
- **V2**: cloud relay (works off-LAN — phone reaches PC over internet)
- **V2**: push notifications (Android FCM)
- **V2**: background sync

---

*Last updated: 2026-05-18 · mobile-v1 · M-L-036*

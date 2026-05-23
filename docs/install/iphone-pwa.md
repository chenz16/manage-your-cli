# Install Holon on your iPhone (PWA — 5 minutes)

This is the iPhone install guide for Holon Personal Edition V1. You install
it as a Progressive Web App (PWA): a home-screen icon that launches Holon
full-screen, just like a native app — but with no App Store download and no
TestFlight invite needed.

> **Why PWA, not App Store?** V1 ships fast. The Holon mobile UI is already a
> proper web app served by your PC; an iPhone PWA is a 30-second install of
> that same UI. No Apple developer account, no review queue.

---

## Before you start

You need **all four** of these:

1. **Your PC is running Holon.** The desk server must be live on your
   PC — that's where your AI staff actually run. (Windows install guide:
   see `docs/install/windows.md` once published; until then, follow the
   repo `README.md` "How to get started" section to bring up `pnpm dev`
   on port 3000.)
2. **Your iPhone is on the same Wi-Fi as the PC.** PWA install needs LAN
   reachability — there's no cloud bridge in V1.
3. **You use Safari on iPhone.** **Not Chrome.** Chrome on iOS cannot
   install PWAs (Apple restriction — it's a known limitation, not a bug).
4. **iOS 16.4 or newer** (Safari 16.4 added the full PWA install flow we
   rely on).

---

## One-time PC-side setup (Windows)

On your **PC**, double-click:

```
scripts\iphone-pwa-bridge.bat
```

This script:

- Auto-elevates to Administrator (Windows will prompt — accept).
- Starts the mobile production build on port 3003 (PWA install requires
  the production build; the dev server intentionally disables the service
  worker per M-L-019).
- Opens the Windows firewall on port 3003.
- Forwards inbound LAN traffic into WSL2 so your iPhone can reach the
  server.

When it finishes, the script prints a URL like:

```
============================================
  iPhone (same Wi-Fi) -> Safari (prod):
  http://192.168.1.42:3003
============================================
```

**Copy that URL.** You'll type it on your iPhone in a moment.

> **Don't know your PC's LAN IP?** The bridge script prints it for you. If
> you'd rather check manually: open Command Prompt and run `ipconfig`, then
> look for the IPv4 address under your Wi-Fi adapter (usually starts with
> `192.168.` or `10.`). On Mac, open System Settings → Network → your
> active Wi-Fi → Details → TCP/IP.

> **WSL restarted? Re-run the bat.** WSL2's internal IP changes on every
> Windows restart. The bridge has to re-bind. If the iPhone suddenly stops
> connecting after a reboot, re-run `iphone-pwa-bridge.bat`.

---

## Install on iPhone (30 seconds)

1. **Open Safari** on your iPhone. *(Not Chrome. Chrome on iOS cannot
   install PWAs.)*
2. **Type the URL** the PC printed — e.g. `http://192.168.1.42:3003` —
   into the address bar. The Holon home screen should load.
3. **Tap the Share button** (the square with an up-arrow at the bottom
   of Safari).
4. **Scroll down → tap "Add to Home Screen"** (英文: *Add to Home
   Screen*; 中文 iOS: *添加到主屏幕*).
5. **Tap "Add"** in the top-right.

A **Holon icon** appears on your home screen. Tap it. It launches
full-screen — no Safari address bar, no tab bar. That's the PWA.

> **(Screenshot placeholder: Safari share sheet with "Add to Home Screen"
> highlighted.)**
>
> **(Screenshot placeholder: Holon icon on iPhone home screen.)**
>
> **(Screenshot placeholder: Holon running full-screen after launch.)**

---

## First-run connect (what "pair" means here)

> **"Pair" in V1 is not a Bluetooth-style dance.** There is no code to
> enter, no QR to scan, no confirmation prompt on the PC. The PWA is
> "paired" the instant you typed your PC's LAN URL into Safari (step 2
> above) — that URL *is* the pairing. If you've already done that, you
> are already connected; there is no further pair action to take.

The first time you tap the home-screen icon:

1. Holon opens to `/chat` — the work-bench chat.
2. The mobile app calls your PC's BFF (the same `http://<lan-ip>:3003`
   you typed in step 2 above). All state — your staff roster, today's
   work, deliverables, mission inbox — comes from the PC.
3. If the PC server is up and on the same Wi-Fi, you're connected. Type
   a message to test: *"看一下收件请求"* or *"团队里都有谁？"*

> **No discovery, no separate pairing screen in V1.** The phone reaches
> the PC by its LAN IP only. The PWA is bound to the PC URL you opened
> it from. If your PC's LAN IP changes (new router, different Wi-Fi),
> the connection silently fails — and because there's no "re-pair"
> button, the fix is to re-install the PWA against the new URL
> (re-bookmark via Safari Share → Add to Home Screen). This is a known
> V1 limitation; V2 will add a real pairing flow (QR-code scan + LAN
> discovery) so the URL is not load-bearing.

---

## Daily use

- **Same Wi-Fi as the PC** → tap icon → use Holon. That's it.
- **Different Wi-Fi (e.g. you're out)** → Holon won't load. V1 has no
  cloud relay. The PC is the source of truth; the iPhone is a view
  of it. V2 adds the cloud-relay path so the iPhone keeps working when
  the user leaves their LAN.
- **PC asleep** → Holon won't load. Wake the PC; the bridge survives
  sleep on Windows 11 (we've tested it on the 2026-05 builds), but the
  mobile-prod-preview process running inside WSL doesn't always — if
  the iPhone shows "connection refused" after the PC wakes, SSH into
  WSL (or open Windows Terminal → Ubuntu) and re-run
  `scripts/mobile-prod-preview.sh restart`.

---

## Troubleshooting

### "Safari cannot connect to the server" or "connection refused"

The iPhone cannot reach the PC. Check, in order:

1. **Same Wi-Fi?** iPhone and PC both on the same SSID. Phone is not
   on cellular. Phone is not on a guest network that isolates clients.
2. **PC server up?** On the PC, open the URL in a browser (Edge / Chrome
   on the PC itself). If it doesn't work locally, the mobile-prod-preview
   isn't running — open WSL and run `scripts/mobile-prod-preview.sh`.
3. **Firewall?** Re-run `iphone-pwa-bridge.bat` (it re-applies the
   firewall rule). If Windows asks "allow on Public networks?", say yes
   — home Wi-Fi sometimes gets mis-classified as Public.
4. **WSL IP changed?** Re-run `iphone-pwa-bridge.bat` after any WSL or
   Windows restart.
5. **PC's LAN IP changed?** Routers can hand out a new DHCP lease.
   Check `ipconfig` again; if the IP is different from what you typed
   in Safari, re-install the PWA against the new URL.

### Holon icon shows an old version after I updated the PC

Service workers cache the app shell. To force a refresh:

1. iPhone → Settings → Safari → Advanced → Website Data → search "holon"
   → swipe-delete the entries for your PC's IP.
2. Long-press the Holon home-screen icon → Remove App → Delete from
   Home Screen.
3. Re-install per "Install on iPhone" above.

> Faster path if you're a developer: bump `CACHE_VERSION` in
> `apps/mobile/public/sw.js` and re-build prod. The service worker's
> activate handler purges old caches.

### Icon shows on home screen but launches in Safari, not full-screen

This means `display: standalone` from the manifest wasn't picked up.
Causes:

- iOS < 16.4 — upgrade.
- You installed from Chrome instead of Safari — uninstall, re-install
  from Safari.
- The PC was serving the dev build (port 3002), not the prod build
  (port 3003). PWA install only works against the prod build with the
  service worker active. Make sure you used `iphone-pwa-bridge.bat`
  (which forwards 3003), not `iphone-lan-bridge.bat` (which forwards
  the dev port 3002).

### Bug-report button (red bug icon, bottom-left) doesn't submit

The bug report POSTs to the same BFF as the rest of the app, so this
means the iPhone briefly lost LAN connectivity. Take a screenshot
manually and re-submit; the report endpoint is idempotent.

---

## What works on V1 iPhone PWA

- All eight mobile routes: 工作台 (chat) · 收件 · 成员 · 今日 · 交付 · 更多
  · 我 · staff detail
- Chinese chrome throughout
- Pull-to-refresh on the data-bearing pages
- Service-worker offline boot to the cached shell (you see "no connection"
  rather than a white screen when the PC is unreachable)
- Bug report (red bug FAB, bottom-left)
- Standalone display mode (no Safari chrome when launched from home
  screen)

## What's deferred to V2

- LAN discovery (V1 you type the URL; V2 auto-discovers the PC)
- Cloud relay (V1 needs same Wi-Fi as PC; V2 reaches PC over internet)
- Push notifications (iOS 16.4+ supports them in PWAs but V1 doesn't
  ship a push subscription path)
- Background sync (V1 is online-only)

---

*Last updated: 2026-05-18 · mobile-v1 · M-L-035*

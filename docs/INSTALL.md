# Install & Usage Guide

**Reference environment: WSL2 on Windows (the primary dev/run target). All commands
run in WSL2 unless explicitly marked (Windows).**

---

## Contents

1. [Your own CLI first](#1-your-own-cli-first)
2. [Desk setup — the web app](#2-desk-setup--the-web-app)
3. [Reach the desk from your phone — WSL2 port-forward](#3-reach-the-desk-from-your-phone--wsl2-port-forward)
4. [Mobile (微作) — build, install, and pair](#4-mobile-微作--build-install-and-pair)
5. [Using it](#5-using-it)
6. [References](#6-references)

---

## 1. Your own CLI first

This app is a **thin shell that drives CLI agents you already own**. It never stores or
handles API keys or subscription tokens. The first step is making sure at least one
supported CLI is installed and you are logged in with your own subscription.

### Supported CLIs

Install at least one. The app auto-detects whichever are on `PATH` and logged in.

| CLI | Install | Log in |
|-----|---------|--------|
| **Claude Code** (`claude`) | `npm install -g @anthropic-ai/claude-code` | `claude` → follow OAuth prompt |
| **Codex** (`codex`) | `npm install -g @openai/codex` | `codex` → follow OAuth prompt |
| **Gemini CLI** (`gemini`) | `npm install -g @google/gemini-cli` | `gemini` → follow OAuth prompt |
| **Qwen CLI** (`qwen`) | per Alibaba Cloud docs | `qwen login` |

None of these credentials are entered into this app. The app spawns the CLI process
using your existing login. By default the Secretary uses `claude`; override with
`HOLON_MANAGER_BINARY=codex` (or `gemini`, etc.) and employee creation defaults to
`claude` unless `HOLON_AGENT_BINARY` is set.

### Node and pnpm

The repo requires **Node.js 20.10.0 or newer** and uses
[`corepack`](https://nodejs.org/api/corepack.html) to manage pnpm.

```bash
# Verify Node version — must be >= 20.10.0
node --version

# Enable corepack (ships with Node 16.9+; activates pnpm on first use)
corepack enable
```

If you use `nvm`, pin a stable version as the default so all new shells pick it up:

```bash
nvm install 22
nvm alias default 22
```

---

## 2. Desk setup — the web app

The desk is a **Next.js web app** in `apps/web`. It serves the chat interface, agent
roster (`/members`), connectors (`/connectors`), and owner profile (`/me`).

### Install dependencies

From the repo root:

```bash
corepack pnpm install
```

### Option A: dev server (fast iteration, HMR)

```bash
corepack pnpm --filter @holon/web dev
```

Starts Next.js dev on **`http://localhost:3000`**. Suitable for development. Service
worker / PWA install is disabled in dev mode.

### Option B: production standalone (recommended for daily use and LAN/phone access)

**Step 1 — Build:**

```bash
bash scripts/build-web.sh
```

This runs `next build` with an isolated throwaway SQLite database so the build never
clobbers your live owner configuration. Output lands at
`apps/web/.next/standalone/apps/web/server.js`.

**Step 2 — Serve (convenience script does static copy + serve in one step):**

```bash
bash scripts/serve-production-wsl.sh
```

This script:
- Stops any running dev or prod server on the target port.
- Copies `apps/web/.next/static/` and `apps/web/public/` into the standalone bundle
  (Next.js does not bundle them automatically).
- Starts the standalone server bound to `0.0.0.0` (required for Windows-browser and
  LAN/phone access through WSL2).
- Pre-warms common routes.

Override the port: `PORT=3100 bash scripts/serve-production-wsl.sh`

Alternatively, run the standalone server manually after copying statics:

```bash
# Copy statics (once per build)
cp -r apps/web/.next/static apps/web/.next/standalone/apps/web/.next/
cp -r apps/web/public       apps/web/.next/standalone/apps/web/

# Start
NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000 \
  node apps/web/.next/standalone/apps/web/server.js
```

### Key environment flags

| Flag | When to use |
|------|-------------|
| `HOLON_OPEN_DEMO=1` | **Single-user, no device token required.** Bypasses the device-pairing gate for all API routes. Use this for personal localhost-only use when you don't need mobile pairing. **Do not set on a shared or internet-exposed deployment.** |
| `HOLON_LAN_ACCESS=1` | **LAN / phone access.** Makes `isLoopbackRequest()` treat private-LAN IPs (10.x, 172.16–31.x, 192.168.x, 100.x Tailscale) as "the local desktop". This is the **recommended flag for LAN and phone use** — it lets you view pairing codes by opening the desk at your WSL IP from a Windows browser (not just from `localhost`), and it allows the phone to poll `GET /api/v1/pair/pending` through the LAN IP. See `apps/web/lib/device-token-auth.ts`. |
| `PORT=<number>` | Port the server listens on (default `3000`). |
| `HOSTNAME=0.0.0.0` | Bind to all interfaces. Required when the desk must be reachable from the Windows host or LAN devices through WSL2. |
| `HOLON_MANAGER_BINARY=<cli>` | CLI binary the Secretary uses (default `claude`). Set to `codex`, `gemini`, etc. |
| `HOLON_AGENT_BINARY=<cli>` | CLI binary used for new employee agents (default `claude`). |

**Typical startup for LAN+phone use:**

```bash
HOLON_LAN_ACCESS=1 bash scripts/serve-production-wsl.sh
```

### Open the desk

```
http://localhost:3000
```

On WSL2, Windows browsers can reach the desk via `localhost:3000` (Windows
auto-forwards WSL2 localhost) or the WSL IP (`http://172.x.x.x:3000`). Open the desk,
go through the onboarding wizard, and chat with the Secretary.

---

## 3. Reach the desk from your phone — WSL2 port-forward

WSL2 runs inside its own NAT. A phone on the same Wi-Fi cannot reach the desk directly
because WSL2's server is not exposed on the Windows LAN IP. You need a portproxy.

### Option A: PowerShell script (included in the repo)

Run this **on Windows, as Administrator**. Double-click `scripts/iphone-lan-bridge.bat`
(it auto-elevates) or run directly from a Windows admin PowerShell:

```powershell
# (Windows PowerShell, Administrator) — forwards port 3000 (the desk)
powershell -NoProfile -ExecutionPolicy Bypass `
  -File scripts\iphone-lan-bridge.ps1 -Port 3000 -Label desk
```

What it does:
1. Reads the WSL2 `eth0` IP dynamically.
2. Adds a `netsh interface portproxy` rule: `0.0.0.0:<port>` → `<wsl-ip>:<port>`.
3. Adds a Windows Firewall inbound rule (Profile=Any — handles networks where Windows
   mis-classifies a home LAN as "Public").
4. Prints the LAN URL.

**Re-run after every WSL or Windows restart** — the WSL2 internal IP is ephemeral.

The phone then opens: `http://<windows-lan-ip>:<port>`

Find your Windows LAN IP: run `ipconfig | findstr "IPv4"` in a Windows cmd prompt.

Note: the script is named `iphone-lan-bridge.ps1` (for historical reasons) but works
for any phone. The `.bat` wrapper `iphone-lan-bridge.bat` defaults to port 3002 (mobile
dev); pass `-Port 3000` to point it at the desk. For production mobile preview on port
3003, use `iphone-pwa-bridge.bat`.

### Option B: Tailscale (simpler, persists across restarts)

1. Install [Tailscale](https://tailscale.com/) on both the Windows machine and the phone,
   using the same Tailscale account.
2. The desk is reachable at the machine's stable `100.x.x.x` Tailscale IP from anywhere
   — no portproxy, no firewall rules, works off-LAN too.
3. Start the desk with `HOSTNAME=0.0.0.0` and `HOLON_LAN_ACCESS=1`
   (100.x Tailscale IPs are treated as "local desktop" by `HOLON_LAN_ACCESS`).
4. Phone accesses: `http://100.x.x.x:3000`

### Viewing pairing codes over LAN

`GET /api/v1/pair/pending` is loopback-gated — it returns the 4-digit pairing code only
to requests from localhost/LAN when `HOLON_LAN_ACCESS=1` (or `HOLON_OPEN_DEMO=1`). To
view the code in your Windows browser (via the WSL IP), start the desk with
`HOLON_LAN_ACCESS=1`.

---

## 4. Mobile (微作) — build, install, and pair

The mobile app (named 微作 in its Chinese UI) is a Capacitor-wrapped Next.js static
export. It is not on any app store; install it as a sideloaded APK.

### Prerequisites

| Requirement | Notes |
|-------------|-------|
| JDK 21 | Default WSL2 path: `~/.local/jdk/jdk-21.0.11+10`. Install: `mkdir -p ~/.local/jdk && curl -sL https://aka.ms/download-jdk/microsoft-jdk-21-linux-x64.tar.gz \| tar -xz -C ~/.local/jdk`. Override: `JDK_PATH=/your/jdk`. |
| Android SDK | Default WSL2 path: `/mnt/c/Users/$USER/AppData/Local/Android/Sdk`. Populate it by running `winget install Google.AndroidStudio` on Windows and completing first launch. Override: `ANDROID_SDK_PATH=/your/sdk`. |
| Desk running | The APK bakes `NEXT_PUBLIC_DESK_ORIGIN` at build time. The desk must be running and reachable at the URL you supply. |

### Build the APK

```bash
NEXT_PUBLIC_DESK_ORIGIN=http://<windows-lan-ip>:3000 \
  bash scripts/build-android-apk.sh
```

- `NEXT_PUBLIC_DESK_ORIGIN` is **required**. The script refuses to proceed without it
  (omitting it would bake `localhost:3000` into the APK, making every desk call resolve
  to the phone itself).
- The APK is written to `dist/holon-mobile-debug-<version>-<sha>.apk`.
- This is a **debug APK** — shows an "unsigned app" warning on install but runs
  identically to a signed release build.
- Build time: ~3 min cold Next build + ~10 min cold Gradle, ~2 min incremental Gradle.
- **Android manifest patches are applied automatically** by the script: CAMERA,
  RECORD_AUDIO, MODIFY_AUDIO_SETTINGS permissions; `usesCleartextTraffic="true"` (for
  http:// LAN desk access); `windowSoftInputMode="adjustResize"` (keyboard handling).
  You do not need to edit the manifest.

### Install: USB (adb)

Enable Developer Mode and USB Debugging on the phone, then connect via USB:

```bash
# From WSL2, using the Windows adb.exe from the Android SDK
/mnt/c/Users/$USER/AppData/Local/Android/Sdk/platform-tools/adb.exe \
  install -r dist/holon-mobile-debug-<version>-<sha>.apk
```

### Install: sideload (no USB)

1. Transfer the APK to the phone (email, WeChat, file-share, or an HTTP file server).
2. On the phone: **Settings → Apps → Special access → Install unknown apps** → allow
   the app you used to transfer the file (one-time).
3. Tap the APK in the file manager → Install → Open.
4. Bundle ID: `com.holon.mobile`.

### Mobile-initiated 4-digit pairing (the primary flow)

Pairing is a one-time operation. The phone generates a device token stored for all
subsequent requests. The current/primary flow is **mobile-initiated**:

**On the phone (微作 app):**

1. On first launch, 微作 shows a pairing screen (`/pairing`) because no desktop
   connection is stored.
2. The desk address is pre-filled from `NEXT_PUBLIC_DESK_ORIGIN` baked into the APK.
   Confirm or edit it, then tap **请求连接**.
3. 微作 POSTs to `POST /api/v1/pair/request` → receives a `requestId`.

**On the desk (open in browser at `http://localhost:3000` or LAN IP with `HOLON_LAN_ACCESS=1`):**

1. Go to `/connectors` → "Connect Phone" section.
2. The desk polls `GET /api/v1/pair/pending` (every 2 seconds) and displays the
   **4-digit code** for the pending request.

**Back on the phone:**

1. Type the 4-digit code shown on the desk.
2. Tap confirm → 微作 POSTs `POST /api/v1/pair/confirm` with the `requestId` and code.
3. On success, the desk returns a `device_token`. 微作 stores it and uses it as
   `x-holon-device-token` on every subsequent request.

The older desk-initiated flow (`/api/v1/pair/start` + `/api/v1/pair/claim`) still exists
in the codebase but the mobile-initiated 4-digit flow above is the main path.

Alternatively, run the desk with `HOLON_OPEN_DEMO=1` to bypass device token validation
entirely, making pairing unnecessary (personal localhost-only use).

---

## 5. Using it

### Chat with the Secretary

Open the desk at `http://localhost:3000`. The main page is the chat interface.
The Secretary is a warm headless CLI process (default: `claude` with `--effort low`);
it answers in ~1 s for short turns after the one-time cold start.

Ask the Secretary to **"hire an employee"** or **"create an agent to work on X"**. It
uses the Holon MCP to spawn a tmux-based employee process. You can attach to any
employee directly: `tmux attach -t <session-name>`.

### Key desk routes

| Route | What it does |
|-------|-------------|
| `/` | Chat with the Secretary |
| `/members` | Live roster of employees + their status |
| `/connectors` | All optional connections: phone pairing, A2A peers, WeChat, MCP plugins, voice/messaging |
| `/me` | Owner profile: name, role, persona, projects, default workspace dir |

### Connectors (`/connectors`)

**Phone pairing** — described in §4 above.

**A2A peers (agent-to-agent):** Paste another desk's URL or drop a QR image in the
"Connect to Holon" field. The app uses the A2A 0.2.0 protocol
(`/.well-known/agent-card.json` + JSON-RPC `message/send`). Works with any
A2A-compliant agent.

**WeChat (OpenClaw/iLink):** The "Connect WeChat (iOS)" button starts a QR-based bind
flow. **Requires:** a Chinese mainland WeChat account, the iOS WeChat app, and a running
ClawBot gateway instance. The gateway is set up separately (see `scripts/clawbot/` and
`scripts/clawbot-bind-probe.mjs` for notes). This does not work out of the box without
the external gateway.

**MCP plugins** — managed from "/connectors → Plugins":

| Plugin | Transport | Needs setup |
|--------|-----------|-------------|
| Holon MCP | stdio (bundled) | None — always active |
| Filesystem MCP | stdio | Provide allowed directory paths |
| Gmail MCP | stdio | First-run OAuth flow in browser (token stored at `~/.gmail-mcp/`) |
| Fetch MCP | stdio | Requires `uvx` (install via `pip install uv`) |

**Voice:**

- **STT (speech-to-text):** Choose an engine in "/connectors → Voice":
  `whisper.cpp` (local, `http://127.0.0.1:8080`), `SenseVoice` (local,
  `http://127.0.0.1:8769`), `faster-whisper` (local, `http://127.0.0.1:8000`), or
  OpenAI (API key required). Each local engine requires a separately running server —
  none start automatically. Quick-start the SenseVoice engine:
  `bash scripts/install-stt-wsl.sh` (installs via `uv`, downloads ~900 MB model on
  first run, starts on `0.0.0.0:8769`).
- **TTS (text-to-speech):** Local edge-tts (Microsoft neural voices, internet required,
  `http://127.0.0.1:8770`) or OpenAI (API key required). Quick-start the local engine:
  `bash scripts/install-tts-wsl.sh`.

**Messaging channels (Slack, Discord, Telegram):** Paste a webhook URL or bot token in
"/connectors → Messaging" to let the Secretary push notifications.

### Projects

The project switcher appears in the desk UI when you have **two or more projects**.
Create a project by asking the Secretary "create project X" or via `/me → Projects`.
Once active, chats and employee work are scoped to the selected project.

### Mobile voice input and 语音报bug

In 微作, the chat composer has a **voice input button** — hold it to speak; the audio
is transcribed by the desk's configured STT engine. There is also a **语音报bug**
(voice bug report) feature: press and hold the bug-report button to capture a voice
description, which is transcribed and filed as a bug report back to the desk.

### Boss memory

Memory lives as plain Markdown files at `~/holon-agents/boss/`: an `INDEX.md` and
detail files under `MEMORY/`. Employees fetch what they need; a periodic
memory-manager agent consolidates short-term notes into long-term files. No vector
database. You can read and edit these files directly.

---

## 6. References

| Resource | URL |
|----------|-----|
| A2A (agent-to-agent) protocol | <https://google.github.io/A2A/> |
| Model Context Protocol (MCP) | <https://modelcontextprotocol.io/> |
| Claude Code | <https://docs.anthropic.com/en/docs/claude-code/> |
| Codex CLI | <https://github.com/openai/codex> |
| Gemini CLI | <https://github.com/google-gemini/gemini-cli> |
| Qwen CLI | <https://github.com/QwenLM/Qwen-Agent> |
| Capacitor (mobile runtime) | <https://capacitorjs.com/> |
| Tailscale (VPN for LAN access) | <https://tailscale.com/> |
| OpenClaw / Tencent iLink (WeChat bot gateway) | <https://github.com/nightsailer/wechat-clawbot> |
| `@gongrzhe/server-gmail-autoauth-mcp` (Gmail MCP) | <https://github.com/gongrzhe/server-gmail-autoauth-mcp> |
| `@modelcontextprotocol/server-filesystem` | <https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem> |
| `mcp-server-fetch` (Fetch MCP) | <https://github.com/modelcontextprotocol/servers/tree/main/src/fetch> |

---

## Notes on remaining external setup

- **WeChat/iLink:** Requires a Chinese mainland WeChat account and a separate ClawBot
  gateway process. The gateway is not included in the repo.
- **STT/TTS servers:** Local engines (SenseVoice, whisper.cpp, faster-whisper,
  edge-tts/CosyVoice) must be started separately. Use
  `bash scripts/install-stt-wsl.sh` and `bash scripts/install-tts-wsl.sh` for the
  recommended local engines. OpenAI STT/TTS requires an OpenAI API key entered in
  `/connectors`.
- **Release-signed APK:** The build script produces a debug APK. A release-signed
  APK (no "unsigned app" warning) is V1.1 scope and requires a keystore.

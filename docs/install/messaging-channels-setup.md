# Messaging Channels Setup — Telegram + WeChat

> **Status: Historical record.** This document captures a point-in-time
> snapshot. References to **Hermes** / `hermes-acp` /
> `hermes_profile_generic_v1` describe the runtime used by the sister
> repo [`holon-engineering`](https://github.com/chenz16/holon-engineering)
> at the time of writing. `manage-your-cli` does not bundle, link to, or
> depend on Hermes — its live substrate is a direct multi-CLI adapter
> (`claude` / `codex` / `gemini` / `qwen`) under
> [`packages/core/src/cli-adapters.ts`](../../packages/core/src/cli-adapters.ts)
> and [`apps/web/lib/warm-agent.ts`](../../apps/web/lib/warm-agent.ts).
> The body below is preserved unedited for history.

Connect Telegram and WeChat to your Holon desk so inbound messages become triaged Missions in your `/inbound` inbox automatically. This is the go-live runbook for the owner.

**Time budget:** Telegram ~2 minutes. WeChat ~20 minutes (most of it is daemon setup and WeChat plugin activation, not Holon config).

---

## 1. How it works (concept — read once)

### The master-host model

Messaging channels bind to your **always-on host machine** — the office desktop, mini PC, or NAS that runs Holon full-time. Your phone, laptop, and tablet are thin browser clients: they see the same inbox, the same Missions, the same staff — because there is exactly one canonical copy of data on the host.

This is the same topology as Plex or Home Assistant. The practical meaning:

- **One binding, all devices.** WeChat and Telegram connect once on the host. Adding a phone or switching laptops does not touch the channel bindings.
- **Cloud-free.** No relay server, no Holon cloud account. Messages flow: channel API → host → your browser. Your data stays on your hardware.
- **Host-off caveat.** When the master host is off, the desk inbox is unreachable from other devices until the host boots again. Data is safe on disk; messages queued by Telegram/WeChat during downtime arrive when the host reconnects.

### What happens to incoming messages

Every inbound message — regardless of channel — flows through the same pipeline:

```
Channel (Telegram / WeChat)
        ↓
  IngressAdapter (channel-specific connector on master host)
        ↓
  IngressGateway (normalizes to a Mission → inbound_request)
        ↓
  Triage (iter-020: intent extraction, priority, routing)
        ↓
  Your /inbound Todo inbox (all channels unified)
```

Your phone/laptop browser shows the result. Replies are owner-initiated (Engineering Rule #6 — no AI auto-send without your click).

### Two identity models

| Channel | Model | What counterparty sees |
|---|---|---|
| **Telegram** | Bot identity | Messages addressed to `@YourBot`. Counterparty knows it's a bot. Supports groups. |
| **WeChat** | Your-account proxy | Messages flow through your personal WeChat account. Counterparty thinks it's you. |

---

## 2. Telegram (the easy one — fully working today, ~2 minutes)

Telegram uses the official Bot API (released 2015, stable). The `runtime-telegram` adapter is complete and not stubbed.

### Step 1 — Create your bot with @BotFather

1. Open Telegram and search for `@BotFather`.
2. Send `/newbot`.
3. Follow the prompts: pick a display name (e.g. "Holon Desk"), then a username (must end in `bot`, e.g. `holondesk_bot`).
4. BotFather replies with a **bot token** in the format `1234567890:ABCdef...`. Copy it — you'll paste it into Holon next. Keep it secret.

### Step 2 — Connect in Holon

1. Open Holon in your browser → `/me` → **Connectors** → **Messaging**.
2. Find the **Telegram** card → click **Connect**.
3. Paste the bot token → click **Connect**.

The connector card status badge changes from grey to **Connected** (green). The polling loop starts within a few seconds.

### Step 3 — Smoke test

Send a message to your bot from any Telegram account (your own phone is fine). Within a few seconds, it should appear in your Holon **`/inbound`** view as a new Mission with a `telegram_live` badge and an AI-drafted triage summary.

### What to expect (normal behavior)

- Messages addressed to the bot while the host was off arrive in a batch when polling resumes.
- Only **text messages** produce Missions in V1; images, voice, and files produce a placeholder with content type noted — text extraction is V1.1.
- The bot does **not** send replies automatically. When you're ready to reply, use the **Draft Reply** action in the Mission panel and send it yourself via Telegram.
- Counterparties will always see `@YourBot` as the sender, not your personal Telegram username.

---

## 3. WeChat (via OpenClaw gateway — personal account, more steps)

WeChat uses the **iLink / ClawBot** protocol — Tencent's official personal-account Bot API, launched 2026-03-22. This is the ToS-safe path: no grey-area puppet libs, no ban risk. The `runtime-openclaw` adapter logic is complete; the transport wire-details require verification against a live daemon (see § 3.5 below).

### 3.1 Prerequisites

**You need:**
- iOS WeChat version **≥ 8.0.70** (ClawBot is iOS-only in V1; Android support is on Tencent's roadmap).
- An always-on machine to run the OpenClaw daemon (your master host).
- `Node.js ≥ 18` and `npx` on the master host.

**ClawBot must be enabled on your WeChat.** Check before starting:

1. On your iPhone, open WeChat → **我 (Me)** → **设置 (Settings)** → **插件 (Plugins)**.
2. You should see **ClawBot** listed. If you do not see it:
   - Try restarting WeChat.
   - If still absent: you are not yet in Tencent's gradual rollout. Use the **Phase-1 manual-paste fallback** (§ 3.6 below) until ClawBot appears in your settings.

### 3.2 Install and start the OpenClaw gateway daemon on your master host

The `openclaw` npm package is the real gateway daemon. It runs as a sidecar beside Holon and exposes a WebSocket control plane. Holon connects to it as a WS client over `ws://localhost:18789/`.

Open a terminal on the master host and run:

```sh
# Install openclaw globally (requires Node.js >= 22.19)
npm install -g openclaw@latest

# Start the gateway in the foreground (dev: auth=none, loopback-only)
# This is the verified command that works as of openclaw 2026.5.18.
openclaw gateway run --auth none --bind loopback --allow-unconfigured

# Or, for production (token auth):
# OPENCLAW_GATEWAY_TOKEN=<your-token> openclaw gateway run --bind loopback
```

The daemon binds to **`ws://127.0.0.1:18789/`** (confirmed, loopback IPv4 and IPv6). It runs the full gateway on a single multiplexed port (WebSocket control plane + HTTP APIs).

> **Verified 2026-05-20 (openclaw 2026.5.18):** daemon starts in ~6 seconds, log confirms `http server listening` then `ready`. Port 18789 is the real default.

After the daemon is running, install and activate the WeChat plugin:

```sh
openclaw plugins install "@tencent-weixin/openclaw-weixin"
openclaw config set plugins.entries.openclaw-weixin.enabled true
openclaw gateway restart
```

### 3.3 Bind your WeChat account

1. On your iPhone, open WeChat → **我 (Me)** → **设置 (Settings)** → **插件 (Plugins)** → **ClawBot**.
2. Tap **Scan** (扫一扫) and scan the QR code shown in the daemon terminal.
3. Approve the binding prompt on your phone.
4. The daemon terminal confirms the binding is active.

**Important:** The OpenClaw daemon is **not** a WeChat client and does **not** use a WeChat login slot. Your normal WeChat on your phone continues working independently. The phone can be off; messages still route to the daemon via Tencent's iLink servers directly.

### 3.4 How Holon connects to the daemon

Holon talks to the openclaw daemon as a **WebSocket client** at `ws://localhost:18789/`. There is no HTTP polling — it is a persistent WS connection with the verified protocol:

1. Server pushes `{type:"event", event:"connect.challenge", payload:{nonce, ts}}` immediately on connect.
2. Holon sends a `connect` request (string id required — integer ids are rejected):
   ```json
   {
     "type": "req", "method": "connect", "id": "h1",
     "params": { "minProtocol": 3, "maxProtocol": 4,
                 "client": {"id": "gateway-client", "mode": "backend", ...},
                 "role": "operator", "scopes": ["operator.read", "operator.write"],
                 "auth": {} }
   }
   ```
3. Server replies with `{type:"res", id:"h1", ok:true, payload:{type:"hello-ok", protocol:4, ...}}`.
4. Holon calls `sessions.subscribe` to receive inbound session events.
5. Inbound WeChat messages from the `openclaw-weixin` plugin arrive as `{type:"event", event:"session.message", payload:{...}, seq:N}`.
6. Holon sends replies via the `send` RPC.

The implementation is in `packages/runtime-openclaw/src/ws-openclaw-transport.ts` (`WsOpenClawTransport`). It implements the same `OpenClawTransport` interface, so the adapter's dedup/normalize/emit chain is unchanged.

**Protocol deviations from prior docs (verified 2026-05-20):**
- The background notes said "first frame is the connect req" — **wrong**: server challenges first.
- The background notes said hello-ok is a standalone event — **wrong**: it's `res.payload.type === "hello-ok"`.
- Request IDs **must be strings** (e.g. `"h1"`); integer ids cause a `1008 invalid request frame` close.
- `sessions.messages.subscribe` requires a `key` param (session key); use `sessions.subscribe` to receive all session events instead.

### 3.6 Phase-1 manual-paste fallback

If ClawBot is not yet available on your WeChat (gradual rollout), use the manual-paste path:

1. In Holon `/me` → **Connectors** → **Messaging** → **WeChat** → select **Manual Paste** mode.
2. Copy a WeChat message from your phone → paste it into the Holon paste field → submit.
3. Holon extracts intent, drafts a reply, and creates a Mission in `/inbound`.
4. Copy the drafted reply back to WeChat manually.

No daemon, no npm package, no Tencent API. This path always works as a fallback even after ClawBot integration is live.

---

## 4. Remote access — reach your desk when away from home (optional, ~5 min)

By default, your slave devices (phone/laptop/tablet) reach the master host on your local network. If you want to check your inbox from a coffee shop or traveling, you need remote connectivity.

The recommended approach is **Tailscale** (free, ~5 minutes to set up). Tailscale creates an encrypted virtual LAN between your devices — Holon stays cloud-free (Tailscale only brokers the key exchange; your traffic goes device-to-device).

**Quick setup:**

1. On the master host: go to <https://tailscale.com/download> → install → `tailscale up`.
2. On each remote device (phone/laptop): install Tailscale → sign in with the same account.
3. Both devices appear in your Tailscale dashboard with a `100.x.x.x` IP.
4. Access Holon from your remote device at `http://100.x.x.x:PORT` (use the host's Tailscale IP and the Holon port).

When you're on the same LAN as the host (office / home), devices connect directly — Tailscale is idle and costs nothing. When you're remote, Tailscale routes you through.

**You run your own connectivity.** Holon does not provide a relay or cloud access for the remote case — this is intentional for the cloud-free design. If you prefer not to run Tailscale, any VPN or SSH tunnel that reaches the host's LAN IP also works.

---

## 5. Troubleshooting

### Connector card shows `error`

**Telegram:**
- Check that the bot token you pasted is correct (copy it again from BotFather — tokens do not expire but typos are common).
- Check that the master host has internet access to `api.telegram.org`.

**WeChat:**
- Check that the OpenClaw daemon is running on the master host (`ps aux | grep openclaw` or check the terminal where you started it).
- If the daemon is running but the card still shows `error`, a transport wire-detail (§ 3.5) likely needs updating — the card surfaces a specific error message. Copy it and compare against the 6 items in § 3.5.
- If you're not yet in the ClawBot gradual rollout (no plugin in WeChat Settings → Plugins), the daemon cannot bind. Switch to manual-paste mode (§ 3.6).

### Messages not appearing in /inbound

- Confirm the connector card status badge is **Connected** (green), not `connecting` or `error`.
- For Telegram: send a fresh message to `@YourBot` and wait up to 5 seconds for the poll cycle.
- For WeChat: verify the daemon terminal shows "binding active" (or equivalent); send a WeChat message to yourself from another account. Wait up to 40 seconds for the long-poll cycle to return.
- Check that Triage is running on the host — if the warm-CLI Secretary (`apps/web/lib/warm-agent.ts`) or the triage CLI employee is stopped, Missions are queued but not triaged.

### How to disconnect a channel

`/me` → **Connectors** → **Messaging** → channel card → **Disconnect**.

Disconnecting stops the polling loop and wipes the stored credentials (bot token / daemon binding reference) from the Tauri keyring. Your existing Missions in `/inbound` are not deleted — they remain as a historical record. Re-connecting requires re-entering credentials and, for WeChat, re-scanning the QR code.

---

## 6. WeChat via wcferry read daemon (Windows-host, owner-account hook)

### 6.0 Bundled daemon — no Python needed (recommended for end users)

Starting with the installer produced after running `scripts\build-wechat-daemon.ps1`,
the wcferry daemon ships **pre-bundled** as `wechat-read-daemon.exe` inside the Holon
NSIS installer. End users get a single `.exe` with no Python, no `pip install`, and
no PATH juggling.

**Build the bundle (developer / build machine, Windows only):**

```powershell
# From the repo root on a Windows host:
powershell -ExecutionPolicy Bypass -File scripts\build-wechat-daemon.ps1
```

This script:
1. Creates an isolated Python venv at `build\wechat-daemon-venv\`
2. Installs `pyinstaller`, `wcferry==39.4.5.0`, and `requests` into it
3. Runs PyInstaller via `scripts\wechat-daemon.spec` (onefile, console mode, with `sdk.dll` bundled)
4. Copies `dist\wechat-read-daemon.exe` into `apps\web\src-tauri\resources\wechat-daemon\`

After that, run the normal installer build:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build-windows-installer-local.ps1
```

Tauri picks up `resources/wechat-daemon/**/*` automatically (declared in `tauri.conf.json`)
and the final NSIS installer includes the exe.

**At runtime:** the installed Holon app finds the daemon at:
```
<install_dir>\resources\wechat-daemon\wechat-read-daemon.exe
```

A future launcher iteration will detect this file and invoke it directly, removing
the Python prerequisite entirely for the end user. The legacy Python path (§ 6.3
below) remains the fallback for developer machines and users on the current release.

**Windows Defender note:** wcferry's `sdk.dll` injects into a running process.
Defender may flag or quarantine the exe. If that happens, add an exclusion for
`<install_dir>\resources\wechat-daemon\`. This must be verified on a live Windows
host after the build — it cannot be pre-cleared from WSL2.

---

This is an alternative to the OpenClaw/ClawBot path (§ 3). It uses `wcferry` — a Python library that hooks the already-running WeChat 3.9.12.17 desktop process on the Windows host (no UAC, no QR scan, no Tencent API account). Messages are pushed directly from the daemon into Holon's `/ingest` endpoint.

**When to use this path:** ClawBot/OpenClaw not yet in your WeChat settings rollout, or you prefer the local-hook approach with no cloud dependency.

**Privacy model:** The daemon ships with an **empty whitelist**. It reads and posts **nothing** until you explicitly add wxids. Only whitelisted contacts are ever touched.

### 6.1 Prerequisites

- Windows host with WeChat 3.9.12.17 open and logged in.
- Python 3.10+ on Windows.
- `pip install wcferry==39.4.5.0 requests`

### 6.2 Configure the whitelist

Edit `scripts/wechat-whitelist.json` in the repo:

```json
{
  "ingest_url": "http://localhost:3000/api/v1/channels/wechat/ingest",
  "token": "",
  "whitelist_wxids": ["filehelper"],
  "history_lookback_days": 7
}
```

Fields:

| Field | Required | Description |
|---|---|---|
| `ingest_url` | yes | Holon's ingest endpoint. If Holon runs in WSL2, use `http://localhost:3000/...` — the Windows host reaches WSL2 via loopback. |
| `token` | no | Bearer token for the wechat channel (from Holon `/me` → Connectors). Leave empty if no token is set — loopback callers are allowed without a token. |
| `whitelist_wxids` | yes | List of wxids to read. Empty = read nothing. Find wxids with `wcf.get_contacts()`. |
| `history_lookback_days` | no | How many days of history to backfill on startup. Default: 7. |

To find a contact's wxid, run this one-off on the Windows host:

```python
from wcferry import Wcf; wcf = Wcf()
for c in wcf.get_contacts():
    if 'name_fragment' in str(c.get('name','')):
        print(c)
wcf.cleanup()
```

Or use the existing helper: `python C:\Users\chenz\wcf-test\inspect_contacts.py`.

### 6.3 Run the daemon — one command (recommended)

Two files in `scripts/` make this one action on the Windows host:

| File | Purpose |
|---|---|
| `scripts\wechat-read.bat` | Double-click launcher (calls the .ps1 with ExecutionPolicy Bypass) |
| `scripts\wechat-read.ps1` | PowerShell launcher with auto-restart loop |
| `scripts/wechat-read.sh` | WSL/Git-Bash one-command bridge — auto-detects env and pops a Windows PowerShell window running the .ps1 |

**Option A — from WSL (one command, recommended for the dev box):**

```bash
cd /home/chenz/project/holon-engineering && bash scripts/wechat-read.sh
```

It detects WSL, translates the repo path to a Windows path, and **automatically opens a Windows PowerShell window** running the auto-restart daemon. You don't switch to Windows manually. On plain Linux (no Windows interop) it explains why it can't run there.

**Option B — double-click on Windows (easiest for the owner's PC):**

In Windows Explorer, navigate to `scripts\` inside the repo and double-click `wechat-read.bat`. A console window opens and the daemon starts.

**Option C — PowerShell terminal:**

```powershell
powershell -ExecutionPolicy Bypass -File scripts\wechat-read.ps1
```

Both options:
- Check that Python and `wcferry==39.4.5.0` are installed; install/upgrade them automatically if missing.
- Print a timestamped `WeChat read daemon running… (Ctrl-C to stop)` banner.
- Restart the daemon automatically after a crash (5-second delay). A clean Ctrl-C exit stops the loop without restarting.
- Resolve all paths relative to the script location — works wherever the repo sits (local Windows path or via `\\wsl$\`).

**Ctrl-C** in the console window stops the auto-restart loop cleanly.

#### Optional — auto-start on Windows boot via Task Scheduler

To have the daemon start automatically when Windows boots (no login required), register it once with Task Scheduler. Run this once in an **elevated** (Administrator) PowerShell or CMD on the Windows host, substituting the actual repo path:

```cmd
schtasks /create /tn "HolonWeChatDaemon" /tr "\"C:\path\to\holon-engineering\scripts\wechat-read.bat\"" /sc ONLOGON /rl HIGHEST /f
```

- `/sc ONLOGON` — runs at each user logon (WeChat must already be open; adjust to `/sc ONSTART` if you want it at boot before login, but WeChat must be logged in for the daemon to work).
- `/rl HIGHEST` — runs with elevated rights so wcferry can hook the WeChat process.
- `/f` — overwrites any existing task with the same name (idempotent).

To remove the task: `schtasks /delete /tn "HolonWeChatDaemon" /f`

To check task status: `schtasks /query /tn "HolonWeChatDaemon"`

### 6.3 (legacy) — Run the daemon directly

If you prefer to invoke the Python script directly without the auto-restart wrapper:

```powershell
python scripts\wechat-read-daemon.py --config scripts\wechat-whitelist.json
```

The daemon:
1. Connects to WeChat via wcferry (hooks the running desktop process).
2. Backfills recent history (`history_lookback_days`) for each whitelisted wxid.
3. Enters a live loop: new messages from whitelisted senders are POSTed to `/ingest` in real time.
4. Deduplicates by message id (in-memory + `%TEMP%\holon-wcf-seen-ids.json`) so restarts don't re-post.
5. Shuts down cleanly on Ctrl-C (calls `wcf.cleanup()`).

### 6.4 What each posted message becomes in Holon

Each message produces a `wechat_live` Mission in `/inbound`. The title is `[Wechat] <display_name>: <truncated text>`. The 整理 digest skill (`POST /api/v1/customer-liaison/digest`) groups and summarizes them by sender+urgency.

### 6.5 Auth note

If Holon's wechat channel has a `bot_token` configured (set via `/me` → Connectors), set the same value in `wechat-whitelist.json` → `"token"`. Without a token, only loopback callers (same machine) are accepted — which is the Windows host pushing into WSL2 Holon, so it works without a token by default.

### 6.6 Troubleshooting

- **`wcferry` inject fails / WeChat crashes**: WeChat must already be open and logged in. wcferry hooks the process at startup; if WeChat is not running, it will try to launch it.
- **`is_login()` returns False**: WeChat is open but not logged in (scan QR in WeChat first, then re-run).
- **`query_sql` returns 0 rows**: the contact's messages may be in `MSG1.db` or `MSG2.db`. The daemon tries all `MSG*.db` automatically.
- **403 from /ingest**: the channel has a `bot_token` set in Holon but `token` in `wechat-whitelist.json` is empty (or wrong). Set the matching token.
- **Daemon exits immediately**: check logs — a fatal error (bad config JSON, WeChat not logged in) exits early with an `ERROR:` line.

---

## 7. Future channels

Slack, Discord, WhatsApp, Feishu, and other messaging platforms follow the same `IngressAdapter → IngressGateway → Mission → Triage` pattern (ADR-037). Each is a new adapter implementation; the core pipeline does not change. These are post-V1 roadmap items.

---

*Iteration: iter-022 Phase 3 (real WS transport) + wcferry read daemon. ADR references: ADR-034 (WeChat/OpenClaw, accepted), ADR-037 (channel-agnostic ingress, proposed). Last updated: 2026-05-20. Protocol verified against openclaw 2026.5.18 + wcferry 39.4.5.0.*

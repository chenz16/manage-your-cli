# Design Requirement — WeChat Integration (Read-First; Wechaty primary, ClawBot secondary)

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

Date: 2026-05-20
Author: owner ↔ assistant design discussion (post-ClawBot-scope-verification)
Status: **design-requirement-proposed** (locked, ready for pickup)
Supersedes: 
- `2026-05-20-wechat-connector-feature-request.md` (Wechaty/Work hybrid — outdated)
- `2026-05-20-wechat-personal-team-design-req.md` (Wechaty/PadLocal primary — outdated)

> **PRIORITY CORRECTION (2026-05-20, verified)**: An earlier version of THIS doc
> positioned ClawBot as the primary path. After verifying ClawBot's actual scope,
> that framing is corrected. **ClawBot CANNOT read your existing chat history or
> your conversations with customers — it only handles direct messages sent TO the
> bot itself** (it's a restricted customer-service-style channel). The owner's
> actual core need ("read my customer messages + summarize them") therefore CANNOT
> be served by ClawBot. The two use cases are:
>
> - **P0 刚需 (must-have)**: READ customer WeChat messages into Holon + summarize.
>   Only **Wechaty (account mirror, read-only)** can do this. No official API
>   (ClawBot / OA / Work) gives read access to your personal conversations.
> - **P1 nice-to-have (keep, low priority)**: ClawBot as a "WeChat-as-thin-interface
>   to Holon" — lets people interact with Holon AI through WeChat WITHOUT installing
>   the Holon app. Official, zero-risk, but a DIFFERENT feature than reading data.
>   Owner: "我对这个需求没那么强（可以保留 因为已经在开发了）".

Target iteration: V1.1 — V1.3 (Wechaty read path is the priority; ClawBot interface deferred)
Pickup by: Requirements Agent → iteration `requirements.md` + `plan.md`
Related: ADR-029 (substrate model), `2026-05-19-triage-skills-design-req.md`, `2026-05-19-onboarding-interview-design-req.md`, `2026-05-20-customer-liaison-role` (the role that consumes the read pipeline), Engineering Rules #4, #6, #7, #8

---

## 0.5 Two Use Cases — Distinct Tech, Distinct Priority

| | **P0: Read + Summarize (刚需)** | **P1: ClawBot Interface (keep, weak need)** |
|---|---|---|
| What it does | Read all your customer WeChat conversations into Holon; Customer Liaison virtu cleans + summarizes the firehose | Let people interact with Holon AI through WeChat without installing the Holon app |
| Tech | **Wechaty** (account mirror, read-only) | **ClawBot / iLink** (official Tencent bot API) |
| Data direction | WeChat → Holon (pull data in) | Person ↔ Holon (WeChat as a thin UI) |
| Can ClawBot do it? | ❌ NO — ClawBot can't read existing chats / customer convos | ✅ YES — this is exactly what ClawBot is for |
| Can Wechaty do it? | ✅ YES — full account mirror reads everything | ✅ also possible (userbot) but unnecessary |
| Official / risk | Wechaty grey-area, but READ-ONLY = low risk (no spam-pattern triggers) | Official, zero ToS risk, zero ban risk |
| Priority | **MUST-HAVE — build first** | Nice-to-have — keep since already in dev, low priority |

**Key fact (verified 2026-05-20)**: There is NO official API to read your personal WeChat conversations. ClawBot (bot-DMs-only), Official Account API, and WeChat Work API all CANNOT read your existing personal chats. **Wechaty (account mirror) is the only technical path for the P0 read need** — it is ToS-grey, but read-only usage avoids the high-risk triggers (mass send, auto-add-friend), making real-world ban risk low.

---

## 0. TL;DR

```
CORE NEED (P0 刚需): READ customer WeChat messages into Holon + summarize them.
                     "200 messages/day firehose → 3 clean actionable items."
                     Delivered by the Customer Liaison virtu (see customer-liaison
                     role design). The single most valuable WeChat feature.

P0 TECH:         Wechaty (account mirror, READ-ONLY).
                 The ONLY technical path to read your existing personal WeChat
                 conversations. No official API (ClawBot/OA/Work) can do this.
                 ToS-grey but READ-ONLY avoids the high-risk triggers (mass send,
                 auto-add-friend) → real-world ban risk is LOW.

P0 SEND:         Light, human-in-loop. Owner clicks send. Rate-limited (15/day).
                 Read-heavy + send-light keeps Wechaty risk low.

─────────────────────────────────────────────────────────────────────────

P1 (keep, weak need): ClawBot as "WeChat-as-thin-interface-to-Holon" — lets
                 people interact with Holon AI through WeChat WITHOUT installing
                 the Holon app. Official, zero ToS risk. BUT it's a DIFFERENT
                 feature than reading data — ClawBot CANNOT read your existing
                 customer conversations (bot-DMs-only). Owner: "需求没那么强,
                 可以保留 因为已经在开发了."

P1 TECH:         ClawBot / iLink via @tencent/openclaw-weixin (MIT, official,
                 OpenClaw-framework). Already partly in development — keep it
                 as an OpenClaw RuntimeAdapter channel for V2.

─────────────────────────────────────────────────────────────────────────

TOPOLOGY:        Master host runs Wechaty read daemon (+ optional ClawBot).
                 Slave devices = browser clients. Connector binds to host/desk,
                 not per-device (see § 3.5).

ARCHITECTURE FIT: Both Wechaty and ClawBot are IngressAdapters feeding the same
                 Ask → Triage → Customer Liaison pipeline. Hermes stays primary
                 runtime; OpenClaw added for ClawBot channel (P1).

PHASE 1.1 (P0): Wechaty read-only daemon + IngressAdapter + Customer Liaison
                virtu + Intent Extraction + Triage + summarization digest (2-3 iter)
PHASE 1.2 (P0): Light human-in-loop send via Wechaty + rate limits + audit (1 iter)
PHASE 1.3 (P0): Daily digest UI + Contacts view + file/image/voice capture (1 iter)
PHASE V2 (P1):  ClawBot interface (no-install WeChat access to Holon) via OpenClaw
PHASE V2.x:     Other channels (Telegram/Slack/Discord) via OpenClaw adapters

WHY NOT ClawBot for P0 (verified 2026-05-20):
- ClawBot CANNOT read your chat history
- ClawBot CANNOT access your private chats with customers
- ClawBot ONLY processes direct messages sent TO the bot itself
- = useless for "read my customer conversations"; only good for "be a bot
  people chat with in WeChat" (the P1 use case)
```

---

## 1. The ClawBot Discovery (2026-03-22)

### What Tencent announced

| Item | Detail |
|---|---|
| Product | WeChat ClawBot Plugin |
| Protocol | iLink (智联) |
| Endpoint | `https://ilinkai.weixin.qq.com` |
| Launch | 2026-03-22 |
| Auth | Bearer token + QR scan login |
| Coverage | Personal WeChat accounts (the first-ever official Bot API for personal accounts) |
| Access path | **Only via OpenClaw framework** — no direct HTTP integration permitted |
| Cost to Tencent | Free for users (Tencent gatekeeps which AI services can connect) |
| ToS posture | Officially sanctioned, no ban risk |

### Why this is a game-changer for any product building on personal WeChat

Before 2026-03-22: every personal-WeChat-bot product (Holon V1 plans included) was running Wechaty/PadLocal/PC-HOOK — all grey area, all could ban users at any time, all required ToS-violation disclaimers.

After 2026-03-22: there's a clean, official, legal path. Users sign up via WeChat itself (in the app, no third-party puppet service). No PadLocal subscription needed. No ban risk. No need for "are you OK with us potentially getting your account banned" disclaimers.

### iLink Protocol Technical Detail

| Endpoint | Purpose |
|---|---|
| `/ilink/bot/get_bot_qrcode` | Get login QR code |
| `/ilink/bot/get_qrcode_status` | Poll scan confirmation |
| `/ilink/bot/getupdates` | Long-poll for inbound messages (35s hold max) |
| `/ilink/bot/sendmessage` | Send messages (text/image/voice/file/video) |
| `/ilink/bot/getuploadurl` | Get CDN pre-signed upload URLs |
| `/ilink/bot/sendtyping` | Send typing indicators |

Auth header: `Authorization: Bearer ${bot_token}` + `X-WECHAT-UIN: ${base64-encoded random uint32}` (anti-replay)

Critical: every received message carries `context_token` which must be echoed back when replying — this is how conversation threading works.

Content types supported: text, images (AES-128-ECB encrypted on the wire), voice (Silk-encoded with transcription), files, video.

### ClawBot Limitations (must design around these)

| Limitation | Workaround in Holon |
|---|---|
| No group chat support | V1: skip groups. V2: use Wechaty fallback for groups. |
| One-way message transmission | Bot can only respond to user-initiated messages, can't cold-start. V1: never auto-initiate cold outreach (we'd never do this anyway). |
| No message history API | V1: only handle messages going forward from binding. Historical context = manual export of WeChat chat via WeChat's built-in export. V2: optional Wechaty backfill for users opt-in. |
| Gradual rollout (not all users have ClawBot yet) | Detect at onboarding; fall back to Wechaty (V2 plugin) for users without ClawBot plugin access. Over time, more users become eligible as Tencent expands rollout. |
| Undisclosed rate limits | Empirically measure during V1.1; surface limits in UI; design rate budgeting layer. |
| OpenClaw framework dependency | Adopt OpenClaw as new RuntimeAdapter; no direct iLink HTTP integration. **No Tencent approval needed to use the MIT-licensed npm package — `@tencent/openclaw-weixin`.** |

---

## 2. OpenClaw — The Required Middleware

### What it is

OpenClaw is an open-source AI agent framework on GitHub:
- 15,000+ stars, 200+ contributors (2026 figures)
- MIT licensed
- Self-hosted personal AI assistant
- Already supports 20+ messaging channels: WhatsApp, Telegram, Slack, Discord, Google Chat, Signal, iMessage, IRC, Microsoft Teams, Matrix, Feishu, LINE, Mattermost, Nextcloud Talk, Nostr, Synology Chat, Tlon, Twitch, Zalo, WeChat, QQ, WebChat
- Supports all major LLMs (Claude 4, GPT-4o, Gemini 2.0, DeepSeek V3)
- Built-in: agent runtime, connector ecosystem, persistent memory, template engine

### How Holon Uses OpenClaw

**OpenClaw becomes a new RuntimeAdapter implementation** (per ADR-029):

```
packages/runtime-hermes/         (existing — Hermes; Holon's primary AI runtime)
packages/runtime-cli-agent/      (planned — Claude Code / Codex)
packages/runtime-openclaw/       (NEW — wraps OpenClaw for channel integrations)
                                  └─ Includes openclaw-weixin plugin for ClawBot
```

**Holon's existing architecture (ADR-029) accommodates this cleanly**:
- Owner UI still sees "coworkers" (substrate-discriminated union)
- Router still dispatches by substrate.kind
- Hermes stays primary runtime for AI work
- OpenClaw added as second runtime, specialized for messaging-channel work
- A virtu staff member could be backed by either Hermes (general AI) or OpenClaw (channel-bridge AI)

**Concrete integration shape**:

```typescript
// New substrate variant for OpenClaw-backed staff (channel bridge)
type Substrate =
  | { kind: "local_ai", config: LocalAiConfig }       // Hermes (existing)
  | { kind: "cli_agent", config: CliAgentConfig }     // Claude Code/Codex (planned)
  | { kind: "channel_bridge", config: ChannelBridgeConfig }  // NEW — OpenClaw
  | { kind: "peer", config: PeerConfig }              // Core 2 peer

interface ChannelBridgeConfig {
  framework: "openclaw";
  channels: ChannelBinding[];   // WeChat, Telegram, Slack, etc.
  openclaw_version: string;
}

interface ChannelBinding {
  kind: "wechat" | "telegram" | "slack" | ...;
  account_id: string;           // user's identifier on that channel
  bound_at: ts;
  status: "active" | "needs_reauth" | "disabled";
}
```

### Why adopting OpenClaw is a strategic win

| Capability gained | Effort to build from scratch | Effort to adopt OpenClaw |
|---|---|---|
| WeChat ClawBot integration | 2-3 iter | included |
| Telegram bot connector | 1-2 iter | included |
| Discord bot connector | 1-2 iter | included |
| Slack connector | 1-2 iter | included |
| WhatsApp Cloud API connector | 2-3 iter | included |
| Feishu/Lark connector | 1-2 iter | included |
| QQ bot connector | 1-2 iter | included |
| LINE/Zalo connectors | 1-2 iter each | included |
| Template engine | 1 iter | included |
| Persistent memory store | 1 iter | included (use ours instead) |

**Adopt OpenClaw and you get all of these in V1.x for the cost of one runtime-adapter integration**.

---

## 3. Topology — Multi-Holon Team with ClawBot

```
─── A small business team, all on Holon, all on personal WeChat ─────

   Boss                          Employee A             Employee B
    │                              │                       │
   Holon-boss                    Holon-A                Holon-B
    ├─ Hermes runtime             ├─ Hermes runtime      ├─ Hermes runtime
    └─ OpenClaw runtime           └─ OpenClaw runtime    └─ OpenClaw runtime
        └─ ClawBot plugin             └─ ClawBot plugin      └─ ClawBot plugin
              │                              │                       │
              ▼                              ▼                       ▼
     iLink protocol via             iLink protocol via      iLink protocol via
     ilinkai.weixin.qq.com         ilinkai.weixin.qq.com   ilinkai.weixin.qq.com
              │                              │                       │
              ▼                              ▼                       ▼
       Boss's personal              Employee A's            Employee B's
       WeChat account               personal WeChat         personal WeChat

─── Internal Holon coordination ────────────────────────────────────

   Holon-boss ←─ Core 2 peer mesh ─→ Holon-A
                                   ←─ Core 2 peer mesh ─→ Holon-B

  → Internal team work still via Core 2, NOT through ClawBot/WeChat
  → ClawBot is purely the bridge to external (non-Holon) world

─── External communications via ClawBot ───────────────────────────

   Boss ← WeChat ClawBot ← Clients / friends / vendors (not on Holon)
   A    ← WeChat ClawBot ← A's clients
   B    ← WeChat ClawBot ← B's clients
```

---

## 3.5 Per-Person Internal Topology — Master Host + Slave Devices (V1 Personal Edition)

Each individual's Holon (within the team mesh above) is itself a **single-host + multi-device** deployment per ADR-026. Critically: the WeChat ClawBot binding lives on the **master host**, NOT per-device. This resolves the multi-device sync problem for free (one canonical host, N thin browser clients).

```
╔═══════════════════════════════════════════════════════════════════════╗
║                          External (per person)                         ║
║   Clients / friends / vendors (their own WeChat, not on Holon)         ║
╚═══════════════════════════════════╤═══════════════════════════════════╝
                                     │ send message
                                     ▼
                    ┌────────────────────────────────┐
                    │   Tencent WeChat servers        │
                    │   (your account + ClawBot plugin)│
                    └────────────────┬───────────────┘
                                     │ iLink protocol
                                     │ ilinkai.weixin.qq.com
                                     │ (long-poll getupdates / sendmessage)
                                     ▼
╔═══════════════════════════════════════════════════════════════════════╗
║  MASTER HOST (always-on machine: office desktop / mini PC / NAS)       ║
║  ┌─────────────────────────────────────────────────────────────────┐ ║
║  │  OpenClaw daemon                                                  │ ║
║  │   └─ ClawBot plugin (holds bot_token; NO WeChat client install;   │ ║
║  │      does NOT occupy a WeChat login slot)                         │ ║
║  ├─────────────────────────────────────────────────────────────────┤ ║
║  │  Holon Core                                                       │ ║
║  │   ├─ IngressGateway: WeChat msg → normalize → Ask                │ ║
║  │   ├─ Triage Skills + Intent Extraction                           │ ║
║  │   ├─ Router → staff                                              │ ║
║  │   ├─ RuntimeAdapter: Hermes (AI work) + OpenClaw (channels)      │ ║
║  │   └─ SQLite ★canonical desk state★ (staff/missions/asks/drops)   │ ║
║  └─────────────────────────────────────────────────────────────────┘ ║
╚═══════════════════════╤═══════════════════════╤═══════════════════════╝
            LAN: HTTP+SSE direct        Remote: Tailscale (user-provided)
                        │                       │
        ┌───────────────┼───────────────┬───────┘
        ▼               ▼               ▼
   ┌─────────┐     ┌─────────┐     ┌─────────┐
   │ laptop  │     │ phone   │     │ tablet  │   SLAVE DEVICES (thin clients)
   │ browser │     │ browser │     │ browser │   just Holon UI windows
   │ Holon UI│     │ Holon UI│     │ Holon UI│   no Holon/daemon install
   └─────────┘     └─────────┘     └─────────┘   all see the SAME desk
                                                  (transparent — only one
                                                   copy of data, on host)

  ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
  ┌─────────────────────────────────────────────────────────────────┐
  │  Owner's phone WeChat (the normal app — separate from above)      │
  │   ├─ Normal personal WeChat use (unchanged)                       │
  │   └─ ONE-TIME: Settings → Plugins → ClawBot → scan QR             │
  │       (authorizes the master host's daemon; then unattended)      │
  └─────────────────────────────────────────────────────────────────┘
```

### 3.5.1 Three load-bearing facts

1. **Master host = single source of truth.** WeChat connection, desk data (SQLite), AI runtime all live on the host. Slave devices are browser windows → multi-device transparency is FREE (no sync layer needed, because there is only one copy of the data). This is the Plex / Jellyfin / Home Assistant model (ADR-026).

2. **ClawBot binds to the host, not to devices.** One `bot_token`, one connection point. Adding / switching devices doesn't touch the WeChat connection. No per-device binding conflicts.

3. **The host does NOT log into WeChat.** The daemon uses the official iLink bot API (token-based), it is NOT a WeChat client and does NOT occupy a WeChat login slot. The owner's PHONE is the real WeChat login端; the host's daemon and the phone are parallel and independent (phone can be off and the daemon still receives messages, because messages route Tencent → daemon).

### 3.5.2 Multi-device sync — DON'T over-engineer

An earlier draft of related design discussion proposed CRDT-based multi-master sync across the owner's devices. **That is over-engineering and is hereby rejected for V1.** The single-host model already gives transparent multi-device access because there is exactly one canonical copy of the data (on the host) and devices are thin browser clients. No sync engine, no CRDT, no vector of replicas.

### 3.5.3 Remote access = user-provided connectivity

| Scenario | How devices reach the host |
|---|---|
| On LAN (office / home) | Direct HTTP + SSE — transparent, instant |
| Remote (owner traveling) | **Tailscale** (user installs, ~5 min, free) makes all devices a virtual LAN. OR user-run reverse proxy. OR (V2) optional cloud-relay paid tier. |

This is the "user solves connectivity themselves" model (like Jellyfin / Nextcloud users running their own reverse proxy). V1 ships docs teaching Tailscale; Holon itself stays cloud-free.

### 3.5.4 Always-on host caveat

The single-host model requires one machine that stays on (office desktop / a cheap mini PC ~$200 / NAS). When that host is off: LAN devices can't reach the desk (data is safe on disk, returns on boot). Same constraint as Plex / Home Assistant / any self-hosted server.

---

## 3.6 Generalizing to Other Channels (Telegram, Slack, Discord, etc.)

The architecture is **channel-agnostic**. WeChat ClawBot is one IngressAdapter; every other messaging channel is just another adapter on the same master host, converging at the same IngressGateway → Triage → staff pipeline.

```
   WeChat   Telegram   Slack   Discord   WhatsApp   Feishu   Email
     │         │         │        │         │         │        │
  ClawBot   Bot-API    Slack   Discord   WA-Cloud  Feishu    IMAP
  iLink              API     bot-API     API               SMTP
     │         │         │        │         │         │        │
     └─────────┴─────────┴────────┴─────────┴─────────┴────────┘
                          │  each = one IngressAdapter
                          ▼
              IngressGateway (on master host)
                          ▼
              normalize → Ask → Triage → staff
                          ▼
        slave devices see ALL channels in one unified Asks inbox
```

### 3.6.1 WeChat is the HARD special case; others are easier

| Channel | Official API? | Difficulty | Identity model | Groups | Notes |
|---|---|---|---|---|---|
| **Telegram** | ✅ Bot API (2015) | 🟢 easiest | bot identity | ✅ | @BotFather → token → done in 1hr |
| **Slack** | ✅ | 🟢 easy | bot / user token | ✅ | B2B standard |
| **Discord** | ✅ Bot API | 🟢 easy | bot identity | ✅ | community |
| **WhatsApp** | ✅ Cloud API | 🟡 medium | business number | ✅ | needs Meta business verification |
| **Feishu/Lark** | ✅ | 🟡 medium | bot / app | ✅ | China B2B |
| **WeChat** | 🟡 ClawBot (new 2026-03) | 🔴 hardest | YOUR personal account | ❌ not yet | gradual rollout + special case |
| **Email** | ✅ IMAP/SMTP | 🟢 easy | your mailbox | n/a | universal fallback |

**Note the irony**: WeChat (the one most wanted for the Chinese SMB ICP) is the HARDEST. Telegram / Slack / Discord are 1-hour integrations.

### 3.6.2 Two identity models (decide per channel)

```
A. Bot identity (Telegram / Discord / Slack-bot)
   Counterparty messages "@YourBot", not you personally.
   Good for: customer-service scenarios. User knows it's a bot.

B. Your-account proxy (WeChat ClawBot / Telegram userbot / Email)
   Messages flow through your personal account.
   Good for: "AI manages my personal comms". Counterparty thinks it's you.
```

WeChat ClawBot is model B. For Telegram, **recommend model A (official bot)** — clean, supports groups, zero risk.

### 3.6.3 OpenClaw delivers most channels for free

Adopting OpenClaw as a RuntimeAdapter (per § 2) brings its built-in connector ecosystem: WhatsApp, Telegram, Slack, Discord, Google Chat, Signal, iMessage, Teams, Matrix, Feishu, LINE, QQ, WeChat, and more (20+). After OpenClaw integration, adding Telegram/Slack/Discord is mostly "enable a connector," not "write a protocol from scratch."

### 3.6.4 Recommended channel rollout order

```
V1.1: WeChat (ClawBot)   — hardest but the ICP must-have
  ALSO consider: Telegram (official bot) FIRST as a 1-hour proof
  that the channel-agnostic IngressAdapter architecture works,
  THEN tackle WeChat's special-case complexity.
V1.x: Slack / Discord    — B2B / community
V2:   WhatsApp / Feishu  — need extra business verification
```

**Strong suggestion**: build Telegram integration FIRST (1 hour via official Bot API) to validate the multi-channel adapter architecture end-to-end, before sinking effort into WeChat's gradual-rollout + ClawBot special-casing. Telegram de-risks the architecture cheaply.

---

## 4. Setup Flow (Per User)

```
Step 1: Holon onboarding asks tier choice
  ● Full setup (recommended)
    Includes WeChat connection via ClawBot — official Tencent API,
    zero ToS risk, zero ban risk. Requires brief verification step.
  ○ Lite (Holon-only, no messaging connectors)

Step 2 (Full chosen): Connect WeChat
  Holon (via OpenClaw plugin) calls /ilink/bot/get_bot_qrcode
  → QR displayed in Holon UI

Step 3: User scans QR with their phone WeChat
  WeChat shows: "Authorize ClawBot to send/receive messages on your behalf?"
  User taps Allow

Step 4: Holon receives bot_token via /get_qrcode_status polling
  Token encrypted into Tauri keyring

Step 5: Initial setup complete
  Holon UI: "✅ WeChat connected via ClawBot.
             Tencent says: 156 contacts available, 45 active threads."

Step 6: Permission defaults applied (owner can customize):
  Daily send max: 15
  Per-contact daily max: 5
  Quiet hours: 23:00-07:00
  Auto-disclose AI involvement: off
```

**Note on Step 1 tier choice**: Now that ClawBot is zero-risk, the "Full" tier becomes the default recommendation. "Lite" remains as opt-out for privacy purists or those who don't want any external channel integration.

---

## 5. Starting Path (no approval needed) + Optional Partnership at Scale

### 5.1 What's actually required to START

**For a personal-email indie founder shipping Holon V1 with ClawBot integration**:

```
✅ npm install @tencent/openclaw-weixin           ← MIT licensed, commercial OK
✅ Integrate as OpenClaw RuntimeAdapter in Holon
✅ Ship Holon — users install + bind WeChat per user
✅ Each user authorizes their own OpenClaw daemon via
   WeChat app: Settings → Plugins → ClawBot → QR scan

NO Tencent application needed.
NO ICP filing needed (until you're publishing to China-mainland app stores).
NO business entity needed (personal email + GitHub + domain enough).
NO 4-12 week wait.
```

The "trust anchor" for ClawBot is **the user's explicit consent in their own WeChat app**, not Tencent's approval of Holon. Each user binds their own instance. This is the architectural reason no central approval is needed.

### 5.2 Gradual Rollout Reality (the one real constraint)

Tencent is rolling out the in-app ClawBot plugin gradually to WeChat users. Per the public 2026-03 launch announcement: "currently in gradual rollout and available for individual users only."

Practical implication:
- Some Holon users WILL have "Settings → Plugins → ClawBot" available in their WeChat
- Some Holon users WILL NOT (not yet in the rollout)
- Holon must detect this and gracefully fall back

Detection flow:
```
User clicks "Connect WeChat" in Holon
   ↓
Holon (via openclaw-weixin) requests QR code from iLink endpoint
   ↓
   ├─ Endpoint returns QR → user can scan → ClawBot path works
   │    Holon proceeds with ClawBot integration
   │
   └─ Endpoint returns "not yet eligible" / 404 / similar
        Holon shows: "Your WeChat doesn't have ClawBot enabled yet.
                      Tencent is rolling this out gradually. You can:
                      A. Wait and check back in a few weeks
                      B. Use Wechaty fallback (with ToS warning, opt-in)
                      C. Use manual paste (zero risk)"
```

### 5.3 What you DON'T need to do (debunking my earlier mistake)

Earlier in this design discussion (now corrected), I incorrectly stated this required a 4-12 week Tencent approval process with ICP filing, business entity verification, etc. **That was wrong**. After verifying via the official Tencent/openclaw-weixin GitHub repo + MIT license + public ClawBot launch materials, the actual reality is:

- ❌ NO ICP filing required (until China-mainland app store distribution)
- ❌ NO business entity required (personal email is fine)
- ❌ NO security review by Tencent (until you want enterprise-tier rate limits)
- ❌ NO 4-12 week wait
- ❌ NO partner program application required to ship V1

### 5.4 Optional Partnership Program (V2+, scale only)

There MAY exist a Tencent partner program for Holon at scale (when Holon has thousands of active users) that could offer:

- Raised rate limits beyond default per-user quotas
- Early access to group chat support (when Tencent adds it)
- Official partner badge / co-marketing
- Priority technical support

This is a **problem-of-success**, not a starting blocker. Apply if/when:
- Holon has > 1000 active WeChat-connected users
- You're hitting rate limit complaints from power users
- You want enterprise customer credibility ("Tencent-certified")

Even then, the application process is similar to other Tencent partner programs (Tencent Cloud, WeChat Pay, etc.) and is months of work, not days. **None of this is needed for V1.0 - V1.5**.

### 5.5 Action checklist for V1.0 ship (personal email path)

What you actually need to ship Holon with ClawBot integration:

```
─── Code side ─────────────────────────────────────
□ 1. npm install @tencent/openclaw-weixin (MIT)
□ 2. Integrate as RuntimeAdapter in packages/runtime-openclaw/
□ 3. Implement gray-scale detection at onboarding
□ 4. Implement Wechaty fallback for users without ClawBot
□ 5. Ship V1.0 binary via your GitHub Releases / website

─── Distribution side ─────────────────────────────
□ 6. Domain name ($10/year, optional but recommended for trust)
□ 7. macOS code signing cert (Apple Dev Account $99/year)
□ 8. Windows EV code signing cert ($200-400/year — avoids SmartScreen)
□ 9. Simple landing page (Carrd / Vercel / Cloudflare Pages — free tier)
□ 10. Privacy policy + EULA (generated, ~30 min — see Privacy Policy generators)

─── No-need ───────────────────────────────────────
✗ ICP filing (only needed if uploading to Chinese app stores)
✗ Tencent partner application (only at scale)
✗ Business entity registration (helpful for tax later, not for ship)
✗ Lawyer review (do at MVP-ready stage, not pre-launch)
```

**Total time-to-ship at personal-email-only level**: ~4-6 weeks of dev work + 1-2 weeks waiting for code-signing cert. NOT 4-12 weeks for Tencent.

---

## 6. Read Path (P0 — main value)

Same as the previous design req, but plumbed through OpenClaw:

```
WeChat message arrives at Tencent server
   ↓
ClawBot iLink → /getupdates (long-poll)
   ↓
OpenClaw runtime in Holon receives via plugin
   ↓
Adapter normalizes to Holon's Ask model
   ↓
TriageDispatcher (per triage skills design req)
   ↓
Intent Extraction skill (per existing design)
   ↓
Surface in Asks tab / route to staff / etc.
```

Volume assumption unchanged: boss receives 80-200/day, employee receives 10-30/day.

---

## 7. Send Path (P1 — light, human-in-loop)

Same rate-limited approach as before:

| Limit | Default | Owner-customizable range |
|---|---|---|
| Daily total per account | 15 | 5-50 (hard ceiling 100) |
| Per-contact daily | 5 | 3-20 |
| Per-minute burst | 1 | (system-locked) |
| Quiet hours | 23:00-07:00 | any range |
| New contact cooldown | 7 days | (system-locked) |

**The big upside vs Wechaty path**: rate limits are now about *politeness* not *survival*. ClawBot is zero ban risk; rate limits exist to prevent annoying recipients, not to keep our account alive.

This means we could relax limits over time if customer demand warrants. With Wechaty we couldn't.

### Send via ClawBot (concrete)

```typescript
async function sendWeChatViaClawBot(
  bot_token: string,
  to_contact: string,
  content: string,
  context_token: string,  // from the message we're replying to
): Promise<SendResult> {
  const r = await fetch("https://ilinkai.weixin.qq.com/ilink/bot/sendmessage", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${bot_token}`,
      "X-WECHAT-UIN": generateAntiReplayUin(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to: to_contact,
      content_type: "text",
      content: content,
      context_token: context_token,   // critical: echo back for threading
    }),
  });
  // ... handle rate-limit responses, retry, audit
}
```

Audit event: `wechat.clawbot.message_sent` with hashed content, contact, ts, staff_id, etc.

---

## 8. Engineering Rules Compliance

| Rule | How honored |
|---|---|
| **#4 No silent failure** | All ClawBot API errors (rate limit, invalid token, no-permission, conversation-closed) surface in UI with retry/manual-handle options. OpenClaw plugin handles disconnects with visible status. |
| **#6 Owner-mediated** | Default: every send requires owner click. Auto-send only via owner-pre-authorized triage rules. Tencent gatekeeping is an additional layer of authority (we are who they say we are). |
| **#7 Authority attenuation** | Per-staff toolScope: a virtu without `wechat:reply` capability can't trigger a ClawBot send. Even with capability, rate-limit caps apply. |
| **#8 Audit completeness** | Every iLink request/response logged. Content hashed by default. Send/receive events emit standard audit events. Token stored in keyring, never plaintext. |

---

## 9. Phased Delivery

| Phase | Scope | Time | Notes |
|---|---|---|---|
| **V1.0 (now)** | Manual paste UX, OpenClaw discovery in onboarding hint | 0 dev | Docs only |
| **V1.1** | `packages/runtime-openclaw/` foundation + OpenClaw RuntimeAdapter + ClawBot WeChat plugin integration (`@tencent/openclaw-weixin` npm) + gray-scale detection + Wechaty fallback + Triage + Intent Extraction | 2-3 iter | Tech path; ClawBot users use ClawBot, others fall back |
| **V1.2** | Send capability via ClawBot + rate limit enforcement + send audit | 1 iter | |
| **V1.3** | Daily digest + per-contact controls + Settings UI | 1 iter | |
| **V1.4** | File / image / voice capture + voice transcription via local Whisper | 1 iter | |
| **V2.x** | Tencent partner program application (if scale warrants — raised rate limits, group chat, official badge) | 4-12 weeks paperwork | OPTIONAL, only at scale |
| **V2.y** | Group chat support (when ClawBot adds it OR via Wechaty fallback expansion) | 1 iter | Wait for upstream |
| **V2.z** | Additional OpenClaw channels: Telegram, Slack, Discord, WhatsApp, Feishu, etc. | 1 iter each | Bonus from OpenClaw adoption |

**No critical path through Tencent for V1.x**. Just ship the code. V2.x partner application is OPTIONAL and only after product traction.

---

## 10. Out of Scope (V1.x — V2)

| Item | Why not |
|---|---|
| WeChat Work (企业微信) integration | Personal-only ICP per owner decision. Can revisit V2 if enterprise customers ask. |
| WeChat Official Account API | Defer; only build on real customer pull. |
| WeChat Mini Program automation | Out of scope. |
| Voice/video call integration | Out of scope. |
| Group chat support | Wait for ClawBot to add it (Tencent will eventually). V2 via Wechaty fallback if customer demand. |
| Mass marketing / broadcast | Never. Even with ClawBot's official channel, this is a ToS violation. |
| Cold outreach to non-contacts | Never. One-way protocol prevents this naturally. |
| Auto-add friends | Never. Not in protocol. |

---

## 11. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| User's WeChat account isn't in ClawBot gradual rollout yet | Detect at onboarding; offer Wechaty fallback (with ToS warning) or manual-paste mode. Over time more users gain eligibility as Tencent expands rollout. |
| OpenClaw framework has security vulnerabilities | Pin OpenClaw versions, monitor CVEs, only update after testing. Holon doesn't blindly auto-update OpenClaw. |
| ClawBot rate limits turn out to be very low | Pre-flight every send with rate budget tracker; surface limit reached in UI; degrade gracefully to manual paste. |
| ClawBot adds breaking protocol changes | Pin `@tencent/openclaw-weixin` versions; treat as external dependency with semver expectations; isolate via RuntimeAdapter interface so upper layers don't see protocol changes. |
| Group chat customers churn because ClawBot doesn't support groups | V2 ships Wechaty fallback for groups (opt-in with ToS warning); Tencent will likely add group chat to ClawBot eventually. |
| Tencent silently changes the iLink protocol or terms | Pin to known-working version of openclaw-weixin; monitor the GitHub repo for breaking changes; have manual-paste fallback always available as last resort. |
| Holon scales past per-user rate limits faster than Tencent rolls out partner program | Apply to Tencent partner program when needed (V2.x); meanwhile rate-limit notifications in UI ("you've hit ClawBot daily limit, switch to manual paste"). |
| User has multiple WeChat accounts (rare but real) | Each WeChat account binds independently via separate ClawBot QR; Holon supports multi-account per user (V2). |

---

## 12. Owner-Facing Marketing Narrative (V1.5+, post-approval)

Big strategic upside of going official:

```
─── Before (Wechaty era) ──────────────────────────
"Holon can integrate with your WeChat (but uses an unofficial
 method that may violate WeChat's ToS — your account could be 
 limited or banned. You accept this risk individually.)"

─── After (ClawBot era) ──────────────────────────
"Holon connects to your WeChat via Tencent's official ClawBot 
 Bot API, launched March 2026. Zero ToS risk. Your account 
 stays safe. Tencent has approved Holon as a partner AI service."
```

This is a **MASSIVE** marketing upgrade. For enterprise/compliance-sensitive SMBs, this turns "WeChat integration" from a red flag to a green flag.

---

## 13. Spec Edits Implied

- `docs/architecture/data-model.md`: New `WeChatClawBotConfig` table; extend `Substrate` enum with `channel_bridge`; add `ChannelBinding` types
- `docs/architecture/local-agent-management.md`: New § on OpenClaw as RuntimeAdapter, ChannelBridge substrate type
- `docs/architecture/runtime-adapter-interface.md`: Document OpenClaw adapter alongside Hermes
- `docs/architecture/peer-communication-architecture.md`: WeChat is external channel, NOT Core 2 peer
- New ADR: "WeChat integration via official ClawBot/iLink protocol through OpenClaw framework; Wechaty as V2 fallback"
- New ADR: "OpenClaw as a RuntimeAdapter implementation alongside Hermes"
- New ADR: "Tencent approval process and fallback strategy"
- `docs/install/wechat-clawbot-setup.md` (new): User-facing setup guide

---

## 14. Pickup Instructions for Requirements Agent

When you pick this up:

1. **First action**: `npm install @tencent/openclaw-weixin` and verify it works end-to-end with a test WeChat account. No paperwork needed to start.
2. Read this doc + ADR-029 + companion design reqs (Triage, Interview, Storage) + the superseded WeChat docs (for context on what was rejected)
3. Verify the npm package + iLink endpoints are accessible (https://ilinkai.weixin.qq.com)
4. Clone the official Tencent repos for reference: https://github.com/Tencent/openclaw-weixin + https://github.com/openclaw/openclaw + community plugins like https://github.com/hao-ji-xing/openclaw-weixin and https://github.com/freestylefly/openclaw-wechat
5. Open ADRs for: OpenClaw as RuntimeAdapter, ClawBot/iLink primary with Wechaty fallback, gray-scale detection strategy
6. Plan V1.1 to V1.4 iteration sequence (~5 iter); coordinate with Storage V1.1 + Triage V1.1 + Interview V1.1 (parallel-safe)
7. Security review of OpenClaw integration before V1.1 ships (third-party code in our process — but MIT licensed and from official Tencent repo, so lower scrutiny than e.g. PadLocal which would be a paid third-party service)
8. **Tencent partner program (V2.x)** is OPTIONAL and only after Holon hits traction (e.g. >1000 active users); do NOT block V1 on this

---

## 15. Owner Quotes (Anchoring)

From 2026-05-20 session:

> "找到了!你说的应该就是这个——2026 年 3 月微信官方推出的 ClawBot 插件...
>  这是个游戏规则改变者,以前所有方案 (Wechaty、iPad 协议、PC HOOK) 都是灰色地带、
>  随时封号。现在有了官方通道。"

> [On the assistant's prior skepticism] "狗日的 你不能搜索么"

The owner correctly pointed out that an official Tencent-supported personal-WeChat Bot API now exists, supersedes the Wechaty grey-area assumption, and changes Holon's entire integration story.

---

## 16. Sources (verified 2026-05-20 via WebSearch + WebFetch)

**Official Tencent repos** (canonical):
- [Tencent/openclaw-weixin — official Tencent WeChat plugin (MIT licensed, commercial OK)](https://github.com/Tencent/openclaw-weixin)
- [Tencent/openclaw-weixin LICENSE (MIT)](https://github.com/Tencent/openclaw-weixin/blob/main/LICENSE)
- [Tencent/openclaw-weixin README](https://github.com/Tencent/openclaw-weixin/blob/main/README.md)

**OpenClaw framework**:
- [OpenClaw main repo — github.com/openclaw/openclaw (15K stars, MIT)](https://github.com/openclaw/openclaw)
- [OpenClaw official site](https://openclaw.ai/)

**Community / alternative implementations**:
- [WeChat ClawBot iLink Protocol API spec — openclaw-weixin community fork](https://github.com/hao-ji-xing/openclaw-weixin/blob/main/weixin-bot-api.md)
- [freestylefly/openclaw-wechat — community plugin](https://github.com/freestylefly/openclaw-wechat)
- [fastclaw-ai/weclaw — alternate community plugin](https://github.com/fastclaw-ai/weclaw)

**News / launch coverage**:
- [Tencent's WeChat launches ClawBot plugin supporting OpenClaw AI framework — TechNode (2026-03-23)](https://technode.com/2026/03/23/tencents-wechat-launches-clawbot-plugin-supporting-openclaw-ai-framework-and-multi-modal-interactions/)
- [Tencent Launches WeChat ClawBot Plugin — AIbase](https://www.aibase.com/news/www.aibase.com/news/26443)
- [Tencent adds ClawBot plug-in to WeChat amid OpenClaw boom and privacy warnings — SCMP](https://www.scmp.com/tech/article/3347590/tencent-adds-clawbot-plug-wechat-amid-openclaw-boom-and-privacy-warnings)
- [WeChat Just Gave an Open-Source Project the One Thing It Never Gives — Medium (Tao An, Mar 2026)](https://tao-hpu.medium.com/wechat-just-gave-an-open-source-project-the-one-thing-it-never-gives-a-native-plugin-slot-09602fc9cb9b)

**Integration guides**:
- [How to Connect OpenClaw to WeChat — ClawBot Plugin Guide](https://openclawlaunch.com/guides/openclaw-wechat)
- [The Ultimate Guide to OpenClaw WeChat Integration — Skywork](https://skywork.ai/skypage/en/openclaw-wechat-integration/2049140233657974784)
- [Integrating WeChat with OpenClaw — MEXC News](https://www.mexc.com/news/977368)
- [Connect Personal WeChat via OpenClaw — LangBot docs](https://docs.langbot.app/en/usage/platforms/wechat/weixin)

**Correction note**: An earlier draft of this doc (committed 2026-05-20 morning) incorrectly stated a 4-12 week Tencent approval process was required to ship. Subsequent verification via Tencent/openclaw-weixin repo (MIT licensed) + public statements about gradual user rollout confirmed no central approval needed for individual / small-dev integration. Section 5 fully corrected.

---

End of refined feature request. Implementation can begin from this doc.

# IM Channel Bot API Research — Regional Coverage

**Purpose:** Inform the "reserve hooks" design for 微作's messaging channel adapters.  
**Date:** 2026-05-25  
**Context:** WeChat integration is live (via OpenClaw/iLink clawbot relay). This doc surveys
other regions' dominant IM apps for bot API viability, so we can design a generic
`MessagingChannelAdapter` interface that accommodates each integration pattern.

---

## 1. Region Table

### Global / US

| App | Est. MAU | Bot API? | Auth Model | Inbound | Outbound | Notes |
|-----|----------|----------|------------|---------|----------|-------|
| **WhatsApp** | 3 B | ⚠️ Business-gated | Meta Business Account + WABA phone number; system user tokens via Graph API | ✅ Webhook (POST to your URL on user message) | ✅ Cloud API POST `/messages`; business-initiated requires pre-approved templates | General-purpose AI chatbots **banned as of Jan 15 2026** (policy update Oct 2025). Task-specific bots (support, bookings) still allowed. No on-premise since Oct 2025 — Cloud API only. Unofficial self-hosted relay (WAHA/Evolution API) exists but violates ToS and risks permanent ban. |
| **Facebook Messenger** | ~1.3 B | ✅ Open self-serve | Facebook Page + app review for extended permissions | ✅ Webhook (Meta pushes POST on message/postback events) | ✅ Send API (`/me/messages`) | Must respond to webhook within 5 s. Human escalation path required for bots. No outbound cold-messages (window: 24 h after user last message + message tags for notifications). |
| **Instagram DM** | ~2 B (Instagram MAU) | ⚠️ Business-gated | Instagram Professional (Business/Creator) account + Meta app review | ✅ Webhook on DM events | ✅ Send API | 24-hour messaging window after user interaction. Rate limit ~200 DMs/hour. Human escalation required. Shares Meta Graph API infra with Messenger. |
| **iMessage / Apple Messages for Business** | N/A (iOS penetration: ~55% US) | ❌ Not feasible | Requires Apple-approved CSP (Customer Service Platform) partnership | ⚠️ User must initiate; Apple does not allow business-initiated conversations | ✅ Via CSP only | No public open API. Must go through Apple-certified CSP (LivePerson, Quiq, etc.). Free-to-user but you pay the CSP. No direct REST integration possible without a CSP deal. Unofficial iMessage libraries (Blooio, LoopMessage) use private protocols — Apple actively blocks them. **Not a viable adapter target.** |
| **Signal** | ~40–70 M | ❌ No official API | None | ❌ | ❌ | No official bot platform. signal-cli (22 k★ OSS) reverse-engineers the protocol and exposes a REST bridge (signal-cli-rest-api Docker image). Viable for self-hosted personal relay but Signal may rate-limit/ban numbers. Not suitable for production channel adapter. |
| **Telegram** | 1 B | ✅ Open self-serve | Bot token (BotFather, instant) | ✅ Webhook (HTTPS POST) or long-poll (`getUpdates`) | ✅ `sendMessage` API | Completely free, no business approval. Bot token from BotFather in seconds. Webhook: 90 s timeout (raised in Bot API 7.5 Mar 2025), 100 updates/response cap. Long-poll also supported. Excellent SDK ecosystem. No cold-outbound limit (bot can message any user who has started the bot). Best developer experience of all platforms. |
| **Slack** | ~65 M daily | ✅ Open self-serve | OAuth 2.0 app install; bot token per workspace | ✅ Events API (webhook POST) or Socket Mode (WSS, no public URL needed) | ✅ `chat.postMessage` | Free to create apps. Workspace admin must install the app. Socket Mode removes need for public HTTPS endpoint — useful for desk-side relay. Legacy bots deprecated Mar 31 2025. Strong for enterprise/team channel. |
| **Discord** | ~150–200 M active | ✅ Open self-serve | Bot token; OAuth2 for guild installs | ✅ Gateway WebSocket (persistent outbound connection to Discord) | ✅ REST API `POST /channels/{id}/messages` | No inbound webhooks from Discord — bot opens WebSocket to Discord gateway and receives events. Outbound webhooks (channel webhooks) are send-only. Gateway intents are mandatory (declare which events). No port forwarding needed — bot connects outbound only. |

### Europe

| App | Est. MAU (Europe) | Bot API? | Notes |
|-----|-------------------|----------|-------|
| **WhatsApp** | Dominant (~88% UK, very high DE, FR, ES) | ⚠️ Same as global — see above | Same Cloud API + template restrictions. Jan 2026 general-purpose AI ban applies. |
| **Telegram** | Strong (Eastern Europe #1 in BY, KZ, MD, RU, UA) | ✅ Same as global | Easiest integration; GDPR-friendly (no data retention on Telegram servers beyond TTL). |
| **Signal** | Niche but #1 in NL and SE | ❌ No official API | Privacy-conscious user base; signal-cli relay only for personal use. |
| **Viber** | Significant in Eastern Europe (UA, BG, GR) | ⚠️ Commercial terms required since Feb 2024 | REST Bot API (webhook, token auth). Commercial account required since 5 Feb 2024. Inbound: `conversation_started` event + message events via webhook. Outbound: `send_message` REST endpoint. Auth: account auth token in every request. HTTPS + valid SSL cert mandatory for webhook. Viable but user base shrinking. |

### Japan

| App | Est. MAU (Japan) | Bot API? | Notes |
|-----|------------------|----------|-------|
| **LINE** | ~95 M in Japan (~96% penetration) | ✅ Open self-serve (free tier) | LINE Messaging API. Bot token from LINE Developers Console (instant). Inbound: webhook POST. Outbound: Reply API (free, single-use reply token ~60 s window) + Push API (paid, metered). Free tier: 200 free push messages/month (Communication Plan). Light ¥5k/mo = 5k msgs; Standard ¥15k/mo = 30k msgs. No business approval for basic bot; Verified Account requires registered JP business. Reply API has no per-message cost. |
| **Twitter/X DM** | Moderate | ⚠️ API v2 DM, access-tier gated | Basic tier DM API is read-only; elevated access needed for write. Not IM-primary. |

### South Korea

| App | Est. MAU (Korea) | Bot API? | Notes |
|-----|------------------|----------|-------|
| **KakaoTalk** | ~47 M in Korea (~97% penetration) | ⚠️ Business-gated | KakaoTalk Channel (official account) required. Three message types: **AlimTalk** (transactional, template-based, Kakao approval required per template), **FriendTalk** (marketing, to friends only, template may be needed), **ConsultationTalk** (inbound customer queries — no template approval). Business channel ID + Sender Key required (obtained via Kakao partner/BSP or direct registration). Docs primarily in Korean. API available via direct Kakao Developers or BSPs (Sinch, Infobip, Sendbird). |
| **Naver Band / Naver Talk Talk** | Secondary | ⚠️ Limited | Naver Talk Talk has a chatbot platform but requires Korean business registration. Niche. |

---

## 2. Prioritized "Reserve Hooks For" List

Ranked by: (reach × ease of integration × strategic fit for 微作 use case)

| Priority | Platform | Rationale |
|----------|----------|-----------|
| **1. Telegram** | Highest — implement first after WeChat | Open self-serve (no approval), bot token in seconds, webhook or long-poll both supported (long-poll = zero infra requirement, matches WeChat clawbot relay model), 1 B MAUs, strong in Europe/Middle East/South America. Best DX of any platform. **Pattern: long-poll daemon identical to clawbot.** |
| **2. LINE (Japan)** | High — Japan market is LINE-only | 95 M Japanese MAUs, ~96% national penetration. Free tier viable for 微作 early users. Reply API is free. Bot token self-serve. Webhook + reply token model maps cleanly to our existing pattern. |
| **3. KakaoTalk (Korea)** | High — Korea market is Kakao-only | ~97% penetration. ConsultationTalk (inbound) does not require template approval. AlimTalk templates needed for outbound business-initiated. BSP route (Sinch/Infobip) simplifies setup. More gating than LINE but still doable. |
| **4. WhatsApp** | High reach, high friction — plan for v2 | 3 B MAUs, dominant in EU/LATAM/SEA. Cloud API is well-documented. BUT: Meta business verification required, WABA phone number provisioning, template approval for outbound-initiated. **Jan 2026 general-purpose AI ban: 微作 must position as "personal assistant for task management" not "AI chatbot" to remain compliant.** Reserve hook but implement with care. |
| **5. Slack / Discord** | Medium — team/power-user niche | Slack: already partially wired in codebase (outbound webhook, no inbound). Upgrade to Events API + Socket Mode for full bidirectional. Discord: gateway WebSocket model. Both valuable for the developer/power-user segment of 微作. Low friction to add. |
| **Defer: iMessage** | Not feasible | No open API, CSP partnership required ($$$), Apple controls the channel entirely. Mark as ❌ in UI, do not implement. |
| **Defer: Signal** | Personal/privacy use only | signal-cli relay is technically possible for self-hosted personal setup (matches "no cloud" philosophy). However: no official API, ban risk, not suitable for production. Could offer as an "advanced self-hosted" plugin later. |
| **Defer: Facebook Messenger** | Lower priority for 微作 target users | Viable API but Meta's 24-hour window and human escalation requirement add friction. US FB Messenger MAU skews older demographic; less aligned with 微作 target persona. |
| **Defer: Viber** | Eastern Europe niche, commercial terms | Commercial account required since Feb 2024. Declining user base. Lower ROI vs. Telegram which covers same geographies more broadly. |

---

## 3. Generic Channel Adapter Interface

### Design Principles

The WeChat integration uses a **relay daemon** model:
- A local Python gateway (`scripts/clawbot/gateway.py`) does iLink long-poll
- On inbound message: POST to `POST /api/v1/connectors/wechat/reply` (loopback)
- Response body `{ reply }` is sent back into WeChat

The Slack/Discord/Telegram connectors today are **outbound-only** (webhook URL in owner config, no inbound). Upgrading these to full bidirectional and adding LINE/Kakao requires a unified interface.

### Proposed `MessagingChannelAdapter` Interface

```typescript
// packages/core/src/channel-adapter.ts  (proposed)

/**
 * Connection config blob for a channel. Channel-specific shape; stored in
 * ~/.claude/channels/<channelId>/account.json (matching existing WeChat pattern).
 */
export interface ChannelConfig {
  channelId: string;        // e.g. 'telegram', 'line', 'kakao', 'slack', 'discord'
  [key: string]: unknown;   // channel-specific creds (bot token, webhook URL, chat ID, …)
}

/**
 * Normalized inbound message from any channel.
 */
export interface ChannelMessage {
  channelId: string;        // which channel this came from
  senderId: string;         // channel-native user/sender identifier
  senderDisplayName?: string;
  text: string;             // normalized plain text (channels handle rich → text)
  rawPayload?: unknown;     // original payload for channel-specific logic
  receivedAt: string;       // ISO 8601
}

/**
 * Result of sending a message.
 */
export interface ChannelSendResult {
  ok: boolean;
  messageId?: string;       // channel-native message ID (for reply threading)
  error?: string;
}

/**
 * Transport modes for receiving inbound messages.
 * - 'webhook'    : channel calls our HTTPS endpoint (Slack Events API, LINE, Viber, FB Messenger, WhatsApp)
 * - 'long-poll'  : adapter polls the channel (Telegram getUpdates, Kakao ConsultationTalk)
 * - 'websocket'  : adapter opens persistent WSS connection to channel gateway (Discord, Slack Socket Mode)
 * - 'relay'      : external daemon does transport, POSTs normalized payload to loopback endpoint (WeChat clawbot)
 */
export type ReceiveTransport = 'webhook' | 'long-poll' | 'websocket' | 'relay';

/**
 * Core adapter interface every channel plugin must implement.
 */
export interface MessagingChannelAdapter {
  /** Unique channel identifier — matches channelId in ChannelConfig */
  readonly channelId: string;

  /** Human-readable name */
  readonly displayName: string;

  /** How this adapter receives inbound messages */
  readonly receiveTransport: ReceiveTransport;

  /**
   * Validate + connect using the provided config.
   * For webhook channels: registers the webhook URL with the channel platform.
   * For long-poll/websocket channels: starts the polling/connection loop.
   * For relay channels: verifies config only (daemon managed externally).
   * Returns ok=true and persists account.json on success.
   */
  connect(config: ChannelConfig): Promise<{ ok: boolean; error?: string }>;

  /**
   * Disconnect / deregister this channel. Clean up daemon/loop if running.
   */
  disconnect(): Promise<void>;

  /**
   * Send a message to a specific recipient (identified by channel-native ID).
   * For channels with reply-token semantics (LINE Reply API), pass replyToken
   * in options to use free reply vs. metered push.
   */
  sendMessage(
    to: string,
    text: string,
    options?: { replyToken?: string; threadId?: string; [key: string]: unknown }
  ): Promise<ChannelSendResult>;

  /**
   * Register a handler for inbound messages.
   * - For webhook/relay transports: the handler is called by the webhook route
   *   (adapter registers itself with the route registry).
   * - For long-poll/websocket transports: adapter calls handler from its loop.
   * Called once at startup; adapter is responsible for fan-out to the Secretary.
   */
  onMessage(handler: (msg: ChannelMessage) => Promise<string>): void;
  //                                                   ↑ returns Secretary reply text

  /**
   * Health-check: verify credentials + connectivity without sending a message.
   */
  healthCheck(): Promise<{ ok: boolean; detail?: string }>;

  /**
   * Map a channel-native sender ID to a stable owner-facing identity string.
   * Used for audit logs and memory keys. Default: `${channelId}:${senderId}`.
   */
  identityKey(senderId: string): string;
}
```

### Webhook Route Pattern (for webhook-transport adapters)

Each webhook-transport channel gets its own Next.js route:

```
POST /api/v1/connectors/<channelId>/webhook
```

The route:
1. Validates the channel-specific signature (HMAC / X-Line-Signature / Telegram header)
2. Parses the payload into `ChannelMessage[]`
3. For each message: calls `adapter.onMessage(msg)` which invokes the Secretary warm turn
4. Returns the channel-specific acknowledgement format (e.g., LINE expects 200 OK immediately)

### Alignment with Existing Codebase

| Existing pattern | New pattern |
|-----------------|-------------|
| `POST /api/v1/connectors/wechat/reply` (loopback, relay transport) | `WeChat` adapter with `receiveTransport: 'relay'`; existing route becomes the relay endpoint |
| `MessagingChannel = 'slack' \| 'discord' \| 'telegram'` in `messaging-service.ts` (outbound-only) | Each becomes a full `MessagingChannelAdapter` with `receiveTransport: 'webhook'` (Slack Events API / Discord gateway WSS); current outbound logic becomes `sendMessage()` impl |
| `~/.claude/channels/wechat/account.json` | Generalized to `~/.claude/channels/<channelId>/account.json` — WeChat already uses this exact path |
| `sendMessagingTest()` | Becomes `adapter.healthCheck()` + `adapter.sendMessage()` |

### Channel Adapter Registry (connector = enabled MCP server pattern from ADR)

```typescript
// packages/core/src/channel-registry.ts  (proposed stub)
const registry = new Map<string, MessagingChannelAdapter>();

export function registerAdapter(adapter: MessagingChannelAdapter): void {
  registry.set(adapter.channelId, adapter);
}
export function getAdapter(channelId: string): MessagingChannelAdapter | undefined {
  return registry.get(channelId);
}
export function listAdapters(): MessagingChannelAdapter[] {
  return [...registry.values()];
}
```

Each channel ships as its own package or module that calls `registerAdapter()` at load time. The `/connectors` UI page reads `listAdapters()` to render the channel cards — exactly how the existing connector plugin model works per the connectors-vs-plugins ADR.

---

## Summary Reference

**Quick recap of the most relevant facts per channel:**

- **Telegram**: Token in seconds, free, webhook or long-poll, 1 B MAUs. Best first pick.
- **LINE**: Japan-dominant (96%), free tier for low volume, Reply API = free, Push API = paid.
- **KakaoTalk**: Korea-dominant (97%), ConsultationTalk inbound needs no template approval; AlimTalk outbound does. BSP (Sinch/Infobip) available as an intermediary.
- **WhatsApp**: 3 B MAUs, Cloud API well-documented, BUT: Meta business verification + WABA + template approval for business-initiated + Jan 2026 general-purpose AI ban. Must frame 微作 as task-specific assistant.
- **Slack/Discord**: Power-user/developer niche. Slack Events API (webhook or Socket Mode) + Discord Gateway WSS. Both already partially wired; upgrade to bidirectional is low effort.
- **Viber**: Eastern Europe niche. Commercial terms since Feb 2024. Webhook + token. Viable but lower priority.
- **Facebook Messenger**: Viable API (Meta Graph, webhook + Send API). 24-hour window + human escalation requirement + older demographic = lower ROI.
- **iMessage**: ❌ No open API. CSP partnership required. Do not implement.
- **Signal**: ❌ No official API. signal-cli relay = ToS grey area, ban risk. Defer to advanced/self-hosted only.

---

*Research only — no code changes. Interface sketches above are proposals; file paths are illustrative.*

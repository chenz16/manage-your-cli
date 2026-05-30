/**
 * messaging-channels.ts — Generic messaging-channel adapter layer.
 *
 * RESERVATION LAYER: interfaces + registry + reference WeChat wrap + stubs.
 * No behavior change to any existing WeChat/Slack/Discord/Telegram routes.
 *
 * Design reference: docs/research-im-channels.md § "Generic Channel Adapter Interface"
 */

import path from 'node:path';
import os from 'node:os';

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

/**
 * How this adapter receives inbound messages.
 *
 * - 'relay'      : external daemon (e.g. clawbot gateway.py) does transport,
 *                  POSTs normalized payload to a loopback endpoint we own.
 * - 'long-poll'  : adapter polls the channel (Telegram getUpdates).
 * - 'webhook'    : channel calls our HTTPS endpoint (LINE, Kakao, Slack Events API).
 * - 'websocket'  : adapter opens a persistent WSS connection (Discord Gateway, Slack Socket Mode).
 */
export type ReceiveTransport = 'relay' | 'long-poll' | 'webhook' | 'websocket';

/**
 * Normalized inbound message from any channel.
 * Mirrors ChannelMessage from the design doc with field names matching the
 * task spec exactly (senderName not senderDisplayName, ts not receivedAt).
 */
export interface IncomingChannelMessage {
  /** Matches adapter id, e.g. 'wechat', 'telegram', 'line', 'kakao'. */
  channelId: string;
  /** Channel-native user/sender identifier. */
  senderId: string;
  /** Human-readable display name when available. */
  senderName?: string;
  /** Normalized plain text. */
  text: string;
  /** ISO 8601 timestamp. */
  ts: string;
}

/**
 * Core interface every channel plugin must satisfy.
 */
export interface MessagingChannelAdapter {
  /** Unique channel identifier — matches channelId in account.json convention. */
  readonly id: string;
  /** Human-readable channel name shown in UI. */
  readonly label: string;
  /** How this adapter receives inbound messages. */
  readonly receiveTransport: ReceiveTransport;
  /**
   * Authentication model:
   * - 'bot-token'  : simple token from developer console (Telegram BotFather, LINE).
   * - 'oauth'      : OAuth 2.0 app install (Slack, Discord).
   * - 'business'   : business-verified account required (Kakao, WhatsApp).
   * - 'relay'      : credentials managed by external daemon (WeChat iLink).
   */
  readonly authModel: 'bot-token' | 'oauth' | 'business' | 'relay';

  /**
   * Connect / validate credentials.
   * For relay channels: verifies config is present (daemon managed externally).
   * For polling/websocket: starts the background loop.
   * For webhook: registers webhook URL with the channel platform.
   */
  connect(): Promise<{ ok: boolean; reason?: string }>;

  /** Disconnect / deregister; clean up any running loop. */
  disconnect(): Promise<void>;

  /**
   * Send a message to a channel-native recipient id.
   * Returns {ok:false, reason} on any error — never throws.
   */
  sendMessage(to: string, text: string): Promise<{ ok: boolean; reason?: string }>;

  /**
   * Register the handler that receives inbound messages.
   * - relay/webhook adapters: handler is invoked by the route that owns the
   *   loopback/webhook endpoint.
   * - long-poll/websocket adapters: adapter calls handler from its internal loop.
   * The handler returns the Secretary reply text.
   */
  onMessage(handler: (msg: IncomingChannelMessage) => void): void;

  /** Health-check: verify credentials + connectivity without sending a message. */
  healthCheck(): Promise<{ connected: boolean; detail?: string }>;

  /**
   * Map a channel-native sender id to a stable, owner-visible identity string.
   * Default: `<id>:<senderId>`.
   */
  identityKey(senderId: string): string;
}

// ---------------------------------------------------------------------------
// Path helper
// ---------------------------------------------------------------------------

/**
 * Returns the path to the account.json for the given channel, matching the
 * existing WeChat convention: ~/.claude/channels/<channelId>/account.json
 */
export function channelAccountPath(channelId: string): string {
  return path.join(os.homedir(), '.claude', 'channels', channelId, 'account.json');
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const _registry = new Map<string, MessagingChannelAdapter>();

/** Register a channel adapter. Overwrites any previously registered adapter
 *  with the same id. */
export function registerChannelAdapter(adapter: MessagingChannelAdapter): void {
  _registry.set(adapter.id, adapter);
}

/** Retrieve the adapter for a given channel id. Returns undefined if not found. */
export function getChannelAdapter(id: string): MessagingChannelAdapter | undefined {
  return _registry.get(id);
}

/** List all registered adapters. */
export function listChannelAdapters(): MessagingChannelAdapter[] {
  return [..._registry.values()];
}

/** Exported for tests that need a clean registry. */
export function _resetChannelRegistryForTests(): void {
  _registry.clear();
}

// ---------------------------------------------------------------------------
// WeChat adapter — thin wrapper over existing relay behavior.
// receiveTransport: 'relay'  (clawbot gateway.py → POST /api/v1/connectors/wechat/reply)
// authModel: 'relay'         (credentials in ~/.claude/channels/wechat/account.json,
//                             written by /api/v1/connectors/wechat/qr route)
// ---------------------------------------------------------------------------

import fs from 'node:fs';

export class WeChatAdapter implements MessagingChannelAdapter {
  readonly id = 'wechat';
  readonly label = 'WeChat (via iLink clawbot relay)';
  readonly receiveTransport: ReceiveTransport = 'relay';
  readonly authModel = 'relay' as const;

  private _handler: ((msg: IncomingChannelMessage) => void) | null = null;

  /**
   * connect() for the relay transport:
   * Verify that account.json exists and contains an accountId — that is the
   * only check we can do without the gateway running.
   * The gateway daemon (scripts/clawbot/gateway.py) is started externally;
   * this adapter does NOT manage that process.
   */
  async connect(): Promise<{ ok: boolean; reason?: string }> {
    const filePath = channelAccountPath(this.id);
    let raw: string;
    try {
      raw = fs.readFileSync(filePath, { encoding: 'utf-8' });
    } catch {
      return { ok: false, reason: `account.json not found at ${filePath} — scan QR first` };
    }
    let account: Record<string, unknown>;
    try {
      account = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return { ok: false, reason: `account.json at ${filePath} is not valid JSON` };
    }
    if (!account.accountId) {
      return { ok: false, reason: 'account.json present but missing accountId — re-scan QR' };
    }
    return { ok: true };
  }

  /** Relay transport — daemon managed externally; nothing to stop here. */
  async disconnect(): Promise<void> {
    // TODO: if a daemon-manager is added, signal it to stop here.
  }

  /**
   * sendMessage for WeChat relay:
   * The clawbot gateway handles outbound by reading the reply value returned
   * from POST /api/v1/connectors/wechat/reply.  Direct REST send is not
   * implemented here — the Secretary reply string travels back to the caller
   * of that endpoint.
   *
   * TODO: wire iLink sendmessage REST call here once we want adapter-initiated
   * outbound (not just reply-to-inbound).  See gateway.py sendmessage().
   */
  async sendMessage(_to: string, _text: string): Promise<{ ok: boolean; reason?: string }> {
    return {
      ok: false,
      reason:
        'not_implemented: WeChat outbound is handled by the clawbot relay loop, ' +
        'not by adapter-initiated calls. Add iLink sendmessage() here for proactive outbound.',
    };
  }

  /**
   * Register the inbound-message handler.
   * The existing route POST /api/v1/connectors/wechat/reply calls the Secretary
   * directly (via sendWarmTurn).  This handler is reserved for a future refactor
   * where the route delegates to adapter.onMessage instead.
   *
   * TODO: thread this handler into /api/v1/connectors/wechat/reply once the
   * route is refactored to go through the adapter layer.
   */
  onMessage(handler: (msg: IncomingChannelMessage) => void): void {
    this._handler = handler;
  }

  /**
   * Health-check: same logic as GET /api/v1/connectors/wechat/status.
   * Reads account.json and checks for a valid accountId.
   */
  async healthCheck(): Promise<{ connected: boolean; detail?: string }> {
    const filePath = channelAccountPath(this.id);
    let raw: string;
    try {
      raw = fs.readFileSync(filePath, { encoding: 'utf-8' });
    } catch {
      return { connected: false, detail: 'account.json not found' };
    }
    let account: Record<string, unknown>;
    try {
      account = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return { connected: false, detail: 'account.json parse error' };
    }
    if (!account.accountId) {
      return { connected: false, detail: 'accountId missing in account.json' };
    }
    return {
      connected: true,
      detail: `accountId=${String(account.accountId)}`,
    };
  }

  identityKey(senderId: string): string {
    return `wechat:${senderId}`;
  }

  /**
   * Called by the /api/v1/connectors/wechat/reply route (or a future refactored
   * version) to dispatch a received message into the registered handler.
   * This is a relay helper — not part of MessagingChannelAdapter interface.
   */
  dispatchIncoming(msg: IncomingChannelMessage): void {
    if (this._handler) {
      this._handler(msg);
    }
  }
}

// ---------------------------------------------------------------------------
// Stub adapters — implement the interface, methods return not_implemented.
// Real API call site documented in each method comment.
// ---------------------------------------------------------------------------

/**
 * Telegram stub.
 * receiveTransport: 'long-poll'  (getUpdates polling loop)
 * authModel: 'bot-token'         (BotFather token, instant)
 *
 * Real API: https://core.telegram.org/bots/api
 * sendMessage: POST https://api.telegram.org/bot<TOKEN>/sendMessage
 * Receive: GET  https://api.telegram.org/bot<TOKEN>/getUpdates?offset=<offset>&timeout=30
 */
export class TelegramAdapter implements MessagingChannelAdapter {
  readonly id = 'telegram';
  readonly label = 'Telegram';
  readonly receiveTransport: ReceiveTransport = 'long-poll';
  readonly authModel = 'bot-token' as const;

  async connect(): Promise<{ ok: boolean; reason?: string }> {
    // TODO: read channelAccountPath('telegram'), call GET /getMe with bot token to verify.
    return { ok: false, reason: 'not_implemented' };
  }

  async disconnect(): Promise<void> {
    // TODO: cancel the long-poll loop (AbortController).
  }

  async sendMessage(_to: string, _text: string): Promise<{ ok: boolean; reason?: string }> {
    // TODO: POST https://api.telegram.org/bot<TOKEN>/sendMessage { chat_id: to, text }
    return { ok: false, reason: 'not_implemented' };
  }

  onMessage(_handler: (msg: IncomingChannelMessage) => void): void {
    // TODO: store handler; start long-poll loop calling getUpdates and dispatching here.
  }

  async healthCheck(): Promise<{ connected: boolean; detail?: string }> {
    // TODO: GET /getMe and return { connected: true, detail: username }.
    return { connected: false, detail: 'not_implemented' };
  }

  identityKey(senderId: string): string {
    return `telegram:${senderId}`;
  }
}

/**
 * LINE stub.
 * receiveTransport: 'webhook'  (LINE platform POSTs to /api/v1/connectors/line/webhook)
 * authModel: 'bot-token'       (channel access token from LINE Developers Console)
 *
 * Real API: https://developers.line.biz/en/reference/messaging-api/
 * sendMessage (reply): POST https://api.line.me/v2/bot/message/reply
 *   body: { replyToken: string, messages: [{ type: 'text', text: string }] }
 * sendMessage (push, paid): POST https://api.line.me/v2/bot/message/push
 *   body: { to: string, messages: [...] }
 * Signature verification: X-Line-Signature HMAC-SHA256 of body with channel secret.
 */
export class LineAdapter implements MessagingChannelAdapter {
  readonly id = 'line';
  readonly label = 'LINE';
  readonly receiveTransport: ReceiveTransport = 'webhook';
  readonly authModel = 'bot-token' as const;

  async connect(): Promise<{ ok: boolean; reason?: string }> {
    // TODO: read channelAccountPath('line'), call GET https://api.line.me/v2/bot/info
    // to verify channel access token. Register webhook URL via Messaging API if needed.
    return { ok: false, reason: 'not_implemented' };
  }

  async disconnect(): Promise<void> {
    // TODO: optionally deregister webhook URL.
  }

  async sendMessage(_to: string, _text: string): Promise<{ ok: boolean; reason?: string }> {
    // TODO: use reply token (free) when available via push context, else
    // POST https://api.line.me/v2/bot/message/push (metered).
    return { ok: false, reason: 'not_implemented' };
  }

  onMessage(_handler: (msg: IncomingChannelMessage) => void): void {
    // TODO: store handler; the /api/v1/connectors/line/webhook route will call it.
  }

  async healthCheck(): Promise<{ connected: boolean; detail?: string }> {
    // TODO: GET https://api.line.me/v2/bot/info and return display name.
    return { connected: false, detail: 'not_implemented' };
  }

  identityKey(senderId: string): string {
    return `line:${senderId}`;
  }
}

/**
 * KakaoTalk stub.
 * receiveTransport: 'webhook'  (Kakao POSTs ConsultationTalk events to our endpoint)
 * authModel: 'business'        (Kakao Channel ID + Sender Key, registered via Kakao Developers
 *                               or a BSP such as Sinch / Infobip)
 *
 * Real API: https://business.kakao.com/info/bizmessage (Korean docs)
 * AlimTalk (transactional, template-required):
 *   POST https://alimtalk-api.kakao.com/v2/sender/<senderKey>/message
 * ConsultationTalk (inbound, no template approval):
 *   Webhook POST to your endpoint; reply via consultation reply API.
 * Auth: REST API key in Authorization header.
 */
export class KakaoAdapter implements MessagingChannelAdapter {
  readonly id = 'kakao';
  readonly label = 'KakaoTalk';
  readonly receiveTransport: ReceiveTransport = 'webhook';
  readonly authModel = 'business' as const;

  async connect(): Promise<{ ok: boolean; reason?: string }> {
    // TODO: read channelAccountPath('kakao'), verify Sender Key via
    // GET https://alimtalk-api.kakao.com/v2/sender/<senderKey>.
    return { ok: false, reason: 'not_implemented' };
  }

  async disconnect(): Promise<void> {
    // TODO: optionally deregister webhook.
  }

  async sendMessage(_to: string, _text: string): Promise<{ ok: boolean; reason?: string }> {
    // TODO: ConsultationTalk reply or AlimTalk (template required for outbound-initiated).
    // POST https://alimtalk-api.kakao.com/v2/sender/<senderKey>/message
    return { ok: false, reason: 'not_implemented' };
  }

  onMessage(_handler: (msg: IncomingChannelMessage) => void): void {
    // TODO: store handler; /api/v1/connectors/kakao/webhook route will call it.
  }

  async healthCheck(): Promise<{ connected: boolean; detail?: string }> {
    // TODO: GET sender info from Kakao API and return senderKey / status.
    return { connected: false, detail: 'not_implemented' };
  }

  identityKey(senderId: string): string {
    return `kakao:${senderId}`;
  }
}

// ---------------------------------------------------------------------------
// Bootstrap: register all adapters into the shared registry.
// WeChat is the reference ("real-ish") implementation; the rest are stubs.
// ---------------------------------------------------------------------------

registerChannelAdapter(new WeChatAdapter());
registerChannelAdapter(new TelegramAdapter());
registerChannelAdapter(new LineAdapter());
registerChannelAdapter(new KakaoAdapter());

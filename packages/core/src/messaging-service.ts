/**
 * messaging-service.ts — thin sender module for webhook/token-based channels.
 *
 * Supports Slack (incoming webhook), Discord (channel webhook), and Telegram
 * (Bot API sendMessage). Credentials are owner-scoped (like voice STT/TTS keys).
 * Never throws to the caller — all errors are returned as {ok:false, error}.
 */

export type MessagingChannel = 'slack' | 'discord' | 'telegram';

export interface TelegramCfg {
  telegram_bot_token: string | null | undefined;
  telegram_chat_id: string | null | undefined;
}

export interface SlackCfg {
  slack_webhook_url: string | null | undefined;
}

export interface DiscordCfg {
  discord_webhook_url: string | null | undefined;
}

export type MessagingCfg = SlackCfg & DiscordCfg & TelegramCfg;

export interface MessagingSendResult {
  ok: boolean;
  error?: string;
}

/**
 * Send a test message to the given channel using the provided owner config.
 * Returns {ok:true} on success, {ok:false, error} on any failure.
 * Never throws.
 */
export async function sendMessagingTest(
  channel: MessagingChannel,
  cfg: MessagingCfg,
  text: string,
): Promise<MessagingSendResult> {
  if (channel === 'slack') {
    const url = cfg.slack_webhook_url?.trim();
    if (!url) return { ok: false, error: 'Slack webhook URL is not configured.' };
    return doPost(url, { text }, 'Slack');
  }

  if (channel === 'discord') {
    const url = cfg.discord_webhook_url?.trim();
    if (!url) return { ok: false, error: 'Discord webhook URL is not configured.' };
    return doPost(url, { content: text }, 'Discord');
  }

  if (channel === 'telegram') {
    const token = cfg.telegram_bot_token?.trim();
    const chatId = cfg.telegram_chat_id?.trim();
    if (!token) return { ok: false, error: 'Telegram bot token is not configured.' };
    if (!chatId) return { ok: false, error: 'Telegram chat ID is not configured.' };
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    return doPost(url, { chat_id: chatId, text }, 'Telegram');
  }

  return { ok: false, error: `Unknown channel: ${channel as string}` };
}

async function doPost(
  url: string,
  payload: Record<string, unknown>,
  label: string,
): Promise<MessagingSendResult> {
  let resp: Response;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (fetchErr) {
    const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
    return { ok: false, error: `Network error reaching ${label}: ${msg}` };
  }

  if (resp.ok) return { ok: true };

  let detail = '';
  try {
    const text = await resp.text();
    detail = text.slice(0, 240);
  } catch (_readErr) {
    // ignore — we still have the status code
  }
  return {
    ok: false,
    error: detail
      ? `${label} returned HTTP ${resp.status}: ${detail}`
      : `${label} returned HTTP ${resp.status}`,
  };
}

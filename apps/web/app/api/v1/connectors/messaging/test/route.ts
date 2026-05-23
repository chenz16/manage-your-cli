import { NextResponse } from 'next/server';
import { getOwner, sendMessagingTest, type MessagingChannel } from '@holon/core';

const VALID_CHANNELS = new Set<string>(['slack', 'discord', 'telegram']);

function parseChannel(value: unknown): MessagingChannel | null {
  if (typeof value === 'string' && VALID_CHANNELS.has(value)) return value as MessagingChannel;
  return null;
}

/**
 * POST /api/v1/connectors/messaging/test
 * Body: { channel: 'slack' | 'discord' | 'telegram' }
 *
 * Reads owner config for the channel's credentials and sends a test message.
 * Returns { ok: true } on success, { ok: false, error } on failure.
 */
export async function POST(req: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch (parseErr) {
    void parseErr;
    return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400 });
  }

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ ok: false, error: 'expected object body' }, { status: 400 });
  }

  const channel = parseChannel((body as Record<string, unknown>).channel);
  if (!channel) {
    return NextResponse.json(
      { ok: false, error: 'channel must be one of: slack, discord, telegram' },
      { status: 400 },
    );
  }

  const owner = getOwner();
  const result = await sendMessagingTest(
    channel,
    {
      slack_webhook_url: owner.slack_webhook_url,
      discord_webhook_url: owner.discord_webhook_url,
      telegram_bot_token: owner.telegram_bot_token,
      telegram_chat_id: owner.telegram_chat_id,
    },
    'Holon test message',
  );

  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/chat/history?thread=<threadId>
 *
 * Returns the desk transcript for a given chat thread.
 * Auth: requireDeviceTokenForRemote — works from loopback (desk) and
 * from a paired mobile device (bearer device token).
 *
 * Thread IDs:
 *   thread=owner           — 小秘 owner chat
 *   thread=staff:<staffId> — per-staff 1:1 chat
 *
 * Optional:
 *   limit=<number> — return only the last N messages (default: all, capped at 500)
 *
 * Response: { messages: TranscriptMessage[] }
 * Messages are ordered oldest-first.
 */

import { NextResponse } from 'next/server';
import { readChatTranscript } from '@holon/core';
import { deviceAuthErrorResponse, requireDeviceTokenForRemote } from '@/lib/device-token-auth';

const MAX_LIMIT = 500;

export async function GET(req: Request): Promise<Response> {
  const auth = requireDeviceTokenForRemote(req);
  if (!auth.ok) return deviceAuthErrorResponse(auth);

  const url = new URL(req.url);
  const thread = url.searchParams.get('thread');
  if (!thread) {
    return NextResponse.json(
      { error: 'missing required query param: thread', code: 'missing_thread' },
      { status: 400 },
    );
  }

  // Validate thread ID shape to prevent arbitrary key injection.
  // Valid: 'owner', 'staff:<id>', or 'project:<id>' where id is alphanumeric + underscore/dash/dot.
  const isValidThread =
    thread === 'owner' ||
    /^staff:[a-zA-Z0-9_\-.]+$/.test(thread) ||
    /^project:[a-zA-Z0-9_\-.]+$/.test(thread);
  if (!isValidThread) {
    return NextResponse.json(
      { error: 'invalid thread id format', code: 'invalid_thread' },
      { status: 400 },
    );
  }

  const rawLimit = url.searchParams.get('limit');
  let limit: number | undefined;
  if (rawLimit !== null) {
    const parsed = parseInt(rawLimit, 10);
    if (!isNaN(parsed) && parsed > 0) {
      limit = Math.min(parsed, MAX_LIMIT);
    }
  }

  const messages = readChatTranscript(thread, limit);

  return NextResponse.json({ messages });
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

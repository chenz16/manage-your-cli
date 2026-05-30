/**
 * GET /api/v1/rooms/[id]/history
 *
 * Returns the room's multi-party transcript (thread `room:<id>`).
 * Response: { messages: Array<{ role, content, ts, author? }> }
 * Messages are ordered oldest-first (mirrors /api/v1/chat/history shape).
 *
 * Author extraction: messages stored by the room chat route embed the author
 * as a sentinel prefix "\x00AUTHOR:<json>\x00<actual content>". This route
 * parses that prefix out before returning so mobile receives clean { role,
 * content, ts, author }.
 */

import { NextResponse } from 'next/server';
import { getRoom, readChatTranscript } from '@holon/core';
import { deviceAuthErrorResponse, requireDeviceTokenForRemote } from '@/lib/device-token-auth';
import type { RoomMessageAuthor } from '@holon/api-contract';

interface Context { params: Promise<{ id: string }> }

const MAX_LIMIT = 500;

/** Parse the AUTHOR sentinel prefix out of message content.
 *  Returns { author, content } — content is the real text without the prefix. */
function parseRoomContent(raw: string): { content: string; author: RoomMessageAuthor | undefined } {
  if (!raw.startsWith('\x00AUTHOR:')) {
    return { content: raw, author: undefined };
  }
  const endIdx = raw.indexOf('\x00', 8); // 8 = length of "\x00AUTHOR:"
  if (endIdx === -1) {
    return { content: raw, author: undefined };
  }
  const authorJson = raw.slice(8, endIdx);
  const content = raw.slice(endIdx + 1);
  try {
    const author = JSON.parse(authorJson) as RoomMessageAuthor;
    return { content, author };
  } catch {
    return { content: raw, author: undefined };
  }
}

export async function GET(req: Request, ctx: Context): Promise<Response> {
  const auth = requireDeviceTokenForRemote(req);
  if (!auth.ok) return deviceAuthErrorResponse(auth);

  const { id } = await ctx.params;
  const room = getRoom(id);
  if (!room) return NextResponse.json({ error: 'room not found', id }, { status: 404 });

  const url = new URL(req.url);
  const rawLimit = url.searchParams.get('limit');
  let limit: number | undefined;
  if (rawLimit !== null) {
    const parsed = parseInt(rawLimit, 10);
    if (!isNaN(parsed) && parsed > 0) limit = Math.min(parsed, MAX_LIMIT);
  }

  const threadId = `room:${id}`;
  const raw = readChatTranscript(threadId, limit);

  const messages = raw.map((m) => {
    const { content, author } = parseRoomContent(m.content);
    return author !== undefined
      ? { role: m.role, content, ts: m.ts, author }
      : { role: m.role, content, ts: m.ts };
  });

  return NextResponse.json({ messages });
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

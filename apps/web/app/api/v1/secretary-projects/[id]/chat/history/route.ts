/**
 * GET /api/v1/secretary-projects/:id/chat/history
 *
 * Proxy to /api/v1/chat/history with thread=project:{id}.
 * Returns the chat transcript for this project's secretary.
 *
 * Auth: device-token.
 */

import { NextResponse } from 'next/server';
import { deviceAuthErrorResponse, requireDeviceTokenForRemote } from '@/lib/device-token-auth';
import { getSecretaryProject, readChatTranscript, secretaryProjectThreadId } from '@holon/core';

type RouteParams = { params: Promise<{ id: string }> };

const MAX_LIMIT = 500;

export async function GET(req: Request, { params }: RouteParams): Promise<NextResponse> {
  const auth = requireDeviceTokenForRemote(req);
  if (!auth.ok) return deviceAuthErrorResponse(auth) as unknown as NextResponse;

  const { id } = await params;
  const project = getSecretaryProject(id);
  if (!project) {
    return NextResponse.json({ error: 'project not found', id }, { status: 404 });
  }

  const url = new URL(req.url);
  const rawLimit = url.searchParams.get('limit');
  let limit: number | undefined;
  if (rawLimit !== null) {
    const parsed = parseInt(rawLimit, 10);
    if (!isNaN(parsed) && parsed > 0) {
      limit = Math.min(parsed, MAX_LIMIT);
    }
  }

  const threadId = secretaryProjectThreadId(id);
  const messages = readChatTranscript(threadId, limit);

  return NextResponse.json({ messages, thread: threadId });
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

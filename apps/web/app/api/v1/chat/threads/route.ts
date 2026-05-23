/**
 * BFF route: GET /api/v1/chat/threads
 *
 * Returns ListChatThreadsResponse — the 3 fixture chat threads
 * (Myself / Aria / Wang). Send-message handler is declared in
 * api-contract but deferred to iter-008+ (real Hermes loop).
 */

import { NextResponse } from 'next/server';
import { listChatThreads } from '@holon/core';

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(listChatThreads());
}

export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { listTmuxSessions } from '@holon/core';
import { requireDeviceTokenForRemote, deviceAuthErrorResponse } from '@/lib/device-token-auth';

/**
 * GET /api/v1/cli/discover — list tmux sessions on this machine so the owner can
 * "adopt" an existing CLI session as an employee. Non-tmux processes are out of
 * scope by design. { sessions: DiscoveredTmuxSession[] }
 */
export async function GET(req: Request): Promise<NextResponse | Response> {
  const auth = requireDeviceTokenForRemote(req);
  if (!auth.ok) return deviceAuthErrorResponse(auth);
  return NextResponse.json({ sessions: listTmuxSessions() });
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

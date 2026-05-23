import { NextResponse } from 'next/server';
import { launchCliSession } from '@holon/core';

interface Context { params: Promise<{ id: string }> }

/**
 * POST /api/v1/staff/:id/cli/launch — start the tmux-backed CLI
 * session for this staff (passthrough mode, iter-007 step 8).
 *
 * Idempotent: if a session already exists for this staff, returns
 * already_running=true. Returns the local-attach command the user can
 * run in a terminal to share the session (the "transparent monitoring"
 * piece of the design).
 */
export async function POST(_req: Request, ctx: Context): Promise<NextResponse> {
  const { id } = await ctx.params;
  const r = launchCliSession(id);
  if (!r.ok) {
    const status = r.reason === 'staff_not_found' ? 404 : 400;
    return NextResponse.json({ error: r.reason }, { status });
  }
  return NextResponse.json(r);
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

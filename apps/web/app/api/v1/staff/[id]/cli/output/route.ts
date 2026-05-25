import { NextResponse } from 'next/server';
import { captureCliOutput, getStaffMerged } from '@holon/core';

interface Context { params: Promise<{ id: string }> }

/**
 * GET /api/v1/staff/:id/cli/output?lines=N — read-only snapshot of a CLI staff's
 * terminal (screen + scrollback) so the Secretary can summarise what
 * the worker did. Does NOT send any input.
 *
 * Response: { ok, output?, reason? }
 */
export async function GET(req: Request, ctx: Context): Promise<NextResponse> {
  const { id } = await ctx.params;
  // BUG-006: a missing staff is a distinct 404, not a no_session (which the
  // mobile terminal renders as "session not running").
  if (!getStaffMerged(id)) {
    return NextResponse.json({ ok: false, error: 'staff not found', code: 'not_found' }, { status: 404 });
  }
  // BUG-009: if `lines` is present it must be a positive integer — don't silently
  // fall back to 200 on garbage input.
  const rawLines = new URL(req.url).searchParams.get('lines');
  let lines = 200;
  if (rawLines !== null) {
    const n = Number(rawLines);
    if (!Number.isInteger(n) || n <= 0) {
      return NextResponse.json({ ok: false, error: 'lines must be a positive integer', code: 'invalid_lines' }, { status: 400 });
    }
    lines = n;
  }
  const r = captureCliOutput(id, lines);
  // no_session (running worker absent) is a 409 Conflict, not a 400.
  return NextResponse.json(r, { status: r.ok ? 200 : 409 });
}

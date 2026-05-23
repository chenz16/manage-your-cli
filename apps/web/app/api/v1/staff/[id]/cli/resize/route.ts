import { NextResponse } from 'next/server';
import { resizeCliSession } from '@holon/core';

interface Context { params: Promise<{ id: string }> }

/**
 * POST /api/v1/staff/:id/cli/resize — sync the tmux window size to the
 * frontend xterm grid so the cursor + line wrapping line up. Called by the
 * CliTerminal right after it fits and on every resize.
 *
 * Body: { cols: number, rows: number }
 */
export async function POST(req: Request, ctx: Context): Promise<NextResponse> {
  const { id } = await ctx.params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const cols = Number((body as Record<string, unknown>)?.cols);
  const rows = Number((body as Record<string, unknown>)?.rows);
  if (!Number.isFinite(cols) || !Number.isFinite(rows)) {
    return NextResponse.json({ error: 'cols and rows (numbers) required' }, { status: 400 });
  }
  const r = resizeCliSession(id, cols, rows);
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}

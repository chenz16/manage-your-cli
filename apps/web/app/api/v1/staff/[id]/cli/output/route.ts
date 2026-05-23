import { NextResponse } from 'next/server';
import { captureCliOutput } from '@holon/core';

interface Context { params: Promise<{ id: string }> }

/**
 * GET /api/v1/staff/:id/cli/output?lines=N — read-only snapshot of a CLI staff's
 * terminal (screen + scrollback) so the Sr Manager (Hermes) can summarise what
 * the worker did. Does NOT send any input.
 *
 * Response: { ok, output?, reason? }
 */
export async function GET(req: Request, ctx: Context): Promise<NextResponse> {
  const { id } = await ctx.params;
  const linesParam = Number(new URL(req.url).searchParams.get('lines') ?? '200');
  const r = captureCliOutput(id, Number.isFinite(linesParam) ? linesParam : 200);
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}

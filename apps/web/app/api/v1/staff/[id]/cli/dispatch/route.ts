import { NextResponse } from 'next/server';
import { dispatchCliTask } from '@holon/core';

interface Context { params: Promise<{ id: string }> }

/**
 * POST /api/v1/staff/:id/cli/dispatch — ADR-040 slice 1.
 *
 * Assemble the cli_agent staff's context preamble (role + manager-owned memory +
 * this task brief) and inject it into the staff's CLI session, launching the
 * session first if needed. Returns the preamble that was injected. The CLI does
 * the work in its own session (watch it via /cli/stream); deliverable capture is
 * slice 2.
 *
 * Body: { brief: string }
 * Response: { ok, launched, preamble, reason? }
 */
export async function POST(req: Request, ctx: Context): Promise<NextResponse> {
  const { id } = await ctx.params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'expected object' }, { status: 400 });
  }
  const brief = typeof (body as Record<string, unknown>).brief === 'string'
    ? ((body as Record<string, unknown>).brief as string)
    : '';
  if (!brief.trim()) {
    return NextResponse.json({ error: 'brief required' }, { status: 400 });
  }

  const result = await dispatchCliTask({ staffId: id, brief });
  if (!result.ok) {
    const status = result.reason === 'staff_not_found' ? 404
      : result.reason === 'not_a_cli_agent' ? 409
      : 400;
    return NextResponse.json(result, { status });
  }
  return NextResponse.json(result);
}

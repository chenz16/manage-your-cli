import { NextResponse } from 'next/server';
import { sendKeys } from '@holon/core';

interface Context { params: Promise<{ id: string }> }

/**
 * POST /api/v1/staff/:id/cli/input — send keystrokes to the staff's
 * tmux session. Body: { input: string, enter?: boolean }
 *
 * Default `enter=true` (send Enter after the text) so commands fire
 * immediately. For partial input / interactive prompts, set
 * enter=false.
 */
export async function POST(req: Request, ctx: Context): Promise<NextResponse> {
  const { id } = await ctx.params;
  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'expected object' }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  const input = typeof b.input === 'string' ? b.input : '';
  if (!input) return NextResponse.json({ error: 'input required' }, { status: 400 });
  const enter = b.enter !== false;

  const r = sendKeys(id, input, enter);
  if (!r.ok) {
    const status = r.reason === 'no_session' ? 409 : 500;
    return NextResponse.json({ error: r.reason }, { status });
  }
  return NextResponse.json({ ok: true });
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

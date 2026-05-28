import { NextResponse } from 'next/server';
import { sendKeys, captureCliOutput, getStaffMerged } from '@holon/core';
import { scheduleAdoptedSummary } from '@/lib/adopted-summarizer';

interface Context { params: Promise<{ id: string }> }

/**
 * POST /api/v1/staff/:id/cli/input — send keystrokes to the staff's
 * tmux session. Body: { input: string, enter?: boolean, summarize?: boolean }
 *
 * Default `enter=true` (send Enter after the text) so commands fire
 * immediately. For partial input / interactive prompts, set enter=false.
 * When `summarize: true`, captures pane before send and fires the
 * adopted-summarizer fire-and-forget after a successful sendKeys.
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
  const wantSummary = b.summarize === true;

  // Capture pane before send when client requests summarization.
  const preCapture = wantSummary ? captureCliOutput(id) : null;
  const preScreen = preCapture?.ok ? (preCapture.output ?? '') : '';

  const r = sendKeys(id, input, enter);
  if (!r.ok) {
    const status = r.reason === 'no_session' ? 409 : 500;
    return NextResponse.json({ error: r.reason }, { status });
  }

  // Fire-and-forget summarizer when client opted in. Pass input so haiku can
  // subtract the echo and summarize ONLY the CLI's response.
  if (wantSummary) {
    const staff = getStaffMerged(id);
    const cwd = staff?.substrate.kind === 'cli_agent' ? staff.substrate.cwd : undefined;
    scheduleAdoptedSummary(id, cwd, preScreen, input);
  }

  return NextResponse.json({ ok: true });
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

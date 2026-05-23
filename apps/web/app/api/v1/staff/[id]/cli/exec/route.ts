import { NextResponse } from 'next/server';
import { launchCliSession, sendKeys, getCliStatus, subscribeOutput } from '@holon/core';

interface Context { params: Promise<{ id: string }> }

/**
 * POST /api/v1/staff/:id/cli/exec — fire a single command at a CLI
 * staff's tmux session and return its output.
 *
 * iter-008 Phase 4. Convenience wrapper for the secretary's `cli_exec`
 * tool. Equivalent to (launch if needed) + (send-keys) + (subscribe
 * for wait_ms) + return-buffer. Idempotent on launch.
 *
 * Body: { command: string, wait_ms?: number }
 * Response: { ok: true, output: string, truncated: boolean }
 *
 * Caveat: bash output mixes echo of the typed command + ANSI codes +
 * actual output + new prompt. The caller (secretary LLM) is
 * responsible for parsing what matters. We give the raw text.
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
  const command = typeof b.command === 'string' ? b.command.trim() : '';
  if (!command) return NextResponse.json({ error: 'command required' }, { status: 400 });
  const waitMs = typeof b.wait_ms === 'number' && b.wait_ms > 0 && b.wait_ms <= 30_000
    ? Math.floor(b.wait_ms) : 2500;

  // Auto-launch if not running.
  if (!getCliStatus(id).running) {
    const l = launchCliSession(id);
    if (!l.ok) return NextResponse.json({ error: l.reason }, { status: 400 });
    // Give bash a beat to print its prompt.
    await new Promise((r) => setTimeout(r, 400));
  }

  // Capture output that arrives starting from THIS moment forward —
  // not the scrollback. We subscribe before sending the keys, then
  // wait wait_ms, unsubscribe.
  let captured = '';
  const sub = subscribeOutput(id, (chunk) => { captured += chunk; });
  // Reset captured to drop scrollback (subscribeOutput returns it via
  // a different field; the callback only gets future chunks). We
  // ignore sub.scrollback intentionally.
  void sub.scrollback;

  const r = sendKeys(id, command, true);
  if (!r.ok) {
    sub.unsubscribe();
    return NextResponse.json({ error: r.reason ?? 'send_failed' }, { status: 500 });
  }

  await new Promise((res) => setTimeout(res, waitMs));
  sub.unsubscribe();

  const MAX = 8_000;
  const truncated = captured.length > MAX;
  return NextResponse.json({
    ok: true,
    output: truncated ? captured.slice(-MAX) : captured,
    truncated,
  });
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

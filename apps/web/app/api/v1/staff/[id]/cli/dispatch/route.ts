import { NextResponse } from 'next/server';
import { dispatchCliTask } from '@holon/core';
import { collectOnDispatchComplete } from '@/lib/synthetic-producers';
import { enqueueSyntheticMessages } from '@/lib/warm-agent';
import { get as getProcessEntry, list as listProcesses } from '@/lib/process-registry';

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

  // HR Path B — slice 2. Score the just-completed dispatch via registered
  // SyntheticProducers (currently just hr-path-b). Wrap in try/catch: HR
  // scoring must NEVER fail a real dispatch. Per ADR §4.3 the nudges land
  // on the secretary's NEXT inbound, so we enqueue against the
  // secretary's warm-agent key (parent of this tmux-employee dispatch).
  try {
    // Look up the tmux-employee entry for this staff id, then walk up to
    // its parent warm-secretary (the agent whose next inbound will see the
    // nudge). If no employee entry exists yet (first dispatch), score the
    // staff id directly.
    const employee = getProcessEntry(id) ?? listProcesses((e) => e.key.endsWith(`:${id}`))[0];
    const scoringEntry = employee ?? {
      key: id,
      pid: 0,
      kind: 'tmux-employee' as const,
      lastHeartbeatAt: Date.now(),
      status: 'alive' as const,
      createdAt: Date.now(),
    };
    const synth = await collectOnDispatchComplete(scoringEntry, result);
    if (synth.length > 0) {
      // Default: nudges target the SECRETARY (the dispatcher), not the
      // employee — secretary-HR scope per ADR §4.1. The secretary key is
      // the parentKey, or absent that, scoped-to-this-employee is fine
      // (owner-HR scope falls through). We probe for a warm secretary.
      const parentKey = scoringEntry.parentKey;
      const secretaryKey = parentKey?.startsWith('warm:') ? parentKey.slice('warm:'.length) : null;
      if (secretaryKey) {
        enqueueSyntheticMessages(secretaryKey, synth);
      }
    }
  } catch (err) {
    // Audit only — never fail the dispatch on HR error.
    console.warn(JSON.stringify({
      audit: 'hr.dispatch_score_error',
      staff_id: id,
      error: err instanceof Error ? err.message : String(err),
      ts: new Date().toISOString(),
    }));
  }

  return NextResponse.json(result);
}

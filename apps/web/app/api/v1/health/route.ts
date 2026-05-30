import { NextResponse } from 'next/server';
import { list as listProcesses, pidAlive } from '@/lib/process-registry';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/v1/health — desk + agent liveness snapshot for mobile indicators
 * and ops triage. Returns the process registry contents annotated with
 * current pid alive check (in case heartbeat ticker hasn't run yet).
 */
export async function GET(): Promise<NextResponse> {
  const entries = listProcesses().map((e) => ({
    ...e,
    pidAlive: pidAlive(e.pid),
  }));
  const byKind = entries.reduce<Record<string, number>>((acc, e) => {
    acc[e.kind] = (acc[e.kind] ?? 0) + 1;
    return acc;
  }, {});
  return NextResponse.json({
    desk: 'ok',
    ts: new Date().toISOString(),
    counts: byKind,
    processes: entries,
  });
}

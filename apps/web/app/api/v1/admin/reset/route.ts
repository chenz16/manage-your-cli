import { NextResponse } from 'next/server';
import { clearAllCliSessions, clearMutableStore } from '@holon/core';

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    runtime: 'cli-only',
    persisted_artifacts: {
      fixtures: 'read-only baseline',
    },
  });
}

export async function POST(): Promise<NextResponse> {
  const storeRes = clearMutableStore();
  const cliRes = clearAllCliSessions();
  return NextResponse.json({
    ok: true,
    store: storeRes,
    cli_sessions: cliRes,
    note: 'CLI tmux sessions and thin-core runtime state wiped.',
  });
}

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/todos — list owner's personal work queue items.
 *
 * Supports `?project_id=<id>` filter (Phase 1).
 * Auth posture: requireDeviceTokenForRemote (same as /api/v1/deliverables).
 *
 * The work queue is the owner's personal task list (WorkQueueItem);
 * distinct from staff jobs. Lives in `my_work_queue` fixture field.
 */

import { NextResponse } from 'next/server';
import { listTodos } from '@holon/core';
import { requireDeviceTokenForRemote } from '@/lib/device-token-auth';

export async function GET(req: Request): Promise<NextResponse> {
  const auth = requireDeviceTokenForRemote(req);
  if (!auth.ok) {
    return NextResponse.json(
      { error: 'device authentication required', code: auth.code },
      { status: auth.status },
    );
  }

  const url = new URL(req.url);
  const projectIdParam = url.searchParams.get('project_id');
  // null param = return all; string = filter to project
  const input: Parameters<typeof listTodos>[0] = {};
  if (projectIdParam !== null) input.project_id = projectIdParam;

  const items = listTodos(input);
  return NextResponse.json({ items });
}

export const dynamic = 'force-dynamic';

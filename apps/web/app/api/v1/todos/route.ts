/**
 * GET  /api/v1/todos — list boss-backlog todos (todo-store, SQLite-backed).
 * POST /api/v1/todos — add a new todo. Body: { text, priority?, due_date? }
 *
 * Supports `?project_id=<id>` query param (Phase 1 compat; todos currently
 * don't have project_id, so the param is accepted and ignored).
 *
 * Auth posture: requireDeviceTokenForRemote (same as /api/v1/deliverables).
 */

import { NextResponse } from 'next/server';
import { listTodos, addTodo } from '@holon/core';
import { AddTodoBody } from '@holon/api-contract';
import { requireDeviceTokenForRemote } from '@/lib/device-token-auth';

export const dynamic = 'force-dynamic';

/** GET /api/v1/todos — list all todos, newest first. */
export async function GET(req: Request): Promise<NextResponse> {
  const auth = requireDeviceTokenForRemote(req);
  if (!auth.ok) {
    return NextResponse.json(
      { error: 'device authentication required', code: auth.code },
      { status: auth.status },
    );
  }

  // project_id filter accepted for API compat; todo-store items don't carry
  // project_id yet (future extension point).
  const _url = new URL(req.url);
  const _projectId = _url.searchParams.get('project_id');
  void _projectId; // reserved for future use

  const items = listTodos();
  return NextResponse.json({ items });
}

/** POST /api/v1/todos — add a new todo. Body: { text: string, priority?, due_date? } */
export async function POST(req: Request): Promise<NextResponse> {
  const auth = requireDeviceTokenForRemote(req);
  if (!auth.ok) {
    return NextResponse.json(
      { error: 'device authentication required', code: auth.code },
      { status: auth.status },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const parsed = AddTodoBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'text (string, min 1) required', issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const todo = addTodo(parsed.data.text, parsed.data.priority, parsed.data.due_date ?? null);
  return NextResponse.json(todo, { status: 201 });
}

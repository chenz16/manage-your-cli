import { NextResponse } from 'next/server';
import { updateTodo, deleteTodo } from '@holon/core';
import { UpdateTodoBody } from '@holon/api-contract';

export const dynamic = 'force-dynamic';

/** PATCH /api/v1/todos/[id] — update status and/or text. */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const parsed = UpdateTodoBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid patch body', issues: parsed.error.issues }, { status: 400 });
  }
  // Strip undefined values so the patch satisfies exactOptionalPropertyTypes.
  const patch: { status?: 'pending' | 'delegated' | 'done'; text?: string } = {};
  if (parsed.data.status !== undefined) patch.status = parsed.data.status;
  if (parsed.data.text !== undefined) patch.text = parsed.data.text;
  const updated = updateTodo(id, patch);
  if (!updated) {
    return NextResponse.json({ error: 'todo not found' }, { status: 404 });
  }
  return NextResponse.json(updated);
}

/** DELETE /api/v1/todos/[id] — delete a todo. */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const deleted = deleteTodo(id);
  if (!deleted) {
    return NextResponse.json({ error: 'todo not found' }, { status: 404 });
  }
  return new NextResponse(null, { status: 204 });
}

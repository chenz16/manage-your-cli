import { NextResponse } from 'next/server';
import { listTodos, addTodo } from '@holon/core';
import { AddTodoBody } from '@holon/api-contract';

export const dynamic = 'force-dynamic';

/** GET /api/v1/todos — list all todos, newest first. */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ items: listTodos() });
}

/** POST /api/v1/todos — add a new todo. Body: { text: string } */
export async function POST(req: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const parsed = AddTodoBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'text (string, min 1) required', issues: parsed.error.issues }, { status: 400 });
  }
  const todo = addTodo(parsed.data.text, parsed.data.priority);
  return NextResponse.json(todo, { status: 201 });
}

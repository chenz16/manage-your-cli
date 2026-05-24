/**
 * PATCH /api/v1/projects/:id — rename or archive a project.
 * DELETE /api/v1/projects/:id — delete a project.
 *
 * Auth posture: requireDeviceTokenForRemote (same as /api/v1/deliverables).
 */

import { NextResponse } from 'next/server';
import { requireDeviceTokenForRemote } from '@/lib/device-token-auth';
import { getProject, updateProject, deleteProject } from '@holon/core';

type RouteParams = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: RouteParams): Promise<NextResponse> {
  const auth = requireDeviceTokenForRemote(req);
  if (!auth.ok) {
    return NextResponse.json(
      { error: 'device authentication required', code: auth.code },
      { status: auth.status },
    );
  }

  const { id } = await params;
  const existing = getProject(id);
  if (!existing) {
    return NextResponse.json({ error: 'project not found', id }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'body must be an object' }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  const patch: { name?: string; color?: string; archived?: boolean } = {};
  if (typeof b.name === 'string') {
    if (!b.name.trim()) return NextResponse.json({ error: 'name must be non-empty' }, { status: 400 });
    patch.name = b.name.trim();
  }
  if (typeof b.color === 'string') patch.color = b.color;
  if (typeof b.archived === 'boolean') patch.archived = b.archived;

  const updated = updateProject(id, patch);
  if (!updated) {
    return NextResponse.json({ error: 'project not found', id }, { status: 404 });
  }

  return NextResponse.json({ project: updated });
}

export async function DELETE(req: Request, { params }: RouteParams): Promise<NextResponse> {
  const auth = requireDeviceTokenForRemote(req);
  if (!auth.ok) {
    return NextResponse.json(
      { error: 'device authentication required', code: auth.code },
      { status: auth.status },
    );
  }

  const { id } = await params;
  const deleted = deleteProject(id);
  if (!deleted) {
    return NextResponse.json({ error: 'project not found', id }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}

export const dynamic = 'force-dynamic';

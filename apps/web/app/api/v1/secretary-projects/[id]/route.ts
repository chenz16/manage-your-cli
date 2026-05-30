/**
 * PATCH /api/v1/secretary-projects/:id — rename / recolor a project.
 * DELETE /api/v1/secretary-projects/:id — delete (409 if last project).
 *
 * Auth: device-token.
 */

import { NextResponse } from 'next/server';
import { deviceAuthErrorResponse, requireDeviceTokenForRemote } from '@/lib/device-token-auth';
import { getSecretaryProject, updateSecretaryProject, deleteSecretaryProject } from '@holon/core';

type RouteParams = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: RouteParams): Promise<NextResponse> {
  const auth = requireDeviceTokenForRemote(req);
  if (!auth.ok) return deviceAuthErrorResponse(auth) as unknown as NextResponse;

  const { id } = await params;
  const existing = getSecretaryProject(id);
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

  const patch: { name?: string; color?: string } = {};
  if (typeof b.name === 'string') {
    if (!b.name.trim()) return NextResponse.json({ error: 'name must be non-empty' }, { status: 400 });
    patch.name = b.name.trim();
  }
  if (typeof b.color === 'string') patch.color = b.color;

  const updated = updateSecretaryProject(id, patch);
  if (!updated) {
    return NextResponse.json({ error: 'project not found', id }, { status: 404 });
  }

  return NextResponse.json({ project: updated });
}

export async function DELETE(req: Request, { params }: RouteParams): Promise<NextResponse> {
  const auth = requireDeviceTokenForRemote(req);
  if (!auth.ok) return deviceAuthErrorResponse(auth) as unknown as NextResponse;

  const { id } = await params;
  const result = deleteSecretaryProject(id);

  if (!result.ok) {
    if (result.reason === 'not_found') {
      return NextResponse.json({ error: 'project not found', id }, { status: 404 });
    }
    if (result.reason === 'last_project') {
      return NextResponse.json(
        { error: 'cannot delete the only project', code: 'last_project' },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: result.reason ?? 'delete failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

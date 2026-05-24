/**
 * GET /api/v1/projects — list projects for the desk.
 * POST /api/v1/projects — create a project (auto-slug from name).
 *
 * Auth posture: requireDeviceTokenForRemote (same as /api/v1/deliverables).
 * Boss-memory scaffold: writeBossMemory('projects/<slug>', ...) on create.
 */

import { NextResponse } from 'next/server';
import { requireDeviceTokenForRemote } from '@/lib/device-token-auth';
import { createProject, listProjects } from '@holon/core';
import { writeBossMemory } from '@holon/core';
import { loadFixtures } from '@holon/core';

export async function GET(req: Request): Promise<NextResponse> {
  const auth = requireDeviceTokenForRemote(req);
  if (!auth.ok) {
    return NextResponse.json(
      { error: 'device authentication required', code: auth.code },
      { status: auth.status },
    );
  }

  const url = new URL(req.url);
  const includeArchived = url.searchParams.get('include_archived') === 'true';
  const items = listProjects({ include_archived: includeArchived });
  return NextResponse.json({ items });
}

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

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'name required' }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  if (typeof b.name !== 'string' || !b.name.trim()) {
    return NextResponse.json({ error: 'name must be a non-empty string' }, { status: 400 });
  }

  const fx = loadFixtures();
  const desk_id = fx.primary_desk_id;

  const project = createProject({
    desk_id,
    name: b.name.trim(),
    ...(typeof b.color === 'string' ? { color: b.color } : {}),
  });

  // Phase 1 boss-memory scaffold: write the project memory scope so the
  // Secretary can read it when this project is active. Uses the existing
  // writeBossMemory() — zero new infra (per design doc § 9 item 7).
  writeBossMemory(`projects/${project.slug}`, `Project: ${project.name}\nCreated: ${project.created_at}\n`);

  return NextResponse.json({ project }, { status: 201 });
}

export const dynamic = 'force-dynamic';

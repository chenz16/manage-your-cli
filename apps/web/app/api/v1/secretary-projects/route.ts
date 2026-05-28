/**
 * GET /api/v1/secretary-projects — list all secretary projects with their
 *   secretary staff record inlined.
 * POST /api/v1/secretary-projects — create a project.
 *   Body: { name: string; secretary_staff_id?: string }
 *   If secretary_staff_id is omitted, creates a new secretary staff first.
 *
 * Auth: device-token (same as other mobile routes).
 */

import { NextResponse } from 'next/server';
import { deviceAuthErrorResponse, requireDeviceTokenForRemote } from '@/lib/device-token-auth';
import {
  listSecretaryProjects,
  createSecretaryProject,
  listStaffMerged,
  createStaff,
  updateStaff,
  getStaffMerged,
} from '@holon/core';

export async function GET(req: Request): Promise<NextResponse> {
  const auth = requireDeviceTokenForRemote(req);
  if (!auth.ok) return deviceAuthErrorResponse(auth) as unknown as NextResponse;

  const projects = listSecretaryProjects();
  const allStaff = listStaffMerged();
  const staffById = Object.fromEntries(allStaff.map((s) => [s.id, s]));

  const items = projects.map((p) => ({
    ...p,
    secretary_staff: staffById[p.secretary_staff_id] ?? null,
  }));

  return NextResponse.json({ items });
}

export async function POST(req: Request): Promise<NextResponse> {
  const auth = requireDeviceTokenForRemote(req);
  if (!auth.ok) return deviceAuthErrorResponse(auth) as unknown as NextResponse;

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

  if (typeof b.name !== 'string' || !b.name.trim()) {
    return NextResponse.json({ error: 'name must be a non-empty string' }, { status: 400 });
  }
  const name = b.name.trim();

  let secretaryStaffId: string;
  // Track whether we auto-created the secretary staff (so we can tag it after project creation).
  let autoCreatedStaffId: string | null = null;

  if (typeof b.secretary_staff_id === 'string' && b.secretary_staff_id.trim()) {
    secretaryStaffId = b.secretary_staff_id.trim();
  } else {
    // No secretary_staff_id provided — create a new secretary staff for this project.
    // Tags will be patched with project:{id} after the project is created.
    const newSecretary = createStaff({
      name: `${name} 小秘`,
      role_label: 'Secretary',
      role_name: 'secretary',
      system_prompt:
        'You are the CEO secretary. Answer concise owner questions directly, and use Holon MCP to create, dispatch, read, and retire CLI employees for heavy work.',
      max_concurrent_jobs: 1,
    });
    secretaryStaffId = newSecretary.id;
    autoCreatedStaffId = newSecretary.id;
  }

  const project = createSecretaryProject({
    name,
    secretary_staff_id: secretaryStaffId,
    ...(typeof b.color === 'string' ? { color: b.color } : {}),
  });

  if (!project) {
    return NextResponse.json({ error: 'failed to create project' }, { status: 500 });
  }

  // Tag the auto-created secretary staff with project:{id} now that we have the project id.
  if (autoCreatedStaffId) {
    const existingStaff = getStaffMerged(autoCreatedStaffId);
    if (existingStaff) {
      const existingTags: string[] = Array.isArray(existingStaff.tags) ? existingStaff.tags : [];
      if (!existingTags.some((t) => t.startsWith('project:'))) {
        updateStaff(autoCreatedStaffId, { tags: [...existingTags, `project:${project.id}`] });
      }
    }
  }

  const allStaff = listStaffMerged();
  const staffById = Object.fromEntries(allStaff.map((s) => [s.id, s]));

  return NextResponse.json(
    { project: { ...project, secretary_staff: staffById[project.secretary_staff_id] ?? null } },
    { status: 201 },
  );
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

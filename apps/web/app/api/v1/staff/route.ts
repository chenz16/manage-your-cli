import { NextResponse } from 'next/server';
import { createStaff, listStaffMerged, type CreateStaffInput } from '@holon/core';
import { SubstrateSchema } from '@holon/api-contract';

export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const projectFilter = url.searchParams.get('project');

  const allStaff = listStaffMerged();

  // ?project=ID — STRICT: return ONLY staff with matching `project:{ID}` tag.
  // No "shared" fallback (owner: 通讯录 = 当前项目员工,不该看到别的项目的人).
  // Without ?project, return all (back-compat for non-project surfaces).
  const items = projectFilter
    ? allStaff.filter((s) => {
        const tags: string[] = Array.isArray(s.tags) ? s.tags : [];
        return tags.includes(`project:${projectFilter}`);
      })
    : allStaff;

  return NextResponse.json({ items });
}

export async function POST(req: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const input = parseCreateInput(body);
  if (!input) {
    return NextResponse.json({ error: 'name + role_label required' }, { status: 400 });
  }

  try {
    const staff = createStaff(input);
    return NextResponse.json(staff, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

function parseCreateInput(body: unknown): CreateStaffInput | null {
  if (typeof body !== 'object' || body === null) return null;
  const b = body as Record<string, unknown>;
  if (typeof b.name !== 'string' || !b.name.trim()) return null;
  if (typeof b.role_label !== 'string' || !b.role_label.trim()) return null;
  const input: CreateStaffInput = { name: b.name, role_label: b.role_label };
  if (typeof b.role_name === 'string') input.role_name = b.role_name;
  if (typeof b.system_prompt === 'string') input.system_prompt = b.system_prompt;
  if (typeof b.max_concurrent_jobs === 'number' && Number.isFinite(b.max_concurrent_jobs)) {
    input.max_concurrent_jobs = b.max_concurrent_jobs;
  }
  if (typeof b.agent_profile_id === 'string') input.agent_profile_id = b.agent_profile_id;
  if (Array.isArray(b.tool_scope)) {
    input.tool_scope = b.tool_scope.filter((s): s is string => typeof s === 'string');
  }
  if (typeof b.substrate === 'object' && b.substrate !== null) {
    const parsed = SubstrateSchema.safeParse(b.substrate);
    if (parsed.success) input.substrate = parsed.data;
  }
  return input;
}

export const dynamic = 'force-dynamic';

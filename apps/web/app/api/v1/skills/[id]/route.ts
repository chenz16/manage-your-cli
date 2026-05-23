import { NextResponse } from 'next/server';
import {
  getSkill, updateSkill, deleteSkill, isBuiltInSkill,
  type SkillDescriptor,
} from '@holon/core';

interface Context { params: Promise<{ id: string }> }

const PATCHABLE: Array<keyof SkillDescriptor> = [
  'name', 'tagline', 'icon', 'kind', 'tags',
  'description', 'examples', 'calls', 'consults', 'implemented',
];

export async function GET(_req: Request, ctx: Context): Promise<NextResponse> {
  const { id } = await ctx.params;
  const s = getSkill(id);
  if (!s) return NextResponse.json({ error: 'skill not found', id }, { status: 404 });
  return NextResponse.json({ ...s, _builtin: isBuiltInSkill(id) });
}

export async function PATCH(req: Request, ctx: Context): Promise<NextResponse> {
  const { id } = await ctx.params;
  let body: unknown;
  try { body = await req.json(); } catch (error) {
    return NextResponse.json({ error: 'invalid JSON body', detail: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'expected object body' }, { status: 400 });
  }
  const raw = body as Record<string, unknown>;
  const patch: Partial<SkillDescriptor> = {};
  for (const k of PATCHABLE) {
    if (k in raw) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (patch as any)[k] = raw[k];
    }
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'no patchable fields in body' }, { status: 400 });
  }
  const updated = updateSkill(id, patch);
  if (!updated) return NextResponse.json({ error: 'skill not found', id }, { status: 404 });
  return NextResponse.json(updated);
}

export async function DELETE(_req: Request, ctx: Context): Promise<NextResponse> {
  const { id } = await ctx.params;
  const r = deleteSkill(id);
  if (!r.ok) {
    return NextResponse.json({ error: r.reason ?? 'delete failed' }, {
      status: r.reason === 'not_found' ? 404 : 400,
    });
  }
  return NextResponse.json({ ok: true, id, status: 'deleted', _builtin: isBuiltInSkill(id) });
}

export const dynamic = 'force-dynamic';

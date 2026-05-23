import { NextResponse } from 'next/server';
import {
  getReference, updateReference, deleteReference, isBuiltInReference,
  type ReferenceDescriptor,
} from '@holon/core';

interface Context { params: Promise<{ id: string }> }

const PATCHABLE: Array<keyof ReferenceDescriptor> = [
  'name', 'tagline', 'icon', 'kind', 'tags',
  'authority', 'version', 'url', 'summary', 'key_sections',
  'source_type', 'local_path', 'pinned',
];

export async function GET(_req: Request, ctx: Context): Promise<NextResponse> {
  const { id } = await ctx.params;
  const r = getReference(id);
  if (!r) return NextResponse.json({ error: 'reference not found', id }, { status: 404 });
  return NextResponse.json({ ...r, _builtin: isBuiltInReference(id) });
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
  const patch: Partial<ReferenceDescriptor> = {};
  for (const k of PATCHABLE) {
    if (k in raw) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (patch as any)[k] = raw[k];
    }
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'no patchable fields in body' }, { status: 400 });
  }
  const updated = updateReference(id, patch);
  if (!updated) return NextResponse.json({ error: 'reference not found', id }, { status: 404 });
  return NextResponse.json(updated);
}

export async function DELETE(_req: Request, ctx: Context): Promise<NextResponse> {
  const { id } = await ctx.params;
  const r = deleteReference(id);
  if (!r.ok) {
    return NextResponse.json({ error: r.reason ?? 'delete failed' }, {
      status: r.reason === 'not_found' ? 404 : 400,
    });
  }
  return NextResponse.json({ ok: true, id, status: 'deleted', _builtin: isBuiltInReference(id) });
}

export const dynamic = 'force-dynamic';

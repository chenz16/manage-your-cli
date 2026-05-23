import { NextResponse } from 'next/server';
import {
  listReferences,
  createReference,
  isBuiltInReference,
  type ReferenceKind,
  type CreateReferenceInput,
} from '@holon/core';

const VALID_KINDS: ReferenceKind[] = [
  'regulatory',
  'industry-standard',
  'accessibility',
  'security',
  'language-style',
  'company-internal',
  'output-format',
];

function isValidKind(value: unknown): value is ReferenceKind {
  return typeof value === 'string' && (VALID_KINDS as readonly string[]).includes(value);
}

function parseDirect(body: Record<string, unknown>): CreateReferenceInput | { error: string } {
  if (body.mode !== undefined && body.mode !== 'direct') return { error: 'only direct create is supported' };
  if (typeof body.name !== 'string' || !body.name.trim()) return { error: 'name required' };
  if (!isValidKind(body.kind)) return { error: `kind must be one of: ${VALID_KINDS.join(', ')}` };
  if (typeof body.authority !== 'string' || !body.authority.trim()) return { error: 'authority required' };
  if (typeof body.version !== 'string' || !body.version.trim()) return { error: 'version required' };

  const sourceType = body.source_type;
  const isLocalSource = sourceType === 'file' || sourceType === 'folder';
  const localPath = typeof body.local_path === 'string' ? body.local_path.trim() : '';
  if (isLocalSource && !localPath) return { error: 'local_path required when source_type is file/folder' };
  const url = typeof body.url === 'string' && body.url.trim()
    ? body.url.trim()
    : (isLocalSource ? localPath : '');
  if (!url) return { error: 'url required' };

  const input: CreateReferenceInput = {
    name: body.name.trim(),
    kind: body.kind,
    authority: body.authority.trim(),
    version: body.version.trim(),
    url,
  };
  if (sourceType === 'file' || sourceType === 'folder' || sourceType === 'url') input.source_type = sourceType;
  if (localPath) input.local_path = localPath;
  if (typeof body.pinned === 'boolean') input.pinned = body.pinned;
  if (typeof body.tagline === 'string') input.tagline = body.tagline.trim();
  if (typeof body.icon === 'string') input.icon = body.icon.trim();
  if (typeof body.summary === 'string') input.summary = body.summary.trim();
  if (Array.isArray(body.tags)) input.tags = body.tags.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  if (Array.isArray(body.key_sections)) {
    input.key_sections = body.key_sections
      .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
      .map((item) => ({
        id: String(item.id ?? '').trim(),
        title: String(item.title ?? '').trim(),
        anchor: typeof item.anchor === 'string' ? item.anchor.trim() : '',
      }))
      .filter((item) => item.id && item.title);
  }
  return input;
}

export async function GET(): Promise<NextResponse> {
  const items = listReferences().map((reference) => ({
    ...reference,
    _builtin: isBuiltInReference(reference.id),
  }));
  return NextResponse.json({ items });
}

export async function POST(req: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch (error) {
    return NextResponse.json(
      { error: 'invalid JSON body', detail: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'expected object body' }, { status: 400 });
  }

  const parsed = parseDirect(body as Record<string, unknown>);
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  try {
    const reference = createReference(parsed);
    return NextResponse.json(reference, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}

export const dynamic = 'force-dynamic';

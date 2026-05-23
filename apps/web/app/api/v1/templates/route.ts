import { NextResponse } from 'next/server';
import {
  listTemplates,
  createTemplate,
  isBuiltInTemplate,
  type TemplateKind,
  type CreateTemplateInput,
} from '@holon/core';

const VALID_KINDS: TemplateKind[] = ['hr', 'marketing', 'sales', 'finance', 'engineering', 'ops'];

function isValidKind(value: unknown): value is TemplateKind {
  return typeof value === 'string' && (VALID_KINDS as readonly string[]).includes(value);
}

function parseDirect(body: Record<string, unknown>): CreateTemplateInput | { error: string } {
  if (body.mode !== undefined && body.mode !== 'direct') return { error: 'only direct create is supported' };
  if (typeof body.name !== 'string' || !body.name.trim()) return { error: 'name required' };
  if (!isValidKind(body.kind)) return { error: `kind must be one of: ${VALID_KINDS.join(', ')}` };
  if (typeof body.body !== 'string' || !body.body.trim()) return { error: 'body required' };

  const input: CreateTemplateInput = {
    name: body.name.trim(),
    kind: body.kind,
    body: body.body,
  };
  if (typeof body.tagline === 'string') input.tagline = body.tagline.trim();
  if (typeof body.icon === 'string') input.icon = body.icon.trim();
  if (typeof body.description === 'string') input.description = body.description.trim();
  if (Array.isArray(body.tags)) input.tags = body.tags.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  if (Array.isArray(body.variables)) {
    input.variables = body.variables
      .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
      .map((item) => ({
        name: String(item.name ?? '').trim(),
        label: String(item.label ?? item.name ?? '').trim(),
        ...(typeof item.hint === 'string' && item.hint.trim() ? { hint: item.hint.trim() } : {}),
      }))
      .filter((item) => item.name && item.label);
  }
  return input;
}

export async function GET(): Promise<NextResponse> {
  const items = listTemplates().map((template) => ({
    ...template,
    _builtin: isBuiltInTemplate(template.id),
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
    const template = createTemplate(parsed);
    return NextResponse.json(template, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}

export const dynamic = 'force-dynamic';

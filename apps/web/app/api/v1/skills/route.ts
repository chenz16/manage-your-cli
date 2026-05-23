import { NextResponse } from 'next/server';
import {
  listSkills,
  createSkill,
  type SkillKind,
  type CreateSkillInput,
} from '@holon/core';

const VALID_KINDS: SkillKind[] = ['office', 'media', 'engineering', 'communication', 'research', 'ops'];

function isValidKind(value: unknown): value is SkillKind {
  return typeof value === 'string' && (VALID_KINDS as readonly string[]).includes(value);
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function parseDirect(body: Record<string, unknown>): CreateSkillInput | { error: string } {
  if (body.mode !== undefined && body.mode !== 'direct') return { error: 'only direct create is supported' };
  if (typeof body.name !== 'string' || !body.name.trim()) return { error: 'name required' };
  if (!isValidKind(body.kind)) return { error: `kind must be one of: ${VALID_KINDS.join(', ')}` };
  if (typeof body.description !== 'string' || !body.description.trim()) return { error: 'description required' };

  const input: CreateSkillInput = {
    name: body.name.trim(),
    kind: body.kind,
    description: body.description.trim(),
  };
  if (typeof body.id === 'string' && body.id.trim()) input.id = body.id.trim();
  if (typeof body.tagline === 'string') input.tagline = body.tagline.trim();
  if (typeof body.icon === 'string') input.icon = body.icon.trim();
  const tags = stringArray(body.tags);
  if (tags) input.tags = tags;
  const examples = stringArray(body.examples);
  if (examples) input.examples = examples;
  const calls = stringArray(body.calls);
  if (calls && calls.length > 0) input.calls = calls;
  const consults = stringArray(body.consults);
  if (consults && consults.length > 0) input.consults = consults;
  return input;
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ items: listSkills() });
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
    const skill = createSkill(parsed);
    return NextResponse.json(skill, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}

export const dynamic = 'force-dynamic';

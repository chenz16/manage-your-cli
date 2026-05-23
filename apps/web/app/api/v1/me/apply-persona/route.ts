import { NextResponse } from 'next/server';
import { applyPersona } from '@holon/core';

/**
 * POST /api/v1/me/apply-persona
 *
 * Body: `{ persona_id: string }`
 *
 * Overwrites OwnerAssistant's owner_role, owner_intro, system_prompt,
 * and substrate.tool_scope with the picked persona's bundle. Everything
 * else (owner_name, workspace, budget, integrations, skills, upstream
 * peer) is preserved.
 *
 * Per user 2026-05-17: the picker is the one-click entry to switch the
 * owner-role. Owner then refines via inline-edit + ✨ Polish on /me —
 * those fields stay in the OwnerAssistantPatch path through the
 * existing /api/v1/me PATCH endpoint.
 */
export async function POST(req: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  if (typeof body !== 'object' || body === null || !('persona_id' in body)) {
    return NextResponse.json({ error: 'persona_id required' }, { status: 400 });
  }
  const persona_id = (body as { persona_id: unknown }).persona_id;
  if (typeof persona_id !== 'string' || !persona_id) {
    return NextResponse.json({ error: 'persona_id must be a non-empty string' }, { status: 400 });
  }

  const result = applyPersona(persona_id);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason ?? 'unknown error' }, { status: 400 });
  }
  return NextResponse.json({
    ok: true,
    owner: result.owner,
    replaced_persona: result.replaced_persona ?? null,
    archived_staff_count: result.archived_staff_count ?? 0,
    archived_greeting_thread: result.archived_greeting_thread ?? false,
  });
}

export const dynamic = 'force-dynamic';

/**
 * /api/v1/boss-memory — thin HTTP wrapper around boss memory (read + write).
 *
 * GET  ?scope=<scope>  → { ok: true, scope, text }
 *                        scope omitted → INDEX.md
 * POST { scope, text } → { ok: true, scope, path }
 *
 * Auth: requireDeviceTokenForRemote (loopback exempt).
 * Used by: smoke tests, MCP bridge, future mobile memory viewer.
 */

import { NextResponse } from 'next/server';
import { readBossMemory, writeBossMemory } from '@holon/core';
import { deviceAuthErrorResponse, requireDeviceTokenForRemote } from '@/lib/device-token-auth';

export async function GET(req: Request): Promise<Response> {
  const auth = requireDeviceTokenForRemote(req);
  if (!auth.ok) return deviceAuthErrorResponse(auth);

  const url = new URL(req.url);
  const scope = url.searchParams.get('scope') ?? undefined;
  const projectId = url.searchParams.get('project') ?? undefined;
  const result = readBossMemory(scope, projectId);
  if (!result.ok) {
    return NextResponse.json({ error: result.message, code: result.error }, { status: 500 });
  }
  return NextResponse.json({ ok: true, scope: result.scope, text: result.text, ...(projectId ? { project_id: projectId } : {}) });
}

export async function POST(req: Request): Promise<Response> {
  const auth = requireDeviceTokenForRemote(req);
  if (!auth.ok) return deviceAuthErrorResponse(auth);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  if (typeof b.scope !== 'string' || !b.scope.trim()) {
    return NextResponse.json({ error: 'scope (string) required' }, { status: 400 });
  }
  if (typeof b.text !== 'string' || !b.text.trim()) {
    return NextResponse.json({ error: 'text (string) required' }, { status: 400 });
  }
  // Optional project scoping: body.project_id or query ?project=<id>
  const url = new URL(req.url);
  const projectId = (typeof b.project_id === 'string' ? b.project_id : null)
    ?? url.searchParams.get('project')
    ?? undefined;

  const result = writeBossMemory(b.scope, b.text, projectId);
  if (!result.ok) {
    if ('error' in result) {
      return NextResponse.json({ error: result.message, code: result.error }, { status: 500 });
    }
    return NextResponse.json({
      error: 'budget_exceeded', code: 'budget_exceeded',
      scope: result.scope, path: result.path,
      used: result.used, limit: result.limit, attempted_chars: result.attempted_chars,
    }, { status: 413 });
  }
  return NextResponse.json({ ok: true, scope: result.scope, path: result.path, ...(projectId ? { project_id: projectId } : {}) });
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

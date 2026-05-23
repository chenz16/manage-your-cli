import { NextResponse } from 'next/server';
import { listPersonas } from '@holon/core';

/**
 * GET /api/v1/personas — list pre-built CEO persona bundles. Used by
 * the /me PersonaPicker so the owner can switch the CEO's role with
 * one click, then refine via inline-edit + ✨ Polish.
 */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ items: listPersonas() });
}

export const dynamic = 'force-dynamic';

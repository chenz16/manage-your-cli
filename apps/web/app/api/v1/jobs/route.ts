import { NextResponse } from 'next/server';
import { listJobs } from '@holon/core';

/**
 * GET /api/v1/jobs - recent owner work-in-flight rows for /today.
 *
 * The thin product no longer exposes the old background dispatcher status.
 * Jobs here are only the in-memory work tracker rows currently known by core.
 */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    items: listJobs(),
    dispatcher: { running: false },
  });
}

export const dynamic = 'force-dynamic';

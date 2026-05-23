/**
 * BFF route: GET /api/v1/desk/today
 *
 * Returns TodayResponse — buckets + my_work_queue + recent_events.
 * Per ADR-001: aggregate endpoint; the service does the page-shaped
 * combination so the UI gets one round-trip.
 */

import { NextResponse } from 'next/server';
import { getToday } from '@holon/core';

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(getToday());
}

export const dynamic = 'force-dynamic';

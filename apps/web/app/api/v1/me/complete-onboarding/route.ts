import { NextResponse } from 'next/server';

/**
 * POST /api/v1/me/complete-onboarding
 *
 * iter-012 Pass #3. Audit-only endpoint marking the end of the
 * first-launch wizard. The "onboarded" flag itself lives in
 * localStorage (`holon-onboarded-v1`) per Q-004 default — V1 is
 * single-device-single-owner, so a schema field is overkill.
 *
 * Returns 200 unconditionally; clients should not block UX on this.
 */
export async function POST(): Promise<NextResponse> {
  console.log(JSON.stringify({
    audit: 'onboarding.completed',
    ts: new Date().toISOString(),
  }));
  return NextResponse.json({ ok: true });
}

export const dynamic = 'force-dynamic';

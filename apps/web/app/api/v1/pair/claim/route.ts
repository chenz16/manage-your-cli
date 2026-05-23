import { NextResponse } from 'next/server';
import { z } from 'zod';
import { claimPairingCode } from '@/lib/device-pairing-store';

const ClaimBody = z.object({
  code: z.string().min(4).max(32),
});

export async function POST(req: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body', code: 'invalid_json' }, { status: 400 });
  }

  const parsed = ClaimBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({
      error: 'invalid pair claim body',
      code: 'invalid_pair_claim_body',
      issues: parsed.error.issues,
    }, { status: 400 });
  }

  const result = claimPairingCode(parsed.data.code);
  if (!result.ok) {
    const status = result.reason === 'persistence_failed' ? 500 : 400;
    return NextResponse.json({ error: result.reason, code: result.reason }, { status });
  }

  return NextResponse.json(result);
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

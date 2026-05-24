import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPairingRequest } from '@/lib/device-pairing-store';

// Mobile-initiated pairing: phone POSTs here to register a pairing request.
// Remote-allowed (no loopback gate) — the desk IP is accessible from the phone.
// Returns requestId + expires_at only; the 4-digit code is NEVER returned here
// (it is shown on the desk via GET /api/v1/pair/pending, loopback-only).

const RequestBody = z.object({
  deviceName: z.string().max(64).optional(),
});

export async function POST(req: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body', code: 'invalid_json' }, { status: 400 });
  }

  const parsed = RequestBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({
      error: 'invalid pairing request body',
      code: 'invalid_pair_request_body',
      issues: parsed.error.issues,
    }, { status: 400 });
  }

  const deviceName = parsed.data.deviceName?.trim() || '微作';

  const result = createPairingRequest(deviceName);
  return NextResponse.json(result);
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { confirmPairingRequest } from '@/lib/device-pairing-store';

// Mobile-initiated pairing: phone POSTs the 4-digit code it read off the desk
// screen. Remote-allowed — the phone reaches the desk directly.
// On success returns { ok, device_token, device_id, paired_at }.
// On failure returns a typed error with the appropriate HTTP status.

const ConfirmBody = z.object({
  requestId: z.string().min(1).max(128),
  code: z.string().min(1).max(16),
});

export async function POST(req: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body', code: 'invalid_json' }, { status: 400 });
  }

  const parsed = ConfirmBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({
      error: 'invalid pair confirm body',
      code: 'invalid_pair_confirm_body',
      issues: parsed.error.issues,
    }, { status: 400 });
  }

  const result = confirmPairingRequest(parsed.data.requestId, parsed.data.code);

  if (!result.ok) {
    if (result.reason === 'not_found') {
      return NextResponse.json({ error: 'pairing request not found', code: 'not_found' }, { status: 404 });
    }
    if (result.reason === 'expired') {
      return NextResponse.json({ error: 'pairing request expired', code: 'expired' }, { status: 410 });
    }
    if (result.reason === 'bad_code') {
      return NextResponse.json({ error: 'incorrect pairing code', code: 'bad_code' }, { status: 401 });
    }
    // persistence_failed
    return NextResponse.json({ error: 'persistence error', code: 'persistence_failed' }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    device_token: result.device_token,
    device_id: result.device_id,
    paired_at: result.paired_at,
  });
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

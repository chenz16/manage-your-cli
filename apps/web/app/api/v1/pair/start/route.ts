import { NextResponse } from 'next/server';
import { createPairingStart, getLanUrlHintDetailed } from '@/lib/device-pairing-store';
import { isLoopbackRequest } from '@/lib/device-token-auth';

export async function POST(req: Request): Promise<NextResponse> {
  if (!isLoopbackRequest(req)) {
    return NextResponse.json({
      error: 'pair start must be initiated from the desktop',
      code: 'desktop_loopback_required',
    }, { status: 403 });
  }

  try {
    const pending = createPairingStart();
    const lanHint = getLanUrlHintDetailed(req, pending.code);
    return NextResponse.json({
      code: pending.code,
      expires_at: new Date(pending.expiresAt).toISOString(),
      lan_url: lanHint.lan_url,
      qr_payload: lanHint.lan_url,
      lan_candidates: lanHint.lan_candidates,
    });
  } catch (err) {
    return NextResponse.json({
      error: err instanceof Error ? err.message : String(err),
      code: 'pair_start_failed',
    }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

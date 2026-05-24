import { NextResponse } from 'next/server';
import { listPendingPairingRequests } from '@/lib/device-pairing-store';
import { isLoopbackRequest } from '@/lib/device-token-auth';

// Desk-only: returns pending mobile pairing requests (including the 4-digit
// code) so the desk UI can display the code out-of-band.
// Loopback-gated: only the desk machine can see this.

export async function GET(req: Request): Promise<NextResponse> {
  if (!isLoopbackRequest(req)) {
    return NextResponse.json({
      error: 'pending requests may only be read from the desktop',
      code: 'desktop_loopback_required',
    }, { status: 403 });
  }

  const pending = listPendingPairingRequests();
  return NextResponse.json({ pending });
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

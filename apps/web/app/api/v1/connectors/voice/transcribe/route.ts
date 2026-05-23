import { NextResponse } from 'next/server';

export async function POST(): Promise<NextResponse> {
  return NextResponse.json(
    { ok: false, error: 'voice_removed', message: 'Voice transcription was removed from the CLI-only build.' },
    { status: 410 },
  );
}

export const dynamic = 'force-dynamic';

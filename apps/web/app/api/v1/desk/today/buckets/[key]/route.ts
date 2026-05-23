/**
 * BFF route: GET /api/v1/desk/today/buckets/:key
 *
 * Returns BucketDetailResponse (full item list) for a clicked bucket
 * card. 404 if the key is not one of the 6 known buckets.
 */

import { NextResponse } from 'next/server';
import { getBucketDetail } from '@holon/core';

interface Context {
  params: Promise<{ key: string }>;
}

export async function GET(_req: Request, ctx: Context): Promise<NextResponse> {
  const { key } = await ctx.params;
  const payload = getBucketDetail(key);
  if (!payload) {
    return NextResponse.json({ error: 'unknown bucket key', key }, { status: 404 });
  }
  return NextResponse.json(payload);
}

export const dynamic = 'force-dynamic';

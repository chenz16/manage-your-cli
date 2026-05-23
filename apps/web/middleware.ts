import { NextResponse, type NextRequest } from 'next/server';

/**
 * CORS for the Capacitor mobile WebView (bug-20260520-082135-cfuqy8y0,
 * mobile->desk handoff unblocking mobile M-L-048).
 *
 * The mobile APK loads from a fixed WebView origin and talks cross-origin to
 * the desk API surface: the chat SSE `POST /api/v1/chat/owner/stream` and all
 * `/api/v1/*` reads. The desk owns the API surface, so CORS lives here.
 *
 * Only the known Capacitor origins are allowed (reflected, never `*`) so we can
 * keep `Access-Control-Allow-Credentials: true` for the NextAuth session cookie:
 *   - `capacitor://localhost`        — iOS WebView
 *   - `http://localhost`             — Android WebView (cleartext)
 *   - `https://localhost`            — Android WebView (TLS)
 * Same-origin browser requests (no `Origin` header, or the page's own origin)
 * are untouched — they fall through with no CORS headers, as before.
 */

const ALLOWED_ORIGINS = new Set([
  'capacitor://localhost',
  'http://localhost',
  'https://localhost',
]);

function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    // Expose the SSE content type so the WebView fetch can read the stream type.
    'Access-Control-Expose-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export function middleware(req: NextRequest): NextResponse {
  const origin = req.headers.get('origin');

  // No cross-origin Capacitor request → leave the response exactly as before.
  if (!origin || !ALLOWED_ORIGINS.has(origin)) {
    return NextResponse.next();
  }

  const headers = corsHeaders(origin);

  // Preflight: answer here, don't hit the route handler.
  if (req.method === 'OPTIONS') {
    return new NextResponse(null, { status: 204, headers });
  }

  const res = NextResponse.next();
  for (const [key, value] of Object.entries(headers)) {
    res.headers.set(key, value);
  }
  return res;
}

export const config = {
  matcher: '/api/v1/:path*',
};

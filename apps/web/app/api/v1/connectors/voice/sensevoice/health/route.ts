import { GET as getVoiceHealth } from '../../health/route';

export async function GET(req: Request) {
  const url = new URL(req.url);
  url.searchParams.set('engine', 'sensevoice');
  return getVoiceHealth(new Request(url, req));
}

export const dynamic = 'force-dynamic';

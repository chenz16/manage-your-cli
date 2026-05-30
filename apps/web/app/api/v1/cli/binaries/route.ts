import { NextResponse } from 'next/server';
import { discoverCliBinaries } from '@/lib/cli-discovery';
import { requireDeviceTokenForRemote, deviceAuthErrorResponse } from '@/lib/device-token-auth';

/**
 * GET /api/v1/cli/binaries — list which CLI subscriptions (claude / codex /
 * gemini / qwen) are installed on this desk, with version + path + install
 * hint per binary. Used by:
 *   - /onboarding Step 3 (CLI capability check)
 *   - HireDialog (dynamic picker for new agent's CLI binary)
 *
 * Response: { binaries: CliBinaryStatus[] }
 * Each entry: { name, label, installed, version, path, install_hint, docs_url }
 *
 * `?force=1` bypasses the 10s cache — used by the onboarding "Check again"
 * button after the user installs a CLI in another terminal.
 *
 * NOTE: This is a SEPARATE endpoint from /api/v1/cli/discover (which returns
 * tmux sessions for "adopt"). Don't conflate them — the existing /cli/discover
 * caller (MembersClient AdoptSessionsDialog) depends on { sessions: [...] }.
 */
export async function GET(req: Request): Promise<NextResponse | Response> {
  const auth = requireDeviceTokenForRemote(req);
  if (!auth.ok) return deviceAuthErrorResponse(auth);
  const url = new URL(req.url);
  const force = url.searchParams.get('force') === '1';
  return NextResponse.json({ binaries: discoverCliBinaries({ force }) });
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

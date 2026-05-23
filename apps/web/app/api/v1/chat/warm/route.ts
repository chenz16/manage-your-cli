import { getOrCreateSecretaryStaff } from '@holon/core';
import { prewarmAgent } from '@/lib/warm-agent';

/**
 * GET /api/v1/chat/warm - eagerly spawn the Secretary's warm CLI process so the
 * owner's FIRST message does not pay the ~4s cold-start. Called by
 * ChatRuntimeProvider on chat mount → pre-warms automatically, no typing needed.
 *
 * Idempotent: if already warm, resolves immediately. Subscription-only; no Hermes.
 */
function warmSecretary() {
  const s = getOrCreateSecretaryStaff();
  const sub = s.substrate;
  const cwd = sub.kind === 'cli_agent' ? sub.cwd : undefined;
  const binary = sub.kind === 'cli_agent' && sub.binary ? sub.binary : 'claude';
  const r = prewarmAgent(s.id, binary, cwd, /* keep always-warm */ true);
  return { staffId: s.id, binary, ...r };
}

// Pre-warm as soon as this route module loads (server side), so even the first
// chat-mount ping finds the process already booting.
const _autoWarm = Promise.resolve().then(() => warmSecretary()).catch((err) => {
  console.warn(JSON.stringify({
    audit: 'secretary.autowarm_failed',
    runtime: 'secretary-headless',
    error: err instanceof Error ? err.message : String(err),
    ts: new Date().toISOString(),
  }));
});
void _autoWarm;

export async function GET(): Promise<Response> {
  try {
    const r = warmSecretary();
    return Response.json({ ready: true, runtime: 'secretary-headless', ...r });
  } catch (err) {
    return Response.json(
      { ready: false, runtime: 'secretary-headless', reason: err instanceof Error ? err.message : String(err) },
      { status: 200 },
    );
  }
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

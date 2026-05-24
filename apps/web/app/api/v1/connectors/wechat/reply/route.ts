import { isLoopbackRequest } from '@/lib/device-token-auth';
import { getOrCreateSecretaryStaff } from '@holon/core';
import { sendWarmTurn } from '@/lib/warm-agent';
import { buildOwnerPrompt } from '@/lib/owner-chat-helpers';

/**
 * POST /api/v1/connectors/wechat/reply
 *
 * WeChat→Secretary bridge endpoint called by the clawbot gateway daemon
 * (scripts/clawbot/gateway.py).  The gateway receives inbound WeChat messages
 * via iLink long-poll, POST them here, and sends the Secretary's reply back
 * into WeChat via the iLink sendmessage API.
 *
 * This endpoint is the SSE→buffered bridge: it runs the same warm-agent
 * Secretary path as /api/v1/chat/owner/stream but COLLECTS the full streamed
 * output into a single string and returns JSON { reply } rather than SSE.
 *
 * Request body (JSON):
 *   { text: string, from?: string }
 *   - text  — the raw WeChat message text
 *   - from  — optional sender_id (logged, not used for routing)
 *
 * Response:
 *   200  { reply: string }
 *   400  { error: string }
 *   5xx  { error: string, detail?: string }
 *
 * Auth: loopback-only (127.x / ::1 / localhost).  The gateway runs on the
 * same machine and calls 127.0.0.1:<DESK_PORT>.  Remote callers get 403.
 * HOLON_OPEN_DEMO=1 also bypasses the gate (same rule as other endpoints).
 */

const WECHAT_REPLY_TIMEOUT_MS = 120_000; // 2 min — warm turn is fast; allow cold-start

function jsonResp(body: object, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export async function POST(req: Request): Promise<Response> {
  // Gate: loopback-only (or HOLON_OPEN_DEMO=1).
  const open = process.env.HOLON_OPEN_DEMO === '1';
  if (!open && !isLoopbackRequest(req)) {
    console.error(JSON.stringify({
      audit: 'wechat.reply.rejected',
      reason: 'non_loopback_caller',
      ts: new Date().toISOString(),
    }));
    return jsonResp({ error: 'loopback access only' }, 403);
  }

  // Parse body.
  let body: unknown;
  try {
    body = await req.json();
  } catch (err) {
    return jsonResp({ error: 'invalid JSON body', detail: err instanceof Error ? err.message : String(err) }, 400);
  }
  if (typeof body !== 'object' || body === null || !('text' in body)) {
    return jsonResp({ error: 'body must be { text: string, from?: string }' }, 400);
  }
  const { text, from } = body as { text: unknown; from?: unknown };
  if (typeof text !== 'string' || !text.trim()) {
    return jsonResp({ error: '"text" must be a non-empty string' }, 400);
  }
  const sender = typeof from === 'string' ? from : 'unknown';

  // Build Secretary and prompt (same as owner/stream path).
  const secretary = getOrCreateSecretaryStaff();
  const substrate = secretary.substrate;
  const cwd = substrate.kind === 'cli_agent' ? substrate.cwd : undefined;
  const binary = substrate.kind === 'cli_agent' && substrate.binary ? substrate.binary : 'claude';
  // Pass raw WeChat text as user message; no prior history context for this
  // stateless adapter call (each WeChat message is a fresh turn).
  const prompt = buildOwnerPrompt(text.trim(), []);

  console.log(JSON.stringify({
    audit: 'wechat.reply.start',
    secretary_id: secretary.id,
    binary,
    sender,
    text_chars: text.length,
    ts: new Date().toISOString(),
  }));

  // Collect full streamed reply into one string, then return JSON.
  return new Promise<Response>((resolve) => {
    const deadline = setTimeout(() => {
      console.error(JSON.stringify({
        audit: 'wechat.reply.timeout',
        secretary_id: secretary.id,
        sender,
        ts: new Date().toISOString(),
      }));
      resolve(jsonResp({ error: 'Secretary reply timed out', detail: `timeout after ${WECHAT_REPLY_TIMEOUT_MS}ms` }, 504));
    }, WECHAT_REPLY_TIMEOUT_MS);

    let settled = false;
    let assembled = '';

    const finish = (reply: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      console.log(JSON.stringify({
        audit: 'wechat.reply.done',
        secretary_id: secretary.id,
        sender,
        reply_chars: reply.length,
        ts: new Date().toISOString(),
      }));
      resolve(jsonResp({ reply }, 200));
    };

    const fail = (detail: string, httpStatus = 502) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      console.error(JSON.stringify({
        audit: 'wechat.reply.error',
        secretary_id: secretary.id,
        sender,
        detail,
        ts: new Date().toISOString(),
      }));
      resolve(jsonResp({ error: 'Secretary failed to produce a reply', detail }, httpStatus));
    };

    sendWarmTurn(secretary.id, binary, cwd, prompt, {
      onText: (full) => { assembled = full; },
      onDone: () => finish(assembled.trim()),
      onError: (msg) => fail(msg),
    });
  });
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { deviceAuthErrorResponse, requireDeviceTokenForRemote } from '@/lib/device-token-auth';
import { spawn } from 'node:child_process';
import { getOrCreateSecretaryStaff } from '@holon/core';
import { sendWarmTurn } from '@/lib/warm-agent';
import { parseJsonRequestBody, extractChatMessages, extractLatestUserText, buildOwnerPrompt } from '@/lib/owner-chat-helpers';

/**
 * POST /api/v1/chat/owner/stream - owner chat turn streamed as SSE.
 *
 * Request body: { messages: [{ role, content }] } - assistant-ui shape.
 * The latest user message is sent to the persistent Secretary tmux session.
 * Raw terminal output is deterministically formatted into the existing SSE
 * contract: cumulative {type:'text', text} events, then {type:'done'}.
 */

function sse(event: object): string {
  const json = JSON.stringify(event).replace(/[^\x20-\x7E]/g, (char) =>
    char
      .split('')
      .map((unit) => `\\u${unit.charCodeAt(0).toString(16).padStart(4, '0')}`)
      .join(''),
  );
  return `data: ${json}\n\n`;
}

// Request/prompt helpers moved to @/lib/owner-chat-helpers (route files may only
// export handlers + config, else `next build` route-type validation fails).

export async function POST(req: Request): Promise<Response> {
  const auth = requireDeviceTokenForRemote(req);
  if (!auth.ok) return deviceAuthErrorResponse(auth);

  let body: unknown;
  try {
    body = await parseJsonRequestBody(req);
  } catch (err) {
    console.error(JSON.stringify({
      audit: 'owner.chat_request.invalid_json',
      runtime: 'secretary-cli',
      error: err instanceof Error ? err.message : String(err),
      ts: new Date().toISOString(),
    }));
    return new Response(JSON.stringify({ error: 'invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }

  const messages = extractChatMessages(body);
  const userText = extractLatestUserText(body);
  if (!userText) {
    return new Response(JSON.stringify({ error: 'no user message found' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }

  const secretary = getOrCreateSecretaryStaff();
  const substrate = secretary.substrate;
  const cwd = substrate.kind === 'cli_agent' ? substrate.cwd : undefined;
  const binary = substrate.kind === 'cli_agent' && substrate.binary ? substrate.binary : 'claude';
  const ownerPrompt = buildOwnerPrompt(userText, messages);

  // Headless: drive the OFFICIAL CLI non-interactively (claude -p / codex exec) and
  // stream its clean stdout. No TUI screen-scrape. Subscription-only; NO API key.
  // The owner reads the Secretary, so its output must be clean → headless. Employees
  // stay as live tmux sessions (watch/drive); the Secretary reads them via the MCP.
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      let assembled = '';
      let closed = false;

      const emit = (event: object) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(sse(event))); }
        catch { closed = true; }
      };
      const finish = (stopReason: string, reason?: string) => {
        if (closed) return;
        closed = true;
        try {
          controller.enqueue(encoder.encode(sse({ type: 'done', stopReason, finalText: assembled.trim() })));
          controller.close();
        } catch { /* already closed */ }
        console.log(JSON.stringify({
          audit: 'owner.chat_turn',
          runtime: 'secretary-headless',
          staff_id: secretary.id,
          binary,
          user_chars: userText.length,
          reply_chars: assembled.length,
          stop_reason: stopReason,
          reason,
          ts: new Date().toISOString(),
        }));
      };

      if (binary === 'claude') {
        // Warm persistent process: pays the ~4s cold-start ONCE, then ~1.8s/turn.
        // stream-json stdout is the clean "fast channel" (no TUI scrape).
        assembled = ''; // keep linter happy; warm path tracks its own assembled
        sendWarmTurn(secretary.id, binary, cwd, ownerPrompt, {
          onText: (full) => { assembled = full; emit({ type: 'text', text: full.trim() }); },
          onDone: () => finish('end_turn'),
          onError: (msg) => { emit({ type: 'error', message: msg }); finish('send_failed', 'warm_error'); },
          signal: req.signal,
        });
        return;
      }

      // codex (or other): per-turn `exec` (no verified persistent stream mode yet).
      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(binary, ['exec', ownerPrompt], { cwd, env: process.env });
      } catch (err) {
        emit({ type: 'error', message: err instanceof Error ? err.message : String(err) });
        finish('send_failed', 'spawn_failed');
        return;
      }
      const onAbort = () => { try { child.kill('SIGTERM'); } catch { /* noop */ } finish('aborted'); };
      req.signal.addEventListener('abort', onAbort, { once: true });
      let stderr = '';
      child.stdout?.on('data', (buf: Buffer) => { assembled += buf.toString('utf8'); emit({ type: 'text', text: assembled.trim() }); });
      child.stderr?.on('data', (buf: Buffer) => { stderr += buf.toString('utf8'); });
      child.on('error', (err: Error) => { emit({ type: 'error', message: err.message }); finish('send_failed', 'child_error'); });
      child.on('close', (code: number | null) => {
        req.signal.removeEventListener('abort', onAbort);
        if ((code ?? 0) !== 0 && !assembled.trim()) emit({ type: 'error', message: stderr.trim() || `${binary} exited ${code}` });
        finish('end_turn');
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

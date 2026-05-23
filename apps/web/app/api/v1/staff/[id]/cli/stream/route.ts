import { subscribeOutput, getCliStatus } from '@holon/core';

interface Context { params: Promise<{ id: string }> }

/**
 * GET /api/v1/staff/:id/cli/stream — server-sent events of the staff's
 * tmux output. Sends scrollback on connect, then every chunk live.
 *
 * SSE format: each chunk is `data: {"type":"chunk","text":"…"}\n\n`.
 * Final event: `data: {"type":"end"}` (sent if Node-side tail exits;
 * usually only on session kill).
 */
export async function GET(req: Request, ctx: Context): Promise<Response> {
  const { id } = await ctx.params;
  const status = getCliStatus(id);
  if (!status.running) {
    return new Response(JSON.stringify({ error: 'no_session' }), {
      status: 409,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (obj: object) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`)); }
        catch { closed = true; }
      };

      const { scrollback, unsubscribe } = subscribeOutput(id, (chunk) => send({ type: 'chunk', text: chunk }));

      if (scrollback) send({ type: 'chunk', text: scrollback });

      const onAbort = () => {
        closed = true;
        unsubscribe();
        try { controller.close(); } catch {}
      };
      req.signal.addEventListener('abort', onAbort);
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

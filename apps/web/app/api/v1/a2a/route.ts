/**
 * A2A endpoint — Slice B: Local A2A loopback task.
 * Spec: A2A protocolVersion 0.2.0
 * ADR: docs/adr/ADR-A2A-interconnect.md
 *
 * Accepts POST /api/v1/a2a with an A2A JSON-RPC `message/send` request.
 * Guards to same-machine (loopback) only — no internet peers yet (Slice D).
 * Routes the message text to the warm Secretary CLI and returns the reply as
 * an A2A artifact in a completed Task.
 *
 * Synchronous (no streaming yet — Slice C adds `message/stream` + SSE).
 */

import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { requireDeviceTokenForRemote, deviceAuthErrorResponse } from '@/lib/device-token-auth';
import { getOrCreateSecretaryStaff } from '@holon/core';
import { sendWarmTurn } from '@/lib/warm-agent';
import { buildOwnerPrompt } from '@/lib/owner-chat-helpers';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// JSON-RPC error helpers
// ---------------------------------------------------------------------------

interface JsonRpcError {
  jsonrpc: '2.0';
  id: string | number | null;
  error: { code: number; message: string };
}

function jsonRpcError(
  id: string | number | null,
  code: number,
  message: string,
): NextResponse<JsonRpcError> {
  return NextResponse.json<JsonRpcError>(
    { jsonrpc: '2.0', id, error: { code, message } },
    { status: 200 }, // JSON-RPC errors are returned as HTTP 200 per spec
  );
}

// ---------------------------------------------------------------------------
// A2A types (A2A 0.2.0 subset used by Slice B)
// ---------------------------------------------------------------------------

interface A2APart {
  kind: string;
  text?: string;
}

interface A2AMessage {
  role: string;
  parts: A2APart[];
}

interface A2AMessageSendParams {
  message: A2AMessage;
}

interface JsonRpcRequest {
  jsonrpc: string;
  id: string | number;
  method: string;
  params?: unknown;
}

interface A2ATaskResult {
  jsonrpc: '2.0';
  id: string | number;
  result: {
    id: string;
    contextId: string;
    status: { state: 'completed' };
    artifacts: Array<{
      artifactId: string;
      parts: A2APart[];
    }>;
    kind: 'task';
  };
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(req: Request): Promise<Response> {
  // GUARD: loopback / open-demo only (same-machine peers for Slice B).
  // requireDeviceTokenForRemote allows loopback and HOLON_OPEN_DEMO=1; rejects
  // remote clients without a device token. We want loopback-only for Slice B,
  // so we further restrict: if auth mode is 'device_token' (a real remote client
  // that somehow presented a valid device token), reject it — A2A peering for
  // remote desks is Slice D.
  const auth = requireDeviceTokenForRemote(req);
  if (!auth.ok) {
    // Returns 401/403/500 from device-token-auth — use its response directly.
    return deviceAuthErrorResponse(auth);
  }
  if (auth.mode === 'device_token') {
    // Valid device token but this is a real remote client — Slice D, not yet.
    return new Response(
      JSON.stringify({ error: 'remote A2A peers not yet supported (Slice D)' }),
      { status: 403, headers: { 'Content-Type': 'application/json; charset=utf-8' } },
    );
  }

  // Parse JSON body.
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonRpcError(null, -32700, 'Parse error: request body is not valid JSON');
  }

  if (typeof body !== 'object' || body === null) {
    return jsonRpcError(null, -32600, 'Invalid Request: body must be a JSON object');
  }

  const rpc = body as Partial<JsonRpcRequest>;

  if (rpc.jsonrpc !== '2.0') {
    return jsonRpcError(rpc.id ?? null, -32600, 'Invalid Request: jsonrpc must be "2.0"');
  }

  const rpcId = rpc.id ?? null;

  if (typeof rpc.method !== 'string') {
    return jsonRpcError(rpcId, -32600, 'Invalid Request: method must be a string');
  }

  if (rpc.method !== 'message/send') {
    return jsonRpcError(rpcId, -32601, `Method not found: "${rpc.method}" — only message/send is supported`);
  }

  // Validate params shape.
  const params = rpc.params;
  if (typeof params !== 'object' || params === null) {
    return jsonRpcError(rpcId, -32600, 'Invalid Request: params must be an object');
  }

  const p = params as Partial<A2AMessageSendParams>;
  if (typeof p.message !== 'object' || p.message === null) {
    return jsonRpcError(rpcId, -32600, 'Invalid Request: params.message is required');
  }
  if (!Array.isArray(p.message.parts)) {
    return jsonRpcError(rpcId, -32600, 'Invalid Request: params.message.parts must be an array');
  }

  // Extract text from all text-kind parts.
  const userText = p.message.parts
    .filter((part): part is A2APart & { kind: 'text'; text: string } =>
      part.kind === 'text' && typeof part.text === 'string',
    )
    .map((part) => part.text)
    .join('');

  if (!userText.trim()) {
    return jsonRpcError(rpcId, -32600, 'Invalid Request: no text content found in message parts');
  }

  // Route to the warm Secretary and await full reply.
  let reply: string;
  try {
    reply = await dispatchToSecretary(userText);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({
      audit: 'a2a.message_send.secretary_error',
      error: msg,
      ts: new Date().toISOString(),
    }));
    return jsonRpcError(rpcId, -32603, 'Internal error: secretary dispatch failed');
  }

  // Build A2A completed Task response.
  const taskId = randomUUID();
  const contextId = randomUUID();
  const artifactId = randomUUID();

  const result: A2ATaskResult = {
    jsonrpc: '2.0',
    id: rpcId as string | number,
    result: {
      id: taskId,
      contextId,
      status: { state: 'completed' },
      artifacts: [
        {
          artifactId,
          parts: [{ kind: 'text', text: reply }],
        },
      ],
      kind: 'task',
    },
  };

  console.log(JSON.stringify({
    audit: 'a2a.message_send',
    task_id: taskId,
    user_chars: userText.length,
    reply_chars: reply.length,
    ts: new Date().toISOString(),
  }));

  return NextResponse.json(result);
}

// ---------------------------------------------------------------------------
// Secretary dispatch — promisified wrapper around sendWarmTurn
// ---------------------------------------------------------------------------

function dispatchToSecretary(userText: string): Promise<string> {
  const secretary = getOrCreateSecretaryStaff();
  const substrate = secretary.substrate;
  const cwd = substrate.kind === 'cli_agent' ? substrate.cwd : undefined;
  const binary =
    substrate.kind === 'cli_agent' && substrate.binary ? substrate.binary : 'claude';

  // buildOwnerPrompt with empty history (A2A tasks are stateless single-turn for Slice B).
  const prompt = buildOwnerPrompt(userText, []);

  return new Promise<string>((resolve, reject) => {
    if (binary !== 'claude') {
      // Codex / other: no warm process; reject — callers can fall back to per-turn
      // exec if needed in a future slice. For now, Slice B is claude-only.
      reject(new Error(`secretary binary "${binary}" not supported in Slice B; only claude warm mode is supported`));
      return;
    }

    let finalText = '';
    sendWarmTurn(secretary.id, binary, cwd, prompt, {
      onText: (full) => { finalText = full; },
      onDone: () => resolve(finalText.trim()),
      onError: (msg) => reject(new Error(msg)),
    });
  });
}

/**
 * A2A endpoint — Slice B + Slice C: Local A2A loopback task.
 * Spec: A2A protocolVersion 0.2.0
 * ADR: docs/adr/ADR-A2A-interconnect.md
 *
 * Accepts POST /api/v1/a2a with A2A JSON-RPC requests.
 * Guards to same-machine (loopback) only — no internet peers yet (Slice D).
 *
 * Supported methods:
 *   message/send   — synchronous: route to Secretary, return completed Task.
 *   message/stream — SSE stream: route to Secretary, emit A2A lifecycle events.
 *   tasks/get      — return stored task by id.
 *   tasks/cancel   — abort running task, set state "canceled".
 */

import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { requireDeviceTokenForRemote, deviceAuthErrorResponse } from '@/lib/device-token-auth';
import { getOrCreateSecretaryStaff } from '@holon/core';
import { sendWarmTurn } from '@/lib/warm-agent';
import { buildOwnerPrompt } from '@/lib/owner-chat-helpers';
import {
  createTask,
  getTask,
  updateTask,
  setAbort,
} from '@/lib/a2a-task-store';

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
// A2A types (A2A 0.2.0 subset)
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

interface A2ATasksGetParams {
  id: string;
}

interface A2ATasksCancelParams {
  id: string;
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
    status: { state: string };
    artifacts?: Array<{
      artifactId: string;
      parts: A2APart[];
    }>;
    kind: 'task';
  };
}

// ---------------------------------------------------------------------------
// SSE helper (mirrors chat/owner/stream)
// ---------------------------------------------------------------------------

function sse(obj: object): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

// ---------------------------------------------------------------------------
// Secretary substrate helper (shared by send + stream)
// ---------------------------------------------------------------------------

function getSecretarySubstrate(): {
  staffId: string;
  binary: string;
  cwd: string | undefined;
} {
  const secretary = getOrCreateSecretaryStaff();
  const substrate = secretary.substrate;
  const cwd = substrate.kind === 'cli_agent' ? substrate.cwd : undefined;
  const binary =
    substrate.kind === 'cli_agent' && substrate.binary ? substrate.binary : 'claude';
  return { staffId: secretary.id, binary, cwd };
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(req: Request): Promise<Response> {
  // GUARD: loopback / open-demo only (same-machine peers for Slice B/C).
  const auth = requireDeviceTokenForRemote(req);
  if (!auth.ok) {
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

  // ---------------------------------------------------------------------------
  // Dispatch on method
  // ---------------------------------------------------------------------------

  switch (rpc.method) {

    // -------------------------------------------------------------------------
    // message/send — synchronous (Slice B, now also registers in task store)
    // -------------------------------------------------------------------------
    case 'message/send': {
      const parsed = parseMessageParams(rpc.params, rpcId);
      if (parsed instanceof Response) return parsed;
      const { userText } = parsed;

      const taskId = randomUUID();
      const contextId = randomUUID();
      const artifactId = randomUUID();

      createTask(taskId, contextId);

      let reply: string;
      try {
        reply = await dispatchToSecretarySync(userText);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(JSON.stringify({
          audit: 'a2a.message_send.secretary_error',
          error: msg,
          ts: new Date().toISOString(),
        }));
        updateTask(taskId, { state: 'failed' });
        return jsonRpcError(rpcId, -32603, 'Internal error: secretary dispatch failed');
      }

      updateTask(taskId, { state: 'completed', text: reply });

      const result: A2ATaskResult = {
        jsonrpc: '2.0',
        id: rpcId as string | number,
        result: {
          id: taskId,
          contextId,
          status: { state: 'completed' },
          artifacts: [{ artifactId, parts: [{ kind: 'text', text: reply }] }],
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

    // -------------------------------------------------------------------------
    // message/stream — SSE streaming (Slice C)
    // -------------------------------------------------------------------------
    case 'message/stream': {
      const parsed = parseMessageParams(rpc.params, rpcId);
      if (parsed instanceof Response) return parsed;
      const { userText } = parsed;

      const taskId = randomUUID();
      const contextId = randomUUID();
      const artifactId = randomUUID();

      createTask(taskId, contextId);

      const abortCtrl = new AbortController();
      setAbort(taskId, abortCtrl);

      // Wire client disconnect → abort (mirrors chat/owner/stream req.signal usage).
      req.signal.addEventListener('abort', () => abortCtrl.abort(), { once: true });

      const { staffId, binary, cwd } = getSecretarySubstrate();
      const prompt = buildOwnerPrompt(userText, []);

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const encoder = new TextEncoder();
          let closed = false;

          const emit = (obj: object) => {
            if (closed) return;
            try {
              controller.enqueue(encoder.encode(sse(obj)));
            } catch {
              closed = true;
            }
          };

          const finish = () => {
            if (closed) return;
            closed = true;
            try { controller.close(); } catch { /* already closed */ }
          };

          // 1. Initial Task object.
          emit({
            jsonrpc: '2.0',
            id: rpcId,
            result: {
              id: taskId,
              contextId,
              status: { state: 'submitted' },
              kind: 'task',
            },
          });

          // 2. Status → working.
          emit({
            jsonrpc: '2.0',
            id: rpcId,
            result: {
              taskId,
              contextId,
              status: { state: 'working' },
              kind: 'status-update',
              final: false,
            },
          });

          updateTask(taskId, { state: 'working' });

          if (binary !== 'claude') {
            // codex / other: no warm stream mode in Slice C — emit error + complete.
            const errMsg = `secretary binary "${binary}" not supported in message/stream; only claude warm mode is supported`;
            console.error(JSON.stringify({
              audit: 'a2a.message_stream.unsupported_binary',
              binary,
              task_id: taskId,
              ts: new Date().toISOString(),
            }));
            emit({
              jsonrpc: '2.0',
              id: rpcId,
              error: { code: -32603, message: errMsg },
            });
            updateTask(taskId, { state: 'failed' });
            finish();
            return;
          }

          sendWarmTurn(staffId, binary, cwd, prompt, {
            onText: (full) => {
              updateTask(taskId, { text: full });
              emit({
                jsonrpc: '2.0',
                id: rpcId,
                result: {
                  taskId,
                  contextId,
                  kind: 'artifact-update',
                  artifact: {
                    artifactId,
                    parts: [{ kind: 'text', text: full }],
                  },
                },
              });
            },
            onDone: () => {
              const record = getTask(taskId);
              updateTask(taskId, { state: 'completed' });
              emit({
                jsonrpc: '2.0',
                id: rpcId,
                result: {
                  taskId,
                  contextId,
                  status: { state: 'completed' },
                  kind: 'status-update',
                  final: true,
                },
              });
              console.log(JSON.stringify({
                audit: 'a2a.message_stream',
                task_id: taskId,
                user_chars: userText.length,
                reply_chars: record?.text.length ?? 0,
                ts: new Date().toISOString(),
              }));
              finish();
            },
            onError: (msg) => {
              console.error(JSON.stringify({
                audit: 'a2a.message_stream.secretary_error',
                task_id: taskId,
                error: msg,
                ts: new Date().toISOString(),
              }));
              updateTask(taskId, { state: 'failed' });
              emit({
                jsonrpc: '2.0',
                id: rpcId,
                error: { code: -32603, message: `Internal error: ${msg}` },
              });
              finish();
            },
            signal: abortCtrl.signal,
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

    // -------------------------------------------------------------------------
    // tasks/get — return stored task (Slice C)
    // -------------------------------------------------------------------------
    case 'tasks/get': {
      const params = rpc.params;
      if (typeof params !== 'object' || params === null) {
        return jsonRpcError(rpcId, -32600, 'Invalid Request: params must be an object');
      }
      const p = params as Partial<A2ATasksGetParams>;
      if (typeof p.id !== 'string' || !p.id) {
        return jsonRpcError(rpcId, -32600, 'Invalid Request: params.id must be a non-empty string');
      }

      const record = getTask(p.id);
      if (!record) {
        return jsonRpcError(rpcId, -32001, `task not found: ${p.id}`);
      }

      const result: A2ATaskResult = {
        jsonrpc: '2.0',
        id: rpcId as string | number,
        result: {
          id: record.id,
          contextId: record.contextId,
          status: { state: record.state },
          ...(record.text
            ? { artifacts: [{ artifactId: randomUUID(), parts: [{ kind: 'text', text: record.text }] }] }
            : {}),
          kind: 'task',
        },
      };

      return NextResponse.json(result);
    }

    // -------------------------------------------------------------------------
    // tasks/cancel — abort + set canceled (Slice C)
    // -------------------------------------------------------------------------
    case 'tasks/cancel': {
      const params = rpc.params;
      if (typeof params !== 'object' || params === null) {
        return jsonRpcError(rpcId, -32600, 'Invalid Request: params must be an object');
      }
      const p = params as Partial<A2ATasksCancelParams>;
      if (typeof p.id !== 'string' || !p.id) {
        return jsonRpcError(rpcId, -32600, 'Invalid Request: params.id must be a non-empty string');
      }

      const record = getTask(p.id);
      if (!record) {
        return jsonRpcError(rpcId, -32001, `task not found: ${p.id}`);
      }

      if (record.abort && record.state === 'working') {
        record.abort.abort();
      }
      updateTask(p.id, { state: 'canceled' });

      console.log(JSON.stringify({
        audit: 'a2a.tasks_cancel',
        task_id: p.id,
        ts: new Date().toISOString(),
      }));

      const result: A2ATaskResult = {
        jsonrpc: '2.0',
        id: rpcId as string | number,
        result: {
          id: record.id,
          contextId: record.contextId,
          status: { state: 'canceled' },
          kind: 'task',
        },
      };

      return NextResponse.json(result);
    }

    // -------------------------------------------------------------------------
    // Unknown method
    // -------------------------------------------------------------------------
    default: {
      return jsonRpcError(rpcId, -32601, `Method not found: "${rpc.method}"`);
    }
  }
}

// ---------------------------------------------------------------------------
// Shared: parse message/send and message/stream params
// ---------------------------------------------------------------------------

function parseMessageParams(
  params: unknown,
  rpcId: string | number | null,
): { userText: string } | Response {
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

  const userText = p.message.parts
    .filter((part): part is A2APart & { kind: 'text'; text: string } =>
      part.kind === 'text' && typeof part.text === 'string',
    )
    .map((part) => part.text)
    .join('');

  if (!userText.trim()) {
    return jsonRpcError(rpcId, -32600, 'Invalid Request: no text content found in message parts');
  }

  return { userText };
}

// ---------------------------------------------------------------------------
// Secretary dispatch — promisified wrapper around sendWarmTurn (for message/send)
// ---------------------------------------------------------------------------

function dispatchToSecretarySync(userText: string): Promise<string> {
  const { staffId, binary, cwd } = getSecretarySubstrate();
  const prompt = buildOwnerPrompt(userText, []);

  return new Promise<string>((resolve, reject) => {
    if (binary !== 'claude') {
      reject(new Error(`secretary binary "${binary}" not supported in message/send; only claude warm mode is supported`));
      return;
    }

    let finalText = '';
    sendWarmTurn(staffId, binary, cwd, prompt, {
      onText: (full) => { finalText = full; },
      onDone: () => resolve(finalText.trim()),
      onError: (msg) => reject(new Error(msg)),
    });
  });
}

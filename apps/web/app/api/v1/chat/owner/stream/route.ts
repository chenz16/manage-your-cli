import { deviceAuthErrorResponse, requireDeviceTokenForRemote } from '@/lib/device-token-auth';
import { spawn } from 'node:child_process';
import { getOrCreateSecretaryStaff, readBossMemory, getProject, appendChatMessage, getOwner, getSecretaryProject, secretaryProjectThreadId, listSecretaryProjects, getStaffMerged } from '@holon/core';
import { getEffectiveLanguage } from '@/lib/i18n/get-effective-language';
import { sendWarmTurn } from '@/lib/warm-agent';
import { parseJsonRequestBody, extractChatMessages, extractLatestUserText, buildOwnerPrompt } from '@/lib/owner-chat-helpers';

const OWNER_THREAD_ID = 'owner';

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

  // Resolve secretary project scope.
  // Priority: body.project_id (new multi-project mobile) → query param ?project=ID
  // → default singleton secretary (back-compat).
  const url = new URL(req.url);
  const projectIdFromQuery = url.searchParams.get('project');
  const projectIdFromBody =
    typeof body === 'object' && body !== null && 'project_id' in body
      ? (body as { project_id?: unknown }).project_id
      : undefined;
  const resolvedProjectId = typeof projectIdFromBody === 'string'
    ? projectIdFromBody
    : (projectIdFromQuery ?? null);

  // Determine thread ID and secretary staff for this request.
  let threadId: string = OWNER_THREAD_ID;
  let resolvedSecretaryStaffId: string | null = null;

  if (resolvedProjectId) {
    const sproj = getSecretaryProject(resolvedProjectId);
    if (sproj) {
      threadId = secretaryProjectThreadId(resolvedProjectId);
      resolvedSecretaryStaffId = sproj.secretary_staff_id;
    } else {
      // project_id provided but not found — fall back to first secretary project
      const projects = listSecretaryProjects();
      if (projects.length > 0 && projects[0]) {
        threadId = secretaryProjectThreadId(projects[0].id);
        resolvedSecretaryStaffId = projects[0].secretary_staff_id;
      }
    }
  } else {
    // No project specified — check if there are secretary projects; use first one.
    // This provides back-compat: old clients that don't send project_id still work.
    const projects = listSecretaryProjects();
    if (projects.length > 0 && projects[0]) {
      threadId = secretaryProjectThreadId(projects[0].id);
      resolvedSecretaryStaffId = projects[0].secretary_staff_id;
    }
    // Otherwise keep threadId = 'owner' (pre-migration fallback)
  }

  // Persist the user message immediately (before we await the LLM response)
  // so the desk transcript is visible even if the assistant reply is slow.
  appendChatMessage(threadId, { role: 'user', content: userText });

  // Phase 1: active project memory injection (design doc § 9 item 8).
  // When the client passes `active_project_id`, read its boss-memory scope
  // and prepend it to the owner prompt as context. Backward-compat: if
  // the field is absent or the project has no memory, behavior is unchanged.
  let activeProjectContext: { name: string; memoryText: string } | null = null;
  const activeProjectId =
    typeof body === 'object' && body !== null && 'active_project_id' in body
      ? (body as { active_project_id?: unknown }).active_project_id
      : undefined;
  if (typeof activeProjectId === 'string') {
    const proj = getProject(activeProjectId);
    if (proj) {
      const memResult = readBossMemory(`projects/${proj.slug}`);
      activeProjectContext = {
        name: proj.name,
        memoryText: memResult.ok ? memResult.text : '',
      };
    }
  }

  // Extract optional client flag (e.g. 'mobile') for verbosity calibration.
  const clientId =
    typeof body === 'object' && body !== null && 'client' in body
      ? (body as { client?: unknown }).client
      : undefined;
  const client = typeof clientId === 'string' ? clientId : null;

  // Resolve language preference server-side from the owner config so the
  // Secretary directive is authoritative even before the client sends the pref.
  // Default is zh-CN (product default); only 'en' overrides to English.
  const owner = getOwner();
  const language = getEffectiveLanguage(owner);

  // Resolve the secretary to use: project-specific secretary or default singleton.
  const defaultSecretary = getOrCreateSecretaryStaff();
  const secretary = resolvedSecretaryStaffId
    ? (getStaffMerged(resolvedSecretaryStaffId) ?? defaultSecretary)
    : defaultSecretary;
  const substrate = secretary.substrate;
  const cwd = substrate.kind === 'cli_agent' ? substrate.cwd : undefined;
  const binary = substrate.kind === 'cli_agent' && substrate.binary ? substrate.binary : 'claude';
  const ownerPrompt = buildOwnerPrompt(userText, messages, activeProjectContext, client, language);

  // Headless: drive the OFFICIAL CLI non-interactively (claude -p / codex exec) and
  // stream its clean stdout. No TUI screen-scrape. Subscription-only; NO API key.
  // The owner reads the Secretary, so its output must be clean → headless. Employees
  // stay as live tmux sessions (watch/drive); the Secretary reads them via the MCP.
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      let assembled = '';
      let closed = false;

      // iOS WKWebView buffers a streamed fetch response until ~2KB has arrived
      // before handing the first chunk to the ReadableStream reader — so the
      // mobile 小秘 reply appeared only after the FULL turn (~10s) instead of
      // streaming token-by-token like the desk (~3s first token). Prime the
      // stream with a padding SSE comment to cross that threshold immediately;
      // the client ignores `:`-comment frames.
      controller.enqueue(encoder.encode(`:${' '.repeat(2048)}\n\n`));

      const emit = (event: object) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(sse(event))); }
        catch { closed = true; }
      };
      const finish = (stopReason: string, reason?: string) => {
        if (closed) return;
        closed = true;
        const finalText = assembled.trim();
        try {
          controller.enqueue(encoder.encode(sse({ type: 'done', stopReason, finalText })));
          controller.close();
        } catch { /* already closed */ }
        // Persist the assistant reply to the desk transcript so mobile
        // (and desk on reload) can sync the full conversation.
        if (finalText) {
          appendChatMessage(threadId, { role: 'assistant', content: finalText });
        }
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

#!/usr/bin/env node
/**
 * codex-openai-shim.mjs — EXPERIMENT (ADR-040 follow-up).
 *
 * Exposes an OpenAI-compatible POST /v1/chat/completions that fulfils each
 * request by running the owner's **Codex subscription** via `scripts/codex-agent.sh`
 * (Windows Codex over WSL interop, ChatGPT login — no API key, no token billing).
 *
 * Point Hermes at it to empirically test "can the Codex subscription be Hermes's
 * LLM engine":
 *     HOLON_LLM_GATEWAY_URL=http://127.0.0.1:4001  LITELLM_MASTER_KEY=shim
 *
 * CAVEATS (this is a hack, not a shippable integration):
 *  - `codex exec` is an AGENT (multi-step, slow ~10-60s/turn), not a chat model.
 *    Forced to "just answer" via a directive, but it can still behave oddly.
 *  - Using a subscription through a third-party harness is a ToS gray area.
 *
 * Usage: node scripts/codex-openai-shim.mjs   (PORT env, default 4001)
 */
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const PORT = Number(process.env.PORT ?? 4001);
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const AGENT = join(REPO, 'scripts', 'codex-agent.sh');
const SANDBOX = process.env.CODEX_SHIM_SANDBOX ?? 'read-only';

const DIRECTIVE =
  'You are a plain conversational assistant. Reply to the LAST user message with ' +
  'a direct text answer ONLY. Do not run shell commands, do not read or edit files, ' +
  'do not use tools — just answer in text.';

function buildPrompt(messages) {
  const lines = [DIRECTIVE, ''];
  for (const m of messages ?? []) {
    if (!m || typeof m.content !== 'string') continue;
    const role = m.role === 'assistant' ? 'ASSISTANT' : m.role === 'system' ? 'SYSTEM' : 'USER';
    lines.push(`${role}: ${m.content}`);
  }
  lines.push('', 'ASSISTANT:');
  return lines.join('\n');
}

/** Run codex-agent.sh with the prompt on stdin; resolve its final message. */
function runCodex(prompt) {
  return new Promise((resolve) => {
    const p = spawn('bash', [AGENT, '-s', SANDBOX, '-'], { cwd: REPO });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => { out += d.toString(); });
    p.stderr.on('data', (d) => { err += d.toString(); });
    p.on('close', (code) => {
      // codex-agent.sh prints the clean answer after this marker; the closing
      // dash run can sit on the SAME line as the message (no newline before it).
      const m = out.match(/----- codex final message -----\n([\s\S]*?)-{15,}/);
      let content = m ? m[1].trim() : '';
      if (!content) content = out.trim() || err.trim() || `(codex-agent exit ${code}, no output)`;
      resolve(content);
    });
    p.on('error', (e) => resolve(`(shim spawn error: ${e.message})`));
    p.stdin.write(prompt);
    p.stdin.end();
  });
}

function sendJson(res, obj, status = 200) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') return sendJson(res, { ok: true, engine: 'codex-subscription-shim' });
  if (req.method === 'GET' && (req.url === '/v1/models' || req.url === '/models')) {
    return sendJson(res, { object: 'list', data: [{ id: 'deepseek-chat', object: 'model', owned_by: 'codex-shim' }] });
  }
  if (req.method !== 'POST' || !req.url.includes('/chat/completions')) {
    return sendJson(res, { error: 'not_found' }, 404);
  }

  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', async () => {
    let body;
    try { body = JSON.parse(raw); } catch { return sendJson(res, { error: 'invalid_json' }, 400); }
    const model = body.model ?? 'deepseek-chat';
    const stream = body.stream === true;
    const started = Date.now();
    console.log(`[shim] chat/completions stream=${stream} msgs=${(body.messages ?? []).length} → codex exec…`);
    const content = await runCodex(buildPrompt(body.messages));
    console.log(`[shim] codex replied in ${((Date.now() - started) / 1000).toFixed(1)}s (${content.length} chars)`);

    const id = `chatcmpl-codexshim-${Date.now()}`;
    if (stream) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      const chunk = { id, object: 'chat.completion.chunk', created: Math.floor(started / 1000), model, choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }] };
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      const done = { id, object: 'chat.completion.chunk', created: Math.floor(started / 1000), model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] };
      res.write(`data: ${JSON.stringify(done)}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    } else {
      sendJson(res, {
        id, object: 'chat.completion', created: Math.floor(started / 1000), model,
        choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      });
    }
  });
});

server.listen(PORT, '127.0.0.1', () => console.log(`[codex-openai-shim] listening 127.0.0.1:${PORT} → codex subscription via ${AGENT} (sandbox=${SANDBOX})`));

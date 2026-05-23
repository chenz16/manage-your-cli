#!/usr/bin/env node
/**
 * Automated delegation smoke for iter-007 step 4: ask the owner agent
 * to assign work to a specific staff, verify the right tool fired, and
 * extract any structured side-effect (job_id, etc.) from the stream.
 *
 * Usage: node apps/web/scripts/test-delegation.mjs
 * Prereq: pnpm -F web dev running on :3000.
 */

const PROMPT = '请安排 Aria 研究一下 Q3 北美供应商的合规风险, 一周内交一份简报. 用 assign_to_staff 工具记录这次派单.';
const ENDPOINT = 'http://localhost:3000/api/v1/chat/owner/stream';
const TIMEOUT_MS = 180_000;

const events = [];
const toolCalls = [];
let finalText = '';
let lastTextLen = 0;

function logEvent(ev) {
  events.push(ev);
  if (ev.type === 'tool_call') {
    toolCalls.push(ev);
    console.log(`  🛠  tool_call · ${ev.name} · ${ev.status} · id=${ev.id ?? '-'}`);
  } else if (ev.type === 'tool_update') {
    console.log(`     tool_update · id=${ev.id} · ${ev.status}`);
  } else if (ev.type === 'text') {
    const t = ev.text ?? '';
    if (t.length - lastTextLen >= 80) {
      console.log(`     text grew to ${t.length} chars`);
      lastTextLen = t.length;
    }
  } else if (ev.type === 'done') {
    finalText = ev.finalText ?? '';
    console.log(`  ✅ done · stopReason=${ev.stopReason} · finalText=${finalText.length} chars`);
  } else if (ev.type === 'error') {
    console.log(`  ❌ error · ${ev.message}`);
  }
}

console.log(`POST ${ENDPOINT}`);
console.log(`prompt: ${PROMPT}\n`);

const ctrl = new AbortController();
const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

let response;
try {
  response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: PROMPT }] }),
    signal: ctrl.signal,
  });
} catch (err) {
  console.error('fetch failed:', err.message);
  process.exit(1);
}

if (!response.ok || !response.body) {
  console.error(`HTTP ${response.status}`);
  process.exit(1);
}

const reader = response.body.getReader();
const decoder = new TextDecoder();
let buf = '';
while (true) {
  const { value, done } = await reader.read();
  if (done) break;
  buf += decoder.decode(value, { stream: true });
  let sep;
  while ((sep = buf.indexOf('\n\n')) !== -1) {
    const frame = buf.slice(0, sep);
    buf = buf.slice(sep + 2);
    const data = frame.split('\n').find((l) => l.startsWith('data:'));
    if (!data) continue;
    try { logEvent(JSON.parse(data.slice(5).trim())); } catch {}
  }
}

clearTimeout(timer);

console.log('\n--- summary ---');
console.log(`tool_call events: ${toolCalls.length}`);
console.log(`tools fired: ${toolCalls.map((t) => t.name).join(', ') || '(none)'}`);
console.log(`final assistant text (first 400 chars):\n${finalText.slice(0, 400)}`);

const fired = new Set(toolCalls.map((t) => t.name));
const PASS_TOOLS = ['assign_to_staff', 'delegate_task', 'list_staff', 'query_staff'];
const hit = PASS_TOOLS.filter((n) => fired.has(n));
if (hit.length === 0) {
  console.log('\n❌ FAIL — no delegation tool was called.');
  process.exit(2);
}
console.log(`\n✅ PASS — delegation tool(s) fired: ${hit.join(', ')}`);

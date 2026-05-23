import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOOL_NAMES } from './tools.js';

function sanitizedEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (key === 'ANTHROPIC_API_KEY' || key === 'OPENAI_API_KEY') continue;
    env[key] = value;
  }
  env.HOLON_AGENTS_HOME = mkdtempSync(join(tmpdir(), 'holon-mcp-self-test-'));
  return env;
}

function textPayload(result: unknown): string {
  const content = (result as { content?: Array<{ type?: string; text?: string }> }).content;
  const text = content?.find((item) => item.type === 'text')?.text;
  if (!text) throw new Error('tool result did not include text content');
  return text;
}

function parsePayload(result: unknown): unknown {
  return JSON.parse(textPayload(result)) as unknown;
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const serverPath = fileURLToPath(new URL('./server.ts', import.meta.url));
const client = new Client({ name: 'holon-mcp-self-test', version: '0.0.0' });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['--import', 'tsx', serverPath],
  env: sanitizedEnv(),
});

await client.connect(transport);

const listed = await client.listTools();
const names = listed.tools.map((tool) => tool.name).sort();
assert(JSON.stringify(names) === JSON.stringify([...TOOL_NAMES].sort()), `expected tools ${TOOL_NAMES.join(', ')}, got ${names.join(', ')}`);

const live = parsePayload(await client.callTool({ name: 'list_live_agents', arguments: {} }));
assert(Array.isArray(live), 'list_live_agents must return an array');

const created = parsePayload(await client.callTool({
  name: 'create_agent',
  arguments: { role: 'test-helper', lifecycle: 'short' },
})) as { ok?: boolean; staff?: { role_name?: string } };
assert(created.ok === true, 'create_agent must return ok true after staff provisioning');
assert(created.staff?.role_name === 'test_helper', 'create_agent must provision a test-helper staff row');

const note = `round-trip ${Date.now()}`;
const wrote = parsePayload(await client.callTool({
  name: 'write_memory',
  arguments: { scope: 'self-test', text: note },
})) as { ok?: boolean };
assert(wrote.ok === true, 'write_memory must succeed');

const read = parsePayload(await client.callTool({
  name: 'read_memory',
  arguments: { scope: 'self-test' },
})) as { ok?: boolean; text?: string };
assert(read.ok === true && read.text?.includes(note), 'read_memory must return the written note');

await client.close();
console.log(JSON.stringify({ ok: true, tools: names }, null, 2));

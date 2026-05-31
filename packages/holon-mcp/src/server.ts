#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { pathToFileURL } from 'node:url';
import {
  composeRolePersonaTool,
  composeRolePersonaSchema,
  consolidateMemory,
  createAgent,
  createAgentSchema,
  createAgentWithRole,
  createAgentWithRoleSchema,
  dispatch,
  dispatchSchema,
  listLiveAgents,
  listRoleTemplatesSchema,
  listRoleTemplatesTool,
  readAgentOutput,
  readAgentOutputSchema,
  readMemory,
  readMemorySchema,
  retireAgent,
  retireAgentSchema,
  toolResult,
  writeMemory,
  writeMemorySchema,
} from './tools.js';

function routeProcessLogsToStderr(): void {
  console.log = (...args: unknown[]) => {
    console.error(...args);
  };
}

export function buildServer(): McpServer {
  const server = new McpServer({
    name: 'holon-mcp',
    version: '0.0.0',
  });

  server.registerTool(
    'list_live_agents',
    {
      title: 'List live CLI agents',
      description: 'Return live Holon CLI agents only.',
      inputSchema: {},
    },
    async () => toolResult(await listLiveAgents()),
  );

  server.registerTool(
    'dispatch',
    {
      title: 'Dispatch CLI task',
      description: 'Send a task brief to a CLI agent by id or exact name.',
      inputSchema: dispatchSchema,
    },
    async ({ agent, brief }) => toolResult(await dispatch(agent, brief)),
  );

  server.registerTool(
    'read_agent_output',
    {
      title: 'Read agent output',
      description: 'Capture raw tmux scrollback from a CLI agent.',
      inputSchema: readAgentOutputSchema,
    },
    async ({ agent, lines }) => toolResult(await readAgentOutput(agent, lines)),
  );

  server.registerTool(
    'create_agent',
    {
      title: 'Create CLI agent',
      description: 'Create a short-term or long-term Holon CLI employee.',
      inputSchema: createAgentSchema,
    },
    async ({ role, lifecycle, binary }) => toolResult(await createAgent(role, lifecycle, binary)),
  );

  server.registerTool(
    'retire_agent',
    {
      title: 'Retire CLI agent',
      description: 'Stop a CLI agent session and archive the staff row.',
      inputSchema: retireAgentSchema,
    },
    async ({ agent }) => toolResult(await retireAgent(agent)),
  );

  server.registerTool(
    'read_memory',
    {
      title: 'Read boss memory',
      description: 'Read boss memory INDEX.md or one scoped detail file.',
      inputSchema: readMemorySchema,
    },
    async ({ scope, project_id }) => toolResult(await readMemory(scope, project_id)),
  );

  server.registerTool(
    'write_memory',
    {
      title: 'Write boss memory',
      description: 'Append to one boss-memory detail file and update INDEX.md.',
      inputSchema: writeMemorySchema,
    },
    async ({ scope, text, project_id }) => toolResult(await writeMemory(scope, text, project_id)),
  );

  server.registerTool(
    'list_role_templates',
    {
      title: 'List role templates',
      description: 'Discover available role templates (id/name/description/tags/compose_with). Optional tag filter.',
      inputSchema: listRoleTemplatesSchema,
    },
    async ({ tag }) => toolResult(await listRoleTemplatesTool(tag)),
  );

  server.registerTool(
    'compose_role_persona',
    {
      title: 'Compose role persona',
      description: 'Preview the composed persona for a nominal role + optional compose_with override. Returns structured persona + rendered markdown.',
      inputSchema: composeRolePersonaSchema,
    },
    async ({ nominal, actual_ids }) => toolResult(await composeRolePersonaTool(nominal, actual_ids)),
  );

  server.registerTool(
    'create_agent_with_role',
    {
      title: 'Create CLI agent with role',
      description: 'End-to-end: validate role, compose persona, create CLI agent (long lifecycle), write Role-Composition into the per-binary memory file. Default binary picks first installed in claude → codex → gemini → qwen.',
      inputSchema: createAgentWithRoleSchema,
    },
    async ({ role_id, name, binary, cwd, compose_with }) =>
      toolResult(await createAgentWithRole(role_id, name, binary, cwd, compose_with)),
  );

  server.registerTool(
    'consolidate_memory',
    {
      title: 'Consolidate boss memory',
      description: 'Dispatch the long-term memory-manager CLI agent to consolidate boss memory.',
      inputSchema: {},
    },
    async () => toolResult(await consolidateMemory()),
  );

  return server;
}

export async function main(): Promise<void> {
  routeProcessLogsToStderr();
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

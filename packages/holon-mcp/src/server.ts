#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { pathToFileURL } from 'node:url';
import {
  consolidateMemory,
  createAgent,
  createAgentSchema,
  createProjectTool,
  createProjectSchema,
  dispatch,
  dispatchSchema,
  listLiveAgents,
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
    async ({ scope }) => toolResult(await readMemory(scope)),
  );

  server.registerTool(
    'write_memory',
    {
      title: 'Write boss memory',
      description: 'Append to one boss-memory detail file and update INDEX.md.',
      inputSchema: writeMemorySchema,
    },
    async ({ scope, text }) => toolResult(await writeMemory(scope, text)),
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

  server.registerTool(
    'create_project',
    {
      title: 'Create project',
      description:
        'Create a new project by name (natural language: "create project X" / "建项目 X"). ' +
        'Auto-slugifies the name, creates the in-memory store entry, and scaffolds the ' +
        'boss-memory scope so context is available in future turns. ' +
        'Returns { id, name, slug }.',
      inputSchema: createProjectSchema,
    },
    async ({ name, color }) => toolResult(await createProjectTool(name, color)),
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

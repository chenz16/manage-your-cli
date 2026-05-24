export type McpPluginTransport = 'stdio' | 'remote';
export type McpToolRisk = 'read' | 'write';

export interface McpPluginToolCapability {
  id: string;
  label: string;
  risk: McpToolRisk;
  description: string;
}

export interface McpPluginConfigField {
  key: string;
  label: string;
  required: boolean;
  secret?: boolean;
  description?: string;
}

export interface McpPluginStdioInstallSpec {
  type: 'stdio';
  npmPackage?: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface McpPluginRemoteInstallSpec {
  type: 'remote';
  url: string;
  headers?: Record<string, string>;
}

export type McpPluginInstallSpec = McpPluginStdioInstallSpec | McpPluginRemoteInstallSpec;

export interface McpPluginManifest {
  id: string;
  name: string;
  description: string;
  transport: McpPluginTransport;
  bundled?: boolean;
  install: McpPluginInstallSpec;
  capabilities: McpPluginToolCapability[];
  needsConfig: McpPluginConfigField[];
}

export const MCP_PLUGIN_REGISTRY: McpPluginManifest[] = [
  {
    id: 'holon',
    name: 'Holon MCP',
    description: 'Bundled desk tools for creating agents, dispatching work, reading output, and managing boss memory.',
    transport: 'stdio',
    bundled: true,
    install: {
      type: 'stdio',
      command: 'corepack',
      args: ['pnpm', '-C', '{repoRoot}', '-F', 'holon-mcp', 'start'],
    },
    needsConfig: [],
    capabilities: [
      {
        id: 'holon.list_live_agents',
        label: 'List live agents',
        risk: 'read',
        description: 'Lists running CLI employees and their current status.',
      },
      {
        id: 'holon.read_agent_output',
        label: 'Read agent output',
        risk: 'read',
        description: 'Reads recent terminal output from a CLI employee.',
      },
      {
        id: 'holon.dispatch',
        label: 'Dispatch work',
        risk: 'write',
        description: 'Sends a task prompt to a CLI employee.',
      },
      {
        id: 'holon.create_agent',
        label: 'Create agent',
        risk: 'write',
        description: 'Creates a new CLI employee workspace and session.',
      },
      {
        id: 'holon.write_memory',
        label: 'Write memory',
        risk: 'write',
        description: 'Appends durable notes to the owner memory store.',
      },
    ],
  },
  {
    id: 'filesystem',
    name: 'Filesystem MCP',
    description: 'Curated local filesystem access for explicitly configured directories.',
    transport: 'stdio',
    install: {
      type: 'stdio',
      npmPackage: '@modelcontextprotocol/server-filesystem',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '{config.roots}'],
    },
    needsConfig: [
      {
        key: 'roots',
        label: 'Allowed directories',
        required: true,
        description: 'Absolute path, or array of absolute paths, the MCP server may access.',
      },
    ],
    capabilities: [
      {
        id: 'filesystem.read_file',
        label: 'Read files',
        risk: 'read',
        description: 'Reads files within the configured allowed directories.',
      },
      {
        id: 'filesystem.list_directory',
        label: 'List directories',
        risk: 'read',
        description: 'Lists directory contents within the configured allowed directories.',
      },
      {
        id: 'filesystem.write_file',
        label: 'Write files',
        risk: 'write',
        description: 'Writes files within the configured allowed directories.',
      },
    ],
  },
  {
    id: 'fetch',
    name: 'Fetch MCP',
    description: 'Curated web fetch server for retrieving URL contents through the CLI MCP host.',
    transport: 'stdio',
    install: {
      type: 'stdio',
      command: 'uvx',
      args: ['mcp-server-fetch'],
    },
    needsConfig: [],
    capabilities: [
      {
        id: 'fetch.fetch',
        label: 'Fetch URL',
        risk: 'read',
        description: 'Retrieves and converts URL contents for the CLI employee.',
      },
    ],
  },
];

export function findMcpPluginManifest(id: string): McpPluginManifest | undefined {
  return MCP_PLUGIN_REGISTRY.find((plugin) => plugin.id === id);
}

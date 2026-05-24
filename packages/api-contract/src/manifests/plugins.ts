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
  /**
   * Optional numbered setup steps shown in the plugin card before install.
   * Each string is one step (plain text, rendered as an ordered list).
   * Use when the plugin requires manual credential / OAuth setup outside
   * the normal needsConfig flow (e.g. Gmail OAuth, API key generation).
   */
  setupSteps?: string[];
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
    id: 'gmail',
    name: 'Gmail MCP',
    description:
      'Give the desk Secretary read/draft access to your Gmail inbox via MCP. Uses the official @gongrzhe/server-gmail-autoauth-mcp MCP server — OAuth is handled locally on first run; no credentials leave your machine.',
    transport: 'stdio',
    install: {
      type: 'stdio',
      npmPackage: '@gongrzhe/server-gmail-autoauth-mcp',
      command: 'npx',
      args: ['-y', '@gongrzhe/server-gmail-autoauth-mcp'],
    },
    needsConfig: [],
    setupSteps: [
      'Install Node.js 18+ and make sure `npx` is on your PATH.',
      'Run the install step on this card — `npx -y @gongrzhe/server-gmail-autoauth-mcp` will download and start the server.',
      'On first start, a browser window opens automatically asking you to sign in to Google and grant the requested Gmail scopes (read threads, manage labels, create drafts). Complete that OAuth flow.',
      'The server saves an OAuth token to `~/.gmail-mcp/` on your desk machine. No tokens are sent anywhere outside your machine.',
      'Return to this page and enable the plugin. The Secretary can now search, read, and draft Gmail messages on your behalf.',
      'To revoke access at any time: visit https://myaccount.google.com/permissions and remove "Gmail MCP", then uninstall this plugin.',
    ],
    capabilities: [
      {
        id: 'gmail.search_threads',
        label: 'Search threads',
        risk: 'read',
        description: 'Searches Gmail threads by query (from:, subject:, label:, date ranges, etc.).',
      },
      {
        id: 'gmail.get_thread',
        label: 'Read thread',
        risk: 'read',
        description: 'Retrieves the full message content of a Gmail thread.',
      },
      {
        id: 'gmail.list_labels',
        label: 'List labels',
        risk: 'read',
        description: 'Lists all Gmail labels (system + user-defined).',
      },
      {
        id: 'gmail.create_draft',
        label: 'Create draft',
        risk: 'write',
        description: 'Creates a new draft email in the authenticated Gmail account.',
      },
      {
        id: 'gmail.label_thread',
        label: 'Label thread',
        risk: 'write',
        description: 'Adds or removes labels on a Gmail thread.',
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

import type { IntegrationLink, McpPluginManifest } from '@holon/api-contract';
import { MCP_PLUGIN_REGISTRY, findMcpPluginManifest } from '@holon/api-contract';
import { getOwner, updateOwner } from './owner-config-service.js';

export type McpPluginConfig = Record<string, unknown>;

export interface InstalledMcpPlugin {
  id: string;
  label: string;
  config: McpPluginConfig;
  enabled: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function mcpPluginId(link: Extract<IntegrationLink, { kind: 'mcp' }>): string | null {
  const raw = link.config.plugin_id ?? link.config.id;
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null;
}

function installedFromLink(link: Extract<IntegrationLink, { kind: 'mcp' }>): InstalledMcpPlugin | null {
  const id = mcpPluginId(link);
  if (!id) return null;
  return {
    id,
    label: link.label,
    config: { ...link.config },
    enabled: link.enabled,
  };
}

function installedLinks(): Array<Extract<IntegrationLink, { kind: 'mcp' }>> {
  return getOwner().integrations.filter((link): link is Extract<IntegrationLink, { kind: 'mcp' }> => link.kind === 'mcp');
}

function validateConfig(manifest: McpPluginManifest, config: McpPluginConfig): void {
  for (const field of manifest.needsConfig) {
    if (!field.required) continue;
    const value = config[field.key];
    const hasString = typeof value === 'string' && value.trim().length > 0;
    const hasStringArray = Array.isArray(value)
      && value.length > 0
      && value.every((item) => typeof item === 'string' && item.trim().length > 0);
    if (!hasString && !hasStringArray) {
      throw new Error(`missing required config field: ${field.key}`);
    }
  }
}

export function listRegistry(): McpPluginManifest[] {
  return MCP_PLUGIN_REGISTRY;
}

export function listInstalled(): InstalledMcpPlugin[] {
  return installedLinks()
    .map(installedFromLink)
    .filter((plugin): plugin is InstalledMcpPlugin => plugin !== null);
}

export function installPlugin(id: string, config: unknown = {}): InstalledMcpPlugin {
  const manifest = findMcpPluginManifest(id);
  if (!manifest) throw new Error(`unknown plugin: ${id}`);
  if (!isRecord(config)) throw new Error('config must be an object');

  const pluginConfig: McpPluginConfig = { ...config, plugin_id: id };
  validateConfig(manifest, pluginConfig);

  const owner = getOwner();
  const integrations = [...owner.integrations];
  const existingIndex = integrations.findIndex((link) => link.kind === 'mcp' && mcpPluginId(link) === id);
  const link: Extract<IntegrationLink, { kind: 'mcp' }> = {
    kind: 'mcp',
    label: manifest.name,
    config: pluginConfig,
    enabled: true,
  };

  if (existingIndex >= 0) integrations[existingIndex] = link;
  else integrations.push(link);
  updateOwner({ integrations });
  return installedFromLink(link) as InstalledMcpPlugin;
}

export function setPluginEnabled(id: string, enabled: boolean): InstalledMcpPlugin {
  if (!findMcpPluginManifest(id)) throw new Error(`unknown plugin: ${id}`);
  const owner = getOwner();
  let updated: InstalledMcpPlugin | null = null;
  const integrations = owner.integrations.map((link) => {
    if (link.kind !== 'mcp' || mcpPluginId(link) !== id) return link;
    const next = { ...link, enabled };
    updated = installedFromLink(next);
    return next;
  });
  if (!updated) throw new Error(`plugin not installed: ${id}`);
  updateOwner({ integrations });
  return updated;
}

export function uninstallPlugin(id: string): boolean {
  const owner = getOwner();
  const integrations = owner.integrations.filter((link) => link.kind !== 'mcp' || mcpPluginId(link) !== id);
  if (integrations.length === owner.integrations.length) return false;
  updateOwner({ integrations });
  return true;
}

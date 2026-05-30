/**
 * myc config — owner config + feature-visibility flags.
 *
 * Core readers used:
 *   - getOwner()           owner_assistant (name, role, system_prompt,
 *                          workspace, budget, integrations, substrate)
 *   - getEffectiveLanguage() UI language setting
 *
 * Feature flags / env vars reported:
 *   HOLON_OPEN_DEMO, HOLON_DB_PATH, HOLON_AGENTS_HOME, HOLON_SEED_DEMO_STAFF
 *
 * Note: token keys, OAuth blobs, and channel_creds are intentionally
 * NOT printed — headless read is identity/config only.
 */

import { getOwner, getEffectiveLanguage } from '@holon/core';

/* ── Types ─────────────────────────────────────────────────────────── */

interface IntegrationSummary {
  kind: string;
  label: string;
  enabled: boolean;
}

interface ConfigResult {
  timestamp: string;
  owner: {
    id: string;
    name: string | null;
    role: string | null;
    intro: string | null;
    has_system_prompt: boolean;
    workspace_dir: string | null;
    language: string;
  };
  integrations: IntegrationSummary[];
  substrate: {
    kind: string;
    tool_scope: string[] | null;
  };
  env: {
    HOLON_OPEN_DEMO: string | null;
    HOLON_DB_PATH: string | null;
    HOLON_AGENTS_HOME: string | null;
    HOLON_SEED_DEMO_STAFF: string | null;
  };
}

/* ── Command ───────────────────────────────────────────────────────── */

export async function runConfig({ json }: { json: boolean }): Promise<void> {
  let owner;
  try {
    owner = getOwner();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[config] owner config unavailable: ${msg}`);
    if (json) console.log(JSON.stringify({ error: msg }));
    return;
  }

  let language = 'en';
  try {
    language = getEffectiveLanguage(owner);
  } catch {
    // non-fatal
  }

  const integrations: IntegrationSummary[] = (owner.integrations ?? []).map((link) => ({
    kind: link.kind,
    label: link.label ?? link.kind,
    enabled: link.enabled,
  }));

  const substrate = owner.substrate as {
    kind?: string;
    tool_scope?: string[] | null;
  } | undefined;

  const result: ConfigResult = {
    timestamp: new Date().toISOString(),
    owner: {
      id: owner.id,
      name: owner.name ?? null,
      role: owner.owner_role ?? null,
      intro: owner.owner_intro ?? null,
      has_system_prompt: typeof owner.system_prompt === 'string' && owner.system_prompt.trim().length > 0,
      workspace_dir: owner.workspace_dir ?? null,
      language,
    },
    integrations,
    substrate: {
      kind: substrate?.kind ?? 'unknown',
      tool_scope: substrate?.tool_scope ?? null,
    },
    env: {
      HOLON_OPEN_DEMO: process.env['HOLON_OPEN_DEMO'] ?? null,
      HOLON_DB_PATH: process.env['HOLON_DB_PATH'] ?? null,
      HOLON_AGENTS_HOME: process.env['HOLON_AGENTS_HOME'] ?? null,
      HOLON_SEED_DEMO_STAFF: process.env['HOLON_SEED_DEMO_STAFF'] ?? null,
    },
  };

  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  /* ── Human-readable output ─────────────────────────────────────── */
  const ts = new Date(result.timestamp).toLocaleString();
  console.log(`\n== Config  (${ts}) ==\n`);

  console.log('Owner');
  console.log(`  id         : ${result.owner.id}`);
  console.log(`  name       : ${result.owner.name ?? '(not set)'}`);
  console.log(`  role       : ${result.owner.role ?? '(not set)'}`);
  if (result.owner.intro) console.log(`  intro      : ${result.owner.intro}`);
  console.log(`  workspace  : ${result.owner.workspace_dir ?? '(not set)'}`);
  console.log(`  language   : ${result.owner.language}`);
  console.log(`  system_prompt: ${result.owner.has_system_prompt ? 'set' : '(empty)'}`);

  console.log('\nSubstrate');
  console.log(`  kind       : ${result.substrate.kind}`);
  if (result.substrate.tool_scope) {
    console.log(`  tool_scope : ${result.substrate.tool_scope.join(', ')}`);
  }

  console.log(`\nIntegrations  (${integrations.length})`);
  if (integrations.length === 0) {
    console.log('  (none)');
  } else {
    for (const link of integrations) {
      const badge = link.enabled ? 'enabled ' : 'disabled';
      console.log(`  [${badge}]  ${link.kind.padEnd(12)} ${link.label}`);
    }
  }

  console.log('\nEnvironment');
  const env = result.env;
  console.log(`  HOLON_OPEN_DEMO      : ${env.HOLON_OPEN_DEMO ?? '(not set)'}`);
  console.log(`  HOLON_DB_PATH        : ${env.HOLON_DB_PATH ?? '(not set — default ~/.holon/owner.sqlite)'}`);
  console.log(`  HOLON_AGENTS_HOME    : ${env.HOLON_AGENTS_HOME ?? '(not set — default ~/holon-agents)'}`);
  console.log(`  HOLON_SEED_DEMO_STAFF: ${env.HOLON_SEED_DEMO_STAFF ?? '(not set — demo staff seeding off)'}`);
  console.log('');
}

/**
 * holon-paths — single source of truth for filesystem locations the runtime
 * reads/writes. Centralizes the env-override pattern so dev/test runs can
 * fully isolate from the owner's real ~/holon-agents/ + ~/.holon/ state.
 *
 * Spec: docs/adr/test-release-state-isolation.md
 *
 * Three envs, three roots:
 *
 *   HOLON_AGENTS_HOME → default $HOME/holon-agents
 *       per-staff workspaces + boss memory tree.
 *
 *   HOLON_STATE_ROOT  → default $XDG_DATA_HOME/holon or $HOME/.holon
 *       sqlite DBs, JSON state stores (warm-sessions, process-registry,
 *       hr-state, promotion-vetoes, uploads).
 *
 *   HOLON_DB_PATH     → default <state-root>/owner.sqlite
 *       single-file SQLite database. Already established (Task #8); this
 *       module just documents the convention.
 *
 * Always go through this module — direct homedir() + path-join from feature
 * code is now a lint-grade smell. Existing callers were migrated 2026-05-30
 * (feat/state-isolation).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const nodeRequire = eval('require') as (id: string) => any;
const { homedir } = nodeRequire('os') as typeof import('os');
const { join } = nodeRequire('path') as typeof import('path');

/**
 * Root for per-staff CLI workspaces and the boss-memory tree.
 * Default: `~/holon-agents`. Tests override with `HOLON_AGENTS_HOME`.
 */
export function holonAgentsHome(): string {
  const env = process.env.HOLON_AGENTS_HOME?.trim();
  if (env) return env;
  return join(process.env.HOME ?? homedir(), 'holon-agents');
}

/**
 * Root for runtime state (sqlite DBs, JSON stores, uploads). Mirrors the
 * existing XDG-aware pattern used in owner-state-persistence.ts.
 *
 * Priority:
 *   1. HOLON_STATE_ROOT (explicit override — tests + dev-vs-release isolation)
 *   2. $XDG_DATA_HOME/holon                (Linux desktop convention)
 *   3. $HOME/.holon                        (legacy / non-XDG fallback)
 */
export function holonStateRoot(): string {
  const env = process.env.HOLON_STATE_ROOT?.trim();
  if (env) return env;
  const xdg = process.env.XDG_DATA_HOME?.trim();
  if (xdg) return join(xdg, 'holon');
  return join(process.env.HOME ?? homedir(), '.holon');
}

/**
 * Default path for the owner's single-file SQLite DB. Callers that want to
 * support `HOLON_DB_PATH` should check that env first, then fall back here.
 * Kept as a helper so the layout stays consistent across services.
 */
export function holonDefaultDbPath(): string {
  return join(holonStateRoot(), 'owner.sqlite');
}

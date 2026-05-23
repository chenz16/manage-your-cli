/**
 * /me — real owner config (iter-007 step 6).
 *
 * Server fetches the baseline (fixture + any in-memory overrides) via
 * @holon/core's getOwner(), passes to MeClient which handles all
 * inline editing + LLM-polish + reset wiring.
 *
 * Mirror of mibusy's CEO sheet pattern, adapted to Holon's data model.
 */

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getOwner, loadFixtures } from '@holon/core';
import { MeClient } from './_components/MeClient';

// Match findRepoRoot() in apps/web/lib/hermes-acp-client.ts and
// packages/core/src/worker-dispatcher.ts — see ADR-018 Engineering
// Rule 11 (PII-free, machine-portable defaults). The /me page surfaces
// this as the suggested Sandbox directory so owners on a fresh install
// have a usable default to one-click into.
function findRepoRoot(): string {
  if (process.env.HOLON_REPO_ROOT) return process.env.HOLON_REPO_ROOT;
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

export default function MePage() {
  const owner = getOwner();
  const fx = loadFixtures();
  const primaryDesk = fx.desks.find((d) => d.id === fx.primary_desk_id);
  const conns = fx.connections.map((c) => ({
    id: c.id,
    display_name: c.display_name,
    health_state: c.health_state,
  }));
  const defaultWorkspaceDir = join(findRepoRoot(), 'workspace', 'owner-sandbox');
  return (
    <MeClient
      initialOwner={owner}
      primaryDesk={primaryDesk ? {
        display_name: primaryDesk.display_name,
        device_kind: primaryDesk.device_kind,
        span_of_control_cap: primaryDesk.span_of_control_cap,
      } : null}
      connections={conns}
      defaultWorkspaceDir={defaultWorkspaceDir}
    />
  );
}

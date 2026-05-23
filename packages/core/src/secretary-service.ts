import type { Staff } from '@holon/api-contract';
import { getCliAdapter } from './cli-adapters.js';
import { ensureSecretaryWorkspace } from './cli-memory-scaffold.js';
import { getCliStatus, launchCliSession, type LaunchError, type LaunchResult } from './cli-session-service.js';
import { createStaff, listStaffMerged } from './staff-management-service.js';

const SECRETARY_ROLE_NAME = 'secretary';

function secretaryBinary(): string {
  return process.env.HOLON_SECRETARY_BINARY?.trim()
    || process.env.HOLON_AGENT_BINARY?.trim()
    || 'claude';
}

export function getOrCreateSecretaryStaff(): Staff {
  const existing = listStaffMerged().find(
    (staff) => staff.role_name === SECRETARY_ROLE_NAME && staff.substrate.kind === 'cli_agent',
  );
  if (existing) return existing;

  const binary = secretaryBinary();
  const staff = createStaff({
    name: 'Secretary',
    role_label: 'Secretary',
    role_name: SECRETARY_ROLE_NAME,
    substrate: {
      kind: 'cli_agent',
      binary,
      lifecycle: 'long',
      cwd: ensureSecretaryWorkspace(),
      auto_launch: true,
      args_template: getCliAdapter(binary).interactiveArgs,
      approval_rules: [],
    },
    system_prompt: 'You are the CEO secretary. Answer concise owner questions directly, and use Holon MCP to create, dispatch, read, and retire CLI employees for heavy work.',
    max_concurrent_jobs: 1,
  });

  console.log(JSON.stringify({
    audit: 'secretary.staff.created',
    staff_id: staff.id,
    binary,
    cwd: staff.substrate.kind === 'cli_agent' ? staff.substrate.cwd ?? null : null,
    ts: new Date().toISOString(),
  }));
  return staff;
}

export function ensureSecretaryCliSession(): LaunchResult | LaunchError {
  const staff = getOrCreateSecretaryStaff();
  const result = launchCliSession(staff.id);
  console.log(JSON.stringify({
    audit: result.ok ? 'secretary.cli.ready' : 'secretary.cli.launch_failed',
    staff_id: staff.id,
    running: getCliStatus(staff.id).running,
    reason: result.ok ? undefined : result.reason,
    tmux_name: result.ok ? result.tmux_name : undefined,
    ts: new Date().toISOString(),
  }));
  return result;
}

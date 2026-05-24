#!/usr/bin/env node
/**
 * myc — headless CLI for Manage Your CLI desk.
 *
 * Reads desk state directly from @holon/core — NO running server required.
 * Usage: myc <command> [--json]
 *
 * Commands:
 *   status      — live agents, Secretary state, job counts
 *   connections — paired devices, A2A peers, MCP plugins, WeChat channel
 *   config      — owner config + feature-visibility flags
 *   usage       — token / cost ledger per-agent (毛估 self-count)
 *   help        — list commands (default when no args given)
 */

import { runStatus } from './cmd-status.js';
import { runConnections } from './cmd-connections.js';
import { runConfig } from './cmd-config.js';
import { runUsage } from './cmd-usage.js';

/* ── Tiny arg parser ──────────────────────────────────────────────── */

interface ParsedArgs {
  command: string;
  json: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  // argv[0] = node, argv[1] = script path
  const rest = argv.slice(2);
  const json = rest.includes('--json');
  const positional = rest.filter((a) => !a.startsWith('--'));
  const command = positional[0] ?? 'help';
  return { command, json };
}

/* ── Help ──────────────────────────────────────────────────────────── */

function printHelp(): void {
  console.log(`myc — Manage Your CLI headless desk CLI

USAGE
  myc <command> [--json]

COMMANDS
  status       Overall desk state: live agents, Secretary warm/state, job counts
  connections  Paired devices, A2A peers, MCP plugins, WeChat channel status
  config       Owner config + feature-visibility flags
  usage        Token usage stats per-agent (毛估 self-count from in-process ledger)
  help         Show this message

FLAGS
  --json       Machine-readable JSON output instead of human-readable text

EXAMPLES
  myc status
  myc connections --json
  myc config
`);
}

/* ── Dispatch ──────────────────────────────────────────────────────── */

async function main(): Promise<void> {
  const { command, json } = parseArgs(process.argv);

  switch (command) {
    case 'status':
      await runStatus({ json });
      break;
    case 'connections':
      await runConnections({ json });
      break;
    case 'config':
      await runConfig({ json });
      break;
    case 'usage':
      await runUsage({ json });
      break;
    case 'help':
    default:
      printHelp();
      break;
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  const name = err instanceof Error ? err.name : 'UnknownError';
  console.error(`[myc] ${name}: ${message}`);
  process.exit(1);
});

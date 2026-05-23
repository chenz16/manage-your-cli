import { ensureSecretaryWorkspace } from '@holon/core';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cwd = ensureSecretaryWorkspace();
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

console.log(JSON.stringify({
  ok: true,
  secretary_workspace: cwd,
  claude_mcp_json: join(cwd, '.mcp.json'),
  claude_mcp_add: `claude mcp add --transport stdio holon -- corepack pnpm -C ${repoRoot} -F holon-mcp start`,
  codex_mcp_add: `codex mcp add holon -- corepack pnpm -C ${repoRoot} -F holon-mcp start`,
}, null, 2));

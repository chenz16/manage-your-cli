/**
 * cli-discovery — detect which CLI subscriptions (claude / codex / gemini /
 * qwen) are installed on this desk. Used by:
 *   - /api/v1/cli/binaries (GET) — onboarding Step 3 + agent-create picker
 *
 * Implementation:
 *   - `which <bin>` → path (null if not on $PATH)
 *   - `<bin> --version` → version string (best-effort; null if not parsable)
 *   - 10-second in-process cache to avoid spawn storms on repeated calls
 *     (onboarding + agent-create + future SSE pings can all hit this).
 *
 * Pattern: matches heartbeat.ts — `eval('require')` keeps Node's CJS require
 * in scope so webpack treats `child_process` as a node builtin.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const nodeRequire = eval('require') as (id: string) => any;
const { execFileSync } = nodeRequire('child_process') as typeof import('child_process');

export type CliBinaryName = 'claude' | 'codex' | 'gemini' | 'qwen';

export const KNOWN_CLI_BINARIES: ReadonlyArray<CliBinaryName> = ['claude', 'codex', 'gemini', 'qwen'];

export interface CliBinaryStatus {
  /** Canonical binary name. */
  name: CliBinaryName;
  /** Human-friendly label for UI. */
  label: string;
  /** True iff `which <name>` returned a path. */
  installed: boolean;
  /** Absolute path from `which`, or null. */
  path: string | null;
  /** Parsed version string from `<name> --version`, or null. */
  version: string | null;
  /** Suggested install command (used when not installed). */
  install_hint: string;
  /** Docs URL for the CLI (used in onboarding help). */
  docs_url: string;
}

const LABEL: Record<CliBinaryName, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  gemini: 'Gemini CLI',
  qwen: 'Qwen Code',
};

const INSTALL_HINT: Record<CliBinaryName, string> = {
  claude: 'npm i -g @anthropic-ai/claude-code   then  claude /login',
  codex: 'npm i -g @openai/codex   then  codex login',
  gemini: 'npm i -g @google/gemini-cli   then  gemini',
  qwen: 'npm i -g @qwen-code/qwen-code   then  qwen',
};

const DOCS_URL: Record<CliBinaryName, string> = {
  claude: 'https://docs.anthropic.com/en/docs/claude-code',
  codex: 'https://github.com/openai/codex',
  gemini: 'https://github.com/google-gemini/gemini-cli',
  qwen: 'https://github.com/QwenLM/qwen-code',
};

const CACHE_TTL_MS = 10_000;
let cache: { at: number; value: CliBinaryStatus[] } | null = null;

function whichPath(bin: string): string | null {
  try {
    const out = execFileSync('which', [bin], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 1500,
    }).trim();
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

function probeVersion(bin: string): string | null {
  try {
    const out = execFileSync(bin, ['--version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000,
    }).trim();
    const m = out.match(/\b\d+\.\d+(?:\.\d+)?(?:[-+][\w.]+)?\b/);
    if (m) return m[0];
    return out.split('\n')[0]?.slice(0, 40) ?? null;
  } catch {
    return null;
  }
}

function probeOne(name: CliBinaryName): CliBinaryStatus {
  const path = whichPath(name);
  const installed = path !== null;
  const version = installed ? probeVersion(name) : null;
  return {
    name,
    label: LABEL[name],
    installed,
    path,
    version,
    install_hint: INSTALL_HINT[name],
    docs_url: DOCS_URL[name],
  };
}

export interface DiscoverOptions {
  /** Bypass the 10s cache (used by "Check again" button). */
  force?: boolean;
}

export function discoverCliBinaries(opts: DiscoverOptions = {}): CliBinaryStatus[] {
  const now = Date.now();
  if (!opts.force && cache && now - cache.at < CACHE_TTL_MS) {
    return cache.value;
  }
  const value = KNOWN_CLI_BINARIES.map(probeOne);
  cache = { at: now, value };
  return value;
}

/** Test-only: clear the cache between runs. */
export function _resetCliDiscoveryCacheForTests(): void {
  cache = null;
}

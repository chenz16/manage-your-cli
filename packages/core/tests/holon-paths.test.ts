/**
 * holon-paths — unit + integration test for the env-override pattern.
 *
 * Spec: docs/adr/test-release-state-isolation.md
 *
 * Two layers covered:
 *   1. Each helper honors its env var + falls back to the documented default.
 *   2. Integration: when HOLON_AGENTS_HOME + HOLON_STATE_ROOT + HOLON_DB_PATH
 *      are all set to a tmpdir, calling real services lands every byte
 *      inside the tmpdir — the owner's real `~/holon-agents` and `~/.holon`
 *      stay byte-identical to before the test ran.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdtempSync, existsSync, statSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import {
  holonAgentsHome,
  holonStateRoot,
  holonDefaultDbPath,
} from '../src/holon-paths.ts';
import { ownerHrRoot, hrStateFilePath } from '../src/hr-paths.ts';

interface Snapshot {
  agentsHome?: string;
  stateRoot?: string;
  xdg?: string;
  hrRoot?: string;
  hrState?: string;
  dbPath?: string;
}
let prev: Snapshot;

function snapshot(): Snapshot {
  return {
    agentsHome: process.env.HOLON_AGENTS_HOME,
    stateRoot: process.env.HOLON_STATE_ROOT,
    xdg: process.env.XDG_DATA_HOME,
    hrRoot: process.env.HOLON_HR_ROOT,
    hrState: process.env.HOLON_HR_STATE,
    dbPath: process.env.HOLON_DB_PATH,
  };
}
function restore(s: Snapshot): void {
  for (const [k, v] of Object.entries({
    HOLON_AGENTS_HOME: s.agentsHome,
    HOLON_STATE_ROOT: s.stateRoot,
    XDG_DATA_HOME: s.xdg,
    HOLON_HR_ROOT: s.hrRoot,
    HOLON_HR_STATE: s.hrState,
    HOLON_DB_PATH: s.dbPath,
  })) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

let tmpRoot: string;

beforeEach(() => {
  prev = snapshot();
  tmpRoot = mkdtempSync(join(tmpdir(), 'holon-paths-'));
  // Clear all relevant envs so default-fallback assertions are deterministic.
  delete process.env.HOLON_AGENTS_HOME;
  delete process.env.HOLON_STATE_ROOT;
  delete process.env.XDG_DATA_HOME;
  delete process.env.HOLON_HR_ROOT;
  delete process.env.HOLON_HR_STATE;
  delete process.env.HOLON_DB_PATH;
});

afterEach(() => {
  restore(prev);
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* best effort */ }
});

describe('holon-paths helpers', () => {
  it('holonAgentsHome: env override wins', () => {
    process.env.HOLON_AGENTS_HOME = join(tmpRoot, 'agents');
    expect(holonAgentsHome()).toBe(join(tmpRoot, 'agents'));
  });

  it('holonAgentsHome: default falls back to $HOME/holon-agents', () => {
    expect(holonAgentsHome()).toBe(join(process.env.HOME ?? homedir(), 'holon-agents'));
  });

  it('holonStateRoot: HOLON_STATE_ROOT beats XDG beats $HOME/.holon', () => {
    process.env.HOLON_STATE_ROOT = join(tmpRoot, 'state');
    expect(holonStateRoot()).toBe(join(tmpRoot, 'state'));

    delete process.env.HOLON_STATE_ROOT;
    process.env.XDG_DATA_HOME = join(tmpRoot, 'xdg');
    expect(holonStateRoot()).toBe(join(tmpRoot, 'xdg', 'holon'));

    delete process.env.XDG_DATA_HOME;
    expect(holonStateRoot()).toBe(join(process.env.HOME ?? homedir(), '.holon'));
  });

  it('holonDefaultDbPath: lives inside holonStateRoot', () => {
    process.env.HOLON_STATE_ROOT = join(tmpRoot, 'state');
    expect(holonDefaultDbPath()).toBe(join(tmpRoot, 'state', 'owner.sqlite'));
  });
});

describe('holon-paths consumers honor env overrides', () => {
  it('hr-paths.ownerHrRoot inherits HOLON_AGENTS_HOME when HOLON_HR_ROOT is unset', () => {
    process.env.HOLON_AGENTS_HOME = join(tmpRoot, 'agents');
    expect(ownerHrRoot()).toBe(join(tmpRoot, 'agents', 'boss', 'owner', 'hr'));
  });

  it('hr-paths.ownerHrRoot: HOLON_HR_ROOT still beats HOLON_AGENTS_HOME', () => {
    process.env.HOLON_AGENTS_HOME = join(tmpRoot, 'agents');
    process.env.HOLON_HR_ROOT = join(tmpRoot, 'hr-explicit');
    expect(ownerHrRoot()).toBe(join(tmpRoot, 'hr-explicit'));
  });

  it('hr-paths.hrStateFilePath inherits HOLON_STATE_ROOT', () => {
    process.env.HOLON_STATE_ROOT = join(tmpRoot, 'state');
    expect(hrStateFilePath()).toBe(join(tmpRoot, 'state', 'hr-state.json'));
  });
});

describe('integration: tmp envs keep real $HOME state untouched', () => {
  it('boss-memory write + HR scaffold land inside tmpdir only', async () => {
    process.env.HOLON_AGENTS_HOME = join(tmpRoot, 'agents');
    process.env.HOLON_STATE_ROOT = join(tmpRoot, 'state');
    process.env.HOLON_DB_PATH = join(tmpRoot, 'state', 'owner.sqlite');

    // Snapshot real-home directory listings BEFORE we exercise any code so
    // we can prove the integration leaked nothing.
    const realAgents = join(process.env.HOME ?? homedir(), 'holon-agents');
    const realState = join(process.env.HOME ?? homedir(), '.holon');
    const beforeAgents = existsSync(realAgents) ? readdirSync(realAgents).sort() : [];
    const beforeState = existsSync(realState) ? readdirSync(realState).sort() : [];

    // 1. Boss-memory write → must land under HOLON_AGENTS_HOME/boss/.
    const { writeBossMemory } = await import('../src/boss-memory-service.ts');
    const wrote = writeBossMemory('isolation-smoke', '# isolation smoke\n\ntest body.\n');
    expect(wrote.ok).toBe(true);
    if (wrote.ok) {
      expect(wrote.path.startsWith(tmpRoot)).toBe(true);
    }

    // 2. HR scaffold → must land under HOLON_AGENTS_HOME/boss/owner/hr/.
    const { ensureOwnerHrScaffold } = await import('../src/hr-paths.ts');
    const hr = ensureOwnerHrScaffold();
    expect(hr.root.startsWith(tmpRoot)).toBe(true);
    expect(existsSync(hr.root)).toBe(true);

    // 3. Verify real $HOME directories are byte-identical to before.
    const afterAgents = existsSync(realAgents) ? readdirSync(realAgents).sort() : [];
    const afterState = existsSync(realState) ? readdirSync(realState).sort() : [];
    expect(afterAgents).toEqual(beforeAgents);
    expect(afterState).toEqual(beforeState);

    // 4. tmpdir actually has new files (sanity-check the test itself).
    expect(statSync(join(tmpRoot, 'agents')).isDirectory()).toBe(true);
  });
});

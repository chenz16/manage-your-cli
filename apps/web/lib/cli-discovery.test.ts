/**
 * cli-discovery tests — validates the contract `/api/v1/cli/binaries` exposes
 * and the 10s cache behavior.
 *
 * We mock `child_process.execFileSync` via the same `eval('require')` channel
 * the module under test uses; mocking it indirectly is fragile so we instead
 * stub `which` lookups by monkey-patching $PATH to a tmp dir of fake binaries.
 */
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let tmpRoot: string;
let savedPath: string | undefined;

function makeFakeBin(name: string, versionOutput: string): void {
  const p = join(tmpRoot, name);
  writeFileSync(p, `#!/bin/sh\necho "${versionOutput}"\n`, { mode: 0o755 });
  chmodSync(p, 0o755);
}

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'holon-cli-discovery-'));
  savedPath = process.env.PATH;
  // Prepend the tmp dir so our fake binaries shadow any real ones.
  process.env.PATH = `${tmpRoot}:${savedPath ?? ''}`;
});

afterEach(async () => {
  const mod = await import('./cli-discovery');
  mod._resetCliDiscoveryCacheForTests();
  if (savedPath !== undefined) process.env.PATH = savedPath;
  else delete process.env.PATH;
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('cli-discovery', () => {
  it('reports installed=true with version + path for a fake binary on $PATH', async () => {
    makeFakeBin('claude', '1.2.3');
    const { discoverCliBinaries } = await import('./cli-discovery');
    const result = discoverCliBinaries({ force: true });
    const claude = result.find((b) => b.name === 'claude');
    expect(claude).toBeDefined();
    expect(claude!.installed).toBe(true);
    expect(claude!.path).toContain(tmpRoot);
    expect(claude!.version).toBe('1.2.3');
    expect(claude!.label).toBe('Claude Code');
    expect(claude!.install_hint).toContain('npm i -g');
    expect(claude!.docs_url).toMatch(/^https?:\/\//);
  });

  it('reports installed=false with null path/version when a binary is missing', async () => {
    // No fake codex / gemini / qwen in tmpRoot — but they might exist on
    // the real $PATH. To make this deterministic we scrub $PATH down to ONLY
    // the tmpRoot, so anything not in tmpRoot is guaranteed missing.
    process.env.PATH = tmpRoot;
    const { discoverCliBinaries } = await import('./cli-discovery');
    const result = discoverCliBinaries({ force: true });
    const codex = result.find((b) => b.name === 'codex');
    expect(codex).toBeDefined();
    expect(codex!.installed).toBe(false);
    expect(codex!.path).toBeNull();
    expect(codex!.version).toBeNull();
  });

  it('returns all four known CLIs in the canonical order', async () => {
    process.env.PATH = tmpRoot;
    const { discoverCliBinaries, KNOWN_CLI_BINARIES } = await import('./cli-discovery');
    const result = discoverCliBinaries({ force: true });
    expect(result.map((b) => b.name)).toEqual([...KNOWN_CLI_BINARIES]);
  });

  it('caches results within TTL; force=true bypasses cache', async () => {
    process.env.PATH = tmpRoot;
    const { discoverCliBinaries } = await import('./cli-discovery');
    const first = discoverCliBinaries();
    // Cache hit: same reference object returned on second call within TTL.
    const cached = discoverCliBinaries();
    expect(cached).toBe(first);
    // Force bypasses: new array even if contents are identical.
    const forced = discoverCliBinaries({ force: true });
    expect(forced).not.toBe(first);
    expect(forced.map((b) => b.name)).toEqual(first.map((b) => b.name));
  });
});

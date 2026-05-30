import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// The registry persists to ~/.holon/process-registry.json. We don't want
// the test run to clobber the real desk's live state, so:
//   1. on first import, snapshot whatever is on disk
//   2. between tests, wipe just the entries we created (key starts with
//      'test:') so each test sees only its own writes
//   3. on suite end, restore the snapshot exactly
const STORE = join(homedir(), '.holon', 'process-registry.json');
let snapshot: string | null = null;
if (existsSync(STORE)) snapshot = readFileSync(STORE, 'utf8');

afterAll(() => {
  if (snapshot !== null) writeFileSync(STORE, snapshot);
});

beforeEach(async () => {
  // Force re-import so the module's internal `REG` closure picks up the
  // wiped globalThis Map (deleting the property alone leaves the cached
  // module holding a reference to the old Map).
  vi.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const G = globalThis as any;
  delete G.__holonProcessRegistry;
  delete G.__holonProcessRegistryHydrated;
  // Strip our test-prefix entries from the disk store so the registry
  // hydrates without seeing leftovers from the previous test.
  if (existsSync(STORE)) {
    try {
      const arr = JSON.parse(readFileSync(STORE, 'utf8')) as Array<{ key?: string }>;
      const cleaned = arr.filter((e) => !(typeof e.key === 'string' && e.key.startsWith('test:')));
      writeFileSync(STORE, JSON.stringify(cleaned, null, 2));
    } catch { /* corrupt store — ignore, will hydrate empty */ }
  }
});

describe('process-registry', () => {
  it('register stores an entry and list returns it', async () => {
    const reg = await import('./process-registry');
    const entry = reg.register({
      key: 'test:alpha',
      pid: 999_999,
      kind: 'warm-secretary',
      meta: { foo: 'bar' },
    });
    expect(entry.key).toBe('test:alpha');
    expect(entry.status).toBe('alive');
    expect(typeof entry.createdAt).toBe('number');
    expect(typeof entry.lastHeartbeatAt).toBe('number');
    expect(reg.list().map((e) => e.key)).toContain('test:alpha');
  });

  it('register is idempotent — same key overwrites pid + meta but preserves createdAt', async () => {
    const reg = await import('./process-registry');
    const first = reg.register({ key: 'test:beta', pid: 100, kind: 'warm-secretary' });
    const createdAt = first.createdAt;
    await new Promise((r) => setTimeout(r, 5));
    const second = reg.register({ key: 'test:beta', pid: 200, kind: 'warm-secretary', meta: { v: 2 } });
    expect(second.createdAt).toBe(createdAt);
    expect(second.pid).toBe(200);
    expect(second.meta?.v).toBe(2);
    expect(reg.list((e) => e.key === 'test:beta')).toHaveLength(1);
  });

  it('unregister removes the entry', async () => {
    const reg = await import('./process-registry');
    reg.register({ key: 'test:gamma', pid: 1, kind: 'warm-secretary' });
    expect(reg.get('test:gamma')).toBeTruthy();
    reg.unregister('test:gamma');
    expect(reg.get('test:gamma')).toBeUndefined();
  });

  it('markStatus updates status + lastHeartbeatAt', async () => {
    const reg = await import('./process-registry');
    reg.register({ key: 'test:delta', pid: 1, kind: 'warm-secretary' });
    const before = reg.get('test:delta')!;
    const beforeTs = before.lastHeartbeatAt;
    await new Promise((r) => setTimeout(r, 5));
    reg.markStatus('test:delta', 'dead');
    const after = reg.get('test:delta')!;
    expect(after.status).toBe('dead');
    expect(after.lastHeartbeatAt).toBeGreaterThan(beforeTs);
  });

  it('touch updates lastHeartbeatAt + lifts stuck → alive', async () => {
    const reg = await import('./process-registry');
    reg.register({ key: 'test:epsilon', pid: 1, kind: 'warm-secretary' });
    reg.markStatus('test:epsilon', 'stuck');
    expect(reg.get('test:epsilon')!.status).toBe('stuck');
    reg.touch('test:epsilon');
    expect(reg.get('test:epsilon')!.status).toBe('alive');
  });

  it('listByKind filters by kind', async () => {
    const reg = await import('./process-registry');
    reg.register({ key: 'test:s1', pid: 1, kind: 'warm-secretary' });
    reg.register({ key: 'test:e1', pid: 2, kind: 'tmux-employee' });
    reg.register({ key: 'test:s2', pid: 3, kind: 'warm-secretary' });
    // Hydration may have loaded entries from prior runs of the desk on
    // this box (the store is ~/.holon/process-registry.json). Filter to
    // the test prefix so we test our own writes only.
    const warm = reg.listByKind('warm-secretary')
      .filter((e) => e.key.startsWith('test:'))
      .map((e) => e.key).sort();
    expect(warm).toEqual(['test:s1', 'test:s2']);
    const tmux = reg.listByKind('tmux-employee')
      .filter((e) => e.key.startsWith('test:'))
      .map((e) => e.key);
    expect(tmux).toEqual(['test:e1']);
  });

  it('listChildren filters by parentKey', async () => {
    const reg = await import('./process-registry');
    reg.register({ key: 'test:parent', pid: 1, kind: 'warm-secretary' });
    reg.register({ key: 'test:child-a', pid: 2, kind: 'tree-child', parentKey: 'test:parent' });
    reg.register({ key: 'test:child-b', pid: 3, kind: 'tree-child', parentKey: 'test:parent' });
    reg.register({ key: 'test:orphan', pid: 4, kind: 'tree-child', parentKey: 'someone-else' });
    const kids = reg.listChildren('test:parent').map((e) => e.key).sort();
    expect(kids).toEqual(['test:child-a', 'test:child-b']);
  });

  it('pidAlive returns false for clearly-dead pid', async () => {
    const reg = await import('./process-registry');
    // PIDs above 4M aren't allocated on Linux by default; safe sentinel.
    expect(reg.pidAlive(4_000_000)).toBe(false);
  });

  it('pidAlive returns true for our own pid', async () => {
    const reg = await import('./process-registry');
    expect(reg.pidAlive(process.pid)).toBe(true);
  });
});

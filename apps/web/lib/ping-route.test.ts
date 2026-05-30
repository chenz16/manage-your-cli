// Asserts the /api/v1/ping route returns 200 WITHOUT a device token.
// This is the one intentional auth-hole on the desk: the mobile onboarding
// flow needs to verify reachability BEFORE pairing exists.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tmpRoot: string;
let savedOpenDemo: string | undefined;
let savedLocalSecret: string | undefined;

beforeEach(() => {
  vi.resetModules();
  tmpRoot = mkdtempSync(join(tmpdir(), 'holon-ping-'));
  process.env.HOLON_DB_PATH = join(tmpRoot, 'owner.sqlite');
  // Clear ambient escape hatches so the test exercises the production
  // gate: if /api/v1/ping were token-gated, no env trick should let it
  // accidentally pass.
  savedOpenDemo = process.env.HOLON_OPEN_DEMO;
  savedLocalSecret = process.env.HOLON_LOCAL_SHARED_SECRET;
  delete process.env.HOLON_OPEN_DEMO;
  delete process.env.HOLON_LOCAL_SHARED_SECRET;
});

afterEach(() => {
  if (savedOpenDemo === undefined) delete process.env.HOLON_OPEN_DEMO;
  else process.env.HOLON_OPEN_DEMO = savedOpenDemo;
  if (savedLocalSecret === undefined) delete process.env.HOLON_LOCAL_SHARED_SECRET;
  else process.env.HOLON_LOCAL_SHARED_SECRET = savedLocalSecret;
  delete process.env.HOLON_DB_PATH;
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('GET /api/v1/ping (public)', () => {
  it('returns 200 with status/version/server_time and no auth', async () => {
    const mod = await import('../app/api/v1/ping/route');
    // Simulate a remote (non-loopback) request without a device token.
    const req = new Request('http://192.168.1.50:3000/api/v1/ping', {
      method: 'GET',
      headers: { host: '192.168.1.50:3000' },
    });
    const res = await mod.GET(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status?: string;
      ok?: boolean;
      version?: string;
      server_time?: string;
    };
    expect(body.status).toBe('ok');
    expect(body.ok).toBe(true);
    expect(typeof body.version).toBe('string');
    expect(typeof body.server_time).toBe('string');
  });
});

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tmpRoot: string;
let savedOpenDemo: string | undefined;

beforeEach(() => {
  vi.resetModules();
  tmpRoot = mkdtempSync(join(tmpdir(), 'holon-auth-'));
  process.env.HOLON_DB_PATH = join(tmpRoot, 'owner.sqlite');
  // SECURITY: the HOLON_OPEN_DEMO escape hatch opens the gate for ALL requests.
  // It leaks in from the ambient shell env in some deployments, which would
  // silently turn every reject-case below into a pass. Save + clear it so each
  // test asserts the gate's real behavior; restore in afterEach.
  savedOpenDemo = process.env.HOLON_OPEN_DEMO;
  delete process.env.HOLON_OPEN_DEMO;
});

afterEach(async () => {
  const store = await import('./device-pairing-store');
  store._resetPairingStateForTests();
  delete process.env.HOLON_DB_PATH;
  if (savedOpenDemo === undefined) delete process.env.HOLON_OPEN_DEMO;
  else process.env.HOLON_OPEN_DEMO = savedOpenDemo;
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('device token auth', () => {
  it('bypasses auth for loopback requests', async () => {
    const auth = await import('./device-token-auth');
    const result = auth.requireDeviceTokenForRemote(new Request('http://localhost:3000/api/v1/deliverables', {
      headers: { host: 'localhost:3000' },
    }));
    expect(result).toEqual({ ok: true, mode: 'loopback' });
  });

  it('does NOT bypass auth for a spoofed loopback Host arriving via a remote proxy', async () => {
    const auth = await import('./device-token-auth');
    // Host claims localhost but X-Forwarded-For proves a remote origin → must
    // fall through to device-token enforcement, not take the loopback bypass.
    const result = auth.requireDeviceTokenForRemote(new Request('http://localhost:3000/api/v1/deliverables', {
      headers: { host: 'localhost:3000', 'x-forwarded-for': '203.0.113.7' },
    }));
    expect(result).toEqual({ ok: false, status: 401, code: 'missing_device_token' });
  });

  it('requires and validates a paired token for remote requests', async () => {
    const store = await import('./device-pairing-store');
    const auth = await import('./device-token-auth');

    const pending = store.createPairingStart();
    const claimed = store.claimPairingCode(pending.code);
    expect(claimed.ok).toBe(true);
    if (!claimed.ok) throw new Error('claim failed');

    const missing = auth.requireDeviceTokenForRemote(new Request('http://192.168.1.20:3000/api/v1/deliverables', {
      headers: { host: '192.168.1.20:3000' },
    }));
    expect(missing).toEqual({ ok: false, status: 401, code: 'missing_device_token' });

    const invalid = auth.requireDeviceTokenForRemote(new Request('http://192.168.1.20:3000/api/v1/deliverables', {
      headers: { host: '192.168.1.20:3000', 'x-holon-device-token': 'wrong' },
    }));
    expect(invalid).toEqual({ ok: false, status: 403, code: 'invalid_device_token' });

    const valid = auth.requireDeviceTokenForRemote(new Request('http://192.168.1.20:3000/api/v1/deliverables', {
      headers: { host: '192.168.1.20:3000', 'x-holon-device-token': claimed.device_token },
    }));
    expect(valid).toEqual({ ok: true, mode: 'device_token' });
  });

  it('HOLON_OPEN_DEMO=1 opens the gate for an otherwise-rejected remote request (escape hatch)', async () => {
    process.env.HOLON_OPEN_DEMO = '1';
    const auth = await import('./device-token-auth');
    const result = auth.requireDeviceTokenForRemote(new Request('http://192.168.1.20:3000/api/v1/deliverables', {
      headers: { host: '192.168.1.20:3000' },
    }));
    // Documents the escape hatch precisely: it bypasses device-token enforcement.
    // Local single-user only — must NEVER be set on a shared/cloud deployment.
    expect(result).toEqual({ ok: true, mode: 'loopback' });
  });
});

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tmpRoot: string;

beforeEach(() => {
  vi.resetModules();
  tmpRoot = mkdtempSync(join(tmpdir(), 'holon-auth-'));
  process.env.HOLON_DB_PATH = join(tmpRoot, 'owner.sqlite');
});

afterEach(async () => {
  const store = await import('./device-pairing-store');
  store._resetPairingStateForTests();
  delete process.env.HOLON_DB_PATH;
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
});

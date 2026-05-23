import { mkdtempSync, rmSync } from 'node:fs';
import type { NetworkInterfaceInfo } from 'node:os';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tmpRoot: string;

beforeEach(() => {
  vi.resetModules();
  tmpRoot = mkdtempSync(join(tmpdir(), 'holon-pairing-'));
  process.env.HOLON_DB_PATH = join(tmpRoot, 'owner.sqlite');
  delete process.env.HOLON_LOCAL_SHARED_SECRET;
  delete process.env.HOLON_PLUGIN_SHARED_SECRET;
});

afterEach(async () => {
  const store = await import('./device-pairing-store');
  store._resetPairingStateForTests();
  delete process.env.HOLON_DB_PATH;
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('device pairing', () => {
  it('starts and claims a pairing code exactly once', async () => {
    const startRoute = await import('../app/api/v1/pair/start/route');
    const claimRoute = await import('../app/api/v1/pair/claim/route');
    const store = await import('./device-pairing-store');

    const startResp = await startRoute.POST(new Request('http://localhost:3000/api/v1/pair/start', {
      method: 'POST',
      headers: { host: 'localhost:3000', 'x-forwarded-for': '127.0.0.1' },
    }));
    expect(startResp.status).toBe(200);
    const started = await startResp.json() as { code: string; lan_url: string; lan_candidates: string[] };
    expect(started.code).toMatch(/^\d{6}$/);
    expect(started.lan_url).toContain(`/api/v1/pair/claim?code=${started.code}`);
    expect(Array.isArray(started.lan_candidates)).toBe(true);

    const claimResp = await claimRoute.POST(new Request('http://192.168.1.20:3000/api/v1/pair/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json', host: '192.168.1.20:3000' },
      body: JSON.stringify({ code: started.code }),
    }));
    expect(claimResp.status).toBe(200);
    const claimed = await claimResp.json() as { ok: true; device_token: string; device_id: string };
    expect(claimed.device_token).toMatch(/^holon_device_/);
    expect(claimed.device_id).toMatch(/^device_/);
    expect(store.validateDeviceToken(claimed.device_token)).toBe(true);

    const secondClaim = await claimRoute.POST(new Request('http://192.168.1.20:3000/api/v1/pair/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json', host: '192.168.1.20:3000' },
      body: JSON.stringify({ code: started.code }),
    }));
    expect(secondClaim.status).toBe(400);
    const secondBody = await secondClaim.json() as { code: string };
    expect(secondBody.code).toBe('invalid_code');
  });

  it('rejects remote pair start without a loopback desktop request', async () => {
    const startRoute = await import('../app/api/v1/pair/start/route');
    const resp = await startRoute.POST(new Request('http://192.168.1.20:3000/api/v1/pair/start', {
      method: 'POST',
      headers: { host: '192.168.1.20:3000' },
    }));
    expect(resp.status).toBe(403);
    const body = await resp.json() as { code: string };
    expect(body.code).toBe('desktop_loopback_required');
  });
});

describe('LAN IPv4 selection', () => {
  it('prefers a real WiFi LAN address over WSL, Hyper-V, and Docker adapters', async () => {
    const store = await import('./device-pairing-store');

    const selected = store.selectLanIPv4({
      'vEthernet (WSL)': [ipv4('172.23.0.1')],
      'vEthernet (Default Switch)': [ipv4('172.20.48.1')],
      docker0: [ipv4('172.17.0.1')],
      'Wi-Fi': [ipv4('192.168.1.42')],
    });

    expect(selected.selected).toBe('192.168.1.42');
    expect(selected.candidates).toEqual([
      '192.168.1.42',
      '172.23.0.1',
      '172.20.48.1',
      '172.17.0.1',
    ]);
  });

  it('orders private LAN ranges as 192.168, then 10, then 172.16-31', async () => {
    const store = await import('./device-pairing-store');

    expect(store.selectLanIPv4({
      Ethernet: [ipv4('172.16.4.20')],
      'USB LAN': [ipv4('10.0.0.55')],
      'Wi-Fi': [ipv4('192.168.50.9')],
    }).selected).toBe('192.168.50.9');

    expect(store.selectLanIPv4({
      Ethernet: [ipv4('172.16.4.20')],
      'USB LAN': [ipv4('10.0.0.55')],
    }).selected).toBe('10.0.0.55');
  });

  it('falls back to the first non-internal IPv4 when only virtual candidates exist', async () => {
    const store = await import('./device-pairing-store');

    const selected = store.selectLanIPv4({
      'vEthernet (WSL)': [ipv4('172.23.0.1')],
      docker0: [ipv4('172.17.0.1')],
      Loopback: [ipv4('127.0.0.1', true)],
      'Link Local': [ipv4('169.254.20.30')],
    });

    expect(selected.selected).toBe('172.23.0.1');
    expect(selected.candidates).toEqual(['172.23.0.1', '172.17.0.1']);
  });
});

function ipv4(address: string, internal = false): NetworkInterfaceInfo {
  return {
    address,
    family: 'IPv4',
    internal,
    cidr: null,
    mac: '00:00:00:00:00:00',
    netmask: '255.255.255.0',
  };
}

// Unit test for the desk-URL storage helper (slice 1: generic-APK
// onboarding). Verifies read/write/clear of deskOrigin + Tailscale state.
//
// Env: node. We shim a minimal in-memory `window.localStorage` so the same
// code path that runs in the Capacitor WebView is exercised here.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(k: string): string | null { return this.store.has(k) ? this.store.get(k)! : null; }
  setItem(k: string, v: string): void { this.store.set(k, String(v)); }
  removeItem(k: string): void { this.store.delete(k); }
  clear(): void { this.store.clear(); }
  key(i: number): string | null { return Array.from(this.store.keys())[i] ?? null; }
  get length(): number { return this.store.size; }
}

beforeEach(() => {
  (globalThis as { window?: unknown }).window = { localStorage: new MemoryStorage() };
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('desk-url-storage', () => {
  it('round-trips deskOrigin via read/write/clear', async () => {
    const mod = await import('./desk-url-storage');
    expect(mod.readDeskOrigin()).toBeNull();

    mod.writeDeskOrigin('http://192.168.1.50:3110');
    expect(mod.readDeskOrigin()).toBe('http://192.168.1.50:3110');

    // Normalizes trailing slash + missing scheme.
    mod.writeDeskOrigin('192.168.1.50:3110/');
    expect(mod.readDeskOrigin()).toBe('http://192.168.1.50:3110');

    mod.clearDeskOrigin();
    expect(mod.readDeskOrigin()).toBeNull();
  });

  it('rejects empty + non-http schemes', async () => {
    const mod = await import('./desk-url-storage');
    expect(() => mod.writeDeskOrigin('')).toThrow();
    // Explicit non-http(s) scheme is rejected (we don't second-guess the
    // user — if they typed a scheme, it must be http or https).
    expect(() => mod.writeDeskOrigin('ws://x')).toThrow();
  });

  // Env-aware namespacing: dev preview and release APK MUST NOT collide in
  // the same Capacitor WebView storage. Default (prod / unset) keeps the
  // legacy key so existing installs continue to work without migration.
  // Spec: docs/adr/test-release-state-isolation.md (slice E).
  it('default env=prod uses the legacy key (no suffix)', async () => {
    // No NEXT_PUBLIC_HOLON_ENV set → prod.
    const mod = await import('./desk-url-storage');
    mod.writeDeskOrigin('http://192.168.1.50:3110');
    const win = (globalThis as { window: { localStorage: { getItem(k: string): string | null } } }).window;
    expect(win.localStorage.getItem('myc.mobile.deskOrigin.v1')).toBe('http://192.168.1.50:3110');
    // The dev-suffixed key must remain empty.
    expect(win.localStorage.getItem('myc.mobile.deskOrigin.v1.dev')).toBeNull();
  });

  it('round-trips tailscale URL + enabled flag, and clearAll wipes both', async () => {
    const mod = await import('./desk-url-storage');
    mod.writeDeskOrigin('http://192.168.1.50:3110');
    mod.writeTailscaleUrl('http://100.105.92.4:3110');
    mod.writeTailscaleEnabled(true);
    expect(mod.readTailscaleUrl()).toBe('http://100.105.92.4:3110');
    expect(mod.readTailscaleEnabled()).toBe(true);

    mod.clearAllDeskUrls();
    expect(mod.readDeskOrigin()).toBeNull();
    expect(mod.readTailscaleUrl()).toBeNull();
    expect(mod.readTailscaleEnabled()).toBe(false);
  });
});

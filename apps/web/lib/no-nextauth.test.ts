/**
 * Removal-invariant tests for feat/remove-nextauth (Task #12).
 *
 * NextAuth + the @auth/drizzle-adapter encryption wrap were deleted because
 * Manage Your CLI is a local single-user desk — pairing happens via the
 * device-token / 6-digit code flow (lib/device-token-auth.ts), not via a
 * web sign-in. These tests pin the regression surface so a future PR can't
 * silently reintroduce NextAuth without flipping a contract:
 *
 *   - the deleted module paths must stay absent (no shadow re-add),
 *   - the runtime dep manifest must not list `next-auth` / `@auth/*`,
 *   - the layout / providers tree must not pull `next-auth/react`.
 *
 * Replaces the 2 tests deleted with `lib/encrypted-token-storage.test.ts`
 * (the adapter wrap they covered no longer exists in the codebase; the
 * AES-256-GCM `encrypt`/`decrypt` invariants those tests transitively
 * relied on stay covered by `packages/auth/tests/crypto.test.ts`).
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const WEB_ROOT = join(__dirname, '..');

describe('feat/remove-nextauth — file removal invariants', () => {
  const REMOVED_PATHS = [
    'auth.ts',
    'next-auth.d.ts',
    'app/api/auth/[...nextauth]/route.ts',
    'app/_components/SessionProviderClient.tsx',
    'app/onboarding/_components/Step3ConnectGmail.tsx',
    'lib/encrypted-token-storage.ts',
    'lib/encrypted-token-storage.test.ts',
    'db/index.ts',
    'db/schema.ts',
    'scripts/init-auth-db.ts',
  ];

  for (const rel of REMOVED_PATHS) {
    it(`${rel} stays deleted`, () => {
      expect(existsSync(join(WEB_ROOT, rel))).toBe(false);
    });
  }
});

describe('feat/remove-nextauth — package + bundle invariants', () => {
  it('apps/web/package.json no longer declares next-auth or @auth/* deps', () => {
    const pkg = JSON.parse(readFileSync(join(WEB_ROOT, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const allDeps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    for (const name of Object.keys(allDeps)) {
      expect(name).not.toBe('next-auth');
      expect(name.startsWith('@auth/')).toBe(false);
    }
  });

  it('app/layout.tsx does not import next-auth or SessionProvider', () => {
    const src = readFileSync(join(WEB_ROOT, 'app/layout.tsx'), 'utf8');
    expect(src).not.toMatch(/from ['"]next-auth/);
    expect(src).not.toMatch(/SessionProviderClient/);
  });

  it('app/api/v1/me/route.ts does not read the NextAuth account table', () => {
    const src = readFileSync(join(WEB_ROOT, 'app/api/v1/me/route.ts'), 'utf8');
    expect(src).not.toMatch(/accountsTable/);
    expect(src).not.toMatch(/from ['"]@\/db/);
    expect(src).not.toMatch(/from ['"]drizzle-orm/);
  });
});

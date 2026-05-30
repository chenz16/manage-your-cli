import { defineConfig } from 'vitest/config';

// Mobile-side vitest config. Node env is fine — the helper under test
// (`desk-url-storage.ts`) only touches `window.localStorage`, which we
// shim in-memory inside the test itself. Adding jsdom would pull a
// transitive dep tree we don't need for slice 1.
export default defineConfig({
  test: {
    include: ['app/_lib/**/*.test.ts', 'app/_components/**/*.test.ts'],
    environment: 'node',
    reporters: 'verbose',
  },
});

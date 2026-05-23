import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(here, '.'),
    },
  },
  test: {
    include: ['lib/**/*.test.ts', 'tests/**/*.test.ts'],
    environment: 'node',
    reporters: 'verbose',
  },
});

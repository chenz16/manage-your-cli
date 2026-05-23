#!/usr/bin/env tsx
/**
 * Generate apis/holon-bff/openapi.yaml from the Zod-registered endpoints.
 *
 * Side effect: importing `../src/index.js` walks every endpoint module,
 * each of which self-registers paths with the shared OpenAPIRegistry.
 *
 * Usage:
 *   pnpm -F api-contract openapi
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import { stringify as yamlStringify } from 'yaml';

import { registry } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const outPath = join(repoRoot, 'apis', 'holon-bff', 'openapi.yaml');

mkdirSync(dirname(outPath), { recursive: true });

const generator = new OpenApiGeneratorV31(registry.definitions);
const document = generator.generateDocument({
  openapi: '3.1.0',
  info: {
    title: 'Holon BFF',
    version: '0.0.0',
    description:
      'Backend-for-Frontend contract for the Holon desk app.\n\n' +
      'Source-of-truth is the Zod schemas in `packages/api-contract/src/`.\n' +
      'Regenerate this file with `pnpm -F api-contract openapi`.\n\n' +
      'Per ADR-001, this contract is what every iteration 003+ targets.',
  },
  servers: [
    { url: 'http://localhost:3000', description: 'Local Next.js dev server' },
  ],
});

writeFileSync(outPath, yamlStringify(document), 'utf8');

const pathCount = Object.keys(document.paths ?? {}).length;
console.log(`wrote ${outPath}`);
console.log(`paths: ${pathCount}`);

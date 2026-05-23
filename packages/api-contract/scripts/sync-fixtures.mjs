#!/usr/bin/env node
/**
 * Mirror src/ui-mock/_shared/fixtures.js into a JSON snapshot the
 * conformance test can consume without parsing IIFE script tags.
 *
 * Usage:
 *   node packages/api-contract/scripts/sync-fixtures.mjs
 *
 * Run after touching fixtures.js. The snapshot is committed alongside
 * fixtures.js so reviewers see schema-impacting changes diffed.
 *
 * Mechanism: read fixtures.js as text → eval it inside a sandbox that
 * provides a `window` global → write `window.HOLON_FIXTURES` as JSON.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');

const fixturesPath = join(repoRoot, 'src', 'ui-mock', '_shared', 'fixtures.js');
const snapshotPath = join(repoRoot, 'src', 'ui-mock', '_shared', 'fixtures.snapshot.json');

const src = readFileSync(fixturesPath, 'utf8');

const sandbox = { window: {} };
runInNewContext(src, sandbox, { filename: fixturesPath });

const fixtures = sandbox.window.HOLON_FIXTURES;
if (!fixtures) {
  throw new Error('fixtures.js did not assign window.HOLON_FIXTURES');
}

writeFileSync(snapshotPath, JSON.stringify(fixtures, null, 2) + '\n', 'utf8');

const counts = {
  desks: fixtures.desks?.length ?? 0,
  staff: fixtures.staff?.length ?? 0,
  my_work_queue: fixtures.my_work_queue?.length ?? 0,
  connections: fixtures.connections?.length ?? 0,
  missions: fixtures.missions?.length ?? 0,
  deliverables: fixtures.deliverables?.length ?? 0,
  recent_events: fixtures.recent_events?.length ?? 0,
  chat_threads: fixtures.chat_threads?.length ?? 0,
};
console.log('wrote', snapshotPath);
console.log(JSON.stringify(counts, null, 2));

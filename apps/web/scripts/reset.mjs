#!/usr/bin/env node
/**
 * One-shot reset: wipe the owner agent's runtime state so the next
 * chat turn starts with empty history. Hits POST /api/v1/admin/reset.
 *
 * Usage: node apps/web/scripts/reset.mjs
 *        pnpm reset
 *
 * NOTE: fixtures.snapshot.json is the read-only mock baseline and is
 * never mutated by the app. Jobs + handoffs from chat tools are
 * log-only in v1 (no DB rows). The only thing that survives across
 * requests right now is the Hermes agent's session history — that's
 * what this script wipes.
 */

const ENDPOINT = process.env.HOLON_BFF_BASE_URL ?? 'http://localhost:3000';

async function main() {
  // Show current state first.
  const status = await fetch(`${ENDPOINT}/api/v1/admin/reset`)
    .then((r) => r.json())
    .catch((e) => ({ error: String(e) }));
  console.log('--- before ---');
  console.log(JSON.stringify(status, null, 2));

  const reset = await fetch(`${ENDPOINT}/api/v1/admin/reset`, { method: 'POST' })
    .then((r) => r.json())
    .catch((e) => ({ error: String(e) }));
  console.log('\n--- reset ---');
  console.log(JSON.stringify(reset, null, 2));

  console.log('\n✅ Done. Refresh your browser tab to clear assistant-ui client state.');
}

main();

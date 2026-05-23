#!/usr/bin/env node
/**
 * Sync src/ui-mock/ → apps/web/public/ so vanilla HTML pages stay
 * reachable while React ports land one screen at a time.
 *
 * Runs before `next dev` and `next build`. Each iteration that ports a
 * vanilla page to React adds an entry to PORTED so the page is
 *   (a) NOT exposed under public/ (vanilla version retired)
 *   (b) rewritten in the OTHER vanilla pages' nav links so they
 *       jump to the React route instead of 404-ing
 */

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, '..');
const repoRoot = join(webRoot, '..', '..');

const src = join(repoRoot, 'src', 'ui-mock');
const dest = join(webRoot, 'public');

/**
 * Pages already ported to React. Maps the vanilla filename to the
 * React route that supersedes it. iter-003 ported Connections;
 * iter-004 ports Inbound.
 *
 * Add an entry here whenever a new iteration replaces a vanilla page.
 * The sync script will (a) drop the vanilla {file}.html + {file}.js
 * from public/ and (b) rewrite href="{file}.html" → href="{route}"
 * inside every other synced HTML so cross-page navigation keeps working.
 */
const PORTED = new Map([
  ['connections', '/connections'],
  ['inbound', '/inbound'],
  // iter-005: Today React page lives at /today; vanilla index.html retired.
  ['index', '/today'],
  // iter-007a: Members + Deliverables React; vanilla retired entirely.
  ['members', '/members'],
  ['deliverables', '/deliverables'],
]);

if (!existsSync(src)) {
  console.error(`vanilla source not found: ${src}`);
  process.exit(1);
}

mkdirSync(dest, { recursive: true });

// Files to skip when copying: the .html + .js for each ported page.
const SKIP_FILES = new Set();
for (const slug of PORTED.keys()) {
  SKIP_FILES.add(`${slug}.html`);
  SKIP_FILES.add(`${slug}.js`);
}

cpSync(src, dest, {
  recursive: true,
  filter(srcPath) {
    const rel = srcPath.slice(src.length + 1);
    if (!rel) return true;
    return !SKIP_FILES.has(rel);
  },
});

// Defensive cleanup of stale files from earlier runs.
for (const name of SKIP_FILES) {
  const p = join(dest, name);
  if (existsSync(p) && statSync(p).isFile()) {
    rmSync(p);
  }
}

// Rewrite cross-page links. For each remaining HTML, replace any nav
// reference to a ported page with its React route.
const { readdirSync } = await import('node:fs');
let rewritten = 0;
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
    } else if (entry.isFile() && entry.name.endsWith('.html')) {
      let html = readFileSync(full, 'utf8');
      let dirty = false;
      for (const [slug, route] of PORTED) {
        // Match href="slug.html" or href='slug.html' (no leading path).
        const re = new RegExp(`href=("|')${slug}\\.html\\1`, 'g');
        if (re.test(html)) {
          html = html.replace(re, `href=$1${route}$1`);
          dirty = true;
        }
      }
      if (dirty) {
        writeFileSync(full, html, 'utf8');
        rewritten += 1;
      }
    }
  }
}
walk(dest);

const skipCount = SKIP_FILES.size;
const portedCount = PORTED.size;
console.log(
  `synced ${src} → ${dest} (skipped ${skipCount} file${skipCount === 1 ? '' : 's'}; rewrote nav in ${rewritten} html for ${portedCount} ported page${portedCount === 1 ? '' : 's'})`
);

#!/usr/bin/env node
// copy-standalone-for-tauri.mjs — iter-012 Pass #6.1 (resolves Q-010 path #1)
//
// After `next build` writes the standalone Node-server bundle to
// `apps/web/.next/standalone/`, this script copies it into
// `apps/web/src-tauri/resources/n/` so Tauri's bundler picks it
// up as a `resources/` entry (declared in tauri.conf.json under
// bundle.resources). At runtime, the Tauri shell resolves
// `resources/n/server.js` via app.path().resolve(...,
// BaseDirectory::Resource) and spawns it under the bundled Node sidecar.
//
// We can't point `frontendDist` directly at `.next/standalone` because
// Tauri's bundle-validation rejects any frontendDist containing a
// `node_modules` folder (Pass #6 hit this — Q-010 B1). And we can't
// symlink because Tauri's resource scanner follows real paths only on
// some platforms. A copy is simple, idempotent, and ~50-150 MB on disk.
//
// Engineering Rule #4: any failure exits non-zero with structured stderr.

import { existsSync, mkdirSync, rmSync, statSync, readdirSync, copyFileSync, lstatSync, symlinkSync, readlinkSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '..');

// L-099: honor NEXT_DIST_DIR so the installer pipeline's isolated build dir
// (.next-prod) is used as the source. Falls back to '.next' for local runs.
const NEXT_DIST_DIR = process.env.NEXT_DIST_DIR ?? '.next';
const SRC = join(REPO_ROOT, `apps/web/${NEXT_DIST_DIR}/standalone`);
// Keep this resource directory intentionally short. Windows NSIS extraction
// still hits MAX_PATH for some Next/pnpm dependency paths when installed under
// `%LOCALAPPDATA%\Holon\resources\next-server\...`; `resources/n` keeps the
// longest known Next path under 260 chars on the default install location.
const DEST = join(REPO_ROOT, 'apps/web/src-tauri/resources/n');
// Next.js standalone output places only the server bundle there; static
// assets + public/ still need to be hand-copied per Next docs.
const STATIC_SRC = join(REPO_ROOT, `apps/web/${NEXT_DIST_DIR}/static`);
const STATIC_DEST = join(DEST, `apps/web/${NEXT_DIST_DIR}/static`);
const PUBLIC_SRC = join(REPO_ROOT, 'apps/web/public');
const PUBLIC_DEST = join(DEST, 'apps/web/public');

function log(msg) {
  console.log(`[copy-standalone] ${msg}`);
}

function errExit(klass, msg) {
  console.error(`[copy-standalone:err:${klass}] ${msg}`);
  process.exit(1);
}

if (!existsSync(SRC)) {
  errExit(
    'missing_standalone',
    `${SRC} not found — run 'pnpm -F web build' first (NEXT_DIST_DIR=${NEXT_DIST_DIR}; requires output: 'standalone' in next.config.ts)`
  );
}

// Wipe destination so stale files from a previous build don't linger
// (e.g. removed routes still served by old server.js bundle).
if (existsSync(DEST)) {
  log(`removing stale ${DEST}`);
  rmSync(DEST, { recursive: true, force: true });
}
mkdirSync(DEST, { recursive: true });

// Recursive copy. Node 20+ has `fs.cp` but we keep this loop explicit for
// clarity + portability across Node 18 (Hermes-sidecar build hosts) and
// Node 22 (dev).
let fileCount = 0;
let byteCount = 0;
function copyTree(srcPath, destPath) {
  const stat = lstatSync(srcPath);
  if (stat.isSymbolicLink()) {
    const target = readlinkSync(srcPath);
    try {
      symlinkSync(target, destPath);
    } catch (e) {
      // Some filesystems (Windows w/o developer mode) refuse symlinks.
      // Fallback: skip — Next standalone's node_modules has internal
      // symlinks but the bundled server only needs the resolved files.
      log(`symlink skipped (filesystem unsupported): ${srcPath} → ${target}`);
    }
    return;
  }
  if (stat.isDirectory()) {
    // Skip src-tauri to prevent recursive nesting (standalone includes
    // the app tree which contains src-tauri → resources → standalone → ...)
    const base = srcPath.split(/[\\/]/).pop();
    if (base === 'src-tauri') return;
    mkdirSync(destPath, { recursive: true });
    for (const entry of readdirSync(srcPath)) {
      copyTree(join(srcPath, entry), join(destPath, entry));
    }
    return;
  }
  if (stat.isFile()) {
    copyFileSync(srcPath, destPath);
    fileCount++;
    byteCount += stat.size;
    return;
  }
  // Sockets / fifos / device files don't belong in a build output.
}

log(`copying ${SRC} → ${DEST}`);
copyTree(SRC, DEST);

// Next.js standalone REQUIRES you to also copy .next/static + public into
// the standalone tree (this is in the official docs:
// https://nextjs.org/docs/app/api-reference/config/next-config-js/output).
// Without these, static assets 404 + the favicon is broken.
if (existsSync(STATIC_SRC)) {
  log(`copying ${STATIC_SRC} → ${STATIC_DEST}`);
  copyTree(STATIC_SRC, STATIC_DEST);
}
if (existsSync(PUBLIC_SRC)) {
  log(`copying ${PUBLIC_SRC} → ${PUBLIC_DEST}`);
  copyTree(PUBLIC_SRC, PUBLIC_DEST);
}

const MB = (byteCount / 1024 / 1024).toFixed(1);
log(`done · files=${fileCount} size=${MB} MB`);

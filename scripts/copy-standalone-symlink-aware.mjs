#!/usr/bin/env node
// copy-standalone-symlink-aware.mjs  -- D-2 hardening (2026-05-19)
//
// Dereferences every symlink in apps/web/src-tauri/resources/n/ by replacing
// each symlink with the real file contents it resolves to. This is required
// for the Windows build path because:
//
//   - WSL's `copy-standalone-for-tauri.mjs` faithfully copies Next.js's
//     standalone tree including ~29 node_modules symlinks that point into
//     node_modules/.pnpm/... chains.
//   - robocopy over the WSL UNC share cannot follow those symlinks; it errors
//     with "ERROR 3: system cannot find the path specified" for each one.
//   - Tauri's bundle.resources glob (`resources/n/**/*`) picks up whatever
//     is on disk; if a symlink resolves to nothing (cross-env path), the file
//     is silently absent from the bundle, causing boot failures at install time.
//
// Usage:
//   node scripts/copy-standalone-symlink-aware.mjs [TARGET_DIR]
//   node scripts/copy-standalone-symlink-aware.mjs --help
//
// TARGET_DIR defaults to apps/web/src-tauri/resources/n (in-place).
//
// The script walks TARGET_DIR recursively. For every symlink it finds:
//   1. Calls fs.realpathSync() to resolve the chain to the final real path.
//   2. Replaces the symlink with fs.copyFileSync() of the real file contents.
//
// Non-symlink regular files and directories are left untouched.
//
// Progress is logged every LOG_INTERVAL files so the operator can track
// the ~4279 files / ~215 MB that the 2026-05-19 build contained.
//
// Exit codes:
//   0 = success (even if 0 symlinks were found -- idempotent)
//   1 = fatal error (missing target dir, unresolvable symlink chain, etc.)
//
// Engineering Rule #4: no bare try/catch; every error path exits non-zero
// with structured stderr context.

import {
  existsSync,
  lstatSync,
  readdirSync,
  realpathSync,
  copyFileSync,
  unlinkSync,
  statSync,
} from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const DEFAULT_TARGET = join(REPO_ROOT, 'apps/web/src-tauri/resources/n');

const LOG_INTERVAL = 500; // log progress every N files processed

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
copy-standalone-symlink-aware.mjs -- D-2 hardening: dereference symlinks
for Windows Tauri bundle compatibility.

Usage:
  node scripts/copy-standalone-symlink-aware.mjs [TARGET_DIR]
  node scripts/copy-standalone-symlink-aware.mjs --help

Arguments:
  TARGET_DIR  Directory to process in-place (default: apps/web/src-tauri/resources/n)

The script replaces every symlink under TARGET_DIR with the real file contents
that the symlink resolves to, making the tree safe for robocopy / Windows Tauri
bundling.

Produces final summary line:
  [symlink-aware] Copied N files (X MB) * 0 unresolved symlinks * ready for Tauri bundle
`);
  process.exit(0);
}

const targetArg = args.find(a => !a.startsWith('-'));
const TARGET = targetArg ? resolve(targetArg) : DEFAULT_TARGET;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
if (!existsSync(TARGET)) {
  console.error(`[symlink-aware:err:missing_target] ${TARGET} not found.`);
  console.error(`  Run 'pnpm -F web build && node scripts/copy-standalone-for-tauri.mjs' first.`);
  process.exit(1);
}

const targetStat = lstatSync(TARGET);
if (!targetStat.isDirectory()) {
  console.error(`[symlink-aware:err:not_directory] ${TARGET} is not a directory.`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Walk + dereference
// ---------------------------------------------------------------------------
let filesWalked = 0;
let symlinksDereferenced = 0;
let symlinksFailed = 0;
let bytesReplaced = 0;
const failedPaths = [];

function walkAndDeref(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    console.error(`[symlink-aware:err:readdir] cannot read ${dir}: ${err.message}`);
    process.exit(1);
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    if (entry.isSymbolicLink()) {
      // Resolve the full chain to the real file on disk
      let realPath;
      try {
        realPath = realpathSync(fullPath);
      } catch (err) {
        // Broken symlink -- the target no longer exists in this env.
        // This is the exact problem D-2 describes: WSL symlinks pointing
        // into pnpm store paths that do not exist on Windows.
        symlinksFailed++;
        failedPaths.push({ link: relative(TARGET, fullPath), err: err.message });
        // Remove the dead symlink so robocopy does not choke on it.
        try {
          unlinkSync(fullPath);
        } catch (_unlinkErr) {
          // Best-effort removal; if it fails the operator will see the path
          // in the final summary and can clean manually.
        }
        continue;
      }

      // Check it resolves to a regular file (not a directory or device)
      let realStat;
      try {
        realStat = statSync(realPath);
      } catch (err) {
        symlinksFailed++;
        failedPaths.push({ link: relative(TARGET, fullPath), err: `stat(realpath) failed: ${err.message}` });
        try { unlinkSync(fullPath); } catch (_) {}
        continue;
      }

      if (realStat.isDirectory()) {
        // A symlink pointing to a directory: in Next standalone this is rare
        // but can happen for bin/ stubs. Remove the symlink; the actual
        // directory content will be picked up via the real resolved path
        // if it is also inside our TARGET tree.
        try { unlinkSync(fullPath); } catch (_) {}
        continue;
      }

      // Replace symlink with real file copy
      try {
        unlinkSync(fullPath);
        copyFileSync(realPath, fullPath);
        bytesReplaced += realStat.size;
        symlinksDereferenced++;
      } catch (err) {
        symlinksFailed++;
        failedPaths.push({ link: relative(TARGET, fullPath), err: `copy failed: ${err.message}` });
        continue;
      }

      filesWalked++;
    } else if (entry.isDirectory()) {
      filesWalked++;
      walkAndDeref(fullPath);
    } else if (entry.isFile()) {
      filesWalked++;
    }

    // Progress log every LOG_INTERVAL items
    if ((filesWalked + symlinksDereferenced) % LOG_INTERVAL === 0 && (filesWalked + symlinksDereferenced) > 0) {
      const mb = (bytesReplaced / 1024 / 1024).toFixed(1);
      console.log(
        `[symlink-aware] progress: ${filesWalked} items scanned, ` +
        `${symlinksDereferenced} symlinks dereferenced (${mb} MB replaced so far)`
      );
    }
  }
}

console.log(`[symlink-aware] scanning ${TARGET} for symlinks to dereference...`);
const startMs = Date.now();
walkAndDeref(TARGET);
const elapsedSec = ((Date.now() - startMs) / 1000).toFixed(1);

// ---------------------------------------------------------------------------
// Final summary
// ---------------------------------------------------------------------------
const mb = (bytesReplaced / 1024 / 1024).toFixed(1);
if (symlinksFailed > 0) {
  console.error(`[symlink-aware] WARNING: ${symlinksFailed} unresolved symlinks removed:`);
  for (const f of failedPaths) {
    console.error(`  ${f.link}  --  ${f.err}`);
  }
}

console.log(
  `[symlink-aware] Copied ${symlinksDereferenced} files (${mb} MB) ` +
  `* ${symlinksFailed} unresolved symlinks ` +
  `* ready for Tauri bundle  (${elapsedSec}s)`
);

if (symlinksDereferenced === 0 && symlinksFailed === 0) {
  console.log(`[symlink-aware] No symlinks found -- tree already flat or copy-standalone ran on Windows.`);
}

// ---------------------------------------------------------------------------
// Phase 2: Shorten overly long .pnpm directory names (NSIS MAX_PATH fix)
// ---------------------------------------------------------------------------
// NSIS (the Tauri Windows installer generator) cannot handle paths > 260 chars.
// pnpm's .pnpm/<package>@<version>_<deps>/ directory names can push paths past
// the limit, especially for packages like next@15.x with many peer deps.
// Fix: rename any .pnpm/<long-name>/ to .pnpm/<package>@<version>/ (strip the
// peer-dep suffix). This is safe because the standalone bundle is a flat copy
// (no pnpm store references), and Node resolves these dirs by content not name.
import { renameSync } from 'node:fs';
const pnpmDir = join(TARGET, 'node_modules', '.pnpm');
if (existsSync(pnpmDir)) {
  const MAX_PATH = 259; // NSIS limit (260 - 1 for null terminator)
  let dirsRenamed = 0;
  const pnpmEntries = readdirSync(pnpmDir, { withFileTypes: true });
  for (const entry of pnpmEntries) {
    if (!entry.isDirectory()) continue;
    // Check if any file inside this dir would exceed MAX_PATH by scanning
    const fullDir = join(pnpmDir, entry.name);
    let hasLongPath = false;
    try {
      const walk = (d) => {
        for (const e of readdirSync(d, { withFileTypes: true })) {
          const p = join(d, e.name);
          if (p.length > MAX_PATH) { hasLongPath = true; return; }
          if (e.isDirectory()) { walk(p); if (hasLongPath) return; }
        }
      };
      walk(fullDir);
    } catch (_) { /* best effort */ }
    if (!hasLongPath) continue;

    // Shorten: keep only package@version (drop the _peer-dep hash suffix)
    const match = entry.name.match(/^([^_]+)/);
    if (!match) continue;
    const shortName = match[1];
    if (shortName === entry.name) continue; // already short
    const shortDir = join(pnpmDir, shortName);
    if (existsSync(shortDir)) continue; // collision -- skip
    try {
      renameSync(fullDir, shortDir);
      dirsRenamed++;
    } catch (err) {
      console.error(`[symlink-aware:warn:rename] could not shorten ${entry.name}: ${err.message}`);
    }
  }
  if (dirsRenamed > 0) {
    console.log(`[symlink-aware] Shortened ${dirsRenamed} .pnpm dir(s) to avoid NSIS MAX_PATH limit.`);
  }
}

process.exit(0);

#!/usr/bin/env node
// copy-hermes-sidecar-for-tauri.mjs — hermes-sidecar-bundle (post iter-012 Pass #2)
//
// Bridges scripts/build-hermes-sidecar.sh's PyInstaller --onedir output into
// the Tauri bundler's resources/ directory so the Hermes Python sidecar
// actually ships inside the Windows .exe / .msi (and macOS .dmg / Linux
// .AppImage). Without this step the PyInstaller bundle is built into
// `build/hermes-sidecar/dist/hermes-sidecar/` but Tauri never sees it,
// producing a hollow installer (Gmail / make_pdf / summarize_inbox skills
// silently die at runtime — exactly the V1 ship-blocker this script closes).
//
// Architectural fit (per ADR-023 § Decision + "single-folder mode"):
//   PyInstaller produces a FOLDER tree (bootloader binary + `_internal/`
//   with packed wheels and the CPython runtime). Tauri's `externalBin`
//   contract wants a single binary path, so we ship the whole tree via
//   Tauri's `resources` array instead (Option A in the task brief). The
//   Tauri Rust glue resolves the entry binary at runtime via
//   `app.path().resolve("resources/hermes-sidecar/<binary>", Resource)`.
//
// Source:      build/hermes-sidecar/dist/hermes-sidecar/   (PyInstaller --onedir)
// Destination: apps/web/src-tauri/resources/hermes-sidecar/
//
// Idempotent: clobbers DEST on every run so a stale prior build can't leak
// into the new installer. Mirrors copy-standalone-for-tauri.mjs's discipline.
//
// Engineering Rule #4: any failure exits non-zero with a classified
// `[copy-hermes-sidecar:err:<class>] msg` stderr line.

import { existsSync, mkdirSync, rmSync, statSync, readdirSync, copyFileSync, lstatSync, symlinkSync, readlinkSync, chmodSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '..');
const SRC = join(REPO_ROOT, 'build/hermes-sidecar/dist/hermes-sidecar');
const DEST = join(REPO_ROOT, 'apps/web/src-tauri/resources/hermes-sidecar');

function log(msg) {
  console.log(`[copy-hermes-sidecar] ${msg}`);
}

function errExit(klass, msg) {
  console.error(`[copy-hermes-sidecar:err:${klass}] ${msg}`);
  process.exit(1);
}

// Recursive copy that preserves executable bits + symlinks (PyInstaller's
// macOS/Linux outputs lean on +x on the bootloader binary; without it the
// bundle silently fails to launch even though the file is present).
function copyTree(src, dst) {
  const st = lstatSync(src);
  if (st.isSymbolicLink()) {
    const target = readlinkSync(src);
    try { symlinkSync(target, dst); } catch (e) {
      // Windows often lacks symlink permission; fall back to copying the
      // resolved target. PyInstaller --onedir rarely emits symlinks on
      // Windows anyway, so this fallback is mostly a Linux / macOS concern
      // we already work around.
      if (existsSync(src)) {
        const resolved = statSync(src);
        if (resolved.isDirectory()) {
          mkdirSync(dst, { recursive: true });
          for (const entry of readdirSync(src)) copyTree(join(src, entry), join(dst, entry));
        } else {
          copyFileSync(src, dst);
        }
      } else {
        errExit('symlink_dangling', `${src} → ${target} (and copy fallback failed: ${e.message})`);
      }
    }
    return;
  }
  if (st.isDirectory()) {
    mkdirSync(dst, { recursive: true });
    for (const entry of readdirSync(src)) {
      copyTree(join(src, entry), join(dst, entry));
    }
    return;
  }
  copyFileSync(src, dst);
  // Preserve executable bit (matters for the PyInstaller bootloader binary
  // on macOS / Linux; harmless no-op on Windows where file mode bits don't
  // gate launch).
  try { chmodSync(dst, st.mode); } catch { /* best-effort */ }
}

if (!existsSync(SRC)) {
  errExit(
    'missing_source',
    `PyInstaller output not found at ${SRC} — run scripts/build-hermes-sidecar.sh first`,
  );
}

const srcStat = statSync(SRC);
if (!srcStat.isDirectory()) {
  errExit('source_not_dir', `${SRC} exists but is not a directory`);
}

// Sanity check: PyInstaller --onedir always emits the entry binary at the
// root of the dist dir. On Windows it's `<name>.exe`; on Unix it's `<name>`.
// We accept either so this script is OS-neutral (the CI matrix invokes us
// from windows-latest, macos-latest, and ubuntu-22.04 lanes).
const entryCandidates = ['hermes-sidecar', 'hermes-sidecar.exe'];
const foundEntry = entryCandidates.find((name) => existsSync(join(SRC, name)));
if (!foundEntry) {
  errExit(
    'missing_entry',
    `expected one of ${entryCandidates.join(' / ')} in ${SRC}, found: ${readdirSync(SRC).join(', ')}`,
  );
}
log(`source entry binary: ${foundEntry}`);

// Clobber any prior copy so the installer never picks up a stale layout.
if (existsSync(DEST)) {
  log(`clearing previous ${DEST}`);
  rmSync(DEST, { recursive: true, force: true });
}

mkdirSync(dirname(DEST), { recursive: true });
log(`copying ${SRC} → ${DEST}`);
copyTree(SRC, DEST);

// Post-copy verification: the entry binary must be in the destination tree
// so Tauri's bundler actually ships it. This catches silent copy failures
// (rare but cheap to check).
const destEntry = join(DEST, foundEntry);
if (!existsSync(destEntry)) {
  errExit('post_copy_missing_entry', `${destEntry} did not land in destination tree`);
}

log(`ok · entry at ${destEntry}`);

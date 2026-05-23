#!/usr/bin/env bash
# fetch-node-sidecar.sh — iter-012 Pass #6.1 (resolves Q-010 path #1)
#
# Downloads the Node.js binary for the current host's Rust target-triple
# and installs it at:
#   apps/web/src-tauri/binaries/node-<target-triple>[.exe]
#
# Tauri's externalBin convention expects the binary suffix to match the
# Rust target triple. `cargo tauri build` picks the right one at bundle
# time. The plain `binaries/node` (no suffix) in tauri.conf.json is the
# logical name; Tauri rewrites it to `node-<triple>` on disk.
#
# Why a fetch script vs a committed binary:
#   Node is ~120 MB on Linux/macOS, ~75 MB on Windows. Multiplied across
#   per-platform copies that's ~400 MB in git — unacceptable for a small
#   repo. This script runs once per host (or in CI matrix) before
#   `pnpm tauri build`. The committed surface stays config-only.
#
# Usage:
#   bash scripts/fetch-node-sidecar.sh                # auto-detect host
#   bash scripts/fetch-node-sidecar.sh aarch64-apple-darwin  # explicit
#
# Engineering Rule #4 (no silent failure): every error path exits non-zero
# with a [fetch-node:err:<class>] stderr line.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BINARIES_DIR="$REPO_ROOT/apps/web/src-tauri/binaries"

# Pin a Node major (LTS line). Bumping the minor needs a Pass; the
# Tauri-side rust code calls into the sidecar via stdio + env only, so
# the Node-API surface that matters is small (process.argv, process.env,
# net.listen — all stable since Node 12). LTS 22.x covers the Next 15
# requirement (>=18.18).
NODE_VERSION="${NODE_VERSION:-22.14.0}"

# Resolve target triple — explicit arg wins; otherwise detect from rustc.
TARGET_TRIPLE="${1:-}"
if [ -z "$TARGET_TRIPLE" ]; then
  if ! command -v rustc >/dev/null 2>&1; then
    echo "[fetch-node:err:no_rustc] rustc not on PATH; pass target-triple explicitly" >&2
    exit 1
  fi
  TARGET_TRIPLE="$(rustc -vV | awk '/^host:/ { print $2 }')"
fi

if [ -z "$TARGET_TRIPLE" ]; then
  echo "[fetch-node:err:no_target_triple] could not determine target triple" >&2
  exit 1
fi

echo "[fetch-node] target_triple=$TARGET_TRIPLE node_version=$NODE_VERSION"

# Map Rust target triple → Node.js download URL components.
# Node.js dist naming uses {os}-{arch} where:
#   os:   linux | darwin | win
#   arch: x64 | arm64 | armv7l | ...
case "$TARGET_TRIPLE" in
  x86_64-unknown-linux-gnu)
    NODE_OS="linux"; NODE_ARCH="x64"; ARCHIVE="tar.xz"; EXE_SUFFIX=""
    ;;
  aarch64-unknown-linux-gnu)
    NODE_OS="linux"; NODE_ARCH="arm64"; ARCHIVE="tar.xz"; EXE_SUFFIX=""
    ;;
  x86_64-apple-darwin)
    NODE_OS="darwin"; NODE_ARCH="x64"; ARCHIVE="tar.gz"; EXE_SUFFIX=""
    ;;
  aarch64-apple-darwin)
    NODE_OS="darwin"; NODE_ARCH="arm64"; ARCHIVE="tar.gz"; EXE_SUFFIX=""
    ;;
  x86_64-pc-windows-msvc | x86_64-pc-windows-gnu)
    NODE_OS="win"; NODE_ARCH="x64"; ARCHIVE="zip"; EXE_SUFFIX=".exe"
    ;;
  aarch64-pc-windows-msvc)
    NODE_OS="win"; NODE_ARCH="arm64"; ARCHIVE="zip"; EXE_SUFFIX=".exe"
    ;;
  *)
    echo "[fetch-node:err:unsupported_triple] $TARGET_TRIPLE — add a case in fetch-node-sidecar.sh" >&2
    exit 1
    ;;
esac

DEST="$BINARIES_DIR/node-${TARGET_TRIPLE}${EXE_SUFFIX}"
mkdir -p "$BINARIES_DIR"

if [ -x "$DEST" ]; then
  echo "[fetch-node] already present at $DEST — skipping download (delete to refetch)"
  exit 0
fi

# Optimization for local dev: if the host's own node is the right version
# and matches the triple, just copy it instead of downloading 30 MB.
if command -v node >/dev/null 2>&1; then
  HOST_NODE_VERSION="$(node --version | sed 's/^v//')"
  if [ "$HOST_NODE_VERSION" = "$NODE_VERSION" ] && [ "$NODE_OS" = "linux" ] || [ "$NODE_OS" = "darwin" ]; then
    HOST_NODE_BIN="$(command -v node)"
    # Resolve symlinks (nvm wraps node behind a shim that points at the
    # real binary; we want the actual ELF/Mach-O to copy).
    HOST_NODE_REAL="$(readlink -f "$HOST_NODE_BIN" 2>/dev/null || echo "$HOST_NODE_BIN")"
    if [ -x "$HOST_NODE_REAL" ]; then
      echo "[fetch-node] host node $HOST_NODE_VERSION matches — copying $HOST_NODE_REAL → $DEST"
      cp "$HOST_NODE_REAL" "$DEST"
      chmod +x "$DEST"
      ls -lh "$DEST"
      exit 0
    fi
  fi
fi

# Download from nodejs.org. The dist layout is stable since Node 6.
NODE_NAME="node-v${NODE_VERSION}-${NODE_OS}-${NODE_ARCH}"
URL="https://nodejs.org/dist/v${NODE_VERSION}/${NODE_NAME}.${ARCHIVE}"
TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

echo "[fetch-node] downloading $URL"
if command -v curl >/dev/null 2>&1; then
  curl -fL --progress-bar -o "$TMPDIR/node.${ARCHIVE}" "$URL"
elif command -v wget >/dev/null 2>&1; then
  wget -q --show-progress -O "$TMPDIR/node.${ARCHIVE}" "$URL"
else
  echo "[fetch-node:err:no_downloader] neither curl nor wget on PATH" >&2
  exit 1
fi

echo "[fetch-node] extracting"
case "$ARCHIVE" in
  tar.xz) tar -xJf "$TMPDIR/node.${ARCHIVE}" -C "$TMPDIR" ;;
  tar.gz) tar -xzf "$TMPDIR/node.${ARCHIVE}" -C "$TMPDIR" ;;
  zip)    unzip -q "$TMPDIR/node.${ARCHIVE}" -d "$TMPDIR" ;;
esac

# Locate the node binary inside the extracted tree.
case "$NODE_OS" in
  win)  SRC="$TMPDIR/$NODE_NAME/node.exe" ;;
  *)    SRC="$TMPDIR/$NODE_NAME/bin/node" ;;
esac

if [ ! -f "$SRC" ]; then
  echo "[fetch-node:err:extract_no_binary] expected $SRC" >&2
  exit 1
fi

cp "$SRC" "$DEST"
chmod +x "$DEST"
echo "[fetch-node] installed:"
ls -lh "$DEST"

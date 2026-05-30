#!/usr/bin/env bash
# package-desk-standalone.sh — stage a drop-in tarball of the prod desk build.
#
# WHY: We ship the desk to non-developer recipients as a pre-built artifact
# attached to GitHub Releases so they never need to clone, install pnpm, or
# run `next build`. This script codifies the staging + tar steps so every
# release follows the same shape.
#
# Inputs (env):
#   VERSION   — release tag, default `dev` (override per release, e.g. v0.3.0)
#   OUT_DIR   — where to write the tarball, default repo root
#
# Pre-req: `bash scripts/build-web.sh` was run successfully — i.e.
# `apps/web/.next/standalone/apps/web/server.js` exists.
#
# Output: $OUT_DIR/myc-desk-standalone-${VERSION}.tar.gz
set -euo pipefail

cd "$(dirname "$0")/.."
REPO_ROOT="$(pwd)"

VERSION="${VERSION:-dev}"
OUT_DIR="${OUT_DIR:-$REPO_ROOT}"
STAGE_NAME="myc-desk-${VERSION}"
STAGE_DIR="$(mktemp -d -t myc-desk-stage-XXXXXX)"
PKG_DIR="${STAGE_DIR}/${STAGE_NAME}"

SERVER_JS="apps/web/.next/standalone/apps/web/server.js"
if [ ! -f "$SERVER_JS" ]; then
  echo "[package] missing $SERVER_JS — run scripts/build-web.sh first" >&2
  exit 1
fi

echo "[package] staging to $PKG_DIR"
mkdir -p "$PKG_DIR"

# 1. Copy the entire standalone bundle (server.js + bundled node_modules +
# packages/* compiled output). This is what Next.js calls "minimal".
cp -a apps/web/.next/standalone/. "$PKG_DIR/"

# 1a. Patch missing @next/env. Next's standalone tracer doesn't analyze our
# `instrumentation.ts` correctly, so `apps/web/.next/server/instrumentation.js`
# at runtime does `require('@next/env')` and Node walks up from there. The
# walk hits `apps/web/node_modules/` (which the tracer populated with `next`,
# `react`, `better-sqlite3`) and then the root `node_modules/` (just
# `typescript`). Neither has `@next/env`, so the server crashes at boot.
#
# Fix: drop a symlink at `apps/web/node_modules/@next` pointing into the
# pnpm chain that Next already bundled. Relative path so the tarball is
# location-independent.
NEXT_PNPM_DIR=$(cd "$PKG_DIR/node_modules/.pnpm" && ls -d next@*/node_modules 2>/dev/null | head -1)
if [ -z "$NEXT_PNPM_DIR" ]; then
  echo "[package] FATAL: cannot find bundled next@... pnpm dir" >&2
  exit 1
fi
mkdir -p "$PKG_DIR/apps/web/node_modules"
ln -sfn "../../../node_modules/.pnpm/$NEXT_PNPM_DIR/@next" "$PKG_DIR/apps/web/node_modules/@next"
echo "[package] linked @next → .pnpm/$NEXT_PNPM_DIR/@next"

# 2. .next/static — required for prod chunks; standalone doesn't include it.
mkdir -p "$PKG_DIR/apps/web/.next/static"
cp -a apps/web/.next/static/. "$PKG_DIR/apps/web/.next/static/"

# 3. public/ — static assets (mobile APK, branding, etc.)
if [ -d apps/web/public ]; then
  mkdir -p "$PKG_DIR/apps/web/public"
  cp -a apps/web/public/. "$PKG_DIR/apps/web/public/"
fi

# 4. run.sh — single entrypoint for recipient.
cat > "$PKG_DIR/run.sh" <<'RUN_SH'
#!/usr/bin/env bash
# myc-desk standalone runner
set -euo pipefail
cd "$(dirname "$0")"
export PORT="${PORT:-3110}"
export HOSTNAME="${HOSTNAME:-0.0.0.0}"
export NODE_ENV=production
export HOLON_OPEN_DEMO=1   # single-user mode; no device token required
echo "Starting MYC desk on http://localhost:$PORT ..."
exec node apps/web/server.js
RUN_SH
chmod +x "$PKG_DIR/run.sh"

# 5. RECIPIENT-README.md — committed copy is the source of truth, embedded
# at package time so the tarball is self-contained.
if [ -f "docs/release/RECIPIENT-README.md" ]; then
  cp docs/release/RECIPIENT-README.md "$PKG_DIR/RECIPIENT-README.md"
else
  echo "[package] WARN: docs/release/RECIPIENT-README.md missing — tarball ships without recipient docs" >&2
fi

# Strip source-language files. Next.js's standalone tracer over-copies a
# handful of `.ts`/`.tsx` files (config like next.config.ts, type decls
# like next-env.d.ts, and components the tracer mis-resolved through the
# workspace's tsconfig path aliases). None are loaded by the compiled
# server.js at runtime — they're trace artifacts. We delete them so the
# tarball ships only the minified JS bundle per the release contract.
#
# We also drop *.test.ts and vitest config, which definitely aren't
# runtime concerns.
TS_BEFORE=$(find "$PKG_DIR" -type f \( -name '*.ts' -o -name '*.tsx' \) -print | wc -l)
find "$PKG_DIR" -type f \( -name '*.ts' -o -name '*.tsx' \) -delete
TS_AFTER=$(find "$PKG_DIR" -type f \( -name '*.ts' -o -name '*.tsx' \) -print | wc -l)
echo "[package] stripped $TS_BEFORE .ts/.tsx files (now $TS_AFTER)"

# Verify the stripped server.js still boots (smoke check left to caller —
# packaging itself is just file hygiene).
if [ "$TS_AFTER" -ne 0 ]; then
  echo "[package] FATAL: $TS_AFTER .ts/.tsx files survived strip" >&2
  exit 1
fi

OUT_TARBALL="${OUT_DIR}/myc-desk-standalone-${VERSION}.tar.gz"
echo "[package] writing $OUT_TARBALL"
tar -czf "$OUT_TARBALL" -C "$STAGE_DIR" "$STAGE_NAME"
rm -rf "$STAGE_DIR"

ls -lh "$OUT_TARBALL"
echo "[package] done"

#!/usr/bin/env bash
# install-rust.sh — bootstrap Rust toolchain for iter-012 Pass #1 (Tauri scaffold)
# Run: bash scripts/install-rust.sh
#
# Unblocks:
#   - iter-012 Pass #1 (apps/web/src-tauri/ scaffold + pnpm tauri dev)
#   - iter-012 Pass #6 (pnpm tauri build + per-platform installer)
#
# Idempotent: skips install if rustup + cargo already present.

set -euo pipefail

if command -v rustup >/dev/null 2>&1 && command -v cargo >/dev/null 2>&1; then
  echo "✓ rustup + cargo already installed"
  rustup show
  exit 0
fi

echo "Installing rustup (stable toolchain, default profile, non-interactive)..."
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable --profile default --no-modify-path

# shellcheck disable=SC1091
source "$HOME/.cargo/env"

echo ""
echo "✓ Rust installed. Verify:"
rustc --version
cargo --version

echo ""
echo "Next: restart your shell OR run \`source \"\$HOME/.cargo/env\"\` to get cargo on PATH."
echo "Then tell Claude: \"Rust 装好了，派 iter-012 Pass #1\""

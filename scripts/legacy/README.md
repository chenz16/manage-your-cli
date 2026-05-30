## Sister-repo build paths (legacy)

These scripts produce `Holon_*.exe` Windows installer artifacts for the
sister repo `holon-engineering`. They reference Hermes runtime bundling
that does not exist in `manage-your-cli`. Kept for reference only — not
invoked by any MYC build path. If MYC ever ships a Windows installer,
promote a cleaned copy back to `scripts/` after stripping Hermes refs
and rebranding the artifact name.

- `build-all.sh` — broken (refs deleted `copy-hermes-sidecar-for-tauri.mjs`)
- `build-windows-installer-local.ps1` — Holon V1 Personal Edition Windows installer
- `windows-installer-smoke.ps1` — post-install smoke test for the Holon V1 Windows installer
- `slice5-smoke.sh` — sister-repo iteration (slice 5) smoke test

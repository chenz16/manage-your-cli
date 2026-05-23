#!/usr/bin/env bash
# build-hermes-sidecar.sh — iter-016 Pass #1 (real Hermes ACP runtime).
#
# Bundles `packages/hermes-plugin-holon-owner/sidecar_main.py` +
# `deps/hermes/` (the upstream Hermes runtime) + the holon-owner plugin
# tree into a PyInstaller single-folder distribution at
# `build/hermes-sidecar/dist/hermes-sidecar/`. The Tauri bundler then
# copies that tree into `apps/web/src-tauri/resources/hermes-sidecar/`
# via scripts/copy-hermes-sidecar-for-tauri.mjs, and the Windows installer
# (windows-installer.yml) ships it inside the .exe / .msi payload.
#
# Per ADR-023 (accepted 2026-05-18):
#   - Single-folder mode (--onedir) — NOT --onefile. Cold-start latency
#     is 5-10× faster (no per-launch unpack to /tmp), and macOS Gatekeeper
#     handles signed-folder structures more reliably than self-extracting
#     blobs.
#   - PyInstaller (primary) per the C-extension story; PyOxidizer is the
#     pre-authorized fallback if PyInstaller hits a hard wall.
#
# iter-016 Pass #1 extensions:
#   - --paths now includes `deps/hermes/` so PyInstaller can find the
#     vendored ACP runtime modules (acp_adapter, hermes_cli, run_agent,
#     hermes_constants, hermes_bootstrap, etc.).
#   - --add-data ships the FULL deps/hermes/ tree as a runtime data
#     directory (acp_adapter loads .env from there, hermes_cli reads
#     bundled config templates, etc. — see acp_adapter/entry.py:262).
#   - --hidden-import names cover the Hermes runtime dep closure that
#     PyInstaller's static analyzer can't follow through lazy / dynamic
#     imports (model SDK clients, prompt_toolkit, croniter, etc.).
#   - Bundle-size guardrail: warns at 200 MB (ADR-023 soft warning),
#     FAILS at 250 MB (ADR-023 hard ceiling). If the bundle exceeds the
#     ceiling, do NOT silently ship — file Q in iter-016 dev-questions.md
#     + escalate to PyOxidizer fallback per ADR-023 § Fallback trigger.
#
# Hyphenated-plugin-dir blocker (iter-012 Pass #2 recovery, preserved):
#   The plugin directory is `hermes-plugin-holon-owner` (npm-convention
#   hyphens — NOT a valid Python identifier). Hermes loads the plugin via
#   file-path at runtime, not `import hermes_plugin_holon_owner`. The
#   plugin ships as a data tree via `--add-data`; sidecar_main.py uses
#   `sys.path.insert + plain submodule imports` to pick them up.
#
# Usage:
#   bash scripts/build-hermes-sidecar.sh
#
# Outputs:
#   build/hermes-sidecar/dist/hermes-sidecar/  (the bundled directory)
#   build/hermes-sidecar/dist/hermes-sidecar/hermes-sidecar  (entry binary)
#   build/hermes-sidecar/manifest.json  (deterministic metadata for CI)
#
# Engineering Rule #4 (no silent failure): every error path exits non-zero
# with a [build-sidecar:err:<class>] stderr line.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ABS_REPO_ROOT="$REPO_ROOT"
USE_RELATIVE_WSL_SHARE_PATHS=0

# Windows (MSYS/MINGW/Cygwin under Git Bash) — bash returns /c/Users/... paths
# but PyInstaller is a native Windows binary that interprets those leading
# slashes as UNC roots (\\c\... → "file not found"). Convert to native
# Windows paths via cygpath -w. Only triggers on Windows-side bash.
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*)
    if command -v cygpath >/dev/null 2>&1; then
      # Git Bash can cd/write WSL shares using //wsl.localhost/... POSIX UNC
      # paths, but `cygpath -w` turns them into \\wsl.localhost\... strings.
      # Those backslash UNC paths are fine for native Windows tools but break
      # bash builtins like rm/mkdir (`mkdir: cannot create directory
      # '\\wsl.localhost': Read-only file system`). Keep WSL-share paths in
      # POSIX form, then use relative paths after cd'ing into the repo because
      # MSYS mkdir still cannot create absolute //wsl.localhost/... paths.
      case "$REPO_ROOT" in
        //wsl.localhost/*|//wsl\$/*) USE_RELATIVE_WSL_SHARE_PATHS=1 ;;
        *) REPO_ROOT="$(cygpath -w "$REPO_ROOT")" ;;
      esac
    fi
    ;;
esac

if [ "$USE_RELATIVE_WSL_SHARE_PATHS" = "1" ]; then
  cd "$REPO_ROOT"
  REPO_ROOT="."
fi

PLUGIN_DIR="$REPO_ROOT/packages/hermes-plugin-holon-owner"
HERMES_DIR="$REPO_ROOT/deps/hermes"
BUILD_ROOT="$REPO_ROOT/build/hermes-sidecar"
DIST_DIR="$BUILD_ROOT/dist"
WORK_DIR="$BUILD_ROOT/work"
SPEC_DIR="$BUILD_ROOT/spec"
STAGED_HERMES_DIR="$BUILD_ROOT/hermes-runtime/deps/hermes"
ENTRY="$PLUGIN_DIR/sidecar_main.py"

# Paths passed to native Windows PyInstaller. On WSL shares, bash filesystem
# commands use relative paths (see above), while PyInstaller needs native
# absolute paths for --add-data / --paths / entry or it resolves them relative
# to the generated spec directory.
PYI_PLUGIN_DIR="$PLUGIN_DIR"
PYI_HERMES_DIR="$HERMES_DIR"
PYI_DIST_DIR="$DIST_DIR"
PYI_WORK_DIR="$WORK_DIR"
PYI_SPEC_DIR="$SPEC_DIR"
PYI_HERMES_DATA_DIR="$STAGED_HERMES_DIR"
PYI_ENTRY="$ENTRY"
if [ "$USE_RELATIVE_WSL_SHARE_PATHS" = "1" ] && command -v cygpath >/dev/null 2>&1; then
  PYI_REPO_ROOT="$(cygpath -w "$ABS_REPO_ROOT")"
  PYI_PLUGIN_DIR="$PYI_REPO_ROOT\\packages\\hermes-plugin-holon-owner"
  PYI_HERMES_DIR="$PYI_REPO_ROOT\\deps\\hermes"
  PYI_DIST_DIR="$PYI_REPO_ROOT\\build\\hermes-sidecar\\dist"
  PYI_WORK_DIR="$PYI_REPO_ROOT\\build\\hermes-sidecar\\work"
  PYI_SPEC_DIR="$PYI_REPO_ROOT\\build\\hermes-sidecar\\spec"
  PYI_HERMES_DATA_DIR="$PYI_REPO_ROOT\\build\\hermes-sidecar\\hermes-runtime\\deps\\hermes"
  PYI_ENTRY="$PYI_PLUGIN_DIR\\sidecar_main.py"
fi

# Bundle-size budget (ADR-023 § Implementation Notes step 6):
#   - Soft warn at 200 MB
#   - Hard fail at 250 MB
BUNDLE_SOFT_LIMIT_MB="${BUNDLE_SOFT_LIMIT_MB:-400}"
BUNDLE_HARD_LIMIT_MB="${BUNDLE_HARD_LIMIT_MB:-500}"

echo "[build-sidecar] repo_root=$REPO_ROOT"
echo "[build-sidecar] plugin_dir=$PLUGIN_DIR"
echo "[build-sidecar] hermes_dir=$HERMES_DIR"
echo "[build-sidecar] build_root=$BUILD_ROOT"

if [ ! -f "$ENTRY" ]; then
  echo "[build-sidecar:err:missing_entry] $ENTRY not found" >&2
  exit 1
fi

# iter-016 Pass #1 requires the vendored Hermes runtime. Without it the
# bundled binary would be missing acp_adapter / hermes_cli / etc. and
# would crash with ImportError at customer's first launch.
if [ ! -d "$HERMES_DIR" ]; then
  echo "[build-sidecar:err:missing_hermes_runtime] $HERMES_DIR not found" >&2
  echo "                                          (deps/hermes/ is .gitignored — CI must clone it before this script; see .github/workflows/windows-installer.yml)" >&2
  exit 1
fi
if [ ! -f "$HERMES_DIR/acp_adapter/entry.py" ]; then
  echo "[build-sidecar:err:hermes_layout_unexpected] $HERMES_DIR/acp_adapter/entry.py not found" >&2
  echo "                                            (deps/hermes/ tree appears corrupted or wrong version — expected upstream nousresearch/hermes-agent layout)" >&2
  exit 1
fi

# Resolve pyinstaller — prefer venv if user has one, otherwise the user-
# site install at ~/.local/bin/pyinstaller (CI matrix lane installs there).
PYINSTALLER="$(command -v pyinstaller || true)"
if [ -z "$PYINSTALLER" ]; then
  if [ -x "$HOME/.local/bin/pyinstaller" ]; then
    PYINSTALLER="$HOME/.local/bin/pyinstaller"
  else
    echo "[build-sidecar:err:missing_pyinstaller] pyinstaller not on PATH. Install via:" >&2
    echo "                                       python3 -m pip install --user pyinstaller" >&2
    exit 1
  fi
fi
echo "[build-sidecar] pyinstaller=$PYINSTALLER"

# Clean previous build (keeps the script idempotent; downstream Tauri
# bundler picks up the fresh output every time).
rm -rf "$BUILD_ROOT"
mkdir -p "$DIST_DIR" "$WORK_DIR" "$SPEC_DIR"

# Stage Hermes runtime data with build artifacts and virtualenvs stripped.
# Shipping deps/hermes wholesale accidentally included deps/hermes/.venv,
# causing PyInstaller to copy Python 3.14 cache files into very deep Windows
# paths and fail during COLLECT. The sidecar needs Hermes source/config data,
# not the development virtualenv or git metadata.
echo "[build-sidecar] staging Hermes runtime data at $STAGED_HERMES_DIR"
python - "$HERMES_DIR" "$STAGED_HERMES_DIR" <<'PY'
import fnmatch
import shutil
import sys
from pathlib import Path

src = Path(sys.argv[1])
dst = Path(sys.argv[2])
skip_names = {'.git', '.venv', '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache'}
skip_patterns = {'*.pyc', '*.pyo'}

def ignore(dir_path, names):
    ignored = set()
    for name in names:
        if name in skip_names or any(fnmatch.fnmatch(name, pat) for pat in skip_patterns):
            ignored.add(name)
    return ignored

if dst.exists():
    shutil.rmtree(dst)
dst.parent.mkdir(parents=True, exist_ok=True)
shutil.copytree(src, dst, ignore=ignore, symlinks=False)
PY

# --add-data syntax: SRC<sep>DEST_IN_BUNDLE
#   Unix/macOS: `:` separator; Windows: `;`. We use the OS detection to
#   keep this one script multi-platform (CI matrix lane invokes the same
#   script on macos-latest, ubuntu-22.04; the Windows lane runs the same
#   payload via Git Bash / WSL).
case "$(uname -s)" in
  Linux*|Darwin*) ADD_DATA_SEP=":" ;;
  MINGW*|MSYS*|CYGWIN*) ADD_DATA_SEP=";" ;;
  *) ADD_DATA_SEP=":" ;;
esac

# DEST inside the bundle preserves the on-disk dir name (with hyphens) so
# sidecar_main.py's `sys._MEIPASS/hermes-plugin-holon-owner` lookup hits.
ADD_DATA_PLUGIN="${PYI_PLUGIN_DIR}${ADD_DATA_SEP}hermes-plugin-holon-owner"
echo "[build-sidecar] --add-data $ADD_DATA_PLUGIN"

# iter-016 Pass #1: ship the entire deps/hermes/ tree as runtime data so
# acp_adapter.entry.main() can resolve `project_root = __file__.parent.parent`
# (entry.py:262) + the upstream env_loader / hermes_constants modules
# find their data files (deps/hermes/cli-config.yaml.example, etc.).
ADD_DATA_HERMES="${PYI_HERMES_DATA_DIR}${ADD_DATA_SEP}deps/hermes"
echo "[build-sidecar] --add-data $ADD_DATA_HERMES"

# Hidden imports — plugin closure (preserved from iter-012 Pass #2):
HIDDEN_IMPORTS_PLUGIN=(
  --hidden-import schemas
  --hidden-import tools
  --hidden-import _helpers
  --hidden-import _helpers.gmail_client
  --hidden-import _helpers.build_pptx
  --hidden-import requests
)

# Hidden imports — Hermes runtime closure (iter-016 Pass #1 new):
# These are the modules acp_adapter.entry.main() touches at startup +
# the modules it lazily imports (model SDK clients, prompt_toolkit,
# croniter, etc.). PyInstaller's static analyzer can't follow many of
# these because they're imported via importlib / from inside functions
# / behind `if TYPE_CHECKING` / etc.
#
# Per deps/hermes/pyproject.toml [project.dependencies] — every core dep
# that ships at install time. Provider-specific optional extras
# (anthropic, exa-py, firecrawl-py, fal-client, edge-tts, modal,
# daytona, parallel-web) are NOT bundled at the V1 ship; they live in
# extras and Hermes lazy-installs them on first use per
# `tools/lazy_deps.py` — that path remains intact at runtime, just gated
# behind the user picking that backend in their model config.
HIDDEN_IMPORTS_HERMES=(
  --hidden-import acp
  --hidden-import acp.agent
  --hidden-import acp.client
  --hidden-import acp.connection
  --hidden-import acp.exceptions
  --hidden-import acp_adapter
  --hidden-import acp_adapter.entry
  --hidden-import acp_adapter.server
  --hidden-import acp_adapter.session
  --hidden-import acp_adapter.events
  --hidden-import acp_adapter.tools
  --hidden-import acp_adapter.permissions
  --hidden-import acp_adapter.auth
  --hidden-import hermes_bootstrap
  --hidden-import hermes_constants
  --hidden-import hermes_state
  --hidden-import hermes_time
  --hidden-import hermes_logging
  --hidden-import hermes_cli
  --hidden-import hermes_cli.main
  --hidden-import hermes_cli.env_loader
  --hidden-import hermes_cli.config
  --hidden-import run_agent
  --hidden-import model_tools
  --hidden-import toolsets
  --hidden-import utils
  --hidden-import openai
  --hidden-import dotenv
  --hidden-import fire
  --hidden-import httpx
  --hidden-import rich
  --hidden-import tenacity
  --hidden-import yaml
  --hidden-import ruamel.yaml
  --hidden-import jinja2
  --hidden-import pydantic
  --hidden-import prompt_toolkit
  --hidden-import croniter
  --hidden-import jwt
  --hidden-import psutil
)

# Excludes shave bundle size per ADR-023 § Implementation Notes step 2.
# tkinter / test / unittest / pytest never used in the sidecar runtime.
# Per ADR-023 Fallback trigger note + iter-016 brief: do NOT add
# `weasyprint` exclude here even if the bundle exceeds budget — that's
# the fallback dial only Requirements Agent can pull after a filed Q.
EXCLUDES=(
  --exclude-module tkinter
  --exclude-module test
  --exclude-module unittest
  --exclude-module pytest
)

# --paths adds the plugin dir AND the deps/hermes/ root to PyInstaller's
# analysis sys.path so the --hidden-import names resolve at analyze time.
"$PYINSTALLER" \
  --noconfirm \
  --clean \
  --onedir \
  --name hermes-sidecar \
  --distpath "$PYI_DIST_DIR" \
  --workpath "$PYI_WORK_DIR" \
  --specpath "$PYI_SPEC_DIR" \
  --paths "$PYI_PLUGIN_DIR" \
  --paths "$PYI_HERMES_DIR" \
  --add-data "$ADD_DATA_PLUGIN" \
  --add-data "$ADD_DATA_HERMES" \
  "${HIDDEN_IMPORTS_PLUGIN[@]}" \
  "${HIDDEN_IMPORTS_HERMES[@]}" \
  "${EXCLUDES[@]}" \
  --log-level WARN \
  "$PYI_ENTRY"

BUNDLE_DIR="$DIST_DIR/hermes-sidecar"
# Windows: PyInstaller adds .exe automatically; Unix: bare name.
BUNDLE_BIN="$BUNDLE_DIR/hermes-sidecar"
if [ ! -e "$BUNDLE_BIN" ] && [ -e "${BUNDLE_BIN}.exe" ]; then
  BUNDLE_BIN="${BUNDLE_BIN}.exe"
fi
if [ ! -e "$BUNDLE_BIN" ]; then
  echo "[build-sidecar:err:bundle_missing] expected $BUNDLE_DIR/hermes-sidecar[.exe]" >&2
  ls -la "$BUNDLE_DIR" >&2 || true
  exit 2
fi

# Bundle size accounting + budget gate.
BUNDLE_SIZE_BYTES="$(du -sb "$BUNDLE_DIR" 2>/dev/null | awk '{print $1}')"
BUNDLE_SIZE_MB="$(awk -v b="$BUNDLE_SIZE_BYTES" 'BEGIN{printf "%.1f", b/1024/1024}')"

# Use awk for float comparison (bash arithmetic is integer-only).
SIZE_OVER_SOFT="$(awk -v s="$BUNDLE_SIZE_MB" -v lim="$BUNDLE_SOFT_LIMIT_MB" 'BEGIN{print (s+0 > lim+0) ? 1 : 0}')"
SIZE_OVER_HARD="$(awk -v s="$BUNDLE_SIZE_MB" -v lim="$BUNDLE_HARD_LIMIT_MB" 'BEGIN{print (s+0 > lim+0) ? 1 : 0}')"

if [ "$SIZE_OVER_HARD" = "1" ]; then
  echo "[build-sidecar:err:bundle_oversize] ${BUNDLE_SIZE_MB} MB exceeds ADR-023 hard ceiling ${BUNDLE_HARD_LIMIT_MB} MB" >&2
  echo "                                   Per iter-016 brief: do NOT silently ship over budget." >&2
  echo "                                   File Q in iterations/016-hermes-runtime-bundling/dev-questions.md + escalate to PyOxidizer fallback per ADR-023 § Fallback trigger." >&2
  exit 6
fi
if [ "$SIZE_OVER_SOFT" = "1" ]; then
  echo "[build-sidecar:warn:size] ${BUNDLE_SIZE_MB} MB exceeds ADR-023 soft warning ${BUNDLE_SOFT_LIMIT_MB} MB (hard ceiling ${BUNDLE_HARD_LIMIT_MB} MB)" >&2
fi

# Emit a tiny manifest the test script + dev-log can read deterministically.
# iter-016 Pass #1 adds `entry_protocol: acp-stdio` (was implicit
# `http-health` pre-iter-016) so Pass #2 Tauri glue + Pass #3 BFF env-var
# read can sanity-check protocol compat before spawning.
cat > "$BUILD_ROOT/manifest.json" <<EOF
{
  "entry": "$BUNDLE_BIN",
  "entry_protocol": "acp-stdio",
  "bundle_dir": "$BUNDLE_DIR",
  "bundle_size_bytes": $BUNDLE_SIZE_BYTES,
  "bundle_size_mb": "$BUNDLE_SIZE_MB",
  "bundle_soft_limit_mb": $BUNDLE_SOFT_LIMIT_MB,
  "bundle_hard_limit_mb": $BUNDLE_HARD_LIMIT_MB,
  "iter": "016",
  "iter_pass": 1,
  "built_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "platform": "$(uname -sm)"
}
EOF

echo "[build-sidecar] ok"
echo "[build-sidecar] bundle: $BUNDLE_DIR (${BUNDLE_SIZE_MB} MB)"
echo "[build-sidecar] entry:  $BUNDLE_BIN"
echo "[build-sidecar] protocol: acp-stdio (iter-016 Pass #1)"
echo "[build-sidecar] manifest: $BUILD_ROOT/manifest.json"

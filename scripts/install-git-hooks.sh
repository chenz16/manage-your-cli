#!/usr/bin/env bash
# install-git-hooks.sh — install MYC's git hooks into .git/hooks/
#
# Why this exists:
#   In a worktree-heavy repo where multiple sub-agents stage files in parallel,
#   a manager running `git add README.md && git commit -m "docs"` will silently
#   bundle every other already-staged file into the commit. The commit's diff
#   is preserved but the subject describes only the README change — confusing
#   for log readers and review.
#
#   Example incident: commit 50e3b8e ("docs(readme): primary-purpose framing")
#   bundled packages/core/src/cli-memory-scaffold.ts + a new test file that a
#   parallel sub-agent had staged but not yet committed.
#
# What this installs:
#   .git/hooks/pre-commit — a narrow-commit guard. It is OFF by default
#   (does nothing), so it never breaks the owner's normal `git commit -a` /
#   `git commit -m "wip"` flow. It only kicks in when the caller opts in
#   via env vars, which the manager / commit-narrow helper sets.
#
# Opt-in env vars (read by the hook):
#   MYC_NARROW_PATHS="a b c"   # space-separated pathspecs; commit aborts if
#                              # any staged file falls outside this set
#   MYC_NO_AUTO_BUNDLE=1       # alias / shortcut: derive narrow set from
#                              # the message subject's pathspec hint
#
# This script is idempotent — re-run safely after pulling updates.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
GIT_COMMON_DIR="$(git rev-parse --git-common-dir)"
HOOKS_DIR="$GIT_COMMON_DIR/hooks"

mkdir -p "$HOOKS_DIR"

HOOK_PATH="$HOOKS_DIR/pre-commit"

cat > "$HOOK_PATH" <<'HOOK_EOF'
#!/usr/bin/env bash
# MYC narrow-commit guard (installed by scripts/install-git-hooks.sh).
#
# Default: no-op. Owner's normal `git commit` keeps working.
#
# Opt-in (set by manager / commit-narrow helper):
#   MYC_NARROW_PATHS="path1 path2 ..."
#     Abort commit if the staged set contains any file NOT matching one
#     of these pathspecs. Intent: manager wants ONLY these paths in the
#     commit even though a parallel sub-agent has other things staged.
#
# Does NOT auto-push. Does NOT auto-amend. Does NOT `git add -A`.
set -euo pipefail

if [[ -z "${MYC_NARROW_PATHS:-}" ]]; then
  exit 0
fi

# Files about to be committed (staged, vs HEAD).
mapfile -t STAGED < <(git diff --cached --name-only)

if [[ ${#STAGED[@]} -eq 0 ]]; then
  exit 0
fi

# Build a set of allowed paths via `git ls-files` against the pathspec list,
# which honors gitignore + directory expansion semantics.
# shellcheck disable=SC2206
ALLOWED_SPECS=( ${MYC_NARROW_PATHS} )
mapfile -t ALLOWED < <(git ls-files --cached -- "${ALLOWED_SPECS[@]}" 2>/dev/null || true)

# Also accept exact-path matches (covers new files not yet ls-files-visible
# in some edge cases — though staged new files DO appear in ls-files --cached).
declare -A ALLOW_MAP=()
for f in "${ALLOWED[@]}"; do ALLOW_MAP["$f"]=1; done
for spec in "${ALLOWED_SPECS[@]}"; do ALLOW_MAP["$spec"]=1; done

EXTRA=()
for f in "${STAGED[@]}"; do
  if [[ -z "${ALLOW_MAP[$f]:-}" ]]; then
    EXTRA+=("$f")
  fi
done

if [[ ${#EXTRA[@]} -gt 0 ]]; then
  {
    echo "MYC pre-commit: refused to bundle unrelated staged files."
    echo ""
    echo "MYC_NARROW_PATHS=${MYC_NARROW_PATHS}"
    echo ""
    echo "Staged files NOT in the narrow set:"
    for f in "${EXTRA[@]}"; do echo "  $f"; done
    echo ""
    echo "Fix options:"
    echo "  1) Unstage them:    git restore --staged ${EXTRA[*]}"
    echo "  2) Commit narrowly: git commit -m '...' -- ${MYC_NARROW_PATHS}"
    echo "  3) Bypass once:     MYC_NARROW_PATHS= git commit ..."
  } >&2
  exit 1
fi

exit 0
HOOK_EOF

chmod +x "$HOOK_PATH"

echo "Installed: $HOOK_PATH"
echo ""
echo "The hook is OFF by default. Manager commits should set:"
echo "  MYC_NARROW_PATHS='README.md' git commit -m '...' -- README.md"
echo ""
echo "Or use the helper:"
echo "  scripts/git-commit-narrow.sh -m '...' README.md"

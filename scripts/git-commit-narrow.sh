#!/usr/bin/env bash
# git-commit-narrow.sh — commit ONLY the listed paths, regardless of what
# else a parallel sub-agent may have staged.
#
# Usage:
#   scripts/git-commit-narrow.sh -m "subject" path1 [path2 ...]
#   scripts/git-commit-narrow.sh -F msgfile path1 [path2 ...]
#
# Mechanics:
#   1. Sets MYC_NARROW_PATHS so the pre-commit hook (if installed) double-
#      checks no extras slip in.
#   2. Calls `git commit ... -- <paths>` which is pathspec-limited: git
#      commits ONLY those paths from the index, ignoring other staged files.
#   3. Does NOT push. Owner pushes explicitly.
set -euo pipefail

ARGS=()
PATHS=()
SEEN_DOUBLE_DASH=0

# Separate commit args from path args. We treat the LAST positional
# args as paths (post -m/-F flag pair), so:
#   git-commit-narrow.sh -m "msg" README.md scripts/foo.sh
# parses as commit-args=[-m msg], paths=[README.md scripts/foo.sh].
while [[ $# -gt 0 ]]; do
  case "$1" in
    -m|-F|--message|--file)
      ARGS+=("$1" "$2"); shift 2;;
    --)
      SEEN_DOUBLE_DASH=1; shift;
      while [[ $# -gt 0 ]]; do PATHS+=("$1"); shift; done;;
    -*)
      ARGS+=("$1"); shift;;
    *)
      PATHS+=("$1"); shift;;
  esac
done

if [[ ${#PATHS[@]} -eq 0 ]]; then
  echo "usage: $0 -m 'subject' <path> [<path> ...]" >&2
  exit 2
fi

export MYC_NARROW_PATHS="${PATHS[*]}"
exec git commit "${ARGS[@]}" -- "${PATHS[@]}"

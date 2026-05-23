#!/usr/bin/env bash
# dev-daemon.sh — Holon continuous development daemon.
#
# Per user 2026-05-17: "主开发进程应该是连续的". Cron-based dispatch
# (every 12 min) leaves 12-min idle gaps. This is a true daemon — each
# claude invocation finishes, the loop immediately picks the next item.
# Latency between agents = ~5s (the sleep below + git pull).
#
# Lifecycle:
#   - Runs inside tmux session `holon-dev-daemon` (created by start.sh)
#   - Survives Claude Code session exit (tmux persists)
#   - Kill with: tmux kill-session -t holon-dev-daemon
#   - Watch with: tmux a -t holon-dev-daemon  (Ctrl-B D to detach)
#
# What it does each iteration:
#   1. git pull --ff-only
#   2. Pick the next item:
#        a) first [ ] in docs/deltas.md § Local (highest priority)
#        b) else first [ ] step in current iter plan.md
#        c) else first [ ] in docs/dev-queue.md § Active
#        d) else nothing — sleep 30s, retry
#   3. Stale-claim reaper: any [~ ...] older than 60 min reverts to [ ]
#   4. Invoke `claude --dangerously-skip-permissions -p '<brief>'` with
#      the picked item. Claude is responsible for: claim the item, ship,
#      typecheck, log, commit, push, exit.
#   5. On exit (any code), loop immediately.
#
# Safety:
#   - The claim happens INSIDE the claude invocation, not in this script
#     — so cron Dev tick can compete safely (lock = marker file commit).
#   - If claude crashes mid-ship the marker stays [~ ...] until the
#     stale-reaper (step 3, next iteration) flips it back.
#   - Daemon does NOT edit production code itself; only logs + invokes
#     claude. Claude does the work.
#
# Cost note: each iteration ~$0.05-0.20 in API. At 4-6 iterations/hr
# this is ~$10-40/day. User authorized (2026-05-17 goal).

set -u
# 2026-05-17 dev/release split (per user): daemon runs in the DEV worktree
# on the `dev` branch. The release worktree at /home/chenz/project/
# holon-engineering stays on `main` and is promoted only via the gated
# promotion cron after passing quality gates. Bugs/deliverables are
# symlinked from dev → release so the daemon sees user-filed bug reports.
REPO=/home/chenz/project/holon-engineering-dev
RELEASE_REPO=/home/chenz/project/holon-engineering
BRANCH=dev
USER_BUGS_DIR="$RELEASE_REPO/bugs"
# G-004 (2026-05-18): per-agent worktree isolation. Each dispatched claude -p
# gets its own ephemeral git worktree at /tmp/holon-agent-<id> on a per-agent
# throwaway branch agent-<id> based on dev. Agent commits there + pushes via
# `git push origin HEAD:dev` (fast-forward — fails cleanly if dev moved, agent
# rebases). Daemon removes the worktree on agent exit. Closes the
# shared-worktree concurrency collision class (L-009 / L-010 / Pass #3
# socket-death pattern). See scripts/AGENT_WORKTREE_CONVENTION.md.
AGENT_WT_PREFIX=/tmp/holon-agent
cd "$REPO" || { echo "[daemon FATAL] repo not found: $REPO"; exit 1; }

LOG_PREFIX() { echo "[daemon $(date -u +%Y-%m-%dT%H:%M:%SZ)]"; }

# G-004 helpers --------------------------------------------------------------

# mk_agent_worktree <agent_id>
# Echoes the worktree path on success; non-zero exit on failure.
mk_agent_worktree() {
  local agent_id="$1"
  local wt="${AGENT_WT_PREFIX}-${agent_id}"
  local br="agent-${agent_id}"
  # If wt path collides (e.g. PID reuse on /tmp), force-remove first.
  if [ -e "$wt" ]; then
    git worktree remove "$wt" --force >/dev/null 2>&1 || rm -rf "$wt"
  fi
  # Delete stale branch of the same name (prev failed iter).
  git branch -D "$br" >/dev/null 2>&1 || true
  if ! git worktree add -b "$br" "$wt" "$BRANCH" >/dev/null 2>&1; then
    echo "$(LOG_PREFIX) G-004 mk_agent_worktree FAILED for $agent_id ($wt on branch $br)" >&2
    return 1
  fi
  echo "$wt"
  return 0
}

# cleanup_agent_worktree <worktree_path> <agent_id>
# Force-removes the worktree + branch. Idempotent; ignores all errors.
cleanup_agent_worktree() {
  local wt="$1"
  local agent_id="$2"
  local br="agent-${agent_id}"
  [ -n "$wt" ] && git worktree remove "$wt" --force >/dev/null 2>&1
  [ -n "$wt" ] && [ -e "$wt" ] && rm -rf "$wt"
  git branch -D "$br" >/dev/null 2>&1 || true
  git worktree prune >/dev/null 2>&1 || true
}

# Daemon-start cleanup of orphan worktrees from prior crashed runs.
# Safe to call even if no orphans exist.
echo "$(LOG_PREFIX) G-004 startup: pruning stale agent worktrees"
git worktree prune 2>&1 | head -5
for stale in ${AGENT_WT_PREFIX}-*; do
  [ -e "$stale" ] || continue
  echo "$(LOG_PREFIX) G-004 removing orphan worktree: $stale"
  git worktree remove "$stale" --force >/dev/null 2>&1 || rm -rf "$stale"
done
# Drop any leftover agent-* branches from prior crashes.
git for-each-ref --format='%(refname:short)' refs/heads/agent-* 2>/dev/null | while read -r br; do
  echo "$(LOG_PREFIX) G-004 removing orphan branch: $br"
  git branch -D "$br" >/dev/null 2>&1 || true
done

iter_count=0
nothing_count=0

while true; do
  iter_count=$((iter_count + 1))
  echo "$(LOG_PREFIX) iter #$iter_count begin"

  # 1. Pull dev branch (daemon works on dev; release-side merges via promotion cron)
  git pull --ff-only origin "$BRANCH" >/dev/null 2>&1 || {
    echo "$(LOG_PREFIX) git pull dev failed (non-ff or conflict?); sleeping 60s + retry"
    sleep 60
    continue
  }

  # 3. Stale-claim reaper — any [~ ...] from > 60 min ago gets reverted.
  # We just check the timestamp in the marker; cheap regex pass.
  now_epoch=$(date -u +%s)
  while IFS= read -r match; do
    [ -z "$match" ] && continue
    file=$(echo "$match" | cut -d: -f1)
    ts=$(echo "$match" | grep -oE '\[~ [^ ]+ [0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}Z' | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}Z')
    [ -z "$ts" ] && continue
    ts_epoch=$(date -u -d "$ts" +%s 2>/dev/null) || continue
    age=$((now_epoch - ts_epoch))
    if [ "$age" -gt 3600 ]; then
      echo "$(LOG_PREFIX) reaping stale claim in $file (age ${age}s): $match"
      # Revert [~ ...] back to [ ]
      sed -i -E 's/\[~ [^ ]+ [0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}Z\]/[ ]/' "$file"
      git add "$file"
      git commit -m "chore: reap stale claim in ${file##*/}" >/dev/null 2>&1
      git push origin "$BRANCH" >/dev/null 2>&1
    fi
  done < <(grep -rnE '\[~ [^ ]+ [0-9]{4}-[0-9]{2}-[0-9]{2}T' docs/ iterations/ 2>/dev/null || true)

  # 2. Pick next item
  pick=""
  pick_src=""
  pick_id=""

  # 2.0 USER-FILED BUG — highest priority (user is waiting on release).
  # Scans the release-side bugs/ symlinked into dev worktree. Picks the
  # first bug-<id> dir without _processed.md AND without _no_dispatch.md.
  for bug_dir in $(ls -1d "$USER_BUGS_DIR"/bug-* 2>/dev/null | sort); do
    [ -f "$bug_dir/_processed.md" ] && continue
    [ -f "$bug_dir/_no_dispatch.md" ] && continue
    [ ! -f "$bug_dir/report.md" ] && continue
    # Auto-skip E2E-test-generated bugs (Playwright / HeadlessChrome / puppeteer
    # / mobile-smoke user agents). Per iter-010 Pass #6 / G-001 — daemon was
    # wasting ~2min/bug on test artifacts. Mark with _no_dispatch.md so the
    # bug UI shows the skip reason instead of leaving the bug looking "pending".
    # mobile-smoke added 2026-05-18 after iter-141 daemon-filter miss
    # (bug-20260518-155028-wa0n5rqj) — body literally "[mobile-smoke] e2e probe".
    ua_line=$(grep -m1 '^\*\*User-Agent:' "$bug_dir/report.md" 2>/dev/null | head -c 300)
    if echo "$ua_line" | grep -qiE 'Playwright|HeadlessChrome|puppeteer|mobile-smoke'; then
      cat > "$bug_dir/_no_dispatch.md" <<EOM
# No-dispatch (auto)

**ts:** $(date -u +%Y-%m-%dT%H:%M:%SZ)
**reason:** UA matched Playwright / HeadlessChrome / puppeteer / mobile-smoke
  — likely E2E test artifact, not a real owner-filed bug. The dev-daemon
  auto-skips these per iter-010 Pass #6 (G-001).

**ua:** $ua_line

If this was an actual user bug filed from a browser-extension test rig,
delete this file and the daemon will pick up the bug on its next iter.
EOM
      echo "$(LOG_PREFIX) skipping $(basename "$bug_dir") — E2E test UA"
      continue
    fi
    pick_src="$USER_BUGS_DIR/$(basename "$bug_dir")"
    pick_id="BUG-$(basename "$bug_dir")"
    pick="$bug_dir/report.md"
    break
  done

  # 2a. deltas.md Local — first [ ] L-XXX (only if no user bug picked)
  if [ -z "$pick" ]; then
    delta_line=$(grep -nE '^- \[ \] L-[0-9]+' "$REPO/docs/deltas.md" 2>/dev/null | head -1)
    if [ -n "$delta_line" ]; then
      pick_src="docs/deltas.md"
      pick_id=$(echo "$delta_line" | grep -oE 'L-[0-9]+' | head -1)
      pick="$delta_line"
    fi
  fi

  # 2b. iter plan — first Pass not marked shipped/skipped.
  # Requirements Agent format: `## Pass #N — <title> [— SHIPPED]?`
  # We pick first Pass heading whose title does NOT contain SHIPPED / shipped
  # / ✓ / [x …] / [skip] / [blocked. L-008 (2026-05-17): the previous regex
  # `\[x\]` only matched literal `[x]` and missed `[x <SHA>]` (e.g.
  # `[x 3612f8e]`), causing the picker to re-select Pass #2 ten times in a
  # row even though plan.md:51 already carried `[x 3612f8e]`. The pattern
  # `\[x[] ]` now matches both `[x]` and `[x ` (space after x), covering
  # any `[x …]` form as terminal.
  # G-005 (2026-05-18): one-way branch flow (dev → main via promote, never
  # main → dev) means marker state diverges — markers flipped on main during
  # promote never reach dev. Reading local dev plan.md sees stale "open"
  # state for already-shipped passes (hit hard in L-012/L-013, 2 promote
  # conflicts). Fix: read plan.md from origin/main (authoritative marker
  # state) via `git show origin/main:<path>` after a silent `git fetch`.
  # Fall back to local file if `git show` fails (e.g. file not yet on main —
  # someone scaffolded a new iter on dev before first promote).
  if [ -z "$pick" ]; then
    git fetch origin main 2>/dev/null || true
    for plan_file in $(ls -1 "$REPO"/iterations/*/plan.md 2>/dev/null | sort -V | tail -3); do
      plan_rel="${plan_file#$REPO/}"
      # Try origin/main first (authoritative); fall back to local file.
      plan_content=$(git show "origin/main:$plan_rel" 2>/dev/null)
      if [ -z "$plan_content" ]; then
        echo "$(LOG_PREFIX) picker: $plan_rel not on origin/main — falling back to local file"
        plan_content=$(cat "$plan_file" 2>/dev/null)
      fi
      # awk: scan ## Pass headings; print first line that doesn't contain shipped/skip markers
      step=$(echo "$plan_content" | awk -v fn="$plan_rel" '/^## Pass #[0-9]+/ {
        line = $0
        if (line ~ /SHIPPED|shipped|✓|\[x[] ]|\[skip|\[blocked|\[~ /) next
        print fn ":" NR ":" line
        exit
      }')
      if [ -n "$step" ]; then
        pick_src="$plan_rel"
        pick_id=$(echo "$step" | grep -oE 'Pass #[0-9]+' | head -1)
        pick="$step"
        break
      fi
    done
  fi

  # 2c. dev-queue.md
  if [ -z "$pick" ]; then
    qline=$(grep -nE '^### [0-9]+\. \[ \]' "$REPO/docs/dev-queue.md" 2>/dev/null | head -1)
    if [ -n "$qline" ]; then
      pick_src="docs/dev-queue.md"
      pick_id=$(echo "$qline" | grep -oE 'D[0-9]+\.[0-9]+|D[0-9]+|QA-[A-Z0-9.-]+' | head -1)
      pick="$qline"
    fi
  fi

  if [ -z "$pick" ]; then
    nothing_count=$((nothing_count + 1))
    echo "$(LOG_PREFIX) nothing to ship (consecutive empties: $nothing_count); sleeping 30s"
    # Back off when persistently empty: cap at 5 min sleep
    sleep_for=$((30 + nothing_count * 30))
    [ $sleep_for -gt 300 ] && sleep_for=300
    sleep $sleep_for
    continue
  fi
  nothing_count=0

  echo "$(LOG_PREFIX) picking $pick_id from $pick_src"
  echo "$(LOG_PREFIX) item: $pick"

  # G-004: provision per-agent ephemeral worktree BEFORE building brief.
  # Agent id = sanitized iter# + nanosec for uniqueness.
  AGENT_ID="iter${iter_count}-$(date +%s%N | tail -c 7)"
  WORKTREE=$(mk_agent_worktree "$AGENT_ID")
  if [ -z "$WORKTREE" ] || [ ! -d "$WORKTREE" ]; then
    echo "$(LOG_PREFIX) G-004 FATAL: could not create agent worktree for $AGENT_ID; skipping iter"
    sleep 30
    continue
  fi
  echo "$(LOG_PREFIX) G-004 created agent worktree: $WORKTREE (branch agent-$AGENT_ID)"

  # 4. Dispatch claude CLI with a focused brief.
  # Two flavors:
  #   - USER-FILED BUG (pick_id starts with BUG-): claude reads report.md +
  #     screenshot, diagnoses, fixes, writes _processed.md per AGENT_BRIEF.md.
  #   - Other (delta / plan / queue): standard ship workflow with marker flip.
  if [[ "$pick_id" == BUG-* ]]; then
    bug_id="${pick_id#BUG-}"
    brief=$(cat <<EOF
You are a focused bug-fix agent dispatched by the Holon dev-daemon. The
owner filed a bug via /api/v1/admin/bugs; you fix it on the dev branch.
The release worktree (port 3000) only sees the fix after the promotion
cron passes gates and merges dev → main.

## G-004 worktree isolation (IMPORTANT — read first)

You work in your OWN ephemeral worktree at \`$WORKTREE\` on branch
\`agent-$AGENT_ID\`. **Do not \`cd $REPO\`** — that is the daemon's worktree
and concurrent agents work there. Use \`$WORKTREE\` for every file edit, git
add, git commit. Push back to dev via \`git push origin HEAD:dev\` (NOT
\`git push origin agent-$AGENT_ID:dev\` — \`HEAD:dev\` is branch-name-agnostic).
The daemon removes your worktree + branch after you exit.

If \`git push origin HEAD:dev\` is rejected (non-fast-forward — another agent
landed first), do \`git fetch origin dev && git rebase origin/dev && git push
origin HEAD:dev\` and retry once. If rebase conflicts: revert your work
(\`git reset --hard origin/dev\`), write status=needs-human in _processed.md,
exit clean.

## The bug

Bug id: \`$bug_id\`
Bug dir: \`$pick_src\` (this is a symlink from $REPO/bugs/$bug_id → $RELEASE_REPO/bugs/$bug_id)
Read first:
- \`$REPO/bugs/AGENT_BRIEF.md\` — the full bug-fix protocol (your operating manual)
- \`$pick_src/report.md\` — bug description + route + viewport + UA
- \`$pick_src/screenshot.<ext>\` if present — view as image

## Workflow

1. \`cd $WORKTREE\` (your isolated worktree on branch agent-$AGENT_ID, based on dev).
   Do NOT \`git checkout dev\` here — you're already on agent-$AGENT_ID which is
   a worktree-local branch off dev's tip. Do NOT \`git pull\` — daemon already
   pulled before creating your worktree.

2. Per AGENT_BRIEF.md § "Per-bug procedure":
   - Diagnose root cause (Route: field points at the page/endpoint)
   - Apply smallest fix
   - \`pnpm -F web typecheck\` must pass
   - Write \`$pick_src/_processed.md\` with status (fixed/needs-human/not-reproducible),
     diagnosis (1-3 sentences), files changed, verification
   - (\`$pick_src\` is a symlink to release's bugs/; same path resolves from
     your worktree.)

3. **Commit on your agent branch then push to dev**: ONE commit. Message:
   \`fix(daemon-bug): $bug_id · <one-line diagnosis>\`.
   Then \`git push origin HEAD:dev\`. (See G-004 retry section above if pushed.)

4. **Append to \`$REPO/docs/dev-log.md\`**:
   \`\`\`
   ## YYYY-MM-DD HH:MM UTC · $pick_id · <one-line>
   - Worker: dev-daemon bug-fix (iter #$iter_count)
   - Files: <list>
   - Smoke: pnpm -F web typecheck PASS/FAIL
   - Commit: <SHA short>
   - Status: fixed / needs-human / not-reproducible
   \`\`\`

5. The _processed.md you wrote is the marker — bug-watcher reader treats
   it as done. Bug stays in $RELEASE_REPO/bugs/ visible at port 3000;
   _processed.md tells the UI it's handled.

## AGENT_BRIEF.md updates: do them in RELEASE worktree

If you need to update \`bugs/AGENT_BRIEF.md\` (e.g. to add a new skip rule
for a class of bugs you can't auto-fix), do it in the RELEASE worktree,
NOT this dev worktree. Here \`bugs/\` is a symlink to release's bugs/, so
\`git add bugs/AGENT_BRIEF.md\` from dev is a no-op (git sees a symlink,
not a tracked path) and your edit is silently lost (see L-004). Instead:

\`\`\`
cd $RELEASE_REPO
# edit bugs/AGENT_BRIEF.md
git add bugs/AGENT_BRIEF.md
git commit -m "..."
git push origin main
\`\`\`

Then \`cd\` back to your dev worktree to continue the bug fix. Bug
artifacts (\`bug-*/\`) are gitignored on both worktrees — only
AGENT_BRIEF.md is tracked, and it lives in release.

## Hard constraints (verbatim from AGENT_BRIEF.md)

- DO NOT edit CLAUDE.md, docs/architecture, docs/decisions, docs/product, agents/, iterations/.
- DO NOT restart the dev server.
- DO NOT commit on main; we work on dev branch only (promotion cron handles main).
- DO NOT skip git hooks. DO NOT force-push.
- DO NOT use \`git commit --amend\` anywhere (concurrency-unsafe in this shared worktree — L-011/dccb4bf). For the SHA backfill in step 4, use a SEPARATE \`chore(daemon): backfill SHA in dev-log for $pick_id\` commit after the fix. Stage explicit paths only (\`git add <path>\`); NEVER \`git add -A\` / \`git add .\`.
- G-004: stay in \`$WORKTREE\`. Do NOT cd to \`$REPO\` for any reason. Do NOT \`git checkout dev\` (you're on agent-$AGENT_ID by design). Cross-agent isolation depends on this.
- If bug is too vague / ambiguous → status=needs-human, leave Open question block.

End reply ≤80 words: bug id, diagnosis, status, files changed, commit SHA.
EOF
)
  else
    brief=$(cat <<EOF
You are a focused dev agent dispatched by the Holon dev-daemon (continuous
loop). Working on the \`dev\` branch via your OWN ephemeral worktree at
\`$WORKTREE\` (branch \`agent-$AGENT_ID\`, based on dev). Ship ONE item and
exit. The release worktree at \`$RELEASE_REPO\` (port 3000) updates ONLY via
the gated promotion cron — do not touch it.

## G-004 worktree isolation (IMPORTANT — read first)

You work in your OWN ephemeral worktree at \`$WORKTREE\` on branch
\`agent-$AGENT_ID\`. **Do not \`cd $REPO\`** — that is the daemon's worktree
and concurrent agents work there. Use \`$WORKTREE\` for every file edit, git
add, git commit. Push back to dev via \`git push origin HEAD:dev\`. The
daemon removes your worktree + branch after you exit.

If \`git push origin HEAD:dev\` is rejected (non-fast-forward — another agent
landed first), do \`git fetch origin dev && git rebase origin/dev && git push
origin HEAD:dev\` and retry once. If rebase conflicts: \`git reset --hard
origin/dev\`, flip the marker to \`[blocked: rebase-conflict]\`, dev-log,
push the marker change via \`git push origin HEAD:dev\`, exit.

## The item (from $pick_src)

\`\`\`
$pick
\`\`\`

Item id: \`$pick_id\`. Source file: \`$pick_src\` (resolves the same from your
worktree — relative paths under \`iterations/\`, \`docs/\`, \`packages/\`,
\`apps/\` are all present in your worktree exactly as in $REPO).

## Workflow

1. \`cd $WORKTREE\` (your isolated worktree). Do NOT \`git checkout dev\` —
   you're already on \`agent-$AGENT_ID\` which is based on dev's tip. Do
   NOT \`git pull\` — daemon already pulled before creating your worktree.

2. **Claim the item** atomically: in \`$pick_src\`, replace \`[ ]\` with
   \`[~ daemon \$(date -u +%Y-%m-%dT%H:%MZ)]\` on the line containing
   \`$pick_id\`. \`git add\` + commit just that marker change:
   \`chore: daemon claim $pick_id\`. Push to dev: \`git push origin HEAD:dev\`.

3. **Read context**: \`CLAUDE.md\` § Working Patterns + Engineering Rules.
   For the picked item, read the relevant file paths it mentions.

4. **Ship** — smallest correct edit that closes the item. ≤200 LOC,
   ≤5 files. After every meaningful edit: \`pnpm -F api-contract
   typecheck && pnpm -F core typecheck && pnpm -F web typecheck\`.

5. **Verify** the item's done-condition (smoke command if specified, against port 3001 if a route check is needed — port 3000 is release, not affected yet).
   If verification fails: revert (\`git checkout -- <files>\`), flip the
   marker to \`[blocked: <reason>]\` + dev-log entry, commit + push, exit.

6. **Update tracking**:
   - In \`$pick_src\`: flip \`[~ daemon ...]\` to \`[x] <SHA-short>\`.
   - Append to \`docs/dev-log.md\`:
     \`\`\`
     ## YYYY-MM-DD HH:MM UTC · $pick_id · <one-line> (daemon)
     - Worker: dev-daemon (continuous loop, iter #$iter_count, branch=dev)
     - Files: <list>
     - Smoke: <results>
     - Commit: <SHA short>
     - Notes: <root cause / surprises>
     \`\`\`

7. **Commit + push**: ONE focused commit. Message format:
   \`feat|fix(daemon): $pick_id · <one-line summary>\`.
   Then \`git push origin HEAD:dev\`. Release will follow via promotion cron.

## Hard constraints

- DO NOT touch CLAUDE.md, docs/architecture, docs/decisions, docs/product, agents/.
- DO NOT skip git hooks. DO NOT force-push.
- DO NOT commit on main — we're on dev. Promotion handles main.
- DO NOT restart any dev server (HMR handles TS).
- DO NOT use \`git commit --amend\` anywhere (concurrency-unsafe across worktrees — L-011/dccb4bf). For step 6 SHA backfill, use a SEPARATE \`chore(daemon): backfill SHA + flip marker for $pick_id\` commit after the fix commit. Stage explicit paths only (\`git add <path>\`); NEVER \`git add -A\` / \`git add .\`.
- G-004: stay in \`$WORKTREE\`. Do NOT cd to \`$REPO\` for any reason. Do NOT \`git checkout dev\` (you're on agent-$AGENT_ID by design). Push via \`git push origin HEAD:dev\`. Cross-agent isolation depends on this.
- ≤200 LOC across ≤5 files. If item is bigger, split: ship the first
  half, file the second half as a new queue item.
- If you can't ship in 30 min, mark [blocked] + dev-log + exit. Do
  NOT keep trying.

End by replying ≤80 words: item, root cause, files, commit SHA.
EOF
)
  fi

  # Run claude CLI. Output goes to tmux pane stdout (visible if user attaches).
  # We don't capture/parse; trust claude to do the work + push.
  echo "$(LOG_PREFIX) invoking claude -p (this may take 1-10 min) in worktree $WORKTREE ..."
  start_ts=$(date +%s)
  # Run claude FROM the agent worktree so any \$PWD-relative work the agent
  # does lands in isolation even if it forgets the cd step.
  ( cd "$WORKTREE" && claude --dangerously-skip-permissions -p "$brief" 2>&1 | tail -30 )
  end_ts=$(date +%s)
  duration=$((end_ts - start_ts))
  echo "$(LOG_PREFIX) claude returned after ${duration}s"

  # G-004: pull whatever the agent pushed to origin/dev into our local dev,
  # then teardown the agent worktree + branch. --force in case agent left
  # dirty files / uncommitted changes / merge state.
  git pull --ff-only origin "$BRANCH" >/dev/null 2>&1 || \
    echo "$(LOG_PREFIX) G-004 post-agent dev fast-forward failed (non-fatal; next iter retries)"
  cleanup_agent_worktree "$WORKTREE" "$AGENT_ID"
  echo "$(LOG_PREFIX) G-004 cleaned up agent worktree $WORKTREE (branch agent-$AGENT_ID)"

  # 5. Brief courtesy pause so we don't hammer git/CI.
  sleep 5
done

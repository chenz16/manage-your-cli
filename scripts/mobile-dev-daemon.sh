#!/usr/bin/env bash
# mobile-dev-daemon.sh — Holon mobile-track continuous development daemon.
#
# Mirror of scripts/dev-daemon.sh for the mobile track. Bakes in desk's
# L-008 / L-011 / L-012 / L-013 fixes from day 1:
#   - L-008 picker treats [x ...] as terminal marker
#   - L-011 NO git commit --amend (concurrency-unsafe)
#   - L-012 script-on-disk changes require daemon restart (documented)
#   - L-013 picker reads `git show origin/main:plan.md` (always latest)
#
# Lifecycle:
#   tmux new-session -d -s holon-mobile-daemon \
#     "bash /home/chenz/project/holon-engineering-mobile/scripts/mobile-dev-daemon.sh"
#   tmux a -t holon-mobile-daemon            # watch
#   tmux kill-session -t holon-mobile-daemon # stop
#
# Each iteration:
#   1. git pull --ff-only mobile-v1
#   2. Pick the next item (priority order):
#        a) USER-FILED BUG tagged mobile (route contains /mobile, or
#           description starts with [mobile])
#        b) first [ ] M-L-NNN in docs/mobile-deltas.md § Local
#           (reads origin/main view per L-013)
#        c) first [ ] Pass in iterations/M-*/plan.md (origin/main view)
#   3. Stale-claim reaper (>60min [~ ...] reverts to [ ])
#   4. Dispatch claude --dangerously-skip-permissions -p '<brief>'
#   5. Loop with 5s pause.
#
# Cost: ~$0.05-0.20 per iter. At 4-6 iters/hr ~ $10-40/day.

set -u
REPO=/home/chenz/project/holon-engineering-mobile
RELEASE_REPO=/home/chenz/project/holon-engineering
BRANCH=mobile-v1
USER_BUGS_DIR="$RELEASE_REPO/bugs"
cd "$REPO" || { echo "[mobile-daemon FATAL] repo not found: $REPO"; exit 1; }

LOG_PREFIX() { echo "[mobile-daemon $(date -u +%Y-%m-%dT%H:%M:%SZ)]"; }

iter_count=0
nothing_count=0

while true; do
  iter_count=$((iter_count + 1))
  echo "$(LOG_PREFIX) iter #$iter_count begin"

  # 1. Pull mobile-v1 (this daemon's branch)
  git fetch origin "$BRANCH" main >/dev/null 2>&1 || {
    echo "$(LOG_PREFIX) git fetch failed; sleep 60s"
    sleep 60
    continue
  }
  git pull --ff-only origin "$BRANCH" >/dev/null 2>&1 || {
    echo "$(LOG_PREFIX) git pull $BRANCH non-ff; sleep 60s"
    sleep 60
    continue
  }

  # 2. Stale-claim reaper (>60 min [~ ...] reverts to [ ])
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
      sed -i -E 's/\[~ [^ ]+ [0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}Z\]/[ ]/' "$file"
      git add "$file"
      git commit -m "chore(mobile-daemon): reap stale claim in ${file##*/}" >/dev/null 2>&1
      git push origin "$BRANCH" >/dev/null 2>&1
    fi
  done < <(grep -rnE '\[~ [^ ]+ [0-9]{4}-[0-9]{2}-[0-9]{2}T' docs/ iterations/M001-* 2>/dev/null || true)

  # 3. Pick next item
  pick=""
  pick_src=""
  pick_id=""

  # 3.0 USER-FILED MOBILE BUG — highest priority. Filter by route /mobile*
  # OR description containing [mobile] OR title containing [mobile].
  for bug_dir in $(ls -1d "$USER_BUGS_DIR"/bug-* 2>/dev/null | sort); do
    [ -f "$bug_dir/_processed.md" ] && continue
    [ -f "$bug_dir/_no_dispatch.md" ] && continue
    [ ! -f "$bug_dir/report.md" ] && continue
    # Skip E2E test artifacts (same as desk daemon)
    ua_line=$(grep -m1 '^\*\*User-Agent:' "$bug_dir/report.md" 2>/dev/null | head -c 300)
    if echo "$ua_line" | grep -qiE 'Playwright|HeadlessChrome|puppeteer'; then
      continue
    fi
    # Mobile filter: route field starts with /mobile OR description / title contains [mobile]
    route_line=$(grep -m1 '^\*\*Route:' "$bug_dir/report.md" 2>/dev/null)
    desc_block=$(head -30 "$bug_dir/report.md" 2>/dev/null)
    if echo "$route_line" | grep -qE '/mobile' || echo "$desc_block" | grep -qiE '\[mobile\]|mobile bug:'; then
      pick_src="$USER_BUGS_DIR/$(basename "$bug_dir")"
      pick_id="MOBILE-BUG-$(basename "$bug_dir")"
      pick="$bug_dir/report.md"
      break
    fi
  done

  # 3a. mobile-deltas.md Local — read from LOCAL file post-pull.
  # Mobile's L-013-equivalent fix: markers flip on mobile-v1 (daemon's
  # branch) BEFORE PROMOTE moves them to main. So origin/main view is
  # ALWAYS stale relative to mobile-v1. Local file (after `git pull
  # --ff-only origin mobile-v1` at iter start) is in sync with origin/
  # mobile-v1 — that's the freshest authoritative view.
  #
  # Pickable markers: `[ ]` (untouched) AND `[design-done: <SHA>]`
  # (Design Agent finished its spec — same item is now ready for the
  # Dev Agent code pass; per M003 Pass #3).
  if [ -z "$pick" ]; then
    delta_line=$(grep -nE '^- (\[ \]|\[design-done:[^]]*\]) M-L-[0-9]+' "$REPO/docs/mobile-deltas.md" 2>/dev/null | head -1)
    if [ -n "$delta_line" ]; then
      pick_src="docs/mobile-deltas.md"
      pick_id=$(echo "$delta_line" | grep -oE 'M-L-[0-9]+' | head -1)
      pick="$delta_line"
    fi
  fi

  # 3b. iter plan — first Pass not marked shipped/skipped (local file post-pull).
  # Mobile uses iterations/M001-* (and later M002, etc.) — distinct from desk's iterations/NNN-*.
  if [ -z "$pick" ]; then
    for plan_file in $(ls -1 "$REPO"/iterations/M*/plan.md 2>/dev/null | sort -V | tail -3); do
      # L-008: \[x[] ] matches both [x] and [x ... (covers [x SHA] form)
      # [~ ...] also treated as terminal (claimed = don't re-pick)
      step=$(awk '/^## Pass #[0-9]+/ {
        line = $0
        if (line ~ /SHIPPED|shipped|✓|\[x[] ]|\[skip|\[blocked|\[~ /) next
        print FILENAME ":" NR ":" line
        exit
      }' "$plan_file")
      if [ -n "$step" ]; then
        pick_src="${plan_file#$REPO/}"
        pick_id=$(echo "$step" | grep -oE 'Pass #[0-9]+' | head -1)
        pick="$step"
        break
      fi
    done
  fi

  if [ -z "$pick" ]; then
    nothing_count=$((nothing_count + 1))
    echo "$(LOG_PREFIX) nothing to ship (consecutive empties: $nothing_count); sleeping"
    sleep_for=$((30 + nothing_count * 30))
    [ $sleep_for -gt 300 ] && sleep_for=300
    sleep $sleep_for
    continue
  fi
  nothing_count=0

  echo "$(LOG_PREFIX) picking $pick_id from $pick_src"
  echo "$(LOG_PREFIX) item: $pick"

  # 3.5 Race-check (M-G-008): re-fetch origin/mobile-v1 and verify the
  # marker for $pick_id is still [ ] (or, in the no-fetch case where we
  # picked from a file that already had [~ ...], that the [~ ...] is OUR
  # own from this very iter). If another claimer raced in between our
  # pick and now, abort and loop. Costs one network round-trip but
  # prevents the duplicate-claim → wasted-claude-p pattern that hit
  # M-L-005 and M-L-007.
  if [[ "$pick_id" != MOBILE-BUG-* ]]; then
    git fetch origin "$BRANCH" >/dev/null 2>&1 || true
    fresh_marker=$(git show "origin/${BRANCH}:${pick_src#$REPO/}" 2>/dev/null | grep -F "$pick_id" | head -1)
    if echo "$fresh_marker" | grep -qE '\[x [a-f0-9]|\[skip|\[blocked|\[~ '; then
      echo "$(LOG_PREFIX) race-check: $pick_id is no longer open on origin/${BRANCH} (saw: $(echo "$fresh_marker" | head -c 120)…); aborting iter, loop"
      sleep 5
      continue
    fi
    echo "$(LOG_PREFIX) race-check: $pick_id still open on origin/${BRANCH}, proceeding"
  fi

  # 3.6 Phase determination (M003 Pass #3 · `[design]` tag routing).
  #   bug    → user-filed mobile bug fix
  #   design → M-L tagged `[design]` and not yet design-done; dispatch
  #            Design Agent to produce design-spec.md (no code).
  #   dev    → everything else, including M-Ls already marked
  #            `[design-done: <SHA>]` (spec exists; ready for code).
  # Design-tag detection is scoped to docs/mobile-deltas.md to avoid
  # matching the literal string "[design]" inside iter-plan prose.
  phase="dev"
  if [[ "$pick_id" == MOBILE-BUG-* ]]; then
    phase="bug"
  elif [ "$pick_src" = "docs/mobile-deltas.md" ]; then
    if echo "$pick" | grep -qE '\[design-done:'; then
      phase="dev"
    elif echo "$pick" | grep -qE '\[design\]'; then
      phase="design"
    fi
  fi
  CURRENT_ITER=$(ls -1d "$REPO"/iterations/M*/ 2>/dev/null | sort -V | tail -1 | sed -E 's|.*/(M[^/]+)/?$|\1|')
  echo "$(LOG_PREFIX) phase=$phase current_iter=$CURRENT_ITER"

  # 4. Dispatch claude CLI with focused brief.
  if [[ "$pick_id" == MOBILE-BUG-* ]]; then
    bug_id="${pick_id#MOBILE-BUG-}"
    brief=$(cat <<EOF
You are the mobile-track bug-fix agent dispatched by mobile-dev-daemon.
Owner filed a mobile bug; fix it on \`mobile-v1\` branch in worktree:
\`$REPO\`. The release worktree (port 3000, main branch) only sees fixes
after mobile-promote.sh passes gates and merges.

## The bug

Bug id: \`$bug_id\`
Bug dir: \`$pick_src\`
Read first:
- \`$REPO/bugs/AGENT_BRIEF.md\` (shared with desk)
- \`$pick_src/report.md\`
- \`$pick_src/screenshot.<ext>\` if present

## Workflow

1. \`cd $REPO && git checkout mobile-v1 && git pull --ff-only origin mobile-v1\`.
2. Diagnose root cause (look at apps/mobile/ files referenced in Route).
3. Apply smallest fix.
4. \`pnpm -F mobile typecheck\` PASS.
5. Write \`$pick_src/_processed.md\` (status / diagnosis / files / verification).
6. \`git add <explicit paths>\` (NEVER \`-A\` or \`.\`).
7. ONE commit on mobile-v1: \`fix(mobile-daemon-bug): $bug_id · <diagnosis>\`. \`git push origin mobile-v1\`.
8. Append entry to \`$REPO/docs/mobile-dev-log.md\` (see format in that file's header).

## Constraints (verbatim from AGENT_BRIEF.md + mobile-specific)

- DO NOT edit CLAUDE.md, docs/architecture, docs/decisions, docs/product, agents/.
- DO NOT touch apps/web/ (desk territory) or iterations/NNN-* (desk iters).
- DO NOT commit on main; mobile-v1 only. Promote handles main.
- DO NOT skip git hooks. DO NOT force-push.
- DO NOT use \`git commit --amend\` (L-011 — concurrency-unsafe in shared worktree).
- If bug is too vague → status=needs-human, leave Open question block, exit.

End reply ≤80 words: bug id, diagnosis, status, files changed, commit SHA.
EOF
)
  elif [ "$phase" = "design" ]; then
    brief=$(cat <<EOF
You are the mobile-track DESIGN agent dispatched by mobile-dev-daemon.
Working on the \`mobile-v1\` branch in worktree: \`$REPO\`. Your role
definition is \`docs/mobile-agents/design-agent.md\` — read it FIRST.
You produce a design-spec.md ONLY; you must NOT touch code or CSS.

## The item (from $pick_src — tagged \`[design]\`)

\`\`\`
$pick
\`\`\`

Item id: \`$pick_id\`. Current iter: \`$CURRENT_ITER\`.

## Workflow

1. \`cd $REPO && git checkout mobile-v1 && git pull --ff-only origin mobile-v1\`.
2. **Claim**: in \`$pick_src\`, replace \`[ ]\` on the line containing \`$pick_id\` with \`[~ design-agent \$(date -u +%Y-%m-%dT%H:%MZ)]\`. \`git add\` + commit \`chore(mobile-design-agent): claim $pick_id [design]\`. Push to origin/mobile-v1.
3. **Read inputs IN ORDER** (per docs/mobile-agents/design-agent.md § Inputs):
   a. \`docs/mobile-architecture-principles.md\` (doctrine — 4-tab cap, thin-shell, desk-tokens-inside-frame, mibusy-dark-outside).
   b. \`apps/web/app/globals.css\` (desk's design tokens — source of truth).
   c. \`src/ui-mock/_shared/components.css\` (desk component patterns — port class names + rhythm, do NOT redesign).
   d. \`/home/chenz/project/mibusy/apps/web/components/AppShell.tsx\` + \`/home/chenz/project/mibusy/apps/web/app/globals.css\` (mibusy mobile frame — phone-shell wrapper only).
   e. The full M-L text above.
   f. Current state of the target surface (read the source so the spec is a diff, not greenfield).
4. **Design-sync diff (M-G-006)**: grep desk's globals.css for every token the M-L references; confirm \`apps/mobile/app/globals.css\` matches. If drift detected: STOP, file a new \`M-L-NNN [design]\` token-sync delta in \`docs/mobile-deltas.md\`, flip current marker to \`[blocked: token-drift — see M-L-NNN]\`, dev-log, exit. Token-sync ships before the original M-L.
5. **Write the spec** at \`iterations/$CURRENT_ITER/design-specs/$pick_id-spec.md\` using \`docs/mobile-agents/design-spec-template.md\` as the boilerplate. Fill EVERY section (no "TBD" outside §7). Concrete dimensions (px or token); token references only (\`var(--paper)\`, never raw hex); exact desk class names; enumerate reachable states; smoke checks are runnable commands.
6. **Commit the spec** (ONE commit, explicit paths only): \`design(mobile-design-agent): spec for $pick_id · <one-line>\`. \`git push origin mobile-v1\`. Capture the SHA-short.
7. **Marker flip**: in \`$pick_src\`, replace the \`[~ design-agent ...]\` claim on the line containing \`$pick_id\` with \`[design-done: <SHA-short-from-step-6>]\`. SEPARATE commit (NOT --amend, L-011): \`chore(mobile-design-agent): mark $pick_id design-done + SHA backfill\`. Push.
8. **Append to \`docs/mobile-dev-log.md\`**:
   \`\`\`
   ## YYYY-MM-DD HH:MM UTC · $pick_id design-pass · <one-line> (mobile-design-agent)
   - Worker: mobile-design-agent (dispatched by mobile-dev-daemon iter #$iter_count, branch=mobile-v1)
   - Spec: iterations/$CURRENT_ITER/design-specs/$pick_id-spec.md
   - Tokens referenced: <count> (all from desk's globals.css)
   - Drift detected: yes / no
   - Open questions left to Dev: <count> (see §7 of spec)
   - Marker: [design-done: <SHA-short>]
   - Commits: <spec-SHA>, <marker-flip-SHA>
   \`\`\`
   Stage + commit + push as part of step 7's marker-flip commit (single commit covers marker-flip + dev-log entry).
9. Final message ≤80 words: item, spec path, tokens count, drift y/n, marker, commit SHAs.

## Hard constraints (verbatim from docs/mobile-agents/design-agent.md § Boundaries)

- NEVER edit production code (apps/mobile/**, packages/**, src/**). Spec only.
- NEVER modify CSS files. Tokens are desk-owned; if a token is missing, file a desk-side delta requesting it.
- NEVER edit doctrine: CLAUDE.md, docs/architecture, docs/decisions, docs/product, agents/, docs/mobile-architecture-principles.md.
- NEVER design from scratch when desk has a pattern. Grep \`src/ui-mock/_shared/components.css\` first; port the class names + rhythm.
- NEVER over-specify. §7 Open Questions is Dev Agent's escape hatch — surface genuine choices there, ≤3 items each with a recommended default.
- DO NOT skip git hooks. DO NOT force-push. DO NOT \`git commit --amend\` (L-011). Stage explicit paths only; NEVER \`-A\` or \`.\`.
- DO NOT commit on main — mobile-v1 only. Promote handles main.
- If you can't ship in 30 min, mark \`[blocked: <reason>]\`, write Q: block in \`iterations/$CURRENT_ITER/design-questions.md\`, dev-log entry, exit.

After this design pass lands, the daemon's next iter will re-pick \`$pick_id\` (now marked \`[design-done: ...]\`) and dispatch the Dev Agent for the code pass with your spec attached.
EOF
)
  else
    brief=$(cat <<EOF
You are the mobile-track dev agent dispatched by mobile-dev-daemon
(continuous loop). Working on the \`mobile-v1\` branch in worktree:
\`$REPO\`. Ship ONE item and exit.

## The item (from $pick_src)

\`\`\`
$pick
\`\`\`

Item id: \`$pick_id\`.

## Workflow

1. \`cd $REPO && git checkout mobile-v1 && git pull --ff-only origin mobile-v1\`.
2. **Claim the item**: in \`$pick_src\`, replace the existing marker on the line containing \`$pick_id\` — either \`[ ]\` (no design pass) OR \`[design-done: <SHA>]\` (design pass already complete) — with \`[~ mobile-daemon \$(date -u +%Y-%m-%dT%H:%MZ)]\`. \`git add\` + commit \`chore(mobile-daemon): claim $pick_id\`. Push to origin/mobile-v1.
3. **Read context**: \`CLAUDE.md\` § Working Patterns + Engineering Rules + iterations/M001-mobile-bootstrap/{requirements,plan}.md. Read any file paths the item mentions. If the prior marker was \`[design-done: <SHA>]\`: READ \`iterations/$CURRENT_ITER/design-specs/$pick_id-spec.md\` and follow its §2–§5 (dimensions / tokens / DOM / states) and §6 smoke checks verbatim — the design spec is the contract.
4. **Ship**: smallest correct edit. ≤200 LOC, ≤5 files. After every meaningful edit: \`pnpm -F api-contract typecheck && pnpm -F core typecheck && pnpm -F mobile typecheck\` (skip mobile if package doesn't exist yet — bootstrap case).
5. **Verify** the done-condition (smoke command if specified, port 3002 for routes).
   If fails: revert (\`git checkout -- <files>\`), flip marker to \`[blocked: <reason>]\` + mobile-dev-log entry, commit + push, exit.
6. **Update tracking**:
   - In \`$pick_src\`: flip \`[~ mobile-daemon ...]\` to \`[x] <SHA-short>\`.
   - Append to \`docs/mobile-dev-log.md\`:
     \`\`\`
     ## YYYY-MM-DD HH:MM UTC · $pick_id · <one-line> (mobile-daemon)
     - Worker: mobile-daemon (continuous loop, iter #$iter_count, branch=mobile-v1)
     - Files: <list>
     - Smoke: <results>
     - Commit: <SHA short>
     - Notes: <root cause / surprises>
     \`\`\`
7. **Commit + push**: ONE focused commit. Message: \`feat|fix(mobile-daemon): $pick_id · <one-line>\`. \`git push origin mobile-v1\`.
   If you need a SHA backfill commit for step 6: use a SEPARATE \`chore(mobile-daemon): backfill SHA + flip marker for $pick_id\` commit (NOT --amend; L-011).

## Hard constraints

- DO NOT touch CLAUDE.md, docs/architecture, docs/decisions, docs/product, agents/.
- DO NOT touch apps/web/ (desk territory) or iterations/NNN-* (desk iters: 001*, 002*, 003*, ..., 010*).
- DO NOT skip git hooks. DO NOT force-push.
- DO NOT commit on main — mobile-v1 only. Promote handles main.
- DO NOT use \`git commit --amend\` (L-011). Stage explicit paths only; NEVER \`-A\` or \`.\`.
- If cross-package edits to packages/api-contract or packages/core are required: STOP and file as M-G-NNN delta requesting desk-side change. Mobile is consumer-only.
- ≤200 LOC across ≤5 files. If item is bigger, split: ship first half, file second half as new queue item.
- If you can't ship in 30 min, mark \`[blocked: <reason>]\` + mobile-dev-log + exit.

End reply ≤80 words: item, root cause, files, commit SHA.
EOF
)
  fi

  echo "$(LOG_PREFIX) invoking claude -p (this may take 1-10 min) ..."
  start_ts=$(date +%s)
  claude --dangerously-skip-permissions -p "$brief" 2>&1 | tail -30
  end_ts=$(date +%s)
  duration=$((end_ts - start_ts))
  echo "$(LOG_PREFIX) claude returned after ${duration}s"

  sleep 5
done

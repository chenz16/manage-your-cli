#!/usr/bin/env bash
# promote.sh — gated dev → main promotion for the release worktree.
#
# Per user 2026-05-17: 你 release 要定时比如 6min 一次 或者比较重要的修订
# 结束 确保你 release 的不会太差（基本功能要能 function 不能拿开发过程中
# 的东西拿过来）.
#
# Run by an in-session cron every 6 min. Cleanly idempotent:
#  - If origin/dev has no new commits beyond origin/main → no-op, exit 0
#  - Else: run quality gates against the DEV worktree (port 3001)
#  - If gates pass → no-ff merge origin/dev into main, push origin/main
#  - If gates fail → log + exit 1 (release stays clean)
#
# Logs to /tmp/holon-promote.log so cron tail can inspect.

set -u
set -o pipefail
LOG=/tmp/holon-promote.log
RELEASE=/home/chenz/project/holon-engineering
DEV=/home/chenz/project/holon-engineering-dev
DEV_PORT=3001
RELEASE_PORT=3000

ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }
log() { echo "[promote $(ts)] $*" | tee -a "$LOG"; }

cd "$RELEASE" || { log "FATAL: release worktree not found"; exit 1; }

# 1. Fetch both branches
log "fetching origin"
git fetch origin main dev 2>&1 | tee -a "$LOG" | tail -3

# 2. Compare: any commits on dev not yet on main?
ahead=$(git rev-list --count origin/main..origin/dev)
if [ "$ahead" = "0" ]; then
  log "no new dev commits to promote (ahead=0); exit clean"
  exit 0
fi
log "$ahead dev commits ahead of main → run gates"

# 3. Gates against DEV worktree (port 3001 is where dev work surfaces)
cd "$DEV"

log "gate 1/3: typecheck"
if ! pnpm -F api-contract typecheck >/dev/null 2>&1; then
  log "FAIL: api-contract typecheck"
  exit 1
fi
if ! pnpm -F core typecheck >/dev/null 2>&1; then
  log "FAIL: core typecheck"
  exit 1
fi
if ! pnpm -F web typecheck >/dev/null 2>&1; then
  log "FAIL: web typecheck"
  exit 1
fi
log "gate 1/3 PASS"

log "gate 2/3: 8 routes on dev (port $DEV_PORT)"
selfheal_used=0
for r in / /inbound /deliverables /members /skills /references /templates /me; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${DEV_PORT}${r}")
  if [ "$code" != "200" ] && [ "$selfheal_used" = "0" ]; then
    rel_code=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${RELEASE_PORT}${r}")
    if [ "$rel_code" = "200" ]; then
      log "gate 2: route $r is $code on dev but $rel_code on release — HMR cache likely corrupted; running dev-self-heal.sh"
      if bash "$RELEASE/scripts/dev-self-heal.sh" 2>&1 | tee -a "$LOG" | tail -5; then
        selfheal_used=1
        # retry this route once after restart
        code=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${DEV_PORT}${r}")
      fi
    fi
  fi
  if [ "$code" != "200" ]; then
    log "FAIL: route $r returned $code on dev (selfheal_used=$selfheal_used)"
    exit 1
  fi
done
log "gate 2/3 PASS (8/8 routes 200 on dev; selfheal_used=$selfheal_used)"

log "gate 3/3: 4 catalog APIs on dev"
for ep in /api/v1/skills /api/v1/templates /api/v1/references; do
  body=$(curl -s "http://localhost:${DEV_PORT}${ep}")
  count=$(echo "$body" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('items',[])))" 2>/dev/null || echo "PARSE_FAIL")
  if [ "$count" = "PARSE_FAIL" ] || [ -z "$count" ] || [ "$count" = "0" ]; then
    log "FAIL: $ep returned $count items (expected ≥1)"
    exit 1
  fi
done
me_body=$(curl -s "http://localhost:${DEV_PORT}/api/v1/me")
me_check=$(echo "$me_body" | python3 -c "import sys,json; d=json.load(sys.stdin); print('ok' if d.get('id') and d.get('role_name')=='owner_assistant' else 'bad')" 2>/dev/null)
if [ "$me_check" != "ok" ]; then
  log "FAIL: /api/v1/me missing structural fields (id + role_name='owner_assistant')"
  exit 1
fi
log "gate 3/3 PASS (catalogs non-empty, /me structural fields present)"

# 4. All gates passed — promote
cd "$RELEASE"
log "all gates PASS — promoting origin/dev → main (--no-ff)"

# Ensure release worktree is on main and clean
current=$(git rev-parse --abbrev-ref HEAD)
if [ "$current" != "main" ]; then
  log "FAIL: release worktree on branch '$current' (expected main); aborting promotion"
  log "  → root cause is almost always an ad-hoc agent that ran 'git checkout -b $current' in $RELEASE"
  log "  → fix: switch release back to main ('cd $RELEASE && git checkout main'), then re-dispatch the agent"
  log "    using the per-agent worktree convention (see scripts/AGENT_WORKTREE_CONVENTION.md § Manual dispatches):"
  log "      git worktree add /tmp/holon-iter\${N}-pass\${P} -b <branch> origin/main"
  log "      ( cd /tmp/holon-iter\${N}-pass\${P} && <run the agent there> )"
  log "    NEVER 'git checkout -b' in $RELEASE — it occupies release and blocks promote (L-064)"
  exit 1
fi
if ! git diff --quiet HEAD; then
  log "WARN: release worktree has uncommitted changes; will stash"
  git stash push -m "promote-auto-stash $(ts)" 2>&1 | tail -2
fi

merge_out=$(git merge --no-ff -m "promote: dev→main $(ts)" origin/dev 2>&1)
merge_rc=$?
echo "$merge_out" | tee -a "$LOG" | tail -5

# L-007: auto-resolve docs/dev-log.md conflicts (both sides append-only —
# we can safely strip conflict markers to keep both halves). Limited to
# this single file; any other conflict still halts.
if [ $merge_rc -ne 0 ] && git status --short 2>/dev/null | grep -q '^UU docs/dev-log.md$'; then
  conflict_count=$(git status --short 2>/dev/null | grep -c '^UU ')
  if [ "$conflict_count" = "1" ]; then
    log "auto-resolving docs/dev-log.md conflict (append-only, both halves kept)"
    sed -i '/^<<<<<<< HEAD$/d; /^=======$/d; /^>>>>>>> /d' docs/dev-log.md
    git add docs/dev-log.md
    commit_out=$(git commit --no-edit 2>&1)
    commit_rc=$?
    if [ $commit_rc -eq 0 ]; then
      log "auto-resolve OK; continuing promotion"
      merge_rc=0
    fi
  fi
fi

if [ $merge_rc -ne 0 ]; then
  log "FAIL: merge failed (rc=$merge_rc) — needs manual fix"
  exit 1
fi
log "merge OK; pushing origin/main"
push_out=$(git push origin main 2>&1)
push_rc=$?
echo "$push_out" | tee -a "$LOG" | tail -3
if [ $push_rc -ne 0 ]; then
  log "FAIL: push failed (rc=$push_rc)"
  exit 1
fi
log "✓ promoted $ahead commits dev→main"

# 5. If pnpm-lock.yaml changed in promoted commits, reinstall in release worktree
if git diff --name-only HEAD@{1} HEAD | grep -qE "pnpm-lock|package\.json"; then
  log "pnpm-lock or package.json changed — reinstall in release"
  pnpm install --frozen-lockfile 2>&1 | tail -5
fi

# 6. Release dev server (port 3000) HMR picks up on next file watch tick. No explicit restart.
log "done · release at port $RELEASE_PORT now serves $(git rev-parse --short HEAD)"
exit 0

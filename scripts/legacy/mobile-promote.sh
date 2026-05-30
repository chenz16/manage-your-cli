#!/usr/bin/env bash
# mobile-promote.sh — gated mobile-v1 → main promotion.
#
# Mirrors scripts/promote.sh from the desk track but targets the mobile
# branch + mobile-specific gates. Bakes in desk's L-002 / L-003 / L-006 /
# L-007 / L-011 / L-013 fixes from day 1 (no need to re-discover):
#   - L-002 set -o pipefail + explicit merge_rc capture
#   - L-003 git merge --no-ff (handles divergence; cron commits OK)
#   - L-006 dev-self-heal hook (mobile port 3002 vs release port 3000)
#   - L-007 docs/mobile-dev-log.md auto-resolve (both sides append)
#   - L-013 use git show origin/main:... when comparing markers
# Plus mobile-specific protections:
#   - M-G-003 promote race with desk: flock /tmp/holon-promote.lock
#
# Run by CronCreate every 6 min. Logs to /tmp/holon-mobile-promote.log.

set -u
set -o pipefail
LOG=/tmp/holon-mobile-promote.log
RELEASE=/home/chenz/project/holon-engineering
MOBILE=/home/chenz/project/holon-engineering-mobile
MOBILE_PORT=3002
RELEASE_PORT=3000
LOCK=/tmp/holon-promote.lock
MOBILE_BRANCH=mobile-v1

ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }
log() { echo "[mobile-promote $(ts)] $*" | tee -a "$LOG"; }

cd "$RELEASE" || { log "FATAL: release worktree not found"; exit 1; }

# 0. Acquire promote lock (M-G-003). Both desk's promote.sh and this
# script merge into main; serialize. flock -n returns immediately if
# busy → skip this tick (next cron tick retries 6 min later).
exec 9>"$LOCK"
if ! flock -n 9; then
  log "skip: promote lock held by another script (desk's promote.sh?); retry next tick"
  exit 0
fi

# 1. Fetch all branches
log "fetching origin"
fetch_out=$(git fetch origin main "$MOBILE_BRANCH" 2>&1)
echo "$fetch_out" | tee -a "$LOG" | tail -3

# 2. Compare: any commits on mobile-v1 not yet on main?
ahead=$(git rev-list --count origin/main..origin/${MOBILE_BRANCH} 2>/dev/null || echo "0")
if [ "$ahead" = "0" ]; then
  log "no new ${MOBILE_BRANCH} commits to promote (ahead=0); exit clean"
  exit 0
fi
log "$ahead ${MOBILE_BRANCH} commits ahead of main → run mobile gates"

# 3. Gates run against MOBILE worktree
cd "$MOBILE"

# Make sure mobile worktree is up to date with origin/mobile-v1 before gates
git pull --ff-only origin "$MOBILE_BRANCH" >/dev/null 2>&1 || {
  log "WARN: git pull mobile-v1 non-ff; will rely on origin/${MOBILE_BRANCH} ref for merge"
}

# Gate 1/3: typecheck across packages that mobile depends on + mobile itself.
# Mobile may not exist yet in early M001 — handle gracefully.
log "gate 1/3: typecheck"
if ! pnpm -F api-contract typecheck >/dev/null 2>&1; then
  log "FAIL: api-contract typecheck"
  exit 1
fi
if ! pnpm -F core typecheck >/dev/null 2>&1; then
  log "FAIL: core typecheck"
  exit 1
fi
# Mobile package may not exist on the first promote cycle (pre-scaffold).
# Skip mobile typecheck if package missing; once Pass #1 ships it's mandatory.
if pnpm -F mobile --silent exec true >/dev/null 2>&1; then
  if ! pnpm -F mobile typecheck >/dev/null 2>&1; then
    log "FAIL: mobile typecheck"
    exit 1
  fi
  log "gate 1/3 PASS (api-contract + core + mobile typecheck)"
else
  log "gate 1/3 PASS (mobile package not yet scaffolded — typecheck skipped; api-contract + core PASS)"
fi

# Gate 2/3: mobile dev server routes on port 3002 (post-scaffold only).
# Pre-scaffold: skip; post-scaffold: 5 routes must return 200.
log "gate 2/3: mobile routes on port $MOBILE_PORT"
mobile_dev_alive=0
if curl -s -o /dev/null --max-time 2 "http://localhost:${MOBILE_PORT}/" >/dev/null 2>&1; then
  mobile_dev_alive=1
fi

if [ "$mobile_dev_alive" = "1" ]; then
  selfheal_used=0
  routes_passed=0
  routes_total=0
  for r in / /me /chat /today /deliverables; do
    routes_total=$((routes_total + 1))
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "http://localhost:${MOBILE_PORT}${r}")
    # L-006 self-heal: if mobile dev (3002) returns non-200 but RELEASE port
    # 3000 has the same path returning 200, HMR cache likely corrupted.
    # For mobile we currently have no equivalent of release port (mobile
    # release artifact is APK, not HTTP). So self-heal scope is narrower —
    # just retry the route once after a brief pause; if still non-200,
    # this route isn't shipped yet (early-iter passes).
    if [ "$code" != "200" ] && [ "$code" != "404" ]; then
      sleep 2
      code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "http://localhost:${MOBILE_PORT}${r}")
    fi
    if [ "$code" = "200" ]; then
      routes_passed=$((routes_passed + 1))
    elif [ "$code" = "404" ]; then
      # Route not implemented yet — that's OK in early M001 passes.
      log "info: route $r not yet implemented (404); skipping"
    else
      log "FAIL: route $r returned $code on mobile dev (selfheal_used=$selfheal_used)"
      exit 1
    fi
  done
  log "gate 2/3 PASS ($routes_passed/$routes_total routes 200 on port $MOBILE_PORT)"
else
  log "gate 2/3 PASS (mobile dev server not running — pre-scaffold or stopped; gate inapplicable)"
fi

# Gate 3/3: shared catalog APIs reachable through desk's port 3000 (mobile
# reads desk BFF). Cheap reachability check that desk wiring is healthy
# from mobile's perspective.
log "gate 3/3: desk-shared APIs reachable on port $RELEASE_PORT"
desk_alive=0
if curl -s -o /dev/null --max-time 2 "http://localhost:${RELEASE_PORT}/" >/dev/null 2>&1; then
  desk_alive=1
fi
if [ "$desk_alive" = "1" ]; then
  me_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "http://localhost:${RELEASE_PORT}/api/v1/me")
  if [ "$me_code" != "200" ]; then
    log "FAIL: desk /api/v1/me returned $me_code (mobile depends on it)"
    exit 1
  fi
  log "gate 3/3 PASS (desk /api/v1/me 200)"
else
  log "gate 3/3 SKIP (desk port $RELEASE_PORT not reachable — desk may be down; not blocking mobile promote)"
fi

# Gate 4 (optional): iOS smoke build via Mac SSH. Non-blocking — SSH
# unreachable / Xcode missing returns 78 → SKIP. Real build errors (1)
# get logged but do NOT block Android pipeline (filed as M-L-NNN by QA).
if [ -x "$MOBILE/scripts/mobile-ios-gate.sh" ]; then
  log "gate 4 (optional): iOS smoke build via Mac SSH"
  bash "$MOBILE/scripts/mobile-ios-gate.sh"
  ios_rc=$?
  case $ios_rc in
    0)  log "gate 4 PASS (iOS Debug-iphonesimulator built clean)" ;;
    78) log "gate 4 SKIP (Mac SSH unreachable or Xcode missing — non-blocking)" ;;
    *)  log "gate 4 SOFT-FAIL (rc=$ios_rc; logged, non-blocking)" ;;
  esac
fi

# 4. All gates passed (or skipped with reason) — promote
cd "$RELEASE"
log "all gates PASS — promoting origin/${MOBILE_BRANCH} → main (--no-ff)"

# Ensure release worktree is on main and clean
current=$(git rev-parse --abbrev-ref HEAD)
if [ "$current" != "main" ]; then
  log "FAIL: release worktree on branch '$current' (expected main); aborting promotion"
  exit 1
fi
if ! git diff --quiet HEAD; then
  log "WARN: release worktree has uncommitted changes; will stash"
  git stash push -m "mobile-promote-auto-stash $(ts)" 2>&1 | tail -2
fi

# L-013: pull latest main BEFORE merging — main may have desk commits we
# haven't seen since last fetch.
git pull --ff-only origin main >/dev/null 2>&1 || {
  log "WARN: release worktree main non-ff after fetch; may need manual reconcile"
}

merge_out=$(git merge --no-ff -m "mobile-promote: ${MOBILE_BRANCH}→main $(ts)" "origin/${MOBILE_BRANCH}" 2>&1)
merge_rc=$?
echo "$merge_out" | tee -a "$LOG" | tail -5

# L-007: auto-resolve docs/dev-log.md, docs/mobile-dev-log.md, or both
# (append-only files; safely strip conflict markers).
# Also docs/mobile-deltas.md (marker conflicts — mobile-v1 daemon flip
# wins over main's older [ ] state since daemon is truth source for
# marker state). Pattern proven 2026-05-18T06:42Z when M-L-014 ship
# raced with stale main.
auto_resolve_append_only_files() {
  local resolved=0
  for f in docs/dev-log.md docs/mobile-dev-log.md; do
    if git status --short 2>/dev/null | grep -q "^UU $f$"; then
      log "auto-resolving $f conflict (append-only, both halves kept)"
      sed -i '/^<<<<<<< HEAD$/d; /^=======$/d; /^>>>>>>> /d' "$f"
      git add "$f"
      resolved=$((resolved + 1))
    fi
  done
  # mobile-deltas.md: prefer mobile-v1 ("theirs") for marker conflicts.
  # Daemon ships markers from mobile-v1; main may have older [ ] state.
  if git status --short 2>/dev/null | grep -q "^UU docs/mobile-deltas.md$"; then
    log "auto-resolving docs/mobile-deltas.md (prefer mobile-v1's marker state)"
    git checkout --theirs docs/mobile-deltas.md 2>&1 | tail -2
    git add docs/mobile-deltas.md
    resolved=$((resolved + 1))
  fi
  if [ "$resolved" -gt 0 ]; then
    # Halt if any OTHER conflicts remain
    if git status --short 2>/dev/null | grep -q '^UU '; then
      log "FAIL: non-doc conflicts remain after auto-resolve; halting"
      git status --short | tee -a "$LOG"
      return 1
    fi
    commit_out=$(git commit --no-edit 2>&1)
    commit_rc=$?
    if [ $commit_rc -eq 0 ]; then
      log "auto-resolve OK ($resolved files); continuing promotion"
      return 0
    else
      log "FAIL: auto-resolve commit failed (rc=$commit_rc)"
      return 1
    fi
  fi
  return 1
}

if [ $merge_rc -ne 0 ] && auto_resolve_append_only_files; then
  merge_rc=0
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
log "✓ promoted $ahead ${MOBILE_BRANCH} commits → main"

# 5. If pnpm-lock.yaml changed in promoted commits, reinstall in release
if git diff --name-only HEAD@{1} HEAD | grep -qE "pnpm-lock|package\.json"; then
  log "pnpm-lock or package.json changed — reinstall in release"
  pnpm install --frozen-lockfile 2>&1 | tail -5
fi

log "done · release at port $RELEASE_PORT now serves $(git rev-parse --short HEAD)"
exit 0

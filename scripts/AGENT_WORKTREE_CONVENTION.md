# Per-Agent Worktree Convention (G-004)

**Status:** active 2026-05-18. Implemented in `scripts/dev-daemon.sh`.
Closes deltas.md G-004 (shared-worktree concurrency collision class).

## TL;DR

Every dispatched `claude -p` agent works in its OWN ephemeral git worktree
at `/tmp/holon-agent-<id>` on a throwaway branch `agent-<id>` based on the
current `dev` tip. The daemon creates the worktree before invoking claude
and force-removes it after claude exits (success or failure). Agent commits
on its own branch and pushes via `git push origin HEAD:dev`.

Cross-agent file-collisions, index races, `--amend`-swallows-other-agents'-stage,
and Pass-N socket-death-from-shared-tooling are **impossible by design** under
this convention.

## Why

Three production incidents in one hour on 2026-05-17:

| ID | Pattern | Root cause |
|---|---|---|
| L-009 (dccb4bf) | Daemon's `--amend` swallowed L-009's staged work | Two agents shared the dev worktree's git index |
| L-010 (781cb06) | Duplicate L-010 commit, dev/main conflict | Two agents wrote the same file from the same worktree |
| Pass #3 socket-death | claude -p couldn't reach its own subprocess | Concurrent agents in the same worktree fighting over `.next/`/lockfiles |

L-011 was the tactical patch (daemon stops using `--amend`).
G-004 is the **architectural fix**: stop sharing the worktree at all.

## How (mechanism)

### Daemon side (`scripts/dev-daemon.sh`)

1. **At startup**: `git worktree prune` + remove any leftover
   `/tmp/holon-agent-*` directories + delete leftover `agent-*` branches
   (cleans up after a crashed prior daemon run).

2. **Before invoking `claude -p`**:
   - Compute `AGENT_ID = iter${iter_count}-$(date +%s%N | tail -c 7)`.
   - `git worktree add -b agent-${AGENT_ID} /tmp/holon-agent-${AGENT_ID} dev`.
   - If creation fails, skip this iter (log + sleep + continue).

3. **Run claude FROM the agent worktree**:
   `( cd "$WORKTREE" && claude --dangerously-skip-permissions -p "$brief" )`.
   The subshell guarantees the agent inherits `$PWD == $WORKTREE` even if
   the agent forgets the explicit `cd`.

4. **After claude returns** (any exit code):
   - `git pull --ff-only origin dev` (pulls whatever the agent pushed).
   - `git worktree remove "$WORKTREE" --force` (handles dirty trees).
   - `git branch -D "agent-${AGENT_ID}"`.
   - `git worktree prune` (idempotent safety).

### Agent side (brief contract)

The agent receives the worktree path + branch name as injected variables
in its brief. The brief tells the agent:

- `cd $WORKTREE` (do NOT `cd $REPO`).
- Do NOT `git checkout dev` (already on `agent-$AGENT_ID` based on dev's tip).
- Do NOT `git pull` (daemon pulled before creating the worktree).
- All git work happens in `$WORKTREE` on `agent-$AGENT_ID`.
- Push via `git push origin HEAD:dev` (branch-name-agnostic).
- On non-fast-forward push rejection: `git fetch origin dev && git rebase
  origin/dev && git push origin HEAD:dev`. If rebase conflicts, hard-reset
  and exit clean.

## Invariants

- **Disjoint working trees**: at any instant, two agents NEVER share a
  worktree, a git index, or a `.next/` build dir. Inter-agent file races
  reduce to inter-process git push races on `origin/dev`, which git handles
  atomically.
- **Idempotent teardown**: removing an already-removed worktree is a no-op.
  Removing an agent branch that doesn't exist is a no-op. Pruning
  worktree metadata for a no-longer-existing path is a no-op. The
  cleanup pass is safe to call N times.
- **Orphan reclamation**: a daemon crash mid-flight leaves
  `/tmp/holon-agent-<id>` + branch `agent-<id>` orphaned. The next daemon
  startup pass reclaims both. Disk leak is bounded by the longest
  daemon-crash-to-restart window.

## What this does NOT solve

- **`origin/dev` push contention** — two agents pushing the same second can
  race; the loser rebases. This is the correct git semantics (atomic ref
  update). Not a bug.
- **Concurrent edits to the SAME file on the SAME line** — agents A and B
  both edit `plan.md` line 51; second-to-push rebases, may conflict, may
  hard-reset. Mitigation: keep agents on disjoint surfaces (the daemon's
  picker already serializes work-item selection via marker claim).
- **The release worktree at `/home/chenz/project/holon-engineering`** —
  promote.sh runs there on `main` branch; entirely independent of per-agent
  dev worktrees. No interaction.
- **The `bugs/` symlink hazard (L-004)** — agent worktrees inherit the same
  symlink. Already handled: bug agents are told to update AGENT_BRIEF.md in
  the RELEASE worktree, not their agent worktree.

## Disk footprint

Each agent worktree is a checkout of the dev branch (~`du -sh` of `apps/web`
without `.next/` or `node_modules/`, since both are gitignored). Typical
size: ~50-150 MB per agent. At max concurrency (1 daemon = 1 agent at a
time per current design), peak disk is one worktree + the persistent
release/dev worktrees. /tmp on this WSL2 host has ~30 GB free; no issue.

If the daemon ever fans out to N concurrent agents, peak /tmp footprint
becomes N × ~150 MB. Still bounded.

## Operational notes

- **Inspecting an in-flight agent**: `git worktree list` shows the active
  agent worktree path + branch. `cd /tmp/holon-agent-<id>` then `git log`
  / `git status` to see what the agent has done so far.
- **Manually killing a stuck agent**: kill the claude PID; the daemon's
  post-claude cleanup will run on the next loop iter. If the daemon itself
  is killed mid-agent, the next daemon start reclaims the worktree.
- **Disabling isolation (emergency rollback)**: revert the
  `mk_agent_worktree` calls in dev-daemon.sh to `WORKTREE=$REPO` + skip
  cleanup. All other logic unchanged. The pre-G-004 collision class
  returns until reverted back.

## Manual dispatches (non-daemon agent invocations) — L-064

The dev-daemon does this automatically. **Manual dispatches** (e.g., main
session firing an `Agent` tool call to ship an iter-NNN pass) must follow
the same convention by hand. Two promote-cron blockages on 2026-05-18
(`hermes-sidecar-bundle` 18:58Z + `iter-016-pass-1-pyinstaller-acp` 19:47Z)
both root-caused to manually dispatched agents running `git checkout -b X`
inside the release worktree at `/home/chenz/project/holon-engineering`,
which left release stuck on a non-main branch. `promote.sh` then refused
to merge dev→main until release was manually flipped back to `main`.

**Hard rule for any manual agent dispatch**:

```bash
# in the dispatcher (main session / cron / human shell), BEFORE invoking the agent:
git -C /home/chenz/project/holon-engineering-dev fetch origin main
git worktree add /tmp/holon-iter${N}-pass${P} -b <branch-name> origin/main
# then dispatch the agent into that path:
( cd /tmp/holon-iter${N}-pass${P} && <Agent tool / claude -p / human work> )
# after the agent exits (success OR failure):
git worktree remove /tmp/holon-iter${N}-pass${P} --force
git branch -D <branch-name>   # optional; safe if branch was already pushed
git worktree prune
```

**Never** instruct an agent to `git checkout -b` in
`/home/chenz/project/holon-engineering` (release) or
`/home/chenz/project/holon-engineering-dev` (dev). Both are shared
infrastructure: release runs `promote.sh` against `main`, and dev runs the
port-3001 HMR server. An in-place branch switch in either occupies the
worktree and breaks the cron pipeline.

When writing an Agent brief, copy the "G-004 worktree isolation" block
that `scripts/dev-daemon.sh` injects (search for `## G-004 worktree
isolation` in the daemon's brief heredoc) so the agent knows:
- it's in `/tmp/holon-iter…`, not the release/dev worktrees;
- it must NOT `cd` to either shared worktree;
- it pushes via `git push origin HEAD:<target-branch>`;
- it does NOT `git checkout` anything (already on its throwaway branch).

## Cross-references

- `docs/deltas.md` § G-004 (the architectural delta this closes)
- `docs/deltas.md` § L-009 / L-010 / L-011 (incident history that motivated this)
- `scripts/dev-daemon.sh` (implementation — see `mk_agent_worktree` /
  `cleanup_agent_worktree` helpers + the brief-injection blocks)
- `scripts/promote.sh` (unaffected — runs in release worktree on main)
- `scripts/mobile-dev-daemon.sh` (mobile track — same pattern recommended
  but not yet ported; track in deltas if observed colliding)

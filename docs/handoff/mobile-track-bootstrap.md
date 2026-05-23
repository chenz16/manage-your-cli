# Mobile Track — Bootstrap & Auto-Pipeline Handoff

**Purpose.** This document hands off the working pattern from the Holon desk-development session (this CLI session, 2026-05-17) to a NEW session that will develop the mobile app track in parallel. Goal: the mobile session should reach the same level of "user-can-walk-away" 7×24 autonomous operation that the desk track has reached, with the user intervening only at strategic decision points (iter scope, irreversible ops).

**Audience.** A fresh Claude Code session in a new terminal, with no shared context. Read top-to-bottom before touching anything.

---

## TL;DR — what's worth copying

1. **3 in-session cron prompts** (DEV every 12 min, QA every 12 min interleaved, REQ every hour) — the user fires these on a cadence; you parse + act.
2. **PROMOTE cron every 6 min** — gated dev → main release script with quality gates.
3. **tmux dev-daemon** — continuous bug-fix processor.
4. **dev/release worktree split** with branch separation — quality gates run on dev (port 3001), release lives on main (port 3000).
5. **deltas.md** = the cross-loop coordination queue (Local + Global sections).
6. **dev-log.md** = append-only ship log (single source of truth for "what shipped when").
7. **Self-heal layers** in `scripts/promote.sh` — handle the common failure modes silently.
8. **Background agent dispatch** for any single ≤30 LOC / ≤3 files task; parallel-safe when file scopes don't overlap.
9. **Marker discipline** — `[ ]` open / `[~ <claimer> <ISO time>]` in-flight / `[x] <SHA-short>` shipped.
10. **TECH-DEBT.md + CLAUDE.md "Working Patterns"** — codify learnings continuously, don't lose them between iters.

This isn't theoretical — the desk track shipped iter-010 (7 passes, ~1500 LOC product + comprehensive tests) in ~10 hours with the user away most of the time.

---

## Part 1 — The auto-pipeline (the part the user cares about)

### Architecture overview

```
┌────────────────────────────────────────────────────────────────────────────┐
│  USER (you, the human)                                                     │
│  fires cron-prompt templates every 6 / 12 / 60 min                         │
│  + answers strategic questions when escalated                              │
└─────────┬─────────────────────┬───────────────────┬────────────────────────┘
          │                     │                   │
          ▼                     ▼                   ▼
   ┌──────────┐         ┌──────────────┐    ┌────────────┐
   │ DEV cron │         │   QA cron    │    │  REQ cron  │
   │ 12 min   │ ◄─────► │   12 min     │    │   1 hour   │
   │ :03/:15… │         │ :09/:21…     │    │   :41      │
   └─────┬────┘         └──────┬───────┘    └──────┬─────┘
         │ picks first [ ]     │ smokes & files    │ surveys plan
         │ from deltas/plan    │ deltas if found   │ + global deltas
         ▼                     ▼                   ▼
   ┌─────────────────┐  ┌───────────────────────────────────────┐
   │ Background      │  │  docs/deltas.md  (cross-loop queue)   │
   │ Agent (parallel)│  │  - § Local: dev loop pulls from top   │
   │ ships ≤30 LOC   │  │  - § Global: req loop pulls from top  │
   │ to dev branch   │  └───────────────────────────────────────┘
   └────────┬────────┘
            │ git push origin dev
            ▼
   ┌──────────────────────────────────────────────┐
   │  PROMOTE cron (6 min)                        │
   │  scripts/promote.sh                          │
   │  ─ typecheck × 3 packages                    │
   │  ─ 8 routes 200                              │
   │  ─ 3 catalog APIs shape check                │
   │  ─ /me owner_role present                    │
   │  ─ if PASS: git merge --no-ff dev → main     │
   │  ─ self-heal layers (L-002/L-007/L-006)      │
   └────────┬─────────────────────────────────────┘
            │ git push origin main
            ▼
   ┌──────────────────────────┐         ┌──────────────────────┐
   │  RELEASE (port 3000)     │ ◄─────  │  tmux dev-daemon     │
   │  user-facing app         │         │  continuous loop     │
   │  pnpm dev on main branch │         │  processes user bugs │
   └──────────────────────────┘         │  + plan steps        │
                                         └──────────────────────┘
```

### Cron prompt templates (verbatim — copy-paste these exact strings)

The user fires these by sending them as messages. Each prompt is the complete algorithm — you parse + act + reply with one line.

**DEV cron** (every 12 min at :03/:15/:27/:39/:51):
- Pulls first `[ ]` from `docs/deltas.md` § Local → if none, falls through to `iterations/NNN-*/plan.md` first unshipped pass → if none, `docs/dev-queue.md`.
- Marks `[~ dev-loop <ISO>]` + commits marker + pushes.
- Dispatches a background Agent (Claude subagent in `run_in_background: true` mode) with a self-contained brief.
- Replies ONE line: `→ dev: dispatched <id> <title>` OR `✓ dev: nothing to ship` OR `⏭ dev: agent winding down`.

**QA cron** (every 12 min at :09/:21/:33/:45/:57 — interleaved with DEV):
- Pulls latest main; runs typecheck × 3 + 8 routes + 4 APIs.
- If new commits in 14-min window touched a daily-flow surface, runs `pnpm test:e2e:daily` filtered.
- Findings → filed as `L-NNN` (local) or `G-NNN` (global) deltas in `docs/deltas.md`.
- Appends tick entry to `docs/reviews/qa-watch-log.md` (gitignored — local only).
- Commits + pushes ONLY doc changes.
- Reply: `✓ qa: 8/8 routes, typecheck PASS, +<L> local +<G> global deltas`.

**PROMOTE cron** (every 6 min):
- Runs `scripts/promote.sh` (logs to `/tmp/holon-promote.log`).
- Reply: `✓ promote: shipped N commits dev→main, release now at <SHA>` OR `✓ promote: no-op (dev ahead by 0)` OR `✗ promote: gate failed — <reason>`.

**REQ cron** (every hour at :41):
- Surveys hour's commits + open global deltas + current iter plan.
- Decides: A (plan on track), B (micro-update plan), C (iter done — write feedback.md), D (stalled).
- Reply: one line summarizing decision.

The exact prompt text the user sends is preserved in this session's conversation history — for the mobile track, you should write **mobile-specific** cron templates that point at `iterations/M-NNN-*/plan.md` (mobile iters) and `docs/mobile-deltas.md` (mobile delta queue) so the two tracks don't trample each other.

### The 4 critical files for cross-loop coordination

| File | Purpose | Who writes | Who reads |
|---|---|---|---|
| `docs/deltas.md` | Append-only queue of local + global findings | QA loop, sometimes dev/main session | Dev loop (Local) + Req loop (Global) |
| `docs/dev-log.md` | Append-only ship log | Every dispatched agent on completion | Humans (during/after iter) + Req loop |
| `iterations/NNN-*/plan.md` | Iter scope & pass-by-pass plan | Req loop (drafts) + agents (flip markers) | Dev loop (picks unshipped passes) |
| `docs/reviews/qa-watch-log.md` | Per-tick QA observations (gitignored) | QA loop | Humans (local debugging) |

For mobile track, mirror these: `docs/mobile-deltas.md`, `docs/mobile-dev-log.md`, `iterations/M001-*/plan.md` (or similar prefix). Or share `dev-log.md` with a `## Mobile` section convention — your call, just decide upfront and stick to it.

### The dev/release worktree split

```
/home/chenz/project/holon-engineering/        ← RELEASE worktree on `main`
                                              ← serves port 3000 (real user-facing)
                                              ← promote.sh + cron scripts run from here
                                              ← only updated via promote.sh merge

/home/chenz/project/holon-engineering-dev/    ← DEV worktree on `dev`
                                              ← serves port 3001 (gate target)
                                              ← daemon + dispatched agents work here
                                              ← all `feat/fix` commits land on `dev`
```

Set up via `git worktree add`. For mobile track, **make your own worktree pair**:
```bash
git worktree add /home/chenz/project/holon-engineering-mobile -b mobile-v1
# optional: git worktree add /home/chenz/project/holon-engineering-mobile-dev -b mobile-dev
```

⚠ **G-005 (open architectural delta as of 2026-05-17): one-way branch flow causes marker drift.** Marker flips done on main don't reach dev. Daemon's picker reads dev's local file and sees stale "open" state. For mobile track, prefer (a) marker flips happen on dev first then promote to main, OR (b) daemon picker reads `git show origin/main:plan.md` instead of local file.

### scripts/promote.sh — the gated release script

Read `scripts/promote.sh` in full before you write a mobile version. Key features it has after a day of hardening (L-002, L-003, L-006, L-007 all shipped):

1. **`set -o pipefail`** — captures git's real exit code, not tail's (`L-002`)
2. **`git merge --no-ff`** instead of `--ff-only` — handles diverged branches (`L-003`)
3. **L-007 auto-resolve for `docs/dev-log.md`** — strips conflict markers when both sides only append (single-file conflict only; multi-file halts loudly)
4. **L-006 dev-self-heal hook** — if a route 500s on dev BUT 200s on release (same SHA → source is fine, cache corrupted), invokes `scripts/dev-self-heal.sh` once + retries
5. **Always stash + restore** if release worktree has uncommitted changes before merge
6. **3 typecheck gates × 3 packages** (api-contract, core, web)
7. **8-route HTTP smoke** + **4 catalog APIs shape check** + **/me owner_role presence**

Copy this structure for the mobile track. The exact gates change (mobile won't have 8 routes — adjust to whatever mobile health-check looks like: app boots? screens render? etc.).

### tmux dev-daemon (the continuous bug-fix worker)

```bash
tmux new-session -d -s holon-dev-daemon "bash /home/chenz/project/holon-engineering-dev/scripts/dev-daemon.sh"
```

Loops every ~30 seconds. Each iter:
1. Pulls latest dev.
2. Scans `bugs/` for unprocessed user-filed bug reports (filed via `[🐞]` FAB button → `POST /api/v1/admin/bugs` → on-disk dir).
3. If a bug exists, dispatches `claude --dangerously-skip-permissions -p '<brief>'` to fix it. Bug-fix agent commits + pushes to dev. Promote picks it up next cycle.
4. If no bugs, falls through to plan.md scan for an unshipped pass.
5. Logs to tmux pane (capture via `tmux capture-pane -t holon-dev-daemon -p`).

Gotchas (all documented as L-NNN deltas):
- **L-004** — `bugs/` is a symlink across worktrees; daemon must edit `bugs/AGENT_BRIEF.md` from RELEASE worktree, not dev (symlinks don't git-add cleanly)
- **L-008** — picker regex must match `[x SHA]` markers as terminal (skip already-shipped); easy to forget the space-vs-bracket character class
- **L-011** — daemon must NOT use `git commit --amend` to backfill — when other agents have staged changes, `--amend` swallows their work into the daemon's commit. Always use a NEW commit.
- **L-012** — daemon process holds the awk/grep patterns in memory; **on-disk script changes don't take effect until daemon restart**. Pair every picker patch with `tmux kill-session && tmux new-session ...`.
- **L-013 (CRITICAL)** — daemon picker reads local plan.md; if main's markers are ahead of dev (which happens because flips land on main directly), daemon will re-pick already-shipped passes. ALWAYS sync plan.md from main → dev before restart, OR have the picker read `origin/main`'s plan.md directly.

### Background agent dispatch (the parallel-velocity multiplier)

Use the `Agent` tool with `subagent_type: general-purpose` and `run_in_background: true`. Brief format that works:

```
1. The picked item VERBATIM from deltas/plan
2. Workflow steps (cd to dev worktree, git pull --ff-only, edit files, verify, commit, push)
3. Hard constraints (typecheck PASS, ONE commit, push, DO NOT touch [list of restricted paths])
4. Marker-flip + dev-log append steps for the agent to do at the end
5. Report budget: "≤150 words: LOC change, smoke result, dev SHA, main SHA"
6. Timebox: "If you can't ship in 1 hr, mark [blocked] <reason> and exit"
```

**Parallel safety rule**: dispatched agents must have ZERO file overlap with each other and with in-flight daemon work. Today's peak: 4 agents in parallel (Pass #4 budget UI + Pass #5 CI + Pass #7 audit + L-011 daemon fix), all shipped clean because their file scopes were disjoint.

**Collision incidents to learn from**:
- **L-009 dccb4bf swallow** — daemon's bug-fix agent `--amend`ed L-009's staged work into an unrelated commit. Tactical fix: L-011 banned `--amend`. Architectural fix needed: **G-004 — per-agent ephemeral worktrees** (`git worktree add /tmp/agent-<id> dev`).
- **L-010 duplicate** — competing L-010 commits landed on main (incomplete) and dev (canonical). Required manual `git checkout --theirs` to unblock. Same G-004 root cause.

### Self-heal patterns proven in production today

| Layer | Fix | What it catches |
|---|---|---|
| **L-002** `set -o pipefail` + explicit `merge_rc=$?` | Silent merge-failure (`tail`'s exit code being read instead of `git`'s) | promote.sh used to falsely report success |
| **L-003** `git merge --no-ff` | Branch divergence preventing `--ff-only` | cron loops commit directly to main causing dev to be behind |
| **L-007** sed-strip conflict markers on `docs/dev-log.md` only | Recurring append-only file conflicts | dev-log.md edited on both sides every promote |
| **L-006** `dev-self-heal.sh` retry once when dev ≠ release on same route | webpack HMR cache corruption | dev port serves 500 but release same SHA serves 200 |

Each fired live multiple times today. Copy the pattern: detect a specific recoverable failure shape + auto-recover once + escalate to loud-halt on the 2nd failure.

### TECH-DEBT.md + CLAUDE.md learnings discipline

- **Every "this is fine for now" decision** → append to `TECH-DEBT.md` with: title, current state, why it's debt, cleanup task, blast radius, filed-date.
- **Every working-pattern learning** (process, agent dispatch, file conventions) → append to `CLAUDE.md` § Working Patterns.
- Both files are read by every dispatched agent + every future iter. Don't lose hard-won lessons between sessions.

Today's TECH-DEBT additions: D13 (External integration auth — Gmail OAuth, ~500-800 LOC, recommended iter-011 Pass #1).

---

## Part 2 — UI design references (the secondary part)

Read these in roughly this order if you're doing mobile UI from scratch:

1. **`docs/product/vision-v2-product-shape.md`** — the V1/V2 personas + chat+Teams+Outlook+Jira positioning. Don't deviate from the chat-first control plane on mobile.
2. **`docs/architecture/functional-architecture.md`** § 2 (The Two Cores frame) — Local Agent Management + Hybrid Employment Interconnect. Mobile must respect both cores' boundaries.
3. **`docs/architecture/local-agent-management.md`** — flat staff roster invariant. Mobile shouldn't introduce sub-staff hierarchy.
4. **`bugs/`** — read recent user bug reports. They're the freshest signal on what embarrasses the user on first contact. Today's bug queue has ~15 entries from a single afternoon of usage; patterns include /me persona UX, panel-X navigation, label inconsistencies.

### CLAUDE.md § "UI: Examples vs Yours convention"

For every catalog surface on mobile (skills, templates, references, future):
- Partition into `yours` (user-created) + `examples` (built-in catalog).
- Default render: yours grouped by kind, expanded. Examples in ONE bottom collapsible section, **default-collapsed**.
- Empty-state hint when `yours.length === 0`: instruct + point at + New + mention Examples.

### Reference products to rotate through

(From CLAUDE.md § "Product framing")
- Lindy.ai (autonomous worker UX)
- Notion AI (catalog + slash-command surface)
- Glean (enterprise integrations)
- Sana / Stack AI (workflow builder)
- Cursor (chat-first dev tool)
- MaxAI / Monica (browser-embedded — mobile equivalent: floating-bubble overlay?)
- Linear (issue tracking aesthetic — translates well to mobile)

### Theme / aesthetic

Cream/sand background, high contrast, accessible — per user's display preference (`memory/user_display.md`: WSL2 + Windows Terminal, dim screen, prefers brighter/higher-contrast colors). Mobile will need the same warmth — avoid the typical "white background + dark blue accent" iOS default. Inherit the desk theme from `src/ui-mock/_shared/components.css`.

---

## Part 3 — Gotchas + escalation triggers

### When to escalate to the user (don't try to recover silently)

- Anything that would force-push, reset --hard, delete branches
- Anything that would kill a running `claude -p` (~3 min wasted work; needs explicit OK)
- Anything that changes shared infrastructure (CI workflow, scripts/, docs/architecture)
- Anything that introduces a new dependency in package.json
- Promote pipeline stuck on the same conflict 2+ times → ask
- Anything that touches `.env` / secrets

### Things you CAN do silently

- Marker flips ([~] ↔ [x] ↔ [ ]) — they're append-only conventions
- New deltas in `docs/deltas.md` or `docs/mobile-deltas.md`
- New entries in `docs/dev-log.md`
- New tasks in `docs/dev-queue.md`
- Restart the dev server (port 3001) if down
- Drop git stashes whose self-description marks them as obsolete

### Coordination protocol with desk track (THIS session)

We share:
- `packages/api-contract/` (schemas — if mobile adds endpoints, propose them here, desk's QA loop will catch breakage)
- `packages/core/` (services — read-mostly from mobile side; if mobile needs a new service, file as G-NNN for human to approve)
- `bugs/` (user-filed bug queue — both tracks should respect daemon's processing; if a bug is mobile-only, tag it so desk daemon skips)
- `.env` (secrets — never commit, both tracks share)
- `TECH-DEBT.md` (append-only on both sides — sort by filing date)
- `CLAUDE.md` (append to § Working Patterns; coordinate via human if both sides want to edit same section)

We DON'T share:
- `apps/web/` is mostly desk's — mobile gets its own `apps/mobile/` (or whatever you scaffold)
- iter folder — desk uses `iterations/NNN-*`, mobile use a different prefix (e.g., `iterations/M-NNN-*`)
- Daemon — mobile starts its own tmux session with its own daemon script (don't share `holon-dev-daemon`; use `holon-mobile-daemon`)
- Cron prompts — fork the templates, point at mobile-specific paths

## Part 3.5 — Branching strategy (read first — this trips everyone up)

### How the desk track works today

```
main          ←─ release branch (port 3000, the user-facing app)
                 promote.sh ships dev → main when gates pass
 │
 └── dev      ←─ desk development branch (port 3001, gate target)
                 daemon + dispatched agents commit here, ALL real product
                 work happens here, then promote.sh moves it to main
```

Two physical worktrees on disk, sharing one `.git/`:
- `/home/chenz/project/holon-engineering/` checked out to `main`
- `/home/chenz/project/holon-engineering-dev/` checked out to `dev`

`git worktree add` is the magic — separate folders, isolated working state, but same repo. No file collisions even with two parallel sessions writing simultaneously.

### How the mobile track should mirror it

```
main                 ←─ STILL the single release branch (port 3000 desk + mobile artifacts ship here)
 │
 ├── dev             ←─ desk development (unchanged)
 │
 └── mobile-v1       ←─ NEW mobile development branch (off main)
                        own daemon, own dispatched agents commit here
                        mobile-promote.sh moves mobile-v1 → main when its gates pass
```

Three physical worktrees:
- `/home/chenz/project/holon-engineering/` on `main` (existing)
- `/home/chenz/project/holon-engineering-dev/` on `dev` (existing)
- `/home/chenz/project/holon-engineering-mobile/` on `mobile-v1` (NEW — mobile session creates this)

**Key point**: both `dev` and `mobile-v1` ship to the same `main`. Mobile code lives under `apps/mobile/` (new sub-tree). Desk code stays under `apps/web/`. They share `packages/api-contract/`, `packages/core/`, `bugs/`, `TECH-DEBT.md`, `CLAUDE.md` — coordinate edits to those via `git pull --rebase` discipline.

### Recommended: single mobile branch first, fork dev/release later

Desk has `dev` + `main` because daemon's high-frequency commits forced the safety split. Mobile won't have that pressure on day 1 — start with **single `mobile-v1` branch** that promotes directly to `main`. When mobile's commit frequency grows enough to justify the cost, fork off `mobile-dev` + `mobile-release` (same pattern as desk).

### Why mobile session can self-bootstrap

The user is opening a new Claude Code session in a folder ABOVE the holon-engineering checkouts (likely `/home/chenz/project/` or higher). That session has filesystem + git access to the whole project tree. **It can run `git worktree add` itself** — no manual user setup. The user just needs to send a first-message instruction.

### The exact first message to send the new mobile session

Copy this verbatim into the new Claude Code chat:

```
You are bootstrapping the Holon mobile-app development track in parallel
with the existing desk-app track. Read these files in order:

1. /home/chenz/project/holon-engineering/docs/handoff/mobile-track-bootstrap.md
   (your full handoff — read it top to bottom)
2. /home/chenz/project/holon-engineering/CLAUDE.md
   (project-wide working rules; mobile track follows the same engineering rules)
3. /home/chenz/project/holon-engineering/docs/product/vision-v2-product-shape.md
   (V1/V2 personas; mobile inherits the chat+Teams+Outlook+Jira frame)
4. /home/chenz/project/holon-engineering/iterations/010-catalog-real/pass-7-readiness-audit.md
   (Pass #7 audit; iter-011 scope including Gmail OAuth — mobile depends on it)

After reading, do this:

(a) Create your worktree:
    cd /home/chenz/project/holon-engineering
    git worktree add /home/chenz/project/holon-engineering-mobile -b mobile-v1
    cd /home/chenz/project/holon-engineering-mobile

(b) Propose your tech stack (Tauri 2.0 mobile / Capacitor / React Native +
    Expo) with a one-paragraph trade-off for each, then recommend one. Wait
    for my pick before scaffolding any code.

(c) Once I confirm the stack, draft:
    - iterations/M001-mobile-bootstrap/requirements.md
    - iterations/M001-mobile-bootstrap/plan.md (4-6 passes, mirror iter-010
      structure: scaffold → login + /me → chat surface → one Gmail
      integration → polish + onboarding)
    - scripts/mobile-promote.sh (mirror scripts/promote.sh with
      mobile-appropriate gates)
    - scripts/mobile-dev-daemon.sh (mirror scripts/dev-daemon.sh)

(d) Show me the 4 cron prompt templates you'd use (DEV/QA/PROMOTE/REQ for
    mobile track), with paths pointing at mobile files, before I start
    firing them.

(e) Tell me what to do day-1 — what I'll need to install on my dev box
    (Xcode? Android Studio? Tauri CLI? Expo CLI?), what's optional, and
    what blocks until I install it.

Hard constraints:
- Mobile work commits to mobile-v1 branch only; promote it to main via
  mobile-promote.sh after gates pass. NEVER force-push.
- Shared packages (packages/api-contract, packages/core): if you must
  edit them, pull --rebase first + ping me in chat so I can coordinate
  with the desk session.
- Don't touch apps/web/, iterations/010-*, iterations/011-* (those are
  desk territory). Mobile owns apps/mobile/ + iterations/M-*.
- Read the gotchas section in the handoff doc (L-001 through L-013) so
  you don't re-discover the same failure modes.

Start by reading the 4 docs above.
```

### First-day setup checklist (what the mobile Claude session executes — you don't run any of this)

(For your reference, here's what the new session will do after you send the message above. You don't type these commands — the Claude session runs them itself.)

1. **Create worktree**: `git worktree add /home/chenz/project/holon-engineering-mobile -b mobile-v1` (one-time, off main).
2. **Decide stack** — Claude proposes 3 options + recommends one, waits for your pick.
3. **Scaffold iter folder**: writes `iterations/M001-mobile-bootstrap/{requirements,plan}.md`. First plan: (#1) scaffold mobile shell + boot on phone, (#2) login flow + /me page, (#3) chat surface, (#4) one Gmail integration (depends on desk iter-011 Pass #1 shipping Gmail OAuth).
4. **Write `scripts/mobile-promote.sh`** — analogous to `scripts/promote.sh` but with mobile-appropriate gates (build succeeds? app boots in simulator? smoke test screens render?).
5. **Write `scripts/mobile-dev-daemon.sh`** — analogous to `scripts/dev-daemon.sh` for bug-fix continuous loop.
6. **Show the 4 cron prompt templates** pointed at mobile paths (you copy + start firing them on the cadence).
7. **Start the daemon**: `tmux new-session -d -s holon-mobile-daemon "bash scripts/mobile-dev-daemon.sh"`.
8. **File first findings** as M-L-001 (mobile local delta) / M-G-001 (mobile global) to start the queue.

The point: by the end of day 1, you should be able to fire mobile-DEV / mobile-QA / mobile-PROMOTE / mobile-REQ cron prompts on a cadence and watch mobile-track commits flow autonomously, same as desk does. **You touched only the chat — no terminal commands.**

---

## Part 4 — Live state snapshot (as of 2026-05-17T23:08Z)

For situational awareness:

- **Desk iter-010** is feature-complete (all 7 passes shipped). Release at SHA `3e9b2ad`.
- **iter-011 not yet opened** — awaiting human decision on scope (Pass #7 audit at `iterations/010-catalog-real/pass-7-readiness-audit.md` proposes 6 passes starting with Gmail OAuth).
- **Open global deltas**: G-003 (Gmail OAuth — needed for "real testing"), G-004 (worktree isolation), G-005 (marker drift between main/dev), G-006 (mobile track decision — this handoff is part of resolving it).
- **Pipeline status**: 100% functional + at rest (no commits backlogged).
- **Daemon**: running, processing user bugs as they come.
- **tmux sessions**: `holon-dev-daemon` (desk bug-fix loop).

---

**Last word.** The most important thing to copy is the **discipline of writing things down as you learn them** — every L-NNN delta filed today exists because someone took 90 seconds to write it down instead of letting it fade. Compound that for a week and you have a self-documenting system.

Good luck. — desk-session-2026-05-17

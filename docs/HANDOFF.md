# Holon — Operator Handoff (7×24 role + running state)

**For:** the next Claude operator (picking up on **native Windows**).
**From:** the WSL session (2026-05-21). **Owner:** the CEO (chen.zhang6@gmail.com) — you are the engineering manager; owner is in owner-mode at all times.
**Read this top-to-bottom, then run the cutover checklist.**

---

## 0. The platform move (in progress)
We are migrating dev from **WSL → native Windows** (WeChat read + the Windows installer are Windows-only; WSL HMR died mid-session; interop is leaky). Mac was considered and rejected: it cannot do WeChat-read (wcferry is Windows-only) or build the Windows `.exe`.

**Toolchain status on this Windows box (verified via interop):**
- ✅ Python 3.11.9, Git 2.47, Rust/cargo 1.95 (`~/.cargo`), winget 1.28 — present.
- ✅ **Node LTS 22 installed** (winget OpenJS.NodeJS.LTS) + **uv installed** — but PATH only resolves in a *native* shell (interop didn't see it).
- ⬜ Remaining (do in a native Windows shell — trivial): `corepack enable && corepack prepare pnpm@9 --activate`; clone; `pnpm install`; copy env; `uv sync` for Hermes.

**Full migration steps:** `docs/install/windows-native-dev-migration.md` (long-paths reg, clone to `C:\dev`, etc.). Keep the WSL checkout until the Windows cutover checklist (§ in that doc) is all green.

⚠️ **Node must stay 20/22, NOT 24** (Node 24 breaks the standalone copy step — runbook G-004).

---

## 1. Your role — the 7×24 manager (operating model)
Canonical: `CLAUDE.md` § "7×24 Manager Mode" + the iteration model. In short: keep yourself + subagents busy, supervise (never fire-and-forget), surface owner-decisions, report status every pause.

**Cron cadences** (fired as prompts by an external scheduler — re-establish them on Windows):
- **DEV loop** q12m (:03/:15/:27/:39/:51) — pick first open local delta in `docs/deltas.md` → dispatch ONE background agent (Sonnet) in an isolated worktree → mark in-flight.
- **QA loop** q12m (:09/:21/:33/:45/:57) — dev-server health, typecheck×3, 8-route smoke, Playwright for touched surfaces; file deltas.
- **PROMOTE** q6m — `bash scripts/promote.sh` (gated dev→main ff-merge).
- **REQ** hourly (:41) — step back, survey global deltas, re-plan.
- **BUG queue** — scan `bugs/` for dirs without `_processed.md`; fix ≤30 LOC in isolated worktree or triage.

**Hard rules (learned this session — non-negotiable):**
- **≤1 concurrent dev agent**; agents run on **Sonnet** (token-conscious); never fire-and-forget (health-check each tick).
- **Isolated worktrees per agent** (`git worktree add /tmp/holon-bugqueue-<id> origin/main`) — never share the main worktree (L-064). Clean up after merge.
- **Verify the running server serves your change** — WSL HMR silently died this session (`.next` frozen 7h); commit/typecheck ≠ owner sees it. Check `.next/server/app` mtime; restart clean if stale. (`feature/memory: verify-running-server`.)
- **Test the user flow, not gates** — typecheck PASS / 200 ≠ fixed; reproduce the exact failing path.
- **Use the owner's exact wording** (he said 外联, I shipped 集成 → had to redo). Don't substitute your term.
- `bugs/` and `docs/reviews/qa-watch-log.md` are **gitignored (local-only)** — don't `git add -f` them. `docs/deltas.md` + `docs/dev-log.md` ARE tracked.
- No force-push, no `--no-verify`, no committing secrets. Customer build must contain NO secrets (build-time grep guard).
- Trust-but-verify subagents: this session two agents reported success falsely (one only flipped a marker; one omitted `_processed.md`). Always review the diff before merge.

---

## 2. Repos
- **chenz16/holon-engineering** (private) — this dev repo. main @ `358e372`, clean, synced to origin.
- **chenz16/holon-release** (public) — installers + README/TECHNICAL. **v0.1.0** released (115MB exe live).
- **chenz16/Holon** (public) — brand site (chenz16.github.io/Holon); has Download CTA → holon-release.

---

## 3. What shipped this session (all on main, all behind the dead-HMR until restart)
WeChat one-shot read (`--once`); Telegram→CEO bridge; build profile (customer/test secret split) + `auto-build-release.sh`; **G-007** `.next-prod` build isolation; **L-102** telegram poller gate; **empty team roster** for customer (`HOLON_SEED_DEMO_STAFF` gate, keeps skills); **secretary persona** compose (AI = owner's secretary, not the owner — `hermes-plugin-holon-owner/__init__.py`); Hermes→"Holon AI" identity directive; 外联 zh label; language auto-reload; meeting black-screen + connector-icon + garbled-emoji fixes; /me version+update-link; chat empty-state = two-C logo (centered, no "Desk AI" text) + "你好！" greeting (owner_name cleared); collapse-chevron ▶/◀ distinct; **WeChat bundled-exe path resolver** (`tools.py`).

---

## 4. 🔴 In-flight / broken — FIX THESE
1. **v0.1.1 build is BROKEN** at copy-standalone: `auto-build-release.sh --profile customer` failed —
   `.next-prod\standalone not found`. Root cause: the WSL web-build step (`scripts/wsl-web-build.sh`) did NOT receive `NEXT_DIST_DIR=.next-prod`, so Next built to `.next` while `copy-standalone-for-tauri.mjs` looked in `.next-prod`. → On Windows-native this is simpler: either (a) ensure the env var reaches the `pnpm -F web build` step, or (b) since native build doesn't share `.next` with a separate dev server, you can drop `.next-prod` and build to `.next`. **No v0.1.1 exe exists yet** — only v0.1.0.
2. After v0.1.1 builds clean → verify **WeChat read works in the installed exe** (the `tools.py` upward-search for `resources/wechat-daemon/wechat-read-daemon.exe` — confirm the path matches the real install layout), then **upload v0.1.1** to holon-release (`gh release` or `auto-build-release.sh --upload`).

---

## 5. Pending owner decisions (don't auto-decide)
- **G-008** (deltas.md Global) — persona/identity/profile-auto-gen is ONE root (reported 4×). The "Polish with LLM" auto-gen still produces dummy/owner-voice persona text (`keqc7n4k`). Needs a focused pass: cleanly separate owner-profile vs AI-persona + fix the generation prompt. Owner wants it SIMPLE.
- **Gmail configurability** (`lathx5cl`) — customer build has no Google creds (security). Recommended: ship a **public** OAuth client_id + PKCE so customers connect Gmail without baking a secret. Needs owner go.
- Smaller triaged: home Gmail-auth↔connector (`mo8nnzzz`); /me LLM-config ownership → /connectors (`j7lv38rg`, ADR); /me smart auto-fill (`19a7nnlw`/`zlyyvcda`).

---

## 6. Current processes (WSL — will retire after cutover)
- dev server: `apps/web` on **:3000** (restarted clean this session — HMR was dead).
- mobile dev: `holon-engineering-mobile` on :3002.
- No background agents running. v0.1.0 exe at `artifacts/windows/Holon_0.1.0_x64-setup.exe` + `/mnt/c/Users/chenz/Desktop/`.
- Secrets (gitignored, NOT in a fresh clone — copy from WSL checkout via `\\wsl$` or re-enter): `scripts/.env.test.local` (DEEPSEEK_API_KEY, HOLON_FEEDBACK_GITHUB_TOKEN), `apps/web/.env.local`.

---

## 7. First moves on Windows
1. Finish toolchain: `corepack enable && corepack prepare pnpm@9 --activate`.
2. `git clone` to `C:\dev\holon-engineering` (enable long-paths first — migration doc § 0).
3. `pnpm install`; copy the gitignored `.env*` files; `cd deps/hermes && uv sync`.
4. `cd apps/web && pnpm dev` → confirm localhost:3000 + an edit hot-reloads.
5. Fix the v0.1.1 build (§4.1), build, verify WeChat read in the exe, upload v0.1.1.
6. Re-establish the cron loops; resume 7×24.

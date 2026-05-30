# Mobile Architecture Principles

Source-of-truth for "what mobile is, vs what desk is". Read this before drafting any mobile iter plan or design spec.

User-mandated, 2026-05-18T02:23Z.

## Principle 1 — Mobile = thin client over desk-as-server

**Desk** (`apps/web/` on port 3000) is the **full Holon engine**:
- Runs the agent loops (warm CLI Secretary + per-employee CLI tmux sessions + skill execution + LLM provider calls via the user's CLI subscription)
- Owns all production state (audit, jobs, deliverables, fixtures)
- Surfaces the **complete UI** for the owner at their workstation: chat + today + deliverables + members + skills + templates + references + connections + inbound + me + meetings + settings + admin debug

**Mobile** (`apps/mobile/` on port 3002, eventually Capacitor APK / iOS app) is a **thin shell**:
- **Does NOT run** any agent loop. No CLI processes. No skill execution. No LLM provider calls from the mobile process.
- **Does NOT** have its own BFF state. All `/api/*` calls proxy to desk's `:3000` (already wired in `apps/mobile/next.config.ts`).
- **Shows a subset** of desk surfaces — only the ones a single owner needs on the go.
- Logs in to desk; the desk does the work; mobile renders the result.

This is the **personal-edition (V1) architecture**. Enterprise edition (V2) — peer-to-peer desks, per-staff budgets, SSO — is a future iter.

## Principle 2 — Mobile menu is intentionally simpler than desk

Desk shows N tabs / sidebar entries. Mobile shows **4 max** (V1):

| Mobile tab | Maps to desk route | Why on mobile |
|---|---|---|
| **聊天** (`/chat`) | desk's chat panel | The control plane. Quick-fire delegation while on the go. Most important. |
| **今日** (`/today`) | desk's `/today` | "What's running for me right now" — glance check. |
| **收件** (`/inbound`) | desk's `/inbound` | Peer missions waiting on owner approval — read-only on V1 (Approve/Reject in V2). |
| **我** (`/me`) | desk's `/me` | Persona + budget meter glance. Persona-switch deep-links to desk. |

**Explicitly NOT on mobile** in V1 (these stay desk-only):
- Members management (hire/fire/reassign — desk has the dialog UX + cost surface)
- Skills / Templates / References catalog editing (large-form input, desk-shaped)
- Connections + handoff axes config (V2 enterprise + complex form)
- Meetings (chat-thread-with-peers — V2 feature)
- Admin debug + audit log + fixtures reset (operator concerns)
- Settings + integrations (Gmail OAuth, Slack — modal flows fit desk better)
- Inbound mission Approve/Reject (Core 2 — V2)

When the user asks "where do I edit a skill on mobile" the answer is: **you don't — open desk**. Mobile's job is "out-of-office triage", not "full desk on a phone".

## Principle 3 — Visual sync with desk, not divergent

Mobile **inherits desk's design tokens** (paper #F8F6EF, ink, gold #C69A35) so mobile feels like Holon, not like a separate app. The only frame-shaped CSS that diverges is the **phone-shell** wrapper (which uses mibusy's centered-dark-page pattern, but ONLY on desktop browser viewport ≥ 768px so the phone stands out; on a real phone the frame is invisible).

**Design-sync discipline** (M-G-006): every mobile design pass diffs desk's current `apps/web/app/globals.css` + `src/ui-mock/_shared/components.css` first; mobile's tokens never drift unless desk's drifted first.

## Principle 4 — Mobile agent pipeline is LIGHTER than desk's

Desk's track runs 5 cron orchestrators + dev daemon + Test/Dev/Requirements 3-agent model. Mobile is **thinner**: mobile-DEV/QA/PROMOTE/REQ cron + dev daemon + **Design Agent** (added in M003, conditional on `[design]` tag — see `docs/mobile-agents/design-agent.md`). Multi-agent specialization (M-G-007) is **closed at this scope**:

- **Design Agent** — shipped (M003). Triggers on `[design]` tag; writes design-spec then hands off to Dev. Visual quality is mobile's main risk, so this one earned its keep.
- **Product Agent** — **deferred** until bottleneck. Mobile has no product surface to shape (desk owns product); requirements flow through human + Requirements Agent today.
- **Test Agent** — **deferred** until bottleneck. Dev daemon's inline smoke gates (typecheck + curl) cover current surfaces; a separate Test Agent earns its keep once mobile has stateful flows worth regression-testing.

Re-open either if cycle-time or regression rate makes the case.

## Principle 5 — Auth eventually = owner login on desk + mobile uses that session

V1.5+: mobile won't have its own auth flow until desk's auth surface exists. Mobile's `/me` is publicly accessible right now (dev mode, single-tenant). Adding auth is a desk-side change (`/api/v1/auth/*` endpoint) + mobile picks up the session token. Filed as future M-G when desk auth lands.

---

## Implications for in-flight work

- **M-L-005** (iPhone 16 + mibusy frame + desk tokens): correct as filed. Tabs are 4 (聊天/今日/收件/我). Reuses desk's paper theme inside the phone-shell.
- **M-G-007** (multi-agent specialization): CLOSED at current scope (M003). Design Agent shipped; Product + Test specialization deferred (see Principle 4). Re-open if cycle-time or regression rate justifies it.
- **M002 P6** (Capacitor Android wrapper): still relevant — the "thin shell" needs a native shell.
- Future mobile iters: STOP before adding any new tab. Mobile menu = 4 always (V1). New features go INSIDE existing surfaces, not as new top-level tabs.

## Reference

- `docs/product/vision-v2-product-shape.md` — Holon's 4-quadrant product positioning (chat / Teams / Outlook / Jira). Mobile shows just the consumer-facing slice; desk shows everything.
- `apps/web/app/globals.css` — desk's design tokens (mobile MUST match these).
- `/home/chenz/project/mibusy/apps/web/components/AppShell.tsx` + mibusy globals — visual frame pattern reference (only the phone-shell wrapper, not the content semantics).

# Admin Surfaces (Dev-Only Endpoints)

Status: draft (iter-007 implementation status)
Date: 2026-05-16
Author: Requirements Agent
Position: Sibling of `owner-assistant-tools.md` and
`worker-dispatcher.md`. Documents the small set of admin / dev-loop
endpoints introduced during iter-007 that exist purely for the
developer-on-keyboard, not for end-user product flows. Sits under
`implementation-architecture.md` (the build-it spec) rather than under
any of the architectural cores.

## 1. What This Doc Covers

Three endpoints under `apps/web/app/api/v1/admin/` plus the two UI
affordances that drive them. These exist to make the iter-007 dev
loop faster:

- wipe agent state mid-conversation when a turn goes off the rails,
- file a bug from the browser without leaving the app,
- polish user-written text on the `/me` page without going through
  the full chat surface.

What this doc does NOT cover:

- The owner agent — see `owner-assistant-tools.md`.
- The worker dispatcher — see `worker-dispatcher.md`.
- Production observability — see `observability-and-metrics.md`.

## 2. Why "Admin Surfaces" Need a Doc at All

Three reasons these endpoints get their own spec entry rather than
just code comments:

1. **They have side effects on agent state** (kill a subprocess, drop
   maps in memory, write files to disk). A reader doing a security
   pass needs them surfaced.
2. **They will be gated / removed in prod** (see § 6). Forgetting
   them in the V2 cutover would leak a wide-open `/api/v1/admin/reset`
   to any caller who reaches the BFF.
3. **They are the only routes today that bypass the owner agent.**
   Everywhere else, mutations go through the chat tool surface (per
   Engineering Rule 6, owner-mediated authority). Admin endpoints are
   the explicit dev-loop escape hatch from that rule.

## 3. Endpoints

### 3.1 `/api/v1/admin/reset`

**File:** `apps/web/app/api/v1/admin/reset/route.ts`

| Method | Behaviour |
|--------|-----------|
| `GET`  | Inspect-only. Returns `{ bridge, dispatcher, persisted_artifacts }`. Safe to call from anywhere. |
| `POST` | Destructive. Clears the in-memory mutable store, terminates all live CLI tmux sessions, and wipes the project store. Returns `{ ok, store, cli_sessions, projects_cleared, note }`. |

What `POST` actually does (see `apps/web/app/api/v1/admin/reset/route.ts`):

1. `clearMutableStore()` from `@holon/core` — empties the in-memory
   Maps holding jobs and worker deliverables.
2. `clearAllCliSessions()` from `@holon/core` — terminates every
   live CLI employee tmux session. Next dispatch spawns a fresh
   session.
3. `clearProjectStore()` from `@holon/core` — wipes the project
   registry. The warm Secretary process (see `apps/web/lib/warm-agent.ts`)
   is independent and is not killed by reset.

What it does NOT touch:

- `src/ui-mock/_shared/fixtures.snapshot.json` — read-only baseline.
- `bugs/` directory — bug reports persist across resets.
- The boss memory store at `~/holon-agents/boss/` — markdown
  memory survives resets by design (owner-managed state).

> **Lineage.** An earlier sister-repo (`holon-engineering`) version
> of this endpoint also killed a Hermes ACP subprocess via
> `closeBridge()` from `apps/web/lib/hermes-acp-client.ts`.
> `manage-your-cli` has no Hermes runtime and no such bridge; the
> CLI-session cleanup above replaces it.

**Driver:** `apps/web/app/me/_components/DebugControls.tsx` — two
buttons on `/me`: "Wipe chat + jobs + worker deliverables" and
"Reset + reload" (the second issues POST then `location.reload()`).

### 3.2 `/api/v1/admin/bugs`

**File:** `apps/web/app/api/v1/admin/bugs/route.ts`

| Method | Behaviour |
|--------|-----------|
| `POST` | Accepts a bug report. Writes `bugs/<ts>-<id>/{report.md, screenshot.<ext>}` to disk under repo root. |
| `GET`  | Lists known bug folders by mtime desc. |

POST payload shape (validated by `isPayload` in the handler):

```
{
  description: string,           // required, trimmed
  url: string,
  route: string,
  viewport: { w: number, h: number },
  user_agent: string,
  ts: ISO-8601 string,
  screenshot_data_url: string | null,   // data:image/...;base64,...
  screenshot_filename: string | null,
}
```

`bug_id` format: `bug-<YYYYMMDD>-<HHMMSS>-<8-char-rand>`. The folder
contains a markdown `report.md` (description + metadata) and, if a
screenshot was attached, the decoded image.

POST response shape (updated 2026-05-16 after iter-007 tester run #2,
PII-leak fix):

```
{ ok: true, bug_id: "bug-<...>", location: "bugs/<bug_id>" }
```

**Explicitly no `path` field.** An earlier version returned
`path: "/home/<user>/project/holon-engineering/bugs/<bug_id>"`,
which leaked the developer's absolute filesystem path back to the
browser. The `location` field is a relative path under the repo
root and is the only path-like value the client receives. The
`BugReportButton` UI displays just `bug_id` to the user. Recorded
as part of the PII / privacy hygiene policy — see Appendix A.

Side effect: a structured stdout audit line:

```
{ audit: "bug.filed", bug_id, route, description_preview, has_screenshot, ts }
```

**Driver:** `apps/web/app/_components/BugReportButton.tsx` — floating
button (visible app-wide) + modal. Hotkey `⌘/Ctrl+Shift+B`. Captures
the current viewport via `html2canvas` (or the platform equivalent),
encodes to data URL, POSTs to this endpoint.

**Intended consumer:** Claude Code itself. The user files a bug from
the running app; the developer (or an agent) later lists `bugs/`,
walks each report, and scopes a fix. No autonomous triage worker in
V1.

#### 3.2.1 On-Disk Queue Format

Bugs are a flat on-disk queue under `<repo-root>/bugs/`. There is no
index file, no `state.json`, no DB row — `ls bugs/ | sort` IS the
queue, and `mtime desc` is the read order (matches `GET` above).

```
bugs/
├── bug-20260516-093312-a1b2c3d4/
│   ├── report.md            # always present
│   └── screenshot.png       # optional; .png | .jpg | .webp | .gif
├── bug-20260516-094501-e5f6a7b8/
│   └── report.md            # screenshot may be absent
└── …
```

Folder name = `bug_id` verbatim. The intentional double-encoding of
the timestamp (folder name + `ts` in `report.md` front-matter) means
the folder is greppable / sortable from the shell without parsing
markdown, while the report retains its own self-describing copy.

`report.md` shape (the handler is the canonical source; reproduced
here for the consumer):

```markdown
# Bug <bug_id>

- ts: <iso>
- route: <pathname>
- url: <full url>
- viewport: <w>×<h>
- user_agent: <ua>
- screenshot: <filename | "none">

## Description

<user-entered free text, untrimmed past the leading/trailing whitespace>
```

Lifecycle: **append-only**. Nothing in V1 marks a bug as triaged,
closed, or duplicate. The expectation is that whoever fixes the bug
deletes the folder (or moves it to `bugs/archive/`) at the same time
they commit the fix; the disk is the to-do list. This matches the
flat-file ethos of the iteration folders (`iterations/NNN-{slug}/`)
elsewhere in the repo.

#### 3.2.2 No Autonomous Fixer — Human-In-The-Loop Decision

We do **not** want a dispatcher-style background process that picks
bugs off `bugs/` and spawns a worker to fix them. Decision recorded
explicitly because it is the obvious-looking next step:

- A bug report is a high-context, ambiguous artifact (a screenshot, a
  one-paragraph description, possibly a stale URL). The decision of
  what to fix and what to push back on is exactly the kind of
  judgement Engineering Rule 6 reserves for the owner — autonomous
  triage would re-create the auto-accept failure mode on the inbound
  side.
- The realistic fixer is Claude Code itself, driven by the developer.
  The developer reads `bugs/`, picks one, and runs Claude Code with
  the report as context. That keeps the human in the loop at the
  decision point with no infrastructure cost.
- If, in V2+, a triage worker is wanted, it should be a *staff
  member* on the desk with a normal `assign_to_staff` flow (per
  `owner-assistant-tools.md` § 5.2), not a built-in dispatcher.
  That preserves Rule 1 (product state above the runtime) — bug
  fixing becomes work the owner schedules, not work the platform
  initiates.

### 3.3 `/api/v1/admin/polish`

**File:** `apps/web/app/api/v1/admin/polish/route.ts`

| Method | Behaviour |
|--------|-----------|
| `POST` | One-shot DeepSeek call. Polishes a piece of user-written text in-place. Returns `{ polished: string }`. |

Request: `{ text: string, hint?: string }`.

- `text`: the raw draft (intro, persona, skill body, etc.).
- `hint`: optional context (e.g. "this is the desk AI's persona").

#### 3.3.1 Dual-Mode (Updated 2026-05-16)

The endpoint now operates in two modes determined by which of the
two body fields is non-empty:

| `text` | `hint` | Mode | System-prompt behaviour |
|---|---|---|---|
| non-empty | (any) | **Polish in-place** | "match the language, fix grammar / awkwardness, do not add information" |
| empty | non-empty | **Generate from scratch** | "generate a short draft consistent with the hint" |
| empty | empty | 400 | rejected — nothing to act on |

The single-mode validator was relaxed: empty `text` is now accepted
**iff** `hint` is non-empty. The system prompt was extended with
the explicit branch: *"if draft empty/stub → generate; if
substantive → polish in-place."*

Rationale: the user reported the "✨" button on a blank field
did nothing — discoverability bug, because the user expected a
button next to an empty field to *produce* content from the hint
context. The dual-mode behaviour matches that expectation. Per
Engineering Rule 6, the suggestion still requires owner-acceptance
before the PATCH lands; nothing about the safety surface changes.

Discoverability note: the `InlineField` UI does not yet visually
differentiate the two modes — same ✨ glyph in both cases. If a
user complains that "polish" is rewriting more than they expected,
a tooltip ("generates draft" vs "polishes draft") is the cheap
next step. Flagged as Open Q 5 below.

Goes through the provider's `chat/completions` endpoint **directly**,
not through any agent-loop runtime (this point originally distinguished
the path from the sister-repo's Hermes runtime; `manage-your-cli` has
no Hermes runtime, so the distinction collapses to "no agent loop").
Rationale:

- No agent loop, no tools, no streaming needed.
- Token budget is bounded (`max(300, text.length * 2)`).
- Temperature 0.3 — small editorial tweaks, not rewrites.
- The system prompt explicitly forbids adding information or
  changing substance, and instructs to match the language
  (Chinese stays Chinese, English stays English).

Failure modes:

- 503 if `DEEPSEEK_API_KEY` not present in `process.env` nor the
  repo-root `.env`.
- 502 if DeepSeek returns non-2xx (with truncated error body) or
  an empty completion.
- 400 on missing `text`.

**Driver:** `apps/web/app/me/_components/InlineField.tsx` — the
"✨ Polish" button on every long-text field on `/me`. The user types
freely; one click cleans it up.

This endpoint is the *only* admin surface that calls an external API
directly. Per Engineering Rule 1 (product state above the runtime),
this is acceptable because polish does not mutate Holon state — the
user still has to accept the polished text before it is saved back
to the OwnerAssistant record.

## 4. Engineering-Rule Alignment

| Rule | Compliance |
|------|------------|
| **#1 Product state above runtime** | Reset is the only endpoint that mutates Holon state, and the mutation is "drop everything" — not a model deciding what to do. Polish is read-only with respect to Holon state. Bugs writes to a side-channel (`bugs/`), not Holon state. |
| **#4 No silent failure** | Reset returns `{ ok, … }` with explicit counts of what got cleared. Polish maps DeepSeek errors to 502 with body preview. Bugs surfaces the audit line on stdout. |
| **#6 Owner-mediated authority** | **Explicit exception.** These three endpoints intentionally bypass the owner-agent funnel for dev-loop reasons. § 6 below covers how this is contained in prod. |
| **#8 Audit (V1 posture)** | Reset emits nothing yet (TODO: stdout line for parity with `bug.filed` and `staff.job.queued`). Bugs emits `bug.filed`. Polish emits nothing — the polish is offered, not committed. |

## 5. Threat Model (V1)

V1 binds to `localhost` only. Anyone who can reach the BFF can hit
these endpoints. In V1 single-user / desktop-Tauri posture (per
ADR-005) this is "the user themselves," so the threat surface is
limited to:

- a malicious dependency exfiltrating data via these endpoints —
  bug reports could leak screenshots; polish could leak the text;
  reset could DoS the dev experience.
- a malicious browser extension making cross-origin requests to the
  BFF — Next.js default CORS posture on `/api/*` is same-origin
  only, but if relaxed for any reason, these endpoints are reachable.

V2 must (see § 6):

1. Add an auth header (or session cookie) check to every admin route.
2. Gate `/api/v1/admin/*` behind `NODE_ENV !== 'production'` or an
   explicit `HOLON_DEV_ADMIN=1` flag.
3. Consider moving bugs to an authenticated "support" route that
   forwards to a real intake system rather than disk.

## 6. Production Cutover

Before V1 ships to users outside the dev team, the following gate
must be in place — **suggested implementation noted but not
authoritative** (ADR needed):

- A single middleware (`apps/web/middleware.ts` or per-route) that
  short-circuits `/api/v1/admin/*` with `404` when the runtime is
  not in dev / admin mode. The condition could be
  `process.env.HOLON_ADMIN === '1'` to make the dev / admin /
  user-prod posture explicit.
- The `BugReportButton` UI affordance stays — a bug report sink is
  legitimately a user feature — but it should switch to a
  user-prod endpoint (`/api/v1/support/bugs` or similar) that
  writes to a real intake system. The `bugs/` directory is a
  dev-only convenience.
- `/api/v1/admin/reset` is dev-only forever. No production user
  needs a "wipe agent state" button at the BFF layer; a logout +
  re-login flow is the right user-facing equivalent.
- `/api/v1/admin/polish` is the trickiest. It would be a useful
  *user* feature too, but the current implementation talks to
  DeepSeek without checking the owner's `monthly_budget_mc`. Either
  promote it to a production-grade route with budget enforcement,
  or keep it dev-only and have the polish UI go through the chat
  surface in prod.

ADR title suggestion: *"Admin endpoint gating + bug-report intake
path for V2 cutover."*

## 7. Open Questions

1. **Reset granularity.** Today reset is all-or-nothing. Some dev
   loops want "wipe the conversation but keep the queued jobs" or
   "wipe jobs but keep this chat thread." A query-string
   (`?scope=bridge|store|all`) would solve this cheaply.
2. **Bug-report deduplication.** A user clicking the bug button
   three times in a row creates three folders. Probably fine for V1
   (the developer can merge in triage) but might want a content-hash
   short-circuit later.
3. **Polish + budget accounting.** The polish endpoint calls
   DeepSeek directly with no budget gate (see § 6 bullet 4). Even
   in dev, this could rack up surprising spend if the user
   spams the button. Add a per-day call cap?
4. **Audit parity.** Reset should emit an audit stdout line
   (`{ audit: "admin.reset", killed_session, jobs_cleared, … }`)
   for symmetry with `bug.filed` and `staff.job.queued`. One-line
   change.
5. **Polish dual-mode visual differentiation.** Same ✨ glyph
   covers both "polish in-place" and "generate from scratch."
   The mode is implicit (empty `text` ⇒ generate). A user with
   a stub draft ("ml engineer") may be surprised when a click
   replaces it wholesale. Tooltip-level differentiation suffices;
   no contract change.

## 8. Cross-References

- `owner-assistant-tools.md` § 10.6 — admin reset hook on the
  agent side (closes the ACP bridge)
- `worker-dispatcher.md` § 4.1 — what `clearMutableStore` empties
- `implementation-architecture.md` — overall build-it context;
  these endpoints live under `apps/web/app/api/v1/admin/`
- `observability-and-metrics.md` — the V2 home for the audit lines
  these endpoints currently dump to stdout
- ADR-005 — V1 = desktop-Tauri single-user posture; the source of
  the "localhost-only is OK" V1 simplification
- ADR-007 — V1 audit posture; admin endpoints follow the same
  diagnostic-record convention

## Appendix A — PII / Privacy Hygiene (Appended 2026-05-16)

### A.1 Why This Is Here, Not Elsewhere

Holon is a **product for other people's desks**, not the
developer's personal config. Every default that ships in fixtures,
schemas, or default-route responses is seen by every user of the
product. A hardcoded developer path, name, or interview detail
becomes a privacy leak the moment a second user runs the binary.

This appendix lives in `admin-surfaces.md` because:

- The bug-report endpoint (§ 3.2) was one of the leak sites — it
  returned an absolute fs path to the browser.
- The polish endpoint (§ 3.3) and the reset endpoint (§ 3.1) sit
  in the same admin-surface neighbourhood and share the same
  "developer convenience that must not leak in prod" cutover
  concern (§ 6).
- The fixture snapshot used to seed first-run defaults is read by
  these admin endpoints transitively.

This is **ADR-worthy**. Suggested title: *"PII-free defaults:
fixtures, schemas, and route responses ship with generic
placeholders only."* Suggested location:
`docs/decisions/018-pii-free-defaults.md`. See § A.4 verdict.

### A.2 The Five Cleaned Sites

Iter-007 tester run #2 surfaced and verified the cleanup. All five
sites previously contained the literal string
`/home/<developer>/project/holon-engineering` (or equivalent
hardcoded developer identifier); all five now resolve at runtime:

| # | File | Leak class | Fix |
|---|---|---|---|
| 1 | `apps/web/lib/hermes-acp-client.ts` (sister-repo lineage; not present in `manage-your-cli`) | Spawn cwd hardcoded to developer's path | `process.cwd()` |
| 2 | `packages/core/src/worker-dispatcher.ts` (sister-repo lineage; not present in `manage-your-cli`) | Same — worker spawn cwd | `process.cwd()` |
| 3 | `apps/web/app/api/v1/admin/polish/route.ts` | `.env` resolution path hardcoded | `process.cwd()` |
| 4 | `apps/web/app/api/v1/admin/bugs/route.ts` | Bug folder root + leaked `path` in response | `process.cwd()` + response field renamed to `location: "bugs/<bug_id>"` |
| 5 | `apps/web/public/_shared/shell.css` + `src/ui-mock/_shared/shell.css` | CSS comment referenced developer's repo path | comment scrubbed |

Plus two fixture cleanups (not "sites" in the spawn-path sense
but shipped-data leaks):

- `src/ui-mock/_shared/fixtures.snapshot.json`: `workspace_dir`
  defaulted to `""` instead of the developer's repo path.
- `apps/web/public/_shared/fixtures.snapshot.json`: re-synced from
  the above so the served fixture matches.

Generic-placeholder substitution in `MeClient.tsx`: the seeded
intro string "AD / VLA Researcher · NVIDIA E2E AV interview" was
replaced with "Senior Product Engineer · Acme." A user's first
view of `/me` no longer reveals who built the product.

### A.3 The Policy (Adopt Before More Iters Land)

1. **No hardcoded paths.** Any absolute path that ends up in a
   spawn cwd, an `.env` lookup, a route response, or a CSS comment
   must come from `process.cwd()`, an env var, or a config file —
   never a string literal containing `/home/` or `C:\Users\`.
2. **Fixtures ship with `""` or generic placeholders.** No real
   developer name, role, project, employer, or interview detail.
   "Acme", "Senior Product Engineer", "your-org" are the
   approved placeholders.
3. **Route responses never leak fs paths.** Use relative paths
   under the repo root (`bugs/<id>`, `deliverables/<id>`),
   opaque IDs (`bug_id`), or `location` fields scoped to the
   API namespace. Absolute paths are diagnostic-only and may
   appear in stdout audit lines but never in a 2xx body.
4. **CSS / HTML comments are part of the shipped artifact.**
   `// my notes on /home/<user>/...` in a CSS file shipped to the
   browser is a leak; scrub before merge.
5. **The PR review checklist gets a one-liner:** "grep for
   `/home/`, your name, your employer, your current role in the
   diff."

### A.4 Verdict — Is the ADR Urgent?

**Yes.** This is the kind of policy that gets cheaper to enforce
the earlier it lands and progressively more painful as more
iterations bake in non-generic defaults. Three concrete reasons:

- iter-007 surfaced **five** sites in a single tester pass; the
  base rate of accidental hardcoding is non-trivial without a
  written policy and an automated grep gate.
- Two of the five (the spawn-cwd ones) would have failed at
  first-user runtime — a user not running from
  `/home/<developer>/project/holon-engineering` would have got a
  spawn error. So this is not purely a privacy concern; it is
  also a *correctness* concern for any second installation.
- The policy is short and uncontroversial. A 30-minute human
  review of the suggested ADR plus a CI grep step pays back
  every future iteration.

Recommendation: **human reviews this ADR before iter-008 lands**.

### A.5 New Open Question

A-1. **Should the policy be enforced by CI grep?** A pre-commit
or pre-push hook that fails on `/home/`, `C:\\Users\\`, or a
shortlist of developer-identifying strings in any tracked file
would make the policy mechanical rather than aspirational. The
shortlist itself is a maintenance burden (the developer's name
changes if the team grows) — flag for the ADR discussion.

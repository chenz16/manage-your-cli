# Holon Dev Queue — Backlog Feeder

> **Status: Historical record.** This document captures a point-in-time
> snapshot. References to **Hermes** / `hermes-acp` /
> `hermes_profile_generic_v1` describe the runtime used by the sister
> repo [`holon-engineering`](https://github.com/chenz16/holon-engineering)
> at the time of writing. `manage-your-cli` does not bundle, link to, or
> depend on Hermes — its live substrate is a direct multi-CLI adapter
> (`claude` / `codex` / `gemini` / `qwen`) under
> [`packages/core/src/cli-adapters.ts`](../packages/core/src/cli-adapters.ts)
> and [`apps/web/lib/warm-agent.ts`](../apps/web/lib/warm-agent.ts).
> The body below is preserved unedited for history.

**Status changed 2026-05-17:** this file is no longer the canonical priority list for the dev rotation. Live, prioritized work now lives in **`iterations/010-catalog-real/plan.md`** (and successor iter `plan.md` files). This file is the long-tail, unprioritized backlog from which the Requirements Agent pulls items into each iter's `plan.md`.

## How this works now

```
Backlog (here)
    ↓ Requirements Agent pulls 3-5 items per iter
    ↓
iterations/NNN-<slug>/plan.md   ← live work; dev rotation picks from here
    ↓ ships
docs/dev-log.md                  ← append-only ship history
```

- The in-session dev cron + cloud dev routine read **`iterations/NNN-<slug>/plan.md`** (current iter), not this file.
- When an iter closes, its `feedback.md` may surface new backlog items — they land below in the "Backlog" section, tagged with their originating iter.
- When the next iter opens, the Requirements Agent revisits this backlog and pulls 3-5 items into the new `plan.md`. The rest stays here until pulled or aged out.

## Status legend (for items below)

- `[ ]` open, candidate for next iter pull
- `[in-iter:NNN]` already pulled into a live iter
- `[shipped:SHA]` shipped (SHA short) — left here briefly for visibility, removed on next iter close
- `[blocked]` blocked — reason inline
- `[backlog:V2]` deferred to V2 per `docs/product/roadmap-mvp-to-enterprise.md`

---

## Current iter (live work — see plan.md)

**iter-010-catalog-real** — `iterations/010-catalog-real/plan.md`
- Theme: D1 + D7 + D9 — "make the catalog real"
- Status: open 2026-05-17
- Pass #1 (D1 LLM-only: `decompose_task` / `ambiguity_probe` / `format_deliverable`) — `[shipped:bb77597]` under background agent `a645f9c2`
- Pass #2 (D1 shell-out: `make_pdf` / `make_slides`) — open
- Pass #3 (D7 cost-service core) — open
- Pass #4 (D7 budget UI) — open
- Pass #5 (D9 Playwright unfixme + CI) — open

---

## Backlog (not yet pulled into an iter)

Roughly priority-ordered (top = most likely next-up). Refresh ordering at each iter close.

### High — strong candidate for iter-011

- `[x] 9d9e5c9` **M-L-036 — `/staff/[id]` static-export blocker for Capacitor APK build**
  - `next build` with `output: 'export'` (NEXT_PUBLIC_CAPACITOR=1) errors:
    `Page "/staff/[id]" is missing "generateStaticParams()" so it cannot be used with "output: export" config.`
  - Repro: `cd apps/mobile && rm -rf out && NEXT_PUBLIC_CAPACITOR=1 pnpm exec next build`
  - Impact: `scripts/build-android-apk.sh` (M-L-036) correctly aborts in strict mode. The old `scripts/build-android.sh` silently falls back to stale `apps/mobile/out/` from a prior build, producing an APK without the staff routes — APK still installs but `/staff/<id>` paths 404 inside the WebView. This was masked until M-L-036 added strict failure handling.
  - Fix options (pick one in iter-011):
    1. Split `app/staff/[id]/page.tsx` into a server-component shell (`generateStaticParams`) + `'use client'` subcomponent. Stub `generateStaticParams` returns `[{id: '_'}]`; rewrite `/staff/<id>` links to `/staff/_?id=<id>` for the Capacitor build only; client reads either route param or query param.
    2. Convert `/staff/[id]` to a static `/staff/detail` page that reads `id` from `useSearchParams`. Smaller refactor; loses pretty URLs in the Capacitor build but those don't matter in a native shell.
  - Recommendation: option 2 (simpler, single file). ~20 LOC across `page.tsx` + 1 link in `app/staff/page.tsx`.
  - Blast radius: small (single dynamic route; only touches mobile build path).
  - Originating: M-L-036 ship-pipeline work, 2026-05-18.

- `[x] eb7da55` **D6 — Reference local-path UI + `extract_references` plugin tool**
  - "+ New Reference" modal: add `source_type` selector + `local_path` input.
  - Implement `extract_references` Hermes tool: takes a folder path, enumerates files, reads each, returns a list of proposed ReferenceDescriptors for owner confirmation.
  - Done = user can point at `/home/me/specs/` and get N reference cards back, accept each.
  - Blast radius: medium (unlocks the "drop a docs folder" workflow).
  - Originating: TECH-DEBT D6 (iter-009).

- `[x] 9ffb6e6` **D5 — Wire `denied_skills` runtime enforcement in worker dispatcher**
  - Before invoking a skill tool, check `staff.denied_skills`. If denied, return structured error to the LLM ("This staff is not authorized to use {skill_id}; try X instead").
  - Audit emit on deny.
  - Done = E2E: create staff with `denied_skills=['make_slides']`, ask them to make slides, verify they pick a different skill or refuse cleanly.
  - Blast radius: medium (without this, deny-list is theatrical).
  - Originating: TECH-DEBT D5 (iter-009). Best ridden in after iter-010 Pass #3's worker-dispatcher refactor lands.

- `[ ]` **QA P1 batch — post-iter-009 UI polish** (from `docs/reviews/2026-05-17-qa-v1-audit.md`)
  - A-2 page-strip count text overlaps × close button (all panel pages) — small
  - M-2 mobile nav: "References" tab clipped at 390px — medium (responsive nav)
  - M-3 mobile split-shell too cramped under ~700px — medium (responsive shell)
  - F-7 mobile `/members` "1 Issue" pill (investigate — probably xterm-in-narrow)
  - F-9 HireDialog missing `role="dialog" aria-modal`
  - Pull 3 most-visible into next polish iter, or fold into iter-011 if scope permits.

- `[x] 2dbc5d3` **D1.3 — `make_spreadsheet` skill (pandas / openpyxl shell-out)**
  - Filed at original D1.2 line. Iter-010 Pass #2 covers `make_pdf` + `make_slides`; spreadsheets is a separate piece on the same shape.
  - Done = `make_spreadsheet` flipped to `implemented: true` + chat round-trip in dev-log.md.

### Medium

- `[x] c5d6468` **D10 — Source-of-truth `_builtin: boolean` per item in catalog GET responses**
  - Drop the hardcoded `BUILTIN_*_IDS` Set from client; let server tell the client.
  - Already done for skills (per CRUD agent report — response includes `_builtin`); replicate for templates + references.
  - Done = `BUILTIN_TEMPLATE_IDS` and `BUILTIN_REFERENCE_IDS` const dropped from Templates/References Clients.
  - Blast radius: tiny.

- `[x] 8e4418b` **D2 — Drop legacy `_dispatched.md` reader path**
  - bug-watcher.ts still reads `_dispatched.md` markers from old bugs. Clean up.
  - Done = `BugStatus.dispatched` field removed; BugQueue UI branch removed.

- `[x] f162bc7` **D3 — Persona apply path: lift substrate.tool_scope to top-level OR add force flag**
  - Removes the "two paths writing substrate" footgun.
  - Done = persona route reuses the standard PATCH path.

- `[x] 7eade2a` **D4 — Refactor `templatesAsReferences()` to dodge the require() hack**
  - No actual circular dep existed; static import added directly in reference-catalog.ts.

- `[ ]` **Competitive: MCP client support** (competitive scan rec #1, `docs/reviews/2026-05-17-competitive-landscape.md`)
  - Highest-leverage single move per competitive scan. Wire at runtime-adapter so Hermes calls MCP tools the same way as local plugin tools — preserves Engineering Rule #1.
  - Sized: ~1 eng-week. Candidate for iter-012 after D8 settles runtime-adapter pattern.

- `[ ]` **Competitive: SSE streaming + mid-flight intervention on long jobs** (competitive scan rec #2)
  - `assign_to_staff` returns a job that streams plan/step/output back into chat as live-updating action card; owner can post "pause / change / cancel".
  - Closes the biggest V1 trust gap ("did it die or is it still working?").
  - iter-011 candidate after iter-010's worker-dispatcher refactor lands.

### Low / nice-to-have

- `[x]` **D11 — Re-enable `instrumentation.ts` for t=0 server-boot hooks** *(decided: already active — see dev-log 2026-05-20)*
  - Audit found `instrumentation.ts` is already enabled and firing at t=0 since iter-011 (2026-05-18). Queue entry premise ("lazy-init via root layout") was stale. Next.js 15 picks up the hook automatically; `[instrumentation] loaded .env from …` confirmed in dev logs. No action needed; closing as already-done.

- `[x]` **D12 — assistant-ui hydration warning root-cause** `51ed381`
  - Mitigated, not fixed. Pin assistant-ui version + open upstream issue.
  - Pinned `@assistant-ui/react` → `0.14.5` (exact), `@assistant-ui/styles` → `0.3.7` (exact). Lockfile unchanged. Mitigation documented in `ChatSurface.tsx` `ThreadView`. Upstream issue text in dev-log (manual owner follow-up).

- `[ ]` **Cultivation profile editor UI** (from old backlog)
  - Dedicated screen / modal for owner to view and edit a staff member's cultivation profile (per `docs/architecture/local-agent-management.md` § 7).

- `[ ]` **Approval Chain composer** (from old backlog)
  - Drag-and-drop chain builder UI per `docs/architecture/handoff-taxonomy.md` § 5.

- `[ ]` **Negotiated handoff chat-style UI** (from old backlog)

- `[ ]` **Connection health drill-down** (from old backlog)

- `[ ]` **Audit timeline view** — per-entity event timeline (subscribes to audit_events).

- `[ ]` **Onboarding tutorial** — first-run walkthrough for new desk owners.

- `[ ]` **Keyboard shortcuts** — quick navigation, quick assignment creation.

- `[ ]` **Dark mode** — brand-consistent dark palette.

- `[ ]` **focus-visible polish in drawer + chat layers** — per iter-001a UX review P2; per `ui-architecture.md` § 9.1.

- `[ ]` **`tests/COVERAGE.md` populate beyond placeholder** — lands naturally as real tests accumulate (iter-010 Pass #5 will move this).

### Tagged for V2+

(See `docs/product/roadmap-mvp-to-enterprise.md` for the broader phasing plan; mirrored in `requirements/backlog.md`.)

- `[backlog:V2]` **D8 — Peer Connections (Core 2)** — pair-new ECDH/HKDF handshake, cloud relay, dispatch_handoff crossing desks. Multi-week. Likely iter-013 or later.
- `[backlog:V2]` **Holon-in-Slack plugin** (competitive scan rec #3) — `/holon` slash command mapping Slack thread → Desk AI; deliverables posted back as attachments.
- `[backlog:V2]` **SSO + audit log export** — gated above ~500-person co.
- `[backlog:V2]` **Cross-desk SLA timers** — Wei is judged on response time to peer desks.
- `[backlog:V2]` **Org admin console / SSO setup wizard / Sandbox-mediated handoff UI / WebRTC direct-peer toggle / Audit export wizard**

### Tagged for V3+

- `[backlog:V3]` Federation pairing UI
- `[backlog:V3]` Cross-org policy console
- `[backlog:V3]` Compliance certifications dashboard

---

## Shipped (rolling — flushed at next iter close)

- `[shipped:bb77597]` 2026-05-17 — D1.1 LLM-only skill tools (`decompose_task`, `ambiguity_probe`, `format_deliverable`). Pulled into iter-010 Pass #1.

See `docs/dev-log.md` for the canonical append-only ship history.

### Deliverables enhancements (owner feedback 2026-05-20, via /deliverables Feedback)
- `[ ]` **DEL-1 — Deliverable provenance**: every staff-agent deliverable shows the reference files + skill used to produce it, so the owner can see how to adjust (swap reference, tweak skill) when unsatisfied. (bug-20260520-183437)
- `[ ]` **DEL-2 — Terser summaries (results, not process)**: digest/deliverable summaries should lead with the result, trim the process narration. Encode in the owner-assistant ("老板小秘") persona. Owner believes this was discussed before — VERIFY current persona/digest prompt + tighten. (bug-20260520-183636)
- `[ ]` **DEL-3 — Accept / rework actions + LLM-polished comment**: deliverable detail gets next-step actions (Accept / 返工) plus a free-text comment that can be LLM-refined before sending back to the staff. (bug-20260520-183909)

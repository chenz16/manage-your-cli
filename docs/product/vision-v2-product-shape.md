# Vision v2 — Product Shape

Date: 2026-05-17
Status: Living doc — drives prioritization for iter-010+ until next revision.

## The one-line positioning

> Holon is **a chat-first AI workforce console** — what you'd build if **Microsoft Teams + Outlook + Jira + Cursor's chat panel** were rewritten from scratch around "the owner has a team of AI staff who handle the bulk of the work."

Each component analogy:
- **Chat window (Cursor / ChatGPT / Claude desktop)** — the left panel: owner converses with a Desk AI that delegates work. This is the *control plane*. No fixed menus; chat is the action interface.
- **Microsoft Teams** — @-mention multiple staff to summon them into a thread; threads can include peer humans from other Holon desks (Core 2). Ad-hoc, no calendar.
- **Microsoft Outlook** — the inbox of incoming work from peers (`/inbound` = missions delivered by other desks) + the inbox of communications (Inbox Summary skill triages email; future: Gmail/Outlook integrations live here).
- **Atlassian Jira** — `/today` is the kanban-ish view of work in flight (running / waiting / pending / returned / blocked / retrying buckets); `/deliverables` is the archive of returned artifacts; per-staff jobs queue parallels assigned tickets.

The cohesion: traditional Teams + Outlook + Jira each siloed by tool. Holon collapses them around one mental model — **"work delegated to AI staff, surfaced where the owner needs it"**.

## Two persona targets

### V1 — Small business owner / solo founder ("Maya")

- 1-person shop pre-PMF, or solo consultant, or marketing director running a 3-person team.
- Wears 5 hats: product, sales, support, marketing, ops. Time is the bottleneck.
- Low-medium IT sophistication. Uses Notion, ChatGPT, Slack, Google Workspace. Not in a corporate stack.
- **Wants:** delegate the bulk of repetitive cognitive work; produce polished deliverables; never lose context between tasks.
- **Doesn't want:** complex IT setup, per-seat-license dance, integration certifications.
- **Default persona on first run:** "Founder / Solo GM" or a domain-specific one (e.g. "Marketing Director · Robotics" — already shipped).

### V2 — Large-company individual contributor ("Wei")

- Director / PM / EM at a 500-5000 person company.
- Embedded in a Teams + Outlook + Jira + Confluence stack.
- High IT sophistication; SSO, role-based access, audit logs are required.
- **Wants:** cross-desk handoffs (Wei in marketing dispatches to Sara in engineering — both run Holon desks → peer Connections / Core 2); SLA-tracked deliverables; budget visibility for FinOps.
- **Needs:** integrations with the existing stack (Slack, Outlook, Jira tickets, Confluence pages); enterprise audit log export; per-staff cost attribution.
- **Default persona:** role-specific bundle ("Engineering Manager · Backend Infra", "Product Manager · Consumer", "Finance Controller · Startup" — all shipped).

V1 is current focus. V2 features (peer connections, enterprise integrations, role-based access) live in iter-010+.

## User daily-activity sequence diagrams (V1 — Maya)

Each diagram below traces ONE realistic daily flow. Drives Playwright E2E tests in `tests/e2e/daily-flows/`.

### Flow 1 — Morning catchup ("What happened overnight + what should I do today?")

```
Maya             /                Desk AI          (skills)             /today        /deliverables
 |               |                  |                  |                   |               |
 |--open app---->|                  |                  |                   |               |
 |               |--load owner----->|                  |                   |               |
 |               |--load today----->|                  |                   |               |
 |               |<--snapshot-------|                  |                   |               |
 |<--greeting----|                  |                  |                   |               |
 |               |                  |                  |                   |               |
 |--"早上好 帮我过一遍昨天发生的事"-->|                  |                   |               |
 |               |                  |--summarize_inbox|                   |               |
 |               |                  |  + list_recent_jobs                  |               |
 |               |                  |<--results--------|                   |               |
 |<--3-bullet recap + 2 action items--|                |                   |               |
 |               |                  |                  |                   |               |
 |--"那个 NVIDIA 的报告搞完了么"--->|                  |                   |               |
 |               |                  |--list_recent_jobs(staff=Aria)        |               |
 |               |                  |<--job=running 67%, ETA 14:00         |               |
 |<--status reply with deliverable link when ready--|                      |               |
```

**Acceptance criteria:**
- Open `/` cold → Desk AI greets within 1.5s using snapshot context
- "summarize 昨天" should resolve via `summarize_inbox` skill (when implemented) OR fall back to a structured prompt
- Job-status query resolves via `list_recent_jobs` tool, names the staff + ETA
- All replies under 5 lines (V1 brevity rule)

### Flow 2 — Dispatch + receive ("I need a slide deck on humanoid robotics")

```
Maya          Desk AI          decompose_task    make_slides       /deliverables
 |              |                  |                  |                  |
 |--"我要一个 humanoid robotics 市场扫描的 PPT 给周五的投资人会"-->         |
 |              |--ambiguity_probe------------------>|                   |
 |<--3 clarifying Qs: audience? page count? deadline?  |                   |
 |--"投资人 / 10 页 / 周五下午"--->|                  |                   |
 |              |--decompose_task----------------->  |                   |
 |<--plan: research → outline → draft → deck (4 steps, 2h ETA)             |
 |              |                  |                  |                   |
 |--"go"-------->|                  |                  |                   |
 |              |--assign_to_staff(Aria, "research humanoid robotics market")
 |              |<--job_id=job_..., status=running                        |
 |              |--make_slides(after Aria's deliverable)                  |
 |              |                  |--python-pptx--->|                   |
 |              |                  |<--/tmp/humanoid-robotics-deck.pptx   |
 |              |                  |                  |--write deliverable-->|
 |<--✅ Slides ready at /tmp/...pptx (link)----|                          |
```

**Acceptance criteria:**
- Ambiguity probe fires BEFORE the decompose (per Marketing Director persona system_prompt)
- Decompose surfaces plan + waits for owner nod
- Each step's progress visible in `/today` (Running bucket gains a card)
- Final deliverable appears on `/deliverables` with clickable file path (path-tokenizer renders clickable code chip → click-to-copy)

### Flow 3 — Building the team ("I need someone to handle market research")

```
Maya          Desk AI          create_agent       /members
 |              |                  |                  |
 |--"招一个市场调研员 主要看消费机器人 月预算 200 块"--->|
 |              |--ambiguity_probe-->|                |
 |<--clarify: full-time pace or on-demand? Chinese or English sources?
 |--"on-demand / both languages"--->|                |
 |              |--create_agent(name=研究员, role=...,
 |              |                budget=200_00000_mc,
 |              |                denied_skills=['generate_video', 'discord_post'])
 |              |<--staff_..., posted--|             |
 |              |                  |                  |--card visible-->|
 |<--✅ 招了 "研究员" (id=staff_...) · 月预算 200 元 · 默认 deny 视频生成/Discord
```

**Acceptance criteria:**
- Persona-aware: when CEO is Marketing Director, suggested new staff defaults bias toward marketing roles
- Budget surfaced in staff card (currently NO — see TECH-DEBT D7)
- Deny-list defaults to nothing (full inheritance); user can ask to deny specific skills inline
- After creation, staff appears in `/members` on next render (UI refresh)

### Flow 4 — Filing + watching a bug fix

```
Maya          BugReportButton   /api/v1/admin/bugs   bugs/<id>/      Claude Code (main dev)
 |              |                  |                  |                  |
 |--click 🐞 in nav--|              |                  |                  |
 |--paste screenshot via ⌘V--|     |                  |                  |
 |--type description + File bug--->|                  |                  |
 |              |                  |--write report.md|                   |
 |              |                  |  + screenshot.png|                   |
 |              |                  |<--201 bug_id-----|                  |
 |<--✅ Filed · bug-id--|           |                  |                  |
 |              |                  |                  |                  |
 |--/me Debug → BugQueue auto-polls every 5s--|       |                  |
 |<--bug visible as "pending"--|   |                  |                  |
 |              |                  |                  |                  |
 |--ask Claude in terminal "扫一下 bugs/ 看看"--|     |                  |
 |              |                  |                  |<--reads + fixes--|
 |              |                  |                  |--writes _processed.md|
 |<--BugQueue refreshes "✓ fixed"-|                  |                  |
```

**Acceptance criteria:**
- 🐞 button always visible (in Nav)
- ⌘V paste image works inline (already shipped)
- POST is fire-and-forget for the user (returns 201, success toast)
- BugQueue polls /api/v1/admin/bugs every 5s and updates without page refresh
- Status pill transitions: pending → claude working (manual dev label) → ✓ fixed / ⚠ needs-human

### Flow 5 — Adding a custom skill / template / reference

```
Maya          /skills (or /references or /templates)   Modal       LLM (describe mode)   Mutable store
 |              |                                       |              |                    |
 |--click "+ New"-|                                     |              |                    |
 |              |--open modal with 2 tabs------------>|              |                    |
 |--"Describe" tab: "weekly client update email — 1 paragraph summary, 3 wins, 2 asks"-->|
 |              |                                       |--POST /api/v1/templates {mode:describe}-->|
 |              |                                       |              |--DeepSeek json_object-->|
 |              |                                       |              |<--full descriptor------|
 |              |                                       |              |<--write dynamicTemplate|
 |              |                                       |<--201 preview--|                    |
 |<--preview card: name / kind / body / variables-|                    |                    |
 |--"Save"-->|                                                                                  |
 |              |--refresh list--|                                                              |
 |<--new card visible in "Yours" section--|                                                     |
```

**Acceptance criteria:**
- "+ New" button always visible on page-strip
- Both tabs (Describe, Direct) wired
- Describe mode round-trip < 15s with DeepSeek
- Saved entry appears in "Yours" section (not Examples) immediately
- Per-card × delete works on user-created entries; suppressed on Examples

## High-level design — what's there + what's missing

| Layer | Today (V1) | V2 gap |
|---|---|---|
| **Chat (control plane)** | assistant-ui Composer; DeepSeek via Hermes ACP; @mention typeahead | Multi-modal (image/file attach); voice; persistent thread history |
| **Catalog (skills/templates/references)** | Browse + CRUD + LLM-describe; 30/8/14 examples; user-created supported | Skill plugin tools mostly stubbed (D1); reference RAG over local_path (D6) |
| **Workforce (members)** | Roster with 6 substrate kinds; create/dismiss; CLI passthrough | AgentConfigDrawer (per-staff config UI for budget/deny/proxy — schema ready, UI missing); peer connections (Core 2) |
| **Work tracking (today/deliverables)** | Today buckets; jobs queue; deliverable list with path tokenizer | Per-job cost tracking (D7); SLA timer; deliverable diff/version |
| **Inbox (inbound)** | Mission card list with filter chips | Email integration (Gmail/Outlook); cross-desk mission auto-routing |
| **Owner config (/me)** | Persona picker (8 presets); inline identity + system_prompt with ✨ Polish; integrations slot | Integration OAuth flows; SSO; multi-desk owner identity |
| **Bug intake** | 🐞 fab + modal with ⌘V image; on-disk queue; manual-dispatch scan | Real auto-triage skill (replaces the retired tmux+claude path) |

## What this means for next iter

Highest-value V1-completing work, ranked:

1. **AgentConfigDrawer on /members** — schema's ready; UI gives the per-staff config surface. Without it the budget/deny-list/proxy fields are theatrical.
2. **Wire top-5 skill plugin tools to be real** (D1) — turn `implemented: false` into actual behavior for the most-cited skills. Owner sees the catalog do real work, not just describe.
3. **Cost tracking + per-staff budget meter** (D7) — high blast radius; runaway costs are the #1 user fear.
4. **Playwright E2E for the 5 daily-activity flows above** (D9) — gates regression on the most-used paths.
5. **Reference local-path UI + extract_references plugin** (D6) — unlocks the "point at a folder" workflow Maya needs to drop a docs library on the system.

V2 is everything peer-Connections-related — own iteration.

## How to use this doc

- Drives Playwright tests: each Flow N becomes a test file at `tests/e2e/daily-flows/flow-N-<name>.spec.ts` with the diagram as a header comment.
- Drives prioritization: at iter-close, score "are we able to do Flow 1-5 end-to-end?" — gaps are next iter's work.
- Revise on persona shift: when V2 work begins, add Wei's flows (cross-desk handoffs, integration config, audit export).
- Reference for new agents / contributors: read this BEFORE `docs/architecture/` — it tells you what the user is supposed to feel; architecture tells you how it's built.

# Design: Project Organizing Dimension — Todo (看板) + Deliverables Layout

**Status:** Proposed  
**Date:** 2026-05-24  
**Author:** Research agent (Claude Sonnet 4.6) for Chen Zhang  
**Scope:** Research + design doc only — NO product code changes.

---

## 0. Executive Summary

Manage-Your-CLI (MYC) currently has a flat model: all todos, jobs, deliverables,
and staff belong to a single implicit workspace. Real bosses run several concurrent
projects. This doc recommends a thin, additive "project tag" approach (Phase 1) that
preserves the 小老板 single-stream experience at zero cost, adds a project filter/
switcher for multi-project bosses, and lays foundation for per-project Secretary
context in Phase 2 — without a heavy PM engine or migration pain.

**Recommendation in one sentence:** Add an optional `project_id` field to
todos/deliverables/staff (nullable, defaults to `null` = "default project"),
surface a project switcher as a header pill/dropdown on both desk and mobile 看板
tabs, and store per-project context as a memory scope (`MEMORY/projects/<id>.md`)
— this is zero new infra, additive, and backward-compatible.

---

## 1. Research Findings

### 1.1 Claude Projects

Source: [Claude Help Center — What are projects?](https://support.claude.com/en/articles/9517075-what-are-projects)  
Source: [Anthropic announcement](https://www.anthropic.com/news/projects)  
Source: [How to create and manage projects](https://support.claude.com/en/articles/9519177-how-can-i-create-and-manage-projects)

**What a project actually is:**
- A named workspace containing: custom system instructions, a knowledge base (uploaded
  files up to 30 MB each, unlimited files), and all chats scoped to that project.
- Chat history is NOT shared across chats inside the same project. Knowledge files
  ARE shared. Instructions apply to every chat in the project.
- Non-project chats live in a flat "Recents" list. Users can drag a chat into a project
  later ("Add to project" dropdown). Projects appear as collapsible sections in the
  left sidebar.
- Free users: up to 5 projects. Pro/Max/Team/Enterprise: unlimited.

**The "no project" default:** Non-project chats remain accessible in a flat Recents
list alongside project sections. There is no forced project selection on first use.
The UI is a left sidebar with Projects sections above the flat Recents. Claude
maintains a separate memory summary per project AND a summary for all non-project
chats.

**Marketing vs. reality gap:** The "unlimited files" claim (Anthropic marketing) is
accurate per plan tiers; however GitHub issues
([#36866](https://github.com/anthropics/claude-code/issues/36866),
[#59016](https://github.com/anthropics/claude-code/issues/59016)) confirm that Claude
Desktop (the app) lacks in-app folder/project organization entirely — it is a known
gap between the web UI and the desktop app. Claude Cowork (enterprise) adds a task
board per project ([Claude Cowork Help](https://support.claude.com/en/articles/14116274-organize-your-tasks-with-projects-in-claude-cowork)),
but this is separate from the consumer Projects feature and gated behind enterprise plans.

### 1.2 ChatGPT Projects

Source: [OpenAI Help Center — Projects in ChatGPT](https://help.openai.com/en/articles/10169521-projects-in-chatgpt)  
Source: [OpenAI Academy — Using projects in ChatGPT](https://openai.com/academy/projects/)  
Source: [VentureBeat launch coverage](https://venturebeat.com/ai/openai-launches-chatgpt-projects-letting-you-organize-files-chats-in-groups)

**What a project actually is:**
- Left-sidebar collapsible folder. Each project holds: custom instructions
  (override account-level custom instructions), uploaded files, and grouped chats.
- **Project-only memory mode:** chats inside a project can reference each other
  contextually but are isolated from outside-project chats and from global memory.
  Project files are available to all chats in the project. Chat-level files are
  local to one conversation.
- Project sharing: as of Oct 2025, all paid tiers can share projects with collaborators
  (shared instructions + files + conversation history).
- Color-coded folders for visual identification.

**The "no project" default:** Chats not added to a project live in a flat sidebar list.
Users drag-and-drop into project folders. No friction gate on first use.

**Marketing vs. reality gap:** ChatGPT Projects launched Dec 2024. As of early 2026,
custom GPTs (GPT-4o variants) still cannot be used _inside_ a project folder per
OpenAI community reports
([community thread](https://community.openai.com/t/using-custom-gpts-within-projects-folders-in-chatgpt/1364875)).
The "cross-project rollup" or global task view does not exist — you see everything
only within one project at a time or in the flat Recents.

### 1.3 Task/PM Tool Patterns for Progressive Disclosure

**Todoist Inbox model:**  
Source: [Todoist — Inbox vs. project](https://www.todoist.com/help/articles/whats-the-difference-between-the-inbox-and-a-project-d6dSLqAM)  
The Inbox is the zero-friction default capture bucket. Tasks land there unless the
user specifies a project. Organizing is deferred to a weekly review. Result: zero
overhead for single-stream users; multi-project users sort during review. This is the
canonical pattern we should copy.

**Linear:** Teams → Projects → Issues. A solo user just lives in a single team; the
project layer is invisible until they create one. The sidebar collapses to show just
the one team, which feels like no extra chrome.

**Things 3 (Mac):** "Areas" (persistent life domains) contain Projects (time-bounded
efforts). Single-project users just work from the main Today view; areas are only
visible if you create them. Progressive disclosure by creation, not by gate.

**Key PM tool lesson:** The organizing layer must be **invisible by default** and
appear **only when the user creates a second grouping**. Never ask for a project on
first task creation. The "inbox / default" item is always implicitly present.

---

## 2. Current MYC Data Model (no project concept)

Entities relevant to this design, verbatim from `packages/api-contract/src/entities/`:

```
Deliverable {
  id, desk_id, title, body_kind, body,
  origin_label,        // 'local' | 'remote' | 'submitted'
  status,              // 'draft' | 'final' | 'accepted' | 'rejected' | 'revised'
  created_at,
  source_assignment_id?,  source_mission_id?,
  author_staff_id?,       author_remote_desk_id?,
  submitted_to_connection_id?
  // NO project_id
}

Staff {
  id, desk_id, name, role_name, role_label,
  substrate,           // local_ai | cli_agent | peer
  autonomy_level, governance_mode, status,
  current_jobs, max_concurrent_jobs,
  system_prompt?,      // per-staff persona injected into CLI session
  tags[],              // free-form labels e.g. 'suggested'
  // NO project_id
}

WorkQueueItem {          // owner's personal todos
  id, title, body,
  source,              // 'own' | 'from_mission'
  priority, deadline?
  // NO project_id
}
```

Boss memory: flat filesystem at `~/holon-agents/boss/MEMORY/<scope>.md` with a pointer
`INDEX.md`. Current default scopes: `decisions`, `roster`, `work`. No project
namespacing.

The Secretary (warm headless CLI) is initialized with the entire boss memory as
context. There is no per-project Secretary instance or per-project instruction set.

**Key observation:** The entire current model is _implicitly single-project_. Every
entity has `desk_id` (which scopes to ONE boss/desk), but no sub-desk grouping
dimension. Adding `project_id` is purely additive.

---

## 3. Project Model Recommendation (Thin-Shell Philosophy)

### 3.1 What a "project" maps to in MYC

A project is NOT a new engine. It is a **named grouping tag** that:

| Dimension | What changes |
|---|---|
| **Memory** | A boss-memory scope at `MEMORY/projects/<project_slug>.md` — stores project instructions/context. The Secretary reads this scope when a project is active. Nothing new: existing `readBossMemory()` + `writeBossMemory()` already handle arbitrary scopes. |
| **Staff** | Optional `project_id` tag on `Staff` records — indicates "this agent primarily works on this project." Still flat-roster (per CLAUDE.md: "flat-roster, no staff owns staff"). A staff member can appear on multiple projects (via a `project_ids: string[]` set) or on none (shared/general). |
| **Todos (WorkQueueItem)** | Optional `project_id` nullable field. Null = implicit "default" project = inbox/all. |
| **Deliverables** | Optional `project_id` nullable field. Null = no project filter needed. |
| **Jobs (in-flight)** | Optional `project_id` nullable field propagated from the dispatching todo/context. |
| **Chat/Secretary** | Active project context injected into Secretary's system prompt at session start from `MEMORY/projects/<id>.md`. No per-project warm agent needed (too expensive); the active project slug is passed as a session parameter. |

**A project record itself is minimal:**
```typescript
// Proposed — lives in packages/api-contract/src/entities/project.ts
Project = {
  id: idOf('proj'),           // e.g. 'proj_abc123'
  desk_id: idOf('desk'),
  name: string,               // display name, e.g. "MYC Mobile"
  slug: string,               // filesystem-safe, e.g. "myc-mobile"
  color?: string,             // hex or named, for visual badge
  archived: boolean,
  created_at: IsoDateTime,
  // NO: members list, permissions, budget, sprints, milestones.
  // All of that lives in boss memory and staff tags.
}
```

This is 7 fields. Compare to Linear's Project entity (50+ fields). We stay thin.

### 3.2 Backward compatibility

- All existing `project_id` fields are **nullable/optional**. Existing rows parse
  unchanged. `null` project_id means "default project" (unfiltered / inbox-equivalent).
- No migration of existing data required. The "default project" experience is
  maintained automatically.
- Existing Secretary behavior is unchanged when no project is active; the project
  memory scope is only read when the boss has explicitly set an active project.

---

## 4. Progressive Disclosure

### 4.1 The Single-Stream 小老板

**Sees nothing new.** When `projects.length === 0` (no projects created):
- No project chrome anywhere (no switcher, no filter pill, no project column).
- The 看板 shows all todos/deliverables as today.
- The Secretary has no project injection.
- Creating a todo does NOT ask for a project.

This is the Todoist Inbox model: the implicit "default" project is always active,
never named, never surfaced.

### 4.2 Opting into Multi-Project

When the boss creates their **first project** (via chat: "create a project called X" or
via a Settings → Projects panel):
- A project switcher appears in the 看板 header and Desk nav.
- Existing todos/deliverables remain in the "All" view (null project_id = untagged).
- Boss can optionally tag existing items retroactively.
- Creating a new todo while a project is selected auto-tags it.

When the boss creates a **second project**, the switcher becomes meaningful; the UX
payoff is visible.

**Rule:** If `projects.length <= 1`, the switcher is hidden. The single project (if
any) is treated as global context without a switcher pill. At 2+ projects, the
switcher appears.

---

## 5. How Todo (看板) + Deliverables Reorganize Around Projects

### 5.1 Filter model

```
Active filter state:
  project_id = null      → "All" (no filter; show everything)
  project_id = 'proj_x'  → show only items tagged to proj_x
                            + untagged items if boss prefers (opt-in)
```

The filter is a **header-level switcher**, not a column/swimlane split. This keeps the
看板 layout clean on mobile (single-column scroll; swimlanes on a phone are painful).

### 5.2 Global vs. per-project view

| View | Behavior |
|---|---|
| **All (default)** | Every todo/deliverable regardless of project. Project badge shown on each card when 2+ projects exist. |
| **Per-project** | Only todos/deliverables for that project. No project badge needed (redundant). |
| **Untagged** | Accessible via "All" filter when `project_id == null` items are present. |

### 5.3 How a new todo/deliverable gets its project

- If a project is selected in the switcher when the boss creates a todo: auto-tag.
- If "All" is selected: no project tag (goes to inbox/untagged).
- If the Secretary creates a deliverable from a dispatch: inherits the `project_id` of
  the dispatching todo/WorkQueueItem, if set. Otherwise null.
- If a staff agent produces a deliverable: inherits `project_id` from the job context.

The Secretary's MCP tool `dispatch` should accept an optional `project_id` parameter
(Phase 1 addition to `holon-mcp`).

### 5.4 How employee agents associate with a project

- `Staff.project_ids: string[]` (default `[]` = cross-project / shared agent).
- Display: in the /members (desk) and /staff (mobile) roster, a project badge appears
  next to staff when `project_ids.length > 0`.
- Filtering the 看板 to a project also filters the "who's working on this" view in
  the 进行中 column to show only staff tagged to that project (with a toggle to show all).
- A staff member can belong to 0, 1, or N projects — the boss assigns this via chat or
  the Team page, not via a separate "project members" UI.

---

## 6. Layout Proposals with ASCII Mockups

### 6.1 Desk (English)

**Desk nav (left sidebar) — 2+ projects:**
```
┌──────────────────────────────┐
│  ●  Chat                     │  (home / today)
│  ☰  Team             [●MYC] │  project badge on member count
│  ✓  Drops            [●MYC] │  project badge on count
│  ────  Library  ──────────── │
│  ★  Skills                   │
│  📚  References              │
│  ⬡  Connectors               │
│  ────────────────────────────│
│  ⚙  Me                       │
└──────────────────────────────┘
```

The project badge `[●MYC]` next to Team/Drops is the minimal signal that "you are
looking at a filtered view." It is NOT a project switcher; the switcher lives on the
看板/Drops page itself.

**Desk /drops (Deliverables) page — project switcher:**
```
Drops  ·  23 items
┌──────────────────────────────────────────────────────┐
│  [All ▾]  [MYC Mobile ▾]  [OpenClaw ▾]  [+ New]     │
│  ↑ project switcher pills — "All" selected           │
├──────────────────────────────────────────────────────┤
│  ● accepted  OAuth Migration Plan    2h ago  小赵    │
│  ● draft     Q3 Email Copy           5h ago  小钱    │
│  ● final     Competitor Analysis     1d ago  小赵    │
└──────────────────────────────────────────────────────┘
```

Selecting "MYC Mobile" pill filters to project items; badge on the pill shows count.

**Desk /today (Chat+Today) — active project indicator:**
```
Chat                                    [Project: MYC Mobile ▾]
──────────────────────────────────────────────────────────
Boss:  "draft the landing page copy for the onboarding flow"
       ↑ Secretary knows project context from MEMORY/projects/myc-mobile.md
```

The project indicator in the Chat header is a lightweight context signal — the boss
sees what context the Secretary is working in. It does NOT gate the chat (boss can
always override in the prompt). Clicking it opens a project-switcher popover.

**Desk /members (Team) page — project filter:**
```
Team  ·  8 members
┌──────────────────────────────────────────────────────┐
│  [All ▾]  [MYC Mobile ▾]  [OpenClaw ▾]               │
├──────────────────────────────────────────────────────┤
│  🟢 小赵    Code Agent     MYC Mobile   Bounded      │
│  ⚪  小钱    Research Agent  OpenClaw    Supervised   │
│  🟢 小李    General         (none)      Bounded      │
└──────────────────────────────────────────────────────┘
```

"(none)" staff are shared/cross-project; always visible in all filtered views.

**No projects created — Desk view (zero overhead):**
```
Drops  ·  23 items
┌──────────────────────────────────────────────────────┐
│  [+ New]                                             │
│  (no project switcher — clean, single-stream)        │
├──────────────────────────────────────────────────────┤
│  ● accepted  OAuth Migration Plan    2h ago  小赵    │
│  ● draft     Q3 Email Copy           5h ago  小钱    │
└──────────────────────────────────────────────────────┘
```

---

### 6.2 Mobile 微作 (Chinese — all labels in Chinese)

**Key constraint:** 4-tab limit (工作台 / 收件 / 成员 / 更多). Do NOT add a 5th tab.
The project switcher lives in the 看板/today-style header, not as a tab.

The current 4 tabs are: 工作台 / 收件 / 成员 / 更多. The 看板 (kanban) is currently
accessible via the 更多 tab's sub-pages (今日 = jobs, 交付 = deliverables). The
mobile-kanban-mock.md proposes a unified 待办/进行中/交付 three-column swipe view.

**Mobile 看板 tab — no projects (单一项目模式 / zero overhead):**

```
┌────────────────────────────┐
│  看板                       │    ← page title; no switcher
│  全部 3 · 在跑 2 · 交付 1   │    ← column segment pills
├────────────────────────────┤
│ 待办:                       │
│▎高  重构登录到 OAuth         │
│    📅 今天(逾期) ⏳挂3天     │
│    💬对话小秘   ✓   🗑      │
├────────────────────────────┤
│▎中  写 Q3 邮件营销初稿       │
│    📅 5/28  ⏳挂1天          │
└────────────────────────────┘
```

**Mobile 看板 tab — with 2+ projects (多项目模式 / switcher appears in header):**

```
┌────────────────────────────┐
│  看板  [MYC移动 ▾]          │    ← project switcher PILL in header
│  全部 3 · 在跑 2 · 交付 1   │    ← still shows per-project counts
├────────────────────────────┤
│ 待办:                       │
│▎高  设计登录 OTP 流程        │  ← tagged to MYC Mobile project
│    📅 今天  ⏳挂1天          │
│    💬对话小秘   ✓   🗑      │
├────────────────────────────┤
│▎中  移动端首页改稿           │
│    📅 5/29                  │
└────────────────────────────┘
```

The `[MYC移动 ▾]` pill in the header is a dropdown:

```
  ┌────────────────────┐
  │  ✓  MYC移动        │   ← currently selected
  │     OpenClaw       │
  │  ──────────────    │
  │     全部           │   ← show all projects (unfiltered)
  └────────────────────┘
```

**Mobile 工作台 (chat) tab — active project context indicator:**

```
┌────────────────────────────┐
│  工作台  [MYC移动]          │    ← project context badge (non-interactive or tap-to-change)
├────────────────────────────┤
│  今日摘要                   │
│  3 待办 · 2 在跑 · 1 新交付 │
│  ──────────────────────    │
│  老板:  给首页写一段欢迎语   │    ← Secretary uses project context from memory
│  小秘:  好的，根据 MYC移动   │
│         的产品定位…         │
└────────────────────────────┘
```

**Mobile 成员 tab — project filter:**

```
┌────────────────────────────┐
│  成员  [MYC移动 ▾]          │    ← same switcher pattern
├────────────────────────────┤
│  🟢 小赵   代码员工  在跑   │
│  ⚪  小李   研究员    待命   │
│  ──────────────────────    │
│  [无项目员工]  小钱  小王    │   ← cross-project staff always shown as a group
└────────────────────────────┘
```

**Summary: NO 5th tab.** The project switcher is a reusable header pill component
(`<ProjectSwitcher />`) that appears on 看板, 工作台 header, and 成员 tab header
when `projects.length >= 2`. It is invisible at `projects.length <= 1`.

---

## 7. Phasing

### Phase 1 — Minimal: Optional project tag (additive, ~1 dev-day)

**Goal:** Zero migration pain. Single-stream bosses unaffected. Multi-project bosses
get a basic filter.

**Data model changes:**
```typescript
// Additive nullable fields — backward-compat with all existing fixtures/rows

// packages/api-contract/src/entities/work-queue-item.ts
WorkQueueItem.extend({
  project_id: idOf('proj').nullable().optional(),  // null = untagged/default
})

// packages/api-contract/src/entities/deliverable.ts
Deliverable.extend({
  project_id: idOf('proj').nullable().optional(),
})

// packages/api-contract/src/entities/staff.ts
Staff.extend({
  project_ids: z.array(idOf('proj')).default([]),  // [] = shared/cross-project
})

// NEW: packages/api-contract/src/entities/project.ts
Project = {
  id: idOf('proj'),
  desk_id: idOf('desk'),
  name: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/),
  color: z.string().optional(),        // hex or CSS named color
  archived: z.boolean().default(false),
  created_at: zIsoDateTimeLoose,
}
```

**New API surface (minimal):**
- `GET /api/v1/projects` — list projects for the desk (in-memory store, same as staff)
- `POST /api/v1/projects` — create project (name → auto-slug)
- `PATCH /api/v1/projects/:id` — rename / archive
- `GET /api/v1/todos?project_id=<id>` — filtered list (already exists on deliverables)
- `GET /api/v1/deliverables?project_id=<id>` — add project_id filter param

**Memory scaffold:**
- `writeBossMemory('projects/<slug>', ...)` — no new code; existing `writeBossMemory`
  handles arbitrary scopes. The Secretary is told `## Active project: <name>\n<content>`
  injected at the top of its system prompt when a project is active.

**UI changes:**
- `<ProjectSwitcher />` component — shows only when `projects.length >= 2`.
- Header pill on 看板/Drops/Team pages (desk) and on 看板/工作台/成员 headers (mobile).
- Project badge on individual todo/deliverable cards when in "All" view.
- "Create project" entry point: Secretary chat command ("create project X") + Settings.
- No project UI otherwise — zero chrome for 小老板.

**Backward compatibility:** All existing `project_id` fields are nullable/optional.
Existing rows parse without changes. The mutable-store and fixture-store return items
unchanged; the project filter is a client-side or server-side filter applied at query
time. No data migration.

---

### Phase 2 — Full Project Workspaces: Per-project Secretary context + memory namespace

**Goal:** Each project has its own Secretary instructions, memory scope, and potentially
its own active Secretary session context.

**Additions over Phase 1:**
```typescript
Project.extend({
  // Secretary persona for this project — injected verbatim into the system prompt
  secretary_instructions: z.string().optional(),
  // Boss-memory scope prefix — defaults to 'projects/<slug>'
  memory_scope: z.string().optional(),
  // Optional cwd for CLI agents dispatched under this project
  default_cwd: z.string().optional(),
})
```

**Memory:**
- `~/holon-agents/boss/MEMORY/projects/<slug>.md` — project-level context, decisions,
  stakeholders. Boss writes this via Secretary ("remember for MYC Mobile: target users
  are SMB owners...") or directly.
- `~/holon-agents/boss/MEMORY/projects/<slug>/` — sub-scopes: `roster.md`,
  `decisions.md`, `work.md` per project. Exactly mirrors the existing flat boss memory
  structure, scoped one level deeper.
- The Secretary reads the active project's memory scope at session open in addition to
  the global `INDEX.md`.

**UI additions:**
- Settings → Projects panel with per-project instruction editor (desk only).
- "Project context" visible in chat header (mobile + desk) — tap to see current
  project memory summary.
- Project-level "Today" summary on 工作台: "3 open todos, 2 agents running, last
  deliverable 2h ago" — scoped to active project.

**Phase 2 stays thin:** No sprint/milestone/roadmap/velocity engine. Memory = files.
Instructions = a text field. This is the same architecture as the existing Secretary
system, just namespaced per project.

---

### Phase 3 — Cross-Project Rollups

**Goal:** Boss sees fleet-wide status across all projects at once.

**Additions:**
- Global Today dashboard: buckets filtered across all projects with project color
  badges.
- Secretary can receive cross-project queries: "summarize all active work" → reads
  all project memory scopes and synthesizes.
- Optional: project-level Deliverables count badges in the sidebar/tab bar.
- Weekly digest: Secretary auto-generates a cross-project status summary into
  `MEMORY/work.md`.

**No new infra beyond Phase 2** — just query and display changes. The data model and
memory structure are already set by Phase 2.

---

## 8. Data Model Changes Per Phase

| Entity | Phase 1 | Phase 2 | Phase 3 |
|---|---|---|---|
| `WorkQueueItem` | + `project_id?: id\|null` | — | — |
| `Deliverable` | + `project_id?: id\|null` | — | — |
| `Staff` | + `project_ids?: string[]` | — | — |
| `Project` | NEW (7 fields) | + `secretary_instructions`, `memory_scope`, `default_cwd` | — |
| Boss memory | unchanged | `MEMORY/projects/<slug>.md` added dynamically | cross-project read |
| API | 4 new endpoints (CRUD projects + filter params) | `secretary_instructions` in PATCH | cross-project query param |
| Secretary | project context injected as string | full per-project system prompt section | multi-project synthesis prompt |

---

## 9. Recommendation: Do This First

### The right Phase 1 is slightly larger than the minimum viable tag

The migration trap is this: if Phase 1 only adds `project_id` on `WorkQueueItem` and
`Deliverable` but NOT on `Staff`, then Phase 2 adds `project_ids` on `Staff` — which
requires a new migration and a new UI pattern for "who's on this project." That is two
PRs solving the same shape of problem. Include `Staff.project_ids` in Phase 1.

Similarly, if Phase 1 adds only client-side filtering but not `GET /api/v1/projects`,
then Phase 2 must retrofit the API anyway. Add the 4-endpoint project CRUD in Phase 1.

**Phase 1 scope that avoids migration pain later:**
1. `Project` entity (7 fields) in `api-contract` + in-memory store (same pattern as staff/deliverables).
2. `project_id` on `WorkQueueItem` + `Deliverable` (nullable, optional).
3. `project_ids[]` on `Staff` (default `[]`).
4. 4 API endpoints: `GET/POST /api/v1/projects`, `PATCH/DELETE /api/v1/projects/:id`.
5. Filter param `?project_id=` on existing `GET /api/v1/deliverables` and `GET /api/v1/todos`.
6. `<ProjectSwitcher />` component — hidden when `projects.length < 2`, header pill when `>= 2`.
7. Boss memory scaffold: `writeBossMemory('projects/<slug>', ...)` — zero new code.
8. Secretary: read active project memory scope on session start — 1 conditional `readBossMemory()` call.

**What to NOT include in Phase 1:**
- Per-project Secretary instructions UI (Phase 2 — memory file is enough for Phase 1).
- Project-level cwd default (Phase 2 — can be set per-staff already).
- Cross-project rollup (Phase 3).
- Sprint/milestone/timeline (never — out of scope for thin-shell).

**Rationale (long-term value):** The incremental effort of including `Staff.project_ids`
and the 4-endpoint CRUD in Phase 1 is ~0.5 dev-days. The avoided migration pain when
Phase 2 lands (no schema change, no data migration, no API versioning) is worth it.
The `<ProjectSwitcher />` component is reused identically on all 4 surfaces (desk drops,
desk team, mobile 看板, mobile 成员) — building it once in Phase 1 pays off immediately.

**The single-stream 小老板 pays exactly zero cost:** no projects = no switcher, no badge,
no extra step in any flow. This is the most important invariant to protect.

---

## 10. Open Questions for the Boss (not blocking Phase 1)

1. **Project creation surface:** Should the Secretary be the primary way to create
   projects ("create project X") or should there be a dedicated UI entry point (Settings
   → Projects)? Recommendation: Secretary first (keeps thin-shell philosophy), UI entry
   point in Phase 1.5.

2. **Untagged item behavior in per-project view:** Should untagged todos/deliverables
   appear in ALL project views (visible but unbadged) or only in the "All" view?
   Recommendation: "All" view only; per-project view is filtered strictly.

3. **Project deletion / archiving:** When a project is archived, do its todos/deliverables
   stay visible in "All" or are they hidden? Recommendation: stay visible in "All",
   hidden in active-projects switcher, accessible via "Archived" toggle.

4. **Mobile 看板 tab:** The current MobileTabBar.tsx does NOT have a dedicated 看板 tab
   — it is accessible via /more/. This design assumes the 看板 is promoted to a top-level
   tab (replacing or merging with 更多/收件) before the project switcher is worth adding.
   This is a separate mobile nav restructure decision that Phase 1 project work depends on.
   See `docs/design/mobile-kanban-mock.md` for the kanban content design.

---

*Research sources:*
- [Claude Help Center — What are projects?](https://support.claude.com/en/articles/9517075-what-are-projects)
- [Anthropic — Collaborate with Claude on Projects](https://www.anthropic.com/news/projects)
- [Claude Help Center — Create and manage projects](https://support.claude.com/en/articles/9519177-how-can-i-create-and-manage-projects)
- [Claude Cowork — Organize tasks with projects](https://support.claude.com/en/articles/14116274-organize-your-tasks-with-projects-in-claude-cowork)
- [OpenAI Help Center — Projects in ChatGPT](https://help.openai.com/en/articles/10169521-projects-in-chatgpt)
- [OpenAI Academy — Using projects in ChatGPT](https://openai.com/academy/projects/)
- [VentureBeat — OpenAI launches ChatGPT Projects](https://venturebeat.com/ai/openai-launches-chatgpt-projects-letting-you-organize-files-chats-in-groups)
- [Todoist — Inbox vs. project](https://www.todoist.com/help/articles/whats-the-difference-between-the-inbox-and-a-project-d6dSLqAM)
- [Morgen — Linear project management guide](https://www.morgen.so/blog-posts/linear-project-management)
- [GitHub issue — Claude Desktop project folder organization](https://github.com/anthropics/claude-code/issues/36866)
- [OpenAI community — Custom GPTs within Projects](https://community.openai.com/t/using-custom-gpts-within-projects-folders-in-chatgpt/1364875)

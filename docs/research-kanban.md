# 看板 Redesign Research

**Date:** 2026-05-25  
**Scope:** Mobile 微作 看板 tab — research-only, no code changes  
**Status:** Design proposal

---

## Part A — Current-State Critique

### What it currently shows

The 看板 tab (`WorkTracker`) is a segmented tab control with three panels: **待办** / **进行中** / **交付**. One panel is visible at a time — you tap a tab to switch.

**待办 (`TodoBacklog`):** Fetches `/api/v1/todos?status=pending`. Renders a flat list sorted high→medium→low priority, then newest-first within priority. Each card shows: priority color-bar + label tag, title text, due date (red if overdue), aging indicator ("已挂N天"), and three inline action buttons (set date, delegate-to-secretary 💬, mark done). Swipe-to-delete. Has an inline quick-add input.

**进行中 (`ActiveJobs`):** Fetches `/api/v1/jobs` and filters `status === 'queued' | 'running'`. Each card shows: avatar initial + staff_id name, status pill (排队/运行中), elapsed time, job brief/id, latest terminal line (polled every 5s), and two buttons (查看实时 → terminal overlay, 去对话 → secretary). Swipe-to-delete. Polls live terminal for the last 60 chars of output.

**交付 (`DelivSection`):** Fetches `/api/v1/deliverables` (capped at 8). Each card shows: 📄 icon, title, 待验收/已看 pill, time-ago, a four-char "author" fudge (uses first 4 chars of title as author proxy), body excerpt, and a 查看交付 button. Tap opens a full detail view with markdown render and accept/reject buttons.

### Concrete Weaknesses

**1. Tab switching = context loss, not glance.** The owner must navigate three separate screens to get a full picture. The most pressing question — "what needs my attention RIGHT NOW?" — requires visiting all three tabs. This is the opposite of at-a-glance.

**2. Hierarchy is flat; no urgency gradient at the top.** All pending todos appear in one undifferentiated list. There is no "needs your decision" zone vs. "background tracking" zone. Nothing separates a high-priority, overdue todo from one the secretary is already handling.

**3. 进行中 doesn't connect to 待办.** When a todo is delegated (`status: 'delegated'`), it silently vanishes from 待办 but there is no link in 进行中 to the originating todo. The owner cannot tell which running job came from which intent.

**4. 交付 author field is wrong.** The meta line uses `d.title.slice(0, 4)` as the "author" proxy, which is semantically wrong (title start ≠ agent name). The `author_staff_id` field exists on the `Deliverable` entity but is unused in the UI.

**5. No "stuck" detection in the current UI.** `JobStatusPill` computes `'stuck'` as a status but the actual `items.map` hardcodes the ternary `job.status === 'running' ? 'running' : 'queued'` — stuck is never shown. A job running >N minutes without terminal output is silently shown as "运行中…" with no signal to the boss.

**6. 交付 is capped at 8 with no pagination.** Items 9+ are invisible.

**7. No "waiting for me" surface.** Deliverables in `draft/final/revised` status require owner review, but they are mixed with already-reviewed (`accepted/rejected`) deliverables in the same list. There is no count badge or highlight to surface unreviewed items urgently.

**8. The tab control itself is too deep a metaphor for work that spans all three states simultaneously.** An AI-team boss needs cross-state awareness: a job might be running (进行中) but the deliverable it produces needs review (交付) while a follow-up todo is already queued. No single tab shows this.

**9. No auto-refresh.** The board fetches once on mount. It goes stale immediately after an agent completes work. Only 进行中 has a 5s poll for terminal lines, but not for job-state transitions.

**10. Missing entity: missions.** The API contract has a rich `Mission` entity (inbound handoffs with triage state, deadlines, assigned staff) and a `TodayResponse` with typed buckets (`ai_running`, `peer_waiting`, `pending`, `blocked`, `returned`). None of this is surfaced on the 看板. The board doesn't know about inbound work at all.

---

## Part B — The Three Answers

### 1. 核心 — What must the board express?

For a boss watching an autonomous AI team, the information model has five must-haves:

**A. Needs-You (老板要决定)** — items requiring owner action right now: unreviewed deliverables (draft/final/revised), approval-chain missions, blocked jobs awaiting a decision. These are the only items that cannot proceed without the boss. Everything else can run without attention.

**B. In-Flight (团队在干什么)** — running jobs with which agent, what task, and whether they're healthy or stuck. The boss needs "team heartbeat" at a glance, not individual job audit. A count + health indicator per agent is enough at first glance; drill-down for details.

**C. Recent Completions (刚完成什么)** — deliverables and completed jobs from the last N hours. Confidence that the team is producing. This feeds the "has anything shipped?" question without requiring deep review.

**D. Queue Depth (积压有多少)** — pending todos not yet delegated. One number. If it's growing the boss needs to delegate more; if it's shrinking autonomous work is functioning.

**E. Blockers / Overdue (有什么卡住了)** — jobs running too long, overdue todos, missions past deadline. Surfaced proactively, not buried in lists.

These map to an information model: `{ needsYou: Item[], inFlight: AgentPulse[], recentDone: Item[], queueDepth: number, blockers: Item[] }`. This is what the board must always express.

### 2. 怎么表达 — How to express it?

**The classic drag-card Kanban (Trello style) is wrong for this product.** Work items move through states automatically — the boss doesn't drag cards. Making the board look like a Trello board implies manual lane management that will never happen here.

**What fits instead:** a single-screen "boss dashboard" modeled on the **activity-feed + bucket pattern** used by Linear's triage inbox and Things' Today view. The board renders one unified vertical scroll with fixed sections in urgency order:

1. **"老板要决定"** — compact action bucket at the top. One card per actionable item. Red/orange badge count drives notification on the tab itself.
2. **"团队动态"** — agent pulses in running state, 1 row per active agent: avatar + name + what they're doing (last terminal line, truncated) + elapsed time + health status.
3. **"刚完成"** — last 24h completions, chronological, newest first. Brief rows.
4. **"待办积压"** — queue depth number + top 3 pending todos as preview rows.

All sections are **always visible in one scroll**, not behind tabs. The previous tab model is replaced by this vertical layout.

**Refresh strategy:** SSE or 10s poll for job state changes (not just terminal lines). The whole board refreshes on tab focus.

**Comparison to leading tools:**

- **Linear:** "My Issues" + triage inbox is the closest analogue — inbox forces attention to actionable items, cycles show team throughput. Borrow: the triage inbox pattern for "needs you", the cycle progress bar for in-flight count.
- **Things 3:** The "Today" view is the gold standard for single-day focus. Borrow: the hard separation between Today/Anytime/Someday, which maps to Needs-You/Queue/Archive.
- **GitHub Projects:** Board views per project with swimlanes. Relevant if the board becomes configurable (see Part C). Borrow: the field-level filtering approach for desk-side config.
- **Notion Databases:** Views (board/table/gallery/timeline) on the same dataset. The best precedent for the "one dataset, many renderings" idea in the dynamic board concept.
- **Trello:** Classic lane-drag board. Do NOT replicate for an AI team — but borrow the color-coded label aesthetics for priority/status tags.

### 3. 格式/美观/层级/设计

#### Visual language
Keep the WeChat-style row aesthetic: clean `48px` touch rows, `#1f7a44` green for primary actions and active agent pulse dots, `#f0f0f0` dividers, gray secondary text `#888`. No heavy card shadows — use left-border accent bars for status (green = running, orange = needs you, red = blocked, gray = done).

#### Section anatomy

Each section has:
- Section header: uppercase-small label + count badge (e.g. `老板要决定  3`)
- Row cards at standard touch height
- Separator before next section

#### Card anatomy by type

**Needs-You card:**
```
┌─ left accent: orange ────────────────────────────────────────┐
│ [DelivIcon/MissionIcon]  标题文字 (1 line, truncated)  [待验收] │
│ 👤 员工名 · 23分钟前                          [立即处理 →]      │
└──────────────────────────────────────────────────────────────┘
```

**Agent Pulse card (in-flight):**
```
┌─ left accent: green dot pulsing ─────────────────────────────┐
│ [Avatar初]  员工名  [运行中●]  ⏱ 12分                          │
│ > 最新: last terminal line truncated to ~55 chars…            │
└──────────────────────────────────────────────────────────────┘
```

**Recent Done row (compact):**
```
  ✓  交付标题  ·  员工名  ·  2小时前       [查看]
```

**Pending Todo row (compact):**
```
  [高]  任务标题  ·  📅 明天到期             [派活 💬]
```

#### Hierarchy and grouping

```
看板
├── 老板要决定 (count) ← always first, empty = collapsed to 1 row "暂无待决事项"
│   ├── [deliverable card needing review]
│   ├── [mission in approval_chain]
│   └── [blocked job card]
├── 团队动态 (active count)
│   ├── [agent pulse: 张三  运行中  12分  > Writing tests...]
│   └── [agent pulse: 李四  排队   0分]
├── 刚完成 (last 24h count)
│   ├── [done row]
│   └── [done row]
└── 待办积压 (queue depth N)
    ├── [top todo row]
    ├── [top todo row]
    └── [查看全部 N 条 →]
```

#### ASCII mockup (375px mobile, one-column scroll)

```
┌─────────────────────────────────────────┐
│  看板                         [刷新 ↻]  │
├─────────────────────────────────────────┤
│  老板要决定    3                         │
├─────────────────────────────────────────┤
│▌ 📄 产品需求初稿          [待验收]      │
│  👤 小李 · 1小时前          [立即处理→] │
├──────────────────────────────────────   │
│▌ 📋 客户A询价审批                        │
│  👤 张三 (经销商) · 30分前  [立即处理→] │
├──────────────────────────────────────   │
│▌ ⚠ 数据分析任务 卡住了                   │
│  👤 数据员 · 2小时无响应    [去对话 💬] │
├─────────────────────────────────────────┤
│  团队动态    2 运行中                    │
├─────────────────────────────────────────┤
│● 张三  运行中●  ⏱ 8分                   │
│  > Running integration tests for...     │
├──────────────────────────────────────   │
│○ 李四  排队    ⏱ 0分                    │
│  > 等待任务分配                          │
├─────────────────────────────────────────┤
│  刚完成    今日 4 件                     │
├─────────────────────────────────────────┤
│  ✓ 竞品分析报告 · 张三 · 2小时前  [看] │
│  ✓ 周报草稿   · 李四 · 4小时前   [看] │
├─────────────────────────────────────────┤
│  待办积压   7 条                        │
├─────────────────────────────────────────┤
│  [高] 整理客户反馈  📅 明天   [派活 💬] │
│  [中] 更新产品路线图          [派活 💬] │
│  [中] 准备Q2回顾              [派活 💬] │
│           查看全部 7 条 →               │
└─────────────────────────────────────────┘
```

#### Color / typography spec

| Element | Value |
|---|---|
| Brand green (active pulse, primary CTA) | `#1f7a44` |
| Needs-you accent bar | `#e07f30` (orange) |
| Blocked/stuck accent bar | `#e0533a` (red) |
| Done row check | `#1f7a44` |
| Section header text | `11px uppercase, #888, letter-spacing 0.06em` |
| Card title | `15px medium, #111` |
| Card meta | `13px, #888` |
| Touch row min-height | `56px for action cards, 44px for compact rows` |
| Divider | `1px #f0f0f0` |

---

## Part C — Dynamic / Configurable Board Analysis

### The owner's idea

The owner proposes: on DESK, the board layout is user-configurable or AI-generated per stated needs (e.g. "show me deliverables by project"). MOBILE only renders a clean read-only view of the desk-defined board. Mobile does NOT support authoring.

### How leading tools handle configurable views

**Notion Databases:** The cleanest precedent. One dataset, N named views: board/table/gallery/timeline/calendar. Views are a serialized config object (visible columns, filter, sort, group-by, layout type). Each view has a name and is a first-class saved object. Users switch views via a tab bar. Creating a view is a form-fill or template. This is Option A: form-defined views.

**Linear:** "Views" are saved filter presets (team, project, status, assignee) rendered as a list or board. The config is pure JSON (filter rules + layout). Creating a new view = picking filters. Very close to what is proposed. Linear also has a natural-language "search/filter" but the view is still saved as structured config.

**GitHub Projects:** "Custom fields" + board/table/roadmap views with drag-and-drop column definitions. Full power, high complexity. Config is structural (add field, define options, set column = field value). Too heavy for this product.

**Retool / internal dashboards:** "Define a widget schema, render at runtime." The fullest expression of the configurable-board idea. Overkill for V1 but the architecture is instructive: a `BoardSpec` JSON document defines sections, each section defines a data source + filter + card renderer. The runtime reads the spec and renders it.

**Tableau/Looker:** Config-as-code for BI dashboards. The analogy is: desk = Looker author, mobile = Looker consumer. Not directly applicable but validates the split.

### Board-definition schema approach

A minimal `BoardSpec` for this product:

```typescript
interface BoardSpec {
  version: 1;
  sections: BoardSection[];
}

interface BoardSection {
  id: string;
  label: string;         // display name
  icon?: string;         // emoji or icon key
  source: 'needs_you' | 'in_flight' | 'recent_done' | 'todos' | 'missions' | 'deliverables';
  filter?: {
    status?: string[];
    priority?: string[];
    staff_id?: string[];
    project_id?: string[];
    age_max_hours?: number;
  };
  sort?: { field: string; dir: 'asc' | 'desc' };
  max_items?: number;
  collapsed_by_default?: boolean;
}
```

This is intentionally lean. "Which sections to show, in what order, with what filter" is the entire config space. Card rendering is fixed per `source` type — the mobile client has one renderer per source type and the spec just controls visibility/filter.

**Natural-language → BoardSpec via CLI:** The owner's idea of AI-generating the board spec is feasible and fits the product North Star. The flow: owner types "show me all blocked jobs and unreviewed deliverables only" → secretary calls a tool → produces a `BoardSpec` JSON → stores it as the active spec → mobile renders it. This is exactly a "context + orchestration" layer on top of a fixed renderer, which is consistent with the thin-shell principle.

### Recommendation: YES, do the dynamic board — but phase it carefully

**Is it worth it?** Yes, conditionally. The static board proposed in Part B is already a large improvement over the current tab design. The configurable spec is the right long-term architecture because:

1. Different owners will want different default views (some are delivery-focused, some manage more agents, some track missions heavily).
2. The secretary already has tool-call capabilities — adding a `set_board_spec` tool is low-cost.
3. Mobile rendering is already fixed per type; adding spec-driven section visibility is a small delta.

**What NOT to do for V1:** Do not build a visual board editor on desktop first. Do not make the spec support custom card renderers. Do not support arbitrary SQL/filter expressions. Keep the spec to "which sections, in which order, with simple field filters."

**Desk-authoring vs. mobile-static split:** This is the right call. Mobile is a read-only board consumer. The authoring surface on desk can be:
- V1: Secretary chat command ("只显示需要我决定的") → secretary generates + saves spec
- V2: Simple form UI on desk (checkboxes for sections, filter dropdowns)
- V3: Named saved views ("今日关注" / "项目A看板" / "周会前")

Mobile always just renders the active spec. Spec lives server-side; mobile reads it on load.

### Phasing plan

**Phase 0 (now — no code changes today):** Design document only.

**Phase 1 — Static redesigned board (MVP, ~2 dev-days):**
Implement the unified-scroll board with four hard-coded sections (Needs-You / In-Flight / Recent Done / Todo Queue). Replace the three-tab layout. Wire to existing APIs + `TodayResponse` buckets which already model this data. Add auto-refresh on tab focus. Fix the stuck-job detection bug. Fix the author field in deliverable cards.

**Phase 2 — BoardSpec schema + spec storage (~1 dev-day):**
Define `BoardSpec` in api-contract. Add `GET/PUT /api/v1/board-spec` endpoints. Default spec = the four Phase 1 sections. Mobile reads and renders by spec. Server returns default if no custom spec is set.

**Phase 3 — Secretary tool for spec authoring (~1 dev-day):**
Add `set_board_spec(sections)` to the secretary's MCP tool set. Owner can say "只保留需要决定的和在跑的任务" → secretary calls the tool → spec saved → next mobile refresh renders the new view.

**Phase 4 — Named saved views (optional, V2+):**
Multiple named specs, view switcher on mobile (tab bar at top of 看板). Desk UI for editing. Secretary can switch active view by name.

---

## Part D — Recommended Next Step

**Do Phase 1 first.** The redesigned static four-section board is a complete product improvement independent of dynamic spec support. It fixes the core UX problem (tab-switching = no at-a-glance), surfaces the "needs you" urgency signal that is currently invisible, and uses data already in the API contract (`TodayResponse` buckets, `Mission` entity, correct `author_staff_id` on deliverables).

The concrete starting point for an implementation agent:

1. Replace `WorkTracker` tab control with a single-scroll layout component.
2. Add a `needsYou` section that unions: `deliverables` where `status IN (draft, final, revised)` + missions where `state = 'blocked' OR state = 'queued' AND form = 'approval_chain'` + jobs where elapsed > 30min.
3. Keep `ActiveJobs` logic but reformat as pulse rows (not full cards) in the "团队动态" section.
4. Add a compact "刚完成" section: deliverables `status = 'accepted'` from last 24h, jobs `status = 'completed'` from last 24h.
5. Keep `TodoBacklog` logic but collapse to top-3 preview rows + "查看全部" expand.
6. Add `useEffect` auto-refresh on tab activation (via `visibilitychange` or tab focus signal).
7. Fix `stuck` detection: a running job with no terminal update in > 20min gets the stuck status pill and moves to the "needs you" section.
8. Fix deliverable author: use `author_staff_id` → resolve staff name via the contacts list, not title-slice.

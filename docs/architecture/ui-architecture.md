# UI Architecture

Status: draft v0.2 (refreshed 2026-05-15 to align with Two Cores frame, 14 handoff forms, 8 axes, autonomy slider, cultivation, multi-device awareness, AI controller indicator)
Owner: design

## 1. Position

This is the UI / interaction-design contract for Holon's owner-facing surfaces. It specifies what screens exist, what each must show, what interactions they support, and what visual language they use. It does NOT specify pixel-level visual design (that lives in implementation).

The UI's job is to make the Two Cores (per `functional-architecture.md` § 2) feel like one coherent product:

- **Core 1 surfaces** (Today, Staff, Deliverables-local) — the owner's local team and their work.
- **Core 2 surfaces** (Inbound, Connections, Deliverables-returned) — external relationships and cross-desk work.
- **Cross-cutting** (Settings, Audit, Search) — span both cores.

The owner shouldn't have to think "is this Core 1 or Core 2?" — but everything they do snaps into the right place.

## 2. UX Principles

Re-stated from `holon-product-definition.md` § UX Principles, constraining every screen below.

1. **The owner manages outcomes, not agent graphs.** No graph editors. No prompt builders. No nested workflow trees.
2. **Local teams are flat and small** (per `local-agent-management.md` § 2). The Staff screen reflects this — no hierarchy widgets.
3. **Peer identities are visibly tied to real people or remote teams.** Never let the owner forget that "Wang" is backed by Wang's actual desk.
4. **Every handoff has a clear owner, state, and returned artifact.** Status is always visible; nothing goes silent.
5. **The cloud is a reliability layer, not a black box.** Connection health is always inspectable.
6. **Human accountability is always visible.** Even when AI did the work, the human on the hook is named.

## 3. Information Architecture

### 3.1 Primary navigation (5 items, persistent)

| Nav item | What it surfaces | Core |
|---|---|---|
| **Today** | Owner's at-a-glance: in-flight work, what needs decisions, what just came back | Cross-cutting |
| **Inbound** | Mission inbox: incoming work from other desks, awaiting decision | Core 2 → Core 1 boundary |
| **Members** | Local team roster: AI members, CLI executors, peer identities | Core 1 |
| **Connections** | Peer connections: paired desks, health, pairing, revocation | Core 2 |
| **Deliverables** | Durable artifacts: locally produced + remotely returned | Cross-cutting |

The 5-item cap is deliberate — span-of-control discipline applies to nav too.

### 3.2 Secondary navigation (in user menu / settings drawer)

```
Settings  (per-desk preferences, autonomy defaults, span cap)
Audit     (event timeline; cross-entity)
Search    (V1: within deliverables; V2: cross-cutting)
Devices   (V1.x: this person's other desks)
```

### 3.3 App shell

```
┌──────────────────────────────────────────────────────────┐
│  [logo] Holon                          [search] [bell] [me] │  Top bar (fixed)
├────────────┬─────────────────────────────────────────────┤
│ ◉ Today    │                                             │
│   Inbound  │                                             │
│   Staff    │           Main content area                 │
│   Conn.    │                                             │
│   Deliv.   │                                             │
│            │                                             │
│ — — —      │                                             │
│   Settings │                                             │
│   Audit    │                                             │
│            │                                             │
│ [device ▼] │                                             │
└────────────┴─────────────────────────────────────────────┘
```

- Left nav: 5 primary + secondary divider + secondary items.
- Top bar: brand mark, global search, notifications bell, owner identity menu (with "switch desk" if person has multiple).
- Bottom-left of nav: current device indicator (`📱 phone-desk` / `💻 laptop-desk`) — important for multi-device users.

### 3.4 Mobile collapse

At < 768px:
- Nav collapses to bottom tab bar (5 primary items).
- Top bar reduces to logo + bell + me menu.
- Modals become full-screen sheets.

## 4. Device Surfaces

### 4.1 Phone (V1: review surface; V1.x: pairing + lightweight ops)

Phone is for:
- reading inbound missions
- accept / reject / ask-question on missions
- checking connection health
- approving high-stakes handoffs (Dual Authorization confirmations)
- receiving notifications

Phone is NOT for:
- creating new local AI staff (full keyboard recommended)
- editing cultivation profiles
- composing complex handoff forms (Approval Chains, Negotiated)

### 4.2 Desktop Web / Local App

Primary surface. Full feature set. The Tauri-packaged desktop app and the in-browser web app share the same UI; only auth and storage paths differ.

### 4.3 CLI executor surface (V2)

When a CLI is registered as a staff substrate (per `local-agent-management.md` § 5.3), each invocation may surface a per-invocation modal/banner depending on the staff's autonomy level. Not a full screen.

### 4.4 Phone-as-co-signer (V1.x)

For Dual Authorization handoffs, the cosigner's phone is a privileged surface — a push notification opens a focused screen showing exactly what's being co-signed. No other navigation around it.

## 5. Screen Specifications

### 5.1 Today

Default landing screen. Aggregates work into review-friendly buckets.

**Required sections:**

- **Hero summary line.** "You have 3 missions waiting, 2 deliverables returned, 1 connection degraded."
- **Six bucket cards:**
  1. **Local AI running** — count + names of staff currently executing
  2. **Remote peer waiting** — count + named connections we're awaiting
  3. **Inbound mission pending** — count + sender desks
  4. **Deliverable returned** — count + brief preview of the most recent
  5. **Blocked** — count + the unblocking action needed (prominent visual)
  6. **Retrying** — count + countdown to next retry (per Stripe schedule)
- **Recent activity feed.** Reverse-chronological audit events relevant to the owner; clickable to drill into the entity.
- **Quick-create button.** "+ New assignment" or "+ New handoff" — opens the form composer.

#### 5.1.1 Personal Queue

Per ADR-015: owner manual work is NOT a Members card. It surfaces here in Today as a dedicated "Personal Queue" section.

**When it appears:** a mission accepted and routed to the owner (not delegated to AI/CLI/peer staff) lands as a card in this section. The owner's own manually-created todos also appear here.

**Card shape:** same visual structure as assignment cards (title, body excerpt, due date if present, source mission link). No substrate badge (there is no substrate — it's the owner's own work). Status chips: Pending / In progress / Done.

**Position:** rendered between the six bucket cards and the Recent activity feed. Empty state: "Nothing in your queue — you're all clear." Celebrate with visual treatment consistent with the all-good Today state.

**State coverage required:**

- Empty (new desk, nothing in flight)
- Mid-activity (some buckets non-zero)
- Heavy load (many items per bucket; truncated with "view all")
- All-good (zero in blocked / retrying / pending; celebrate visually)

### 5.2 Inbound

The mission inbox. Per `functional-architecture.md` § 3.7, ALL external work lands here — there is no protocol path that bypasses it.

**Required sections:**

- **Filter chips:** All / Pending / Accepted / In progress / Submitted / Rejected / Expired.
- **Mission list** (most recent first; sorted by priority + time within state).

**Per mission row:**

- Sender desk + person + display name
- Mission title + first-line excerpt of body
- **Handoff form badge** — one of the 14 forms (e.g., "Direct Order", "Dual Authorization", "Watch Brief"). Color-coded to form family.
- Authority scope summary (e.g., "cite-only" / "transform" — per `handoff-design.md` § Authority Scope)
- Deadline if present (Windowed / Scheduled-segment timeliness)
- Quick actions inline: **Accept** / **Reject** / **Ask question**

**Mission detail (expanded view or sheet):**

- Full mission body (markdown rendered)
- **Form details panel** — explains the form in plain language (per `handoff-taxonomy.md` § "UI Consent Flow Per Form")
- **Context pack viewer** — list of items the sender included; click to inspect each (per `context-pack.md` § 10.2)
- **Authority scope detail** — what the receiver may DO with the context
- Action area (varies by form):
  - For Direct Order with hierarchical authority: auto-accepted (still requires acknowledgment)
  - For Dual Authorization: shows cosigner status + your sign button
  - For Negotiated: shows current proposal + counter-propose UI
  - For all: Accept (route to local staff or owner queue) / Reject (with reason) / Ask Question (back to sender)

**Special states:**

- Withdrawn by sender (banner; auto-removes after 7 days)
- Sender desk offline (mission still actionable; reply queues)
- Pack hash mismatch (security warning; refuse by default)

### 5.3 Members (route: Staff)

The local team roster — page heading "Members" per ADR-003 (URL slug stays
`/staff` for V1; route rename deferred to a future ADR). Per
`local-agent-management.md`, this is where the flat-roster discipline lives.

**Required sections:**

- **Roster overview header.** "X of N members active" — N is the desk's `span_of_control_cap`. Soft warning at 5+, soft block at 8+.
- **Substrate filter chips:** All / Local AI / CLI executor / Peer. (Per ADR-015: Myself chip removed — owner manual work is in Today's personal queue, not the Members roster.)
- **Add member button.** Opens the explicit-creation flow (substrate picker → role picker → config wizard).

**Per member card:**

```
┌─────────────────────────────────────────────────┐
│ [avatar]  NAME                          [⋯]    │
│           Role · [substrate badge] · [autonomy badge] · [status badge] │
│                                                 │
│  Currently: idle | running 2 jobs | paused      │
│  Cultivation: ●●●○○ (3 of 5 maturity)          │
└─────────────────────────────────────────────────┘
```

- **Autonomy badge** — color-coded pill (Supervised=gold, Bounded=blue,
  Autonomous=green) per ADR-012; click opens popover to change level.
  Detailed component spec in § 6.2 of this doc.
- **Governance mode badge** (always_supervised → slider locked at Supervised with explanation).
- **Cultivation maturity** indicator — visual based on standing-instruction count + exemplar count + assignment history. Click to drill into cultivation profile editor (V1.x).
- **Status** with current load.
- **Substrate badge** — visual differentiator (cube for CLI, person for myself, AI dot for local AI, link for peer).

**Peer-identity cards** are visually distinct (different border) — they are local mirrors of Core 2 connections. Click goes to Connections drilldown.

Each member and peer card includes a **chat icon** (per ADR-013) alongside the `⋯` menu. Clicking the chat icon opens the global chat panel (§ 5.6) pre-filtered to that member's tab. The `owner_assistant` member has no per-card chat icon — its chat is the "Myself" tab in the global panel and is always accessible via the top-bar chat icon (Entry point A).

**Member detail panel:**
- Description (role, capability summary)
- Tool scope (allowlist; editable)
- Budget caps (tokens, cost, time)
- Recent assignments (last 10)
- Cultivation profile preview + "Edit profile" CTA (V1.x)
- **Mentors section** (per ADR-016; only shown for `local_ai` members that have `mentors[]`): lists each attached mentor peer with the domain annotation and invocation policy. Each row shows: mentor display name (linked to their connection record in Connections), domain string (e.g., "JP→EN translation"), and policy pill ("Owner picks" for V1 `owner_picks_per_task`, "AI decides" for V1.x `ai_decides`). Empty state: "No mentors attached — add one to let [AI name] escalate to a human expert."
- Pause / Archive controls

### 5.4 Connections

Per `peer-communication-architecture.md` § 12 + `auth-and-identity.md` § 4.

**Required sections:**

- **Health summary banner.** "All connections healthy" / "2 degraded" / "1 revoked".
- **Connection list.**
- **Pair new connection button.**

**Per connection row:**

- Display name + remote person identity
- **Health badge** — `healthy` / `degraded` / `offline` / `retrying` / `revoked` / `invalid_token` (color-coded).
- Last seen timestamp (relative)
- Pending handoffs count (in + out)
- Quick actions: Test connection / Rotate key / Revoke

**Connection detail panel:**

- Connection metadata (paired date, capabilities, policies)
- Health timeline (graph: state transitions over time)
- Recent handoffs to/from this connection
- Token/key info (rotation date, expiry; never the actual secret)
- Per-connection policy settings (accepted forms, rate limit)
- Revocation: explicit two-step (click Revoke → confirm with reason)

**Pair new connection flow** (separate sheet):

1. Choose target: enter personal code / scan QR / pick from suggestions
2. Confirm intent
3. Wait for receiver acceptance (live status; can cancel)
4. Set initial policies (accepted forms, rate limit)
5. Done — connection appears in list

### 5.5 Deliverables

Per `deliverable-spec.md`. Three columns reflecting origin types.

**Required sections:**

- **Filter chips:** All / Local AI produced / Remote returned / Submitted upstream
- **Search box** (within deliverables; full-text on title + body)
- **Three-column layout** at desktop; stacked at mobile

**Per deliverable card:**

- Title
- Author (per `deliverable-spec.md` § 3.3 attribution disclosure)
- Body excerpt (first 200 chars or summary)
- Citations count + "view sources"
- Body kind icon (markdown / structured / files / sandbox)
- Source assignment / mission link
- Timestamp
- Status badge (draft / submitted / accepted / rejected / partial / withdrawn)
- Actions: View / Approve / Edit / Withdraw

**Deliverable detail view:**

- Full content (rendered per body kind)
- Files (download / preview)
- Citations (clickable to source)
- Attribution (full per disclosure level)
- Version history with supersession chain
- Cultivation feedback hooks (per `deliverable-spec.md` § 11)

### 5.6 Chat Surface (per ADR-013)

Chat is not a new architectural primitive — it is the UI exposure of Hermes's natural conversational form. Every chat session is one Hermes `AIAgent` loop instance. See ADR-013 for the full design rationale and `docs/implementation/hermes-v2-implementation-goal.md` § "AIAgent is the main conversation loop" in the mibusy repo for the architectural basis.

#### Entry points (A + B hybrid)

**Entry point A — Global panel from top bar:**
The top bar gains a chat icon in the bell area. Clicking it opens the global right-side chat panel. Default tab: "Myself" (`owner_assistant` chat). Additional tabs: recent member chats ordered by recency.

**Entry point B — Per-card chat icon on Members screen:**
Each member and peer card on the Members screen gets a small chat icon alongside the existing `⋯` menu. Clicking it opens the global chat panel pre-filtered to that member's chat tab.

Both entry points open the same panel. Which tab is selected on open is the only difference.

#### Global right-side chat panel

```
┌──────────────────────────────────────┐
│ [Myself] [Wang ✕] [Sally ✕]   [×]   │  Tab bar (pinned Myself + recents)
├──────────────────────────────────────┤
│                                      │
│  ┌───────────────────────────────┐   │
│  │ Wang's response (turn 2)      │   │
│  │ "Here's what I found on the  │   │
│  │  Q3 report: …"               │   │
│  │ [cite: Q3-report.md]         │   │  Citation chip
│  └───────────────────────────────┘   │
│                                      │
│  ┌───────────────────────────────┐   │
│  │ ● Checking member status…     │   │  Tool-call indicator
│  └───────────────────────────────┘   │
│                                      │
│  [_________________________________] │  Input field
│  [Send]                              │
└──────────────────────────────────────┘
```

Panel layout: 480px wide right-side overlay (matches existing detail-drawer width per § 10.1); slides in over the main content; does not replace the nav.

**Per-member chat tab:**
- Hermes agent: that member's profile, tool scope, and cultivation profile + global desk context (read-only)
- Conversation is multi-turn; history persists in-memory per session (V1). If the app restarts, session history is lost. Dev Agent implements `member.chat_log[]` array — no new database table.
- Citation chips appear when the agent references desk context items.

**Myself tab (owner assistant):**
- Hermes agent: `owner_assistant` profile with orchestration tools (`create_assignment`, `list_missions`, `get_member_status`, `ping_peer`, `view_deliverable`, etc.)
- Global context: full read access to desk members, missions, connections, and recent deliverables.
- Typical queries: "Show me all blocked missions," "Draft a mission for Sally," "What did Wang return last week?"

#### Mock requirement (V1)

V1 mock MUST include realistic sample content. No empty boxes:

- Multi-turn samples: minimum 3 back-and-forth exchanges per chat type (Myself + one member)
- Tool-call indicator visible: e.g., "Checking member status…" with animated dots between user message and agent response
- Streaming indicator: text reveal or animated dots while response arrives (consistent with § 7.5 animation system)
- Citation chips for responses referencing desk context (consistent with `deliverable-spec.md` citation patterns)

#### App shell change (top bar)

Revised top bar in § 3.3:

```
┌──────────────────────────────────────────────────────────────┐
│  [logo] Holon                    [search] [chat] [bell] [me] │  Top bar (fixed)
```

The chat icon sits between search and bell. On mobile (< 768px), the chat icon is retained in the top bar (the global panel slides in full-width).

## 6. Cross-Cutting UI Patterns

### 6.1 Form-Aware Handoff Composer (modal/sheet)

Reachable from anywhere via "+ New handoff" or quick-create. Per `handoff-taxonomy.md` § "UI Consent Flow Per Form".

**Step 1 — Recipient picker.** Search across connections (typeahead). Recent recipients shown. "Pair new" link if not yet a connection.

**Step 2 — Form picker.** Cards for each form with one-line description and recommended-when text. Defaults shown based on connection type. Advanced forms hidden under "Show all 13 forms".

**Target-aware toggle (per ADR-016):** When the selected target staff is a `local_ai` member with one or more mentors attached, Step 1 (Recipient picker) shows an additional toggle immediately after target selection:

```
Route via:  ● Let [AI name] handle   ○ Send to mentor: [pick from list]
```

Selecting "Send to mentor" reveals a picker listing the AI member's configured mentors (by domain + display name). The owner picks one; the composer proceeds to Step 2 (Form) pre-set to Advisory for V1.x+. In V1, the mentor routing is recorded informally (no formal handoff created); the UI shows a note: "This will be recorded in [AI name]'s cultivation log."

**Step 3 — Form-specific configuration.** Different per form per `handoff-taxonomy.md`:
- Direct Order: title + body + (optional) deadline
- Dual Authorization: cosigner picker
- Approval Chain: drag-and-drop chain builder
- Temporary Cover: date/time pickers
- Conditional Engagement: predicate builder
- Subcontracting: pre-disclose sub-handoff plan
- Parallel Solicitation: multi-recipient picker + resolution policy

**Step 4 — Context pack composer.** Per `context-pack.md` § 10.1.

**Step 5 — Confirm + send.** Plain-language summary + "what happens next" preview.

### 6.2 Autonomy Badge + Popover

(Per ADR-012: replaces the 3-stop segmented control from ADR-004 with a
color-coded badge + click-to-edit popover. Autonomy changes are rare —
monthly, not daily — so the badge keeps the current level visible without
occupying card real estate for an infrequent action. The three levels
Supervised / Bounded / Autonomous from ADR-004 are unchanged.)

A single color-coded badge rendered inline with the substrate badge and
status badge on staff cards and in the staff detail panel.

```
[Bounded] ← clickable color-coded badge (Supervised=gold, Bounded=blue, Autonomous=green)
```

**Color mapping (using existing brand tokens from § 7.1):**

| Level | Badge text | CSS token | Hex | Text color |
|---|---|---|---|---|
| Supervised | "Supervised" | `var(--gold)` | `#C69A35` | white |
| Bounded | "Bounded" | `var(--blue)` | `#1F6F9E` | white |
| Autonomous | "Autonomous" | `var(--green)` | `#2E7D52` | white |

**Hover affordance:** badge shows a 1px outline ring (`var(--blue)`, 100ms
transition) on hover; cursor changes to `pointer` to signal interactivity.

**Popover (on click):**

Clicking the badge opens a small popover anchored below the badge (or above
if insufficient viewport space; 200–260px wide):

```
┌──────────────────────────────────────────┐
│  Autonomy level                          │
│  ◯ Supervised   Every output requires    │
│                 owner approval           │
│  ● Bounded      Acts within declared     │
│                 limits; pauses if limit  │
│                 would be exceeded        │
│  ◯ Autonomous   Acts without per-        │
│                 assignment approval;     │
│                 owner reviews audit      │
└──────────────────────────────────────────┘
```

- Three radio options, one per level, each with a 1–2 line inline
  explanation of its meaning.
- Selecting a radio commits immediately (iter-001a: UI-state only; no
  real persistence).
- **Esc** or click outside dismisses without committing (restores
  previous selection if the radio was changed but not confirmed).

**Lock state (`governance_mode === "always_supervised"`):**

- Badge text is prefixed with 🔒: `🔒 Supervised`.
- Badge is **NOT clickable** — no popover opens.
- Cursor changes to `not-allowed`.
- Hover tooltip: "Locked by governance_mode (always_supervised). Click
  owner settings to change."

**Substrate ceiling rendering (per ADR-004 § 4):**

- For `cli` staff: badge is clickable, but the popover disables the
  "Autonomous" radio (grayed out) with per-option tooltip: "CLI executors
  are capped at Bounded — see local-agent-management.md § 8.4."
- For `peer` staff: badge is **hidden entirely** (autonomy is N/A for peer substrates — autonomy of the actual work is the remote desk's concern). Per ADR-015, `myself` is no longer a substrate; owner work appears in Today's personal queue with no autonomy badge.

**Paused staff (`staff.status = 'paused'`):** badge is rendered read-only
(no click affordance, no hover ring). Hover tooltip: "Staff is paused.
Resume to change autonomy." Previously set autonomy level is preserved and
shown in the badge; resuming re-enables interaction.

### 6.3 Cultivation Indicator

Small visual on staff cards (5-pip maturity dot pattern). Click → opens cultivation profile editor (V1.x; V1 shows read-only summary).

### 6.4 Connection Health Badge

Color-coded pill rendered wherever a connection is named.

| State | Color | Visual |
|---|---|---|
| healthy | green | Solid pill, white text |
| degraded | amber | Solid pill, white text |
| offline | gray | Outlined pill, gray text |
| retrying | blue (animated) | Pulsing pill |
| revoked | red | Strikethrough text + pill |
| invalid_token | red | Solid pill with key icon |

### 6.5 Form Badges

Each handoff form gets a distinctive badge style.

| Form family | Visual cue |
|---|---|
| Authority forms (Direct Order, Direct Takeover, Approval Chain) | Solid filled |
| Mutual forms (Dual Authorization, Negotiated) | Outlined with double border |
| Receiver-passive forms (Watch Brief, Observer Brief) | Soft tinted, smaller |
| Time-sensitive forms (Temporary Cover, Conditional Engagement) | With clock icon |
| Composite forms (Subcontracting, Parallel Solicitation) | With branching icon |

### 6.6 Audit Timeline (drawer)

Available from Today screen and from any entity detail view. Shows audit events filtered to the entity.

Per event:
- Timestamp (relative + absolute on hover)
- Event kind (formatted human-readable)
- Actor (human / AI controller / system / remote desk)
- Payload preview (collapsed JSON; expandable)

Subscribed to live via SSE — new events animate in.

### 6.7 Notification Bell

Top-bar bell shows unread count. Click opens panel:
- Pending missions
- Critical audit events (errors, security warnings)
- Pairing requests
- Cosigner requests (Dual Authorization)
- Returned deliverables (since last visit)

Filterable; "mark all read"; clicking deep-links to entity.

### 6.8 AI Controller Indicator

When an AI controller is configured (per `auth-and-identity.md` § 8), persistent indicator on top bar:
- "AI controller active" (with small AI icon)
- Click → who has access, what capabilities, last action timestamp
- Quick toggle: "pause AI controller for X hours"

## 7. Visual System

### 7.1 Brand Tokens (consistent with marketing page)

```css
--bg:        #F8F6EF
--bg-alt:    #EFEBDD
--bg-dark:   #111
--ink:       #1A1A18
--ink-soft:  #4A4A45
--ink-mute:  #6E6A60
--line:      #E2DCC8
--gold:      #C69A35
--green:     #2E7D52
--blue:      #1F6F9E
--purple:    #7B4FAB

--radius:    16px
--max:       1120px
```

### 7.2 Typography

- **Inter** (variable) for everything UI.
- **Charter / Iowan Old Style / Georgia** italic for accent emphasis.
- **JetBrains Mono / SF Mono** for code samples + audit JSON payloads.

Type scale:
- Display: 56px / -2.5% letter / 700
- H1: 32px / -2.5% / 700
- H2: 24px / -2% / 600
- Body: 15px / 0 / 400
- Caption: 13px / +1% / 500
- Mono: 13px / 0 / 400

### 7.3 Spacing

8px grid. Common values: 8 / 12 / 16 / 24 / 32 / 48 / 64.

### 7.4 Component primitives

- **Card** — `bg: white, border: 1px var(--line), radius: var(--radius), padding: 24-30px, shadow: subtle on hover`
- **Button** — `padding: 12-22px, radius: 10px, transition: lift on hover`. Primary (filled ink), Secondary (outlined), Ghost (text + bg-alt hover).
- **Badge / Pill** — small, semantic colors per state
- **Chip** — like badge but interactive (filter chips)
- **Input** — outlined with focus state in green
- **Modal** — backdrop blur, centered, escape closes

### 7.5 Animation

Subtle, slow, premium.
- Hero gradient shimmer (marketing-page style — 6s loop on accent text)
- Card hover lift (transform translateY(-2px))
- Bucket card count tick
- Notification arrival (slide + fade in)

Respect `prefers-reduced-motion` — disable shimmer / lift / counter ticks when set.

## 8. Copy Rules

### 8.1 Voice

Confident, plain, second-person. No marketing-speak in product UI.

- ✅ "Wang accepted your mission."
- ❌ "Your mission has been graciously received by your collaborator."

### 8.2 Form names in UI

Use the human form name from `handoff-taxonomy.md`:
- "Direct Order", not "DirectOrderHandoff"
- "Dual Authorization", not "dual_auth"
- "Watch Brief", not "watch_brief_form"

### 8.3 State language

| Internal state | UI copy |
|---|---|
| `accepted` | Accepted |
| `in_progress` | In progress |
| `submitted` | Done — awaiting your review |
| `done` | Completed |
| `blocked` | Blocked |
| `expired` | Expired |
| `pending_cosign` | Awaiting cosigner |
| `failed` | Failed |
| `retrying` | Retrying — next attempt at {time} |

### 8.4 Error messages

Per `reliability-and-testing.md` "no silent failure". Every error gets:
- WHAT happened (in plain language)
- WHY (if useful; not technical)
- WHAT TO DO next (action button when possible)

Example:
- ✅ "Wang's desk is offline. Your handoff is queued; we'll deliver when they come back. [View queue]"
- ❌ "WIRE_NO_DEVICE_AVAILABLE: -32011"

### 8.5 Empty states

Every list / screen has a designed empty state:
- Illustration or icon
- Plain text explaining why empty
- CTA when there's an obvious next action

## 9. Accessibility

### 9.1 Required

- Keyboard navigation throughout (no mouse-only paths).
- `:focus-visible` outlines (2px green, 2px offset).
- Semantic HTML.
- ARIA labels on icon-only buttons.
- Color contrast: AA minimum.
- Alt text on meaningful images; empty alt on decorative.

### 9.2 Reduced motion

`@media (prefers-reduced-motion: reduce)` disables shimmer, lift, animated badges, scroll reveal.

### 9.3 Screen reader

Live regions for:
- New missions arriving
- State changes on entities currently in view
- Form composer step transitions

## 10. Layout

### 10.1 Desktop (≥ 1024px)

- Left nav: 220px fixed
- Top bar: 64px fixed
- Main content: max 1120px centered, 28px gutters
- Detail drawers: 480px right-side overlay

### 10.2 Tablet (768–1024px)

- Same as desktop but nav narrows to 60px (icon-only with tooltip)
- Detail drawers go full-width modal

### 10.3 Mobile (< 768px)

- Bottom tab bar: 5 primary nav items
- Top bar: 56px with hamburger for secondary
- Main content: full-width with 20px gutters
- Modals: full-screen sheets

## 11. UI Invariants

These are rules the UI must enforce; tests verify.

| Invariant | Source | Enforcement |
|---|---|---|
| Mission inbox is the ONLY way external work enters | `functional-architecture.md` § 7.2 | No screen accepts work without owner queue mediation |
| Form is shown on every handoff badge | UI rule | Linter on badge component |
| Connection health is shown wherever a connection is named | UI rule | Component composition |
| Authority scope shown on every mission view | UI rule | Component composition |
| Audit-emit on every owner action | `reliability-and-testing.md` § 10.1 | Hook in service layer |
| Reduced motion respected | § 9.2 | CSS media query |
| Sub-delegation disclosure visible when present | `handoff-taxonomy.md` Axis 6 | Mission sheet component |
| Multi-device claim ("claimed by laptop") shown when relevant | `peer-communication-architecture.md` § 8.3 | Mission row component |
| AI controller actions visually marked | `auth-and-identity.md` § 8 | Audit timeline + entity-action attribution |
| Local AI work distinguishable from peer work at a glance | (per ADR-015: myself removed; owner work in Today personal queue) | Substrate badge on member/assignment surfaces |
| Returned deliverables presented as durable artifacts (not chat) | `deliverable-spec.md` § 1 | Deliverable card component |
| The UI shows a flat team, never a hierarchy | `local-agent-management.md` § 2 | No staff card has a "manages" relationship |
| Chat does not create durable work objects; missions and assignments remain the only durable work primitives | ADR-013 + ADR-009 (data-model rule preserved) | Chat panel never renders a "create from chat" flow that bypasses the assignment composer |
| V1 chat mock must include realistic multi-turn samples; no empty chat boxes | ADR-013 § Decision 5 | Mock fixture review at iter acceptance |

## 12. Iteration Strategy

Per ADR-001 (BFF + iteration shape), the UI is iterated in two phases:

- **Iteration 001 (now)**: pure mock with fixture data, no backend.
- **Iteration 002+**: vertical slices — each iteration adds one screen or feature with backend wired up.

Iteration 001 covers: app shell + 5 primary screens + form composer (4 of 14 forms) + autonomy badge + popover + connection health badges. See `iterations/001-ui-mock/`.

## 13. Cross-References

- Functional model: `functional-architecture.md` § 3 (components → screens)
- Handoff form UX details: `handoff-taxonomy.md` § "UI Consent Flow Per Form"
- Autonomy badge + popover semantics: `local-agent-management.md` § 8 (levels); ADR-012 (widget)
- Cultivation feedback hooks: `deliverable-spec.md` § 11
- Connection lifecycle: `peer-communication-architecture.md` § 12
- AI controller indicator: `auth-and-identity.md` § 8
- Audit event subscription: `reliability-and-testing.md` § 5.4
- Brand tokens canonical source: the marketing page at <https://chenz16.github.io/Holon/>
- Chat surface design + rationale: ADR-013 (`docs/decisions/013-chat-surface-as-hermes-loop.md`)
- Chat architectural basis: mibusy `docs/implementation/hermes-v2-implementation-goal.md` § "AIAgent is the main conversation loop"
- Chat per-member agent: `local-agent-management.md` § 4.2 (`owner_assistant` role), § 7 (cultivation profile injected as chat context)

## 14. Open Decisions

1. **Empty-state illustrations.** Custom illustrated or icon-only? V1: icon-only; V1.x: custom.
2. **Mobile bottom-tab vs hamburger.** Bottom-tab is more touch-friendly. V1: bottom-tab.
3. **Cultivation maturity heuristic.** The 5-pip dot pattern needs a defined formula (V1.x).
4. **Audit timeline default density.** Per-event vs grouped-by-day. Default: per-event; grouped option.
5. **Handoff form picker UI.** Cards vs dropdown vs progressive disclosure. V1: cards for the 4 most common, expandable to all 13.
6. **Notification bell behavior on mobile.** Tab bar already crowded; notifications might better be a top-bar pull-down.
7. **Search V2 scope.** Full audit search? Cross-deliverable? Cross-org? Defer.
8. **Tauri-specific UI.** Native chrome integration (e.g., menu bar items) — V1.x.

## 15. Acceptance Criteria

V1 implementation-ready when:

1. ✅ Information architecture defines 5 primary + secondary nav
2. ✅ Each primary screen has required sections + state coverage
3. ✅ Cross-cutting patterns specified (composer, slider, badges, timeline, bell, AI indicator)
4. ✅ Visual system tokens, type scale, spacing, components primitives
5. ✅ Copy rules with voice + state language + error format
6. ✅ Accessibility minimums named
7. ✅ Layout for 3 breakpoints (desktop / tablet / mobile)
8. ✅ UI invariants list with enforcement mechanism per row
9. ✅ Iteration strategy linked to ADR-001
10. ⬜ Iteration 001 mock implements §§ 5.1–5.5 + 6.1 + 6.2 + 6.4 (verify in iter 001 acceptance)
11. ⬜ V1.x adds §§ 6.3 cultivation editor, 6.7 notification bell deep-linking
12. ⬜ V2 adds AI controller multi-controller UI, sandbox handoff visual treatment

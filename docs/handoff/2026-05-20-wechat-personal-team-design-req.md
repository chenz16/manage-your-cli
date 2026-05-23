# Design Requirement — WeChat Integration (Personal + Multi-Holon Team)

Date: 2026-05-20
Author: owner ↔ assistant design discussion (refined session)
Status: **SUPERSEDED** by `2026-05-20-wechat-via-clawbot-design-req.md` (same day, after owner pointed out WeChat ClawBot — Tencent's official Bot API launched 2026-03-22, fundamentally changes the integration story)
Reason superseded: This doc assumed Wechaty/PadLocal was the only personal-WeChat path. Reality (verified via WebSearch 2026-05-20): Tencent officially launched WeChat ClawBot iLink protocol on 2026-03-22, giving the first-ever legal Bot API for personal WeChat — accessed via the open-source OpenClaw framework. Wechaty becomes V2 fallback, not V1 primary.
Supersedes: `2026-05-20-wechat-connector-feature-request.md` (earlier this day; outdated assumptions on WeChat Work primacy and V2-deferred personal)
Target iteration: V1.1 — V1.3 (parallel-safe with Storage + Triage + Interview design reqs)
Pickup by: Requirements Agent → iteration `requirements.md` + `plan.md`
Related: ADR-029 (substrate model), `2026-05-19-triage-skills-design-req.md` (Asks auto-triage), `2026-05-19-onboarding-interview-design-req.md` (Casey skill pattern), `2026-05-19-storage-architecture-design-req.md` (BYOC + Chinese cloud), Engineering Rules #4, #6, #7, #8

---

## 0. TL;DR (the entire doc compressed)

```
WHO uses this:        SMB team where boss + employees are all on personal WeChat
ARCHITECTURE:         Each person installs Holon + connects own WeChat via Wechaty/PadLocal
TOPOLOGY:             Multi-Holon team. Internal coordination via Core 2 (NOT WeChat).
                      WeChat is purely the bridge to external (non-Holon) world.

P0 (MAIN WORK):       READ-heavy. ~80-200 inbound msgs/day per boss → AI triages + extracts
                      intent → 3-5 important things surfaced. THIS is the killer value.
P1 (LIGHT):           Send is human-in-loop with rate limits. 5-15 outbound/day per user.
                      Default: AI drafts, user clicks send. Hard cap 15/day, 5/contact/day.

NO WeChat Work:       Deprioritized. SMB Chinese reality is everyone uses personal WeChat.
                      Don't force operational change on customer.
NO mass send:         Never. Rate limits enforced in code, not just docs.
NO auto-add friends:  Never. Highest ban-risk pattern.

USER COST:            PadLocal subscription ~$24/mo per person, paid directly to PadLocal
                      (not via Holon — protects Holon legally).
TOS RISK:             Acknowledged. Wechaty violates personal-WeChat ToS, but at low volume
                      with human-in-loop sends, real-world ban rate is single-digit %.
                      Each user opts in with full disclosure during onboarding.

PHASE 1.1:  Wechaty READ + Triage + Intent extraction
PHASE 1.2:  Send with rate limits + audit
PHASE 1.3:  Daily digest + per-contact controls + quiet hours
PHASE V2:   Group chat @-mention bot, multi-account, voice transcription, WeChat Work option
```

---

## 1. Owner's Locked Decisions (from 2026-05-20 session)

These are no longer open questions. Implementation should treat as fixed:

| # | Decision | Owner direction |
|---|---|---|
| D1 | Personal WeChat only, not WeChat Work | "不上 wechat work 就是私人的 wechat 个人的 wechat" |
| D2 | Whole team on Holon (each person individually) | "假定员工和老板都用 不用那就没啥事了 那就沟通不需要 wechat" |
| D3 | Internal coordination NOT through WeChat | "沟通不需要 wechat" → Core 2 peer mesh handles internal |
| D4 | Reading is the main value, NOT sending | "1. summary 信息 ok 简单 2 发送不太行" |
| D5 | Low-volume occasional sending IS acceptable | "我只是偶尔发 控制发的个数 这个可以做到" |
| D6 | Employees send few/day, boss receives many/day | "一个员工一天就发几条 老板倒是 [收] 到好多条" |
| D7 | Each user accepts ToS risk individually during onboarding | (Implied — see § 4 ToS UX) |
| D8 | PadLocal as Wechaty puppet; user pays PadLocal directly | (Implied — see § 3 architecture) |

---

## 2. Architecture

### 2.1 Topology — Multi-Holon team mesh

```
─── A small business team, all on Holon, all on personal WeChat ─────

   Boss                          Employee A             Employee B
    │                              │                       │
   Holon-boss                    Holon-A                Holon-B
    │                              │                       │
    └────── Core 2 peer mesh ─────┴───────────────────────┘
              (internal coordination — missions, deliverables,
               status updates flow HERE, NOT via WeChat)

   Each Holon ↔ that person's own personal WeChat ↔ External world

─── External world side (non-Holon people) ─────────────

   Boss ←─ WeChat-boss ←─ Clients / friends / vendors (not on Holon)
   Employee A ←─ WeChat-A ←─ Clients (A's accounts) / personal
   Employee B ←─ WeChat-B ←─ Clients (B's accounts) / personal
```

**Two parallel communication networks**:
- **AI network**: Each Holon talks to other Holons via Core 2 (structured missions, deliverables)
- **Human network**: Each person uses WeChat normally to talk to humans outside the team

WeChat is **not** the team's internal channel — it's the external interface.

### 2.2 WeChat Connection per Person — Wechaty + PadLocal

Each user's Holon integrates with their own personal WeChat via:

```
Holon (Tauri app)
   │
   ├─ Wechaty SDK (npm package, runs inside Holon)
   │     │
   │     ↓  HTTPS API to padlocal.com
   │     │
   │     ▼
   │  PadLocal cloud service (PadLocal company's servers, China)
   │     │
   │     ↓ iPad protocol to Tencent's WeChat servers
   │     │
   │     ▼
   │  WeChat servers (Tencent)
```

**Setup details**:
- PadLocal puppet client runs on PadLocal cloud, occupies the Pad slot
- User's phone WeChat continues running normally (Phone slot)
- Both clients see the same account, both online simultaneously, no conflict (verified by WeChat's documented multi-device login policy: Phone + PC + Pad each get one slot)
- Initial auth: User scans QR with phone WeChat, confirms "iPad login"
- Persistence: PadLocal client stays logged in across Holon restarts (days to weeks before re-scan needed)

### 2.3 PadLocal as External Dependency (NOT bundled by Holon)

User must sign up for PadLocal separately (~$24/month per WeChat account). Holon does NOT:
- Resell PadLocal
- Bundle PadLocal payment
- Pay PadLocal on behalf of user
- Run PadLocal infrastructure

Holon ONLY:
- Includes Wechaty SDK in app bundle
- Provides UX for "paste your PadLocal token + scan QR"
- Talks to PadLocal API using user's token

This separation matters legally: Holon is a Wechaty client app, not a Wechaty/WeChat service operator. Same posture as ChatGPT desktop clients vs OpenAI.

---

## 3. Read Path (P0 — the main work)

### 3.1 Inbound flow

```
WeChat message arrives at Tencent server
   ↓
PadLocal cloud client receives it
   ↓
Wechaty SDK in Holon: on('message', msg => ...)
   ↓
Holon: normalize to Ask object {source: 'wechat', sender, content, files, ts}
   ↓
TriageDispatcher runs (per existing triage skills design req)
   ↓
   ├─ matched: auto_accept → route to staff
   ├─ matched: auto_decline → polite WeChat reply (counts toward send limits)
   └─ no match: pending_owner (default safety)
   ↓
[Optionally] IntentExtractor skill runs on the content:
   - Extract tasks ("Tom please draft proposal")
   - Extract decisions ("we'll go with option B")
   - Extract questions ("when's the deadline?")
   - Extract follow-ups ("remind me Friday")
   ↓
Surface in Asks tab with WeChat badge + extracted intents
```

### 3.2 Intent Extraction Skill (new, but uses existing skill framework)

A `kind: "task"` skill that runs on raw WeChat conversation text:

```yaml
name: WeChat Intent Extractor
kind: task
runs_on: wechat_message_batch
system_prompt: |
  Read the conversation. Extract:
  - Tasks: who should do what by when (with confidence score)
  - Decisions: what was decided
  - Questions: what's pending
  - Follow-ups: what needs reminder
  - Sentiment: any urgency / frustration signals
  Output as structured JSON. Skip casual chitchat.
tools:
  - create_mission
  - flag_for_owner_review
  - extract_files
```

**Important**: Extraction runs locally on Holon (via Hermes), NOT via cloud LLM, to keep WeChat content private. (See storage design req on data residency.)

### 3.3 Daily Digest Skill

For the boss's 80-200 inbound/day reality, a once-or-twice-daily digest:

```
🌅 Morning Digest — 2026-05-20 09:00

Yesterday WeChat: 156 messages across 23 chats.

3 things need your attention:
  1. Wang Chen (ACME) — asked about pricing, awaiting your reply  [Reply →]
  2. Sally (your virtu) drafted response for Mary's request       [Review →]
  3. Tom (employee) blocked on contract review                    [Help →]

AI auto-handled:
  - 12 routine confirmations (e.g., "got it", "thanks")
  - 8 spam / promo / group ads (silenced)
  - 4 status updates from employees (logged to mission threads)

Nothing else needed your time. ⏱ Saved ~ 2.5 hours yesterday.
```

### 3.4 File / Media Capture

WeChat messages often include attachments. Holon must fetch and process:

| WeChat message type | Wechaty SDK | Storage destination |
|---|---|---|
| Text | `msg.text()` | Inline in Ask content |
| Image | `msg.toFileBox()` → blob | Workspace folder + thumbnail in Ask |
| File (PDF, DOC) | `msg.toFileBox()` → blob | Workspace folder + reference in Ask |
| Voice | `msg.toFileBox()` → audio blob | Workspace folder; V1.3 transcribe via local Whisper |
| Video | `msg.toFileBox()` → video blob | Workspace folder (no auto-process V1) |
| Sticker / emoji | Text fallback | Inline |

Files land in the workspace folder per Storage design req — local-first by default, optional cloud backend.

### 3.5 What's NOT captured (V1 scope edges)

- **朋友圈 (Moments)**: WeChat API doesn't expose Moments well, and these are personal-life content. Skip.
- **Mini Programs / 小程序 cards**: Treat as inert text references; don't auto-process.
- **Voice/video calls**: Out of scope. WeChat call protocol is separate.
- **Encrypted secret chats**: WeChat doesn't really have these; n/a.

---

## 4. Send Path (P1 — lightweight)

### 4.1 Two modes

**Mode A (default, V1.2): Human-in-loop**

```
Staff (or AI) drafts a WeChat reply in Holon
   ↓
Owner sees in their Asks/Today view:
   "Sally drafted reply to Wang: 'Re: pricing question, ...'
    [Send via my WeChat]  [Edit draft]  [Copy & I'll send manually]"
   ↓
Owner clicks "Send via my WeChat"
   ↓
Holon → Wechaty API → PadLocal → WeChat
   ↓
Audit log: who drafted, who sent, when, content hash
```

**Mode B (V1.3, opt-in advanced): Limited auto-send**

For a narrow set of patterns:
- Pre-authorized triage rule says "auto-accept and reply"
- Sending stays within rate limits
- Owner has explicitly enabled this rule

Example: Triage rule "Daily standup from team member" → auto-accept → auto-send "got it, will review" → no human needed for trivial confirmation.

### 4.2 Rate Limits (enforced in code)

```yaml
sending_limits:
  default:
    daily_max_per_account: 15        # boss is mid-volume, employees lower
    per_contact_daily_max: 5          # no contact gets spammed
    per_minute_max: 1                 # no bursts (1 msg / 60s)
    quiet_hours: "23:00-07:00"        # local time; configurable
    initial_contact_cooldown: "7 days" # newly added contact: no auto, only human-pasted
  
  owner_customizable_range:
    daily_max: [5, 50]                # hard ceiling at 50, never higher
    per_contact_daily: [3, 20]
    quiet_hours: any range
  
  system_hard_caps_not_owner_overridable:
    absolute_daily_max: 100           # bug/escape valve, owner CANNOT set above
    burst_protection: 1_per_minute    # rate-limiter at the API call layer
    new_contact_no_auto: 7 days       # always human-mediated first week
```

**Enforcement**: Pre-flight check before every Wechaty `say()` call. If limits exceed, throw `RateLimitExceededError`, surface to UI: "Today's quota reached. Switch to manual paste, or raise daily max in Settings."

### 4.3 Send-side risk mitigation (beyond rate limits)

```
✅ Vary content slightly — never send identical text to multiple contacts
✅ Pause if recipient hasn't replied for 3+ days (human approval to follow up)
✅ Don't auto-send between 23:00-07:00 unless owner explicitly approved
✅ Don't auto-send to contacts added in last 7 days
✅ Audit pattern detection: if user's sends start looking like spam patterns,
   alert owner ("Your sending pattern looks unusual — pause to review?")
✅ Provide simulated typing delay (PadLocal supports), makes sends look human
```

### 4.4 What's NEVER allowed (regardless of opt-in)

- Sending to contacts the user has never received from (cold outreach via WeChat)
- Sending in groups owner is not active in
- Adding friends programmatically
- Joining groups programmatically
- Mass-send identical text to N contacts at once
- Bypassing rate limits
- Any 24/7 auto-respond pattern

Hard-coded in the connector module. Not a setting.

---

## 5. Setup / Onboarding Flow

Each user (boss AND each employee) goes through this when they first connect WeChat:

```
─── Step 1: Choose tier ─────────────────────────────────

  How will you use Holon?
  
  ● Full setup with WeChat (recommended for team members)
    Includes WeChat connection — your Holon AI can read and assist
    with your WeChat communications.
    Note: WeChat doesn't officially support this kind of integration.
    Holon uses Wechaty (open source). For occasional, low-volume use,
    accounts rarely have issues. [Learn more about risks →]
  
  ○ Lite (Holon-only, no WeChat)
    Internal team work via Holon, manual copy-paste for WeChat.
    Zero ToS risk.
  
  [ Continue with Full ] [ Set up Lite ]

─── Step 2: PadLocal account ───────────────────────────

  Holon needs a PadLocal account to bridge to your WeChat.
  
  PadLocal is an external service (~$24/month per WeChat account)
  that handles the technical iPad-protocol connection. Holon does
  not resell or include this — you sign up directly.
  
  [ Open padlocal.com signup → ]
  
  Already have a token? Paste here: [           ]

─── Step 3: Connect ─────────────────────────────────────

  Connecting...
  
  [QR CODE]
  
  Scan this with your phone WeChat:
    Me → Settings → Account & Security → Device Management
       → Scan to log in
  
  Then confirm "iPad" login on your phone.

─── Step 4: Test ───────────────────────────────────────

  ✅ Connected! Your WeChat: 123 contacts, 45 active chats
  
  Initial scan running... (one-time, scans last 30 days for context)
  
  When done, Holon will:
    - Show your important WeChat messages in Asks
    - Let your AI staff help draft replies
    - You always click Send manually
  
  [ Done ]

─── Step 5: Permission settings ────────────────────────

  Default settings (you can change anytime):
    📤 Send daily max: 15 messages
    📤 Per-contact daily max: 5
    🌙 Quiet hours: 23:00-07:00
    👤 New contacts (< 7 days old): manual only
    🤝 Auto-disclose AI involvement: off
  
  [ Use defaults ] [ Customize ]
```

---

## 6. Engineering Rules Compliance

| Rule | How WeChat connector honors it |
|---|---|
| **#4 No silent failure** | Every send failure, rate-limit hit, connection drop surfaces visible UI error with retry/manual paste fallback. Wechaty `error` events tracked. |
| **#6 Owner-mediated authority** | Default: every send requires owner click. Auto-send only via owner-pre-authorized triage rule. No way for AI to send without explicit standing authorization. |
| **#7 Authority attenuation** | Per-staff toolScope. A virtu without `wechat:reply` can't send via WeChat. Within-scope sends still capped by rate limits. |
| **#8 Audit completeness** | Every message in/out emits audit event with hashed content + {platform, direction, contact_id, ts, staff_id, ask_id}. Hashed by default; plaintext only if owner opts in for debugging. |

---

## 7. Data Model

### 7.1 Connector config (per user, encrypted in keyring)

```typescript
interface WeChatConnectorConfig {
  enabled: boolean;
  puppet_type: "padlocal";              // V1 only PadLocal
  padlocal_token: EncryptedSecret;      // Tauri keyring, never plaintext on disk
  wechat_account_display_name: string;  // user-facing
  
  // Auth state
  logged_in: boolean;
  login_ts?: ts;
  last_qr_scan_ts?: ts;
  
  // Limits (per § 4.2)
  daily_max: number;                     // default 15
  per_contact_daily_max: number;         // default 5
  quiet_hours: { start: string; end: string };
  new_contact_cooldown_days: number;     // default 7
  
  // Privacy
  audit_content_hashed: boolean;         // default true
  auto_disclose_ai: boolean;             // default false (opt-in toggle)
}
```

### 7.2 Ask source extension

```typescript
type AskSource = 
  | { kind: "peer", connection_id: ConnectionId }
  | { kind: "wechat", contact_id: WeChatContactId, message_id: string }
  // ... existing sources
```

### 7.3 Send audit event

```typescript
interface WeChatSendAuditEvent {
  event: "wechat.message_sent";
  ts: ts;
  to_contact_hash: string;
  content_hash: string;
  content_length: number;
  drafted_by_staff_id?: StaffId;
  sent_by_user_action: "click_send" | "auto_via_rule";
  triage_rule_id?: SkillId;
  ack_received_ts?: ts;
}
```

---

## 8. UI Surfaces

### 8.1 Integrations page (existing, gets WeChat row)

```
─── Messaging connectors ──────────────────────────
  
  WeChat Personal           [ Connected via PadLocal ]
  ✓ 156 contacts · 45 active chats
  Today: 7 received · 4 sent
  [Settings] [View audit log] [Disconnect]
```

### 8.2 Asks tab — WeChat badge

```
┌──────────────────────────────────────────────────────────┐
│ 💬 WeChat · From: Wang Chen (ACME Corp)                  │
│ Received 4 min ago                                        │
│ "下周三能开会讨论方案吗?"                                  │
│ 🤖 AI-extracted intent: meeting request, ACME, this week │
│ Sally drafted reply: [Preview]                           │
│ [Send via my WeChat]  [Edit]  [Copy & send manually]    │
└──────────────────────────────────────────────────────────┘
```

### 8.3 Today / Daily digest

Top of Today tab when ≥10 inbound:

```
🌅 WeChat today: 23 received / 4 sent (11/15 quota left)
   2 need your attention · 4 AI-handled · 17 noise filtered
   [View digest →]
```

### 8.4 Settings → WeChat

Tabs:
- **Connection** (status, re-auth, disconnect)
- **Limits** (rate limit sliders within allowed ranges)
- **Triage** (link to /skills page, filter for WeChat-applicable rules)
- **Audit** (today's send log, weekly summary)
- **Privacy** (content hashing, auto-disclosure)

---

## 9. Phased Delivery

| Phase | Scope | Time estimate |
|---|---|---|
| **V1.0** (today, 0 dev) | Manual paste UX hint in onboarding | <1 day, docs only |
| **V1.1** | Wechaty + PadLocal integration (READ only) + Triage skills for WeChat asks + Intent extraction skill | 2 iterations |
| **V1.2** | Send capability (human-in-loop) + Rate limit enforcement + audit | 1 iteration |
| **V1.3** | Daily digest skill + per-contact controls + quiet hours + UI polish | 1 iteration |
| **V1.4** | File / image / voice capture (text + image + PDF/DOC; voice transcription via local Whisper as V1.4 stretch) | 1 iteration |
| **V2.x** | Group chat @-mention bot, multi-account, advanced auto-send patterns, WeChat Work option for businesses that adopt it | separate ADRs |

**Parallel-safe with**: Storage V1.1 refactor, Triage skills V1.1, Interview skills V1.1 — different code paths.

---

## 10. Out of Scope (explicitly NOT building, V1.x — V2)

| Item | Why not |
|---|---|
| WeChat Work API integration | Deprioritized per owner. Add to V2.x backlog if customer demand emerges. |
| WeChat Official Account API | Lower priority; defer until clear customer ask. |
| Mass marketing / broadcast | Never. ToS violation + brand suicide. |
| Auto-add friends | Never. Highest ban-risk pattern. |
| Cold outreach to non-contacts | Never. Spam pattern. |
| 24/7 auto-reply at scale | Never. Bot detection magnet. |
| Moments (朋友圈) integration | Skip. Personal content, sensitive, limited API. |
| Mini Program automation | Out of scope. |
| Voice/video call integration | Out of scope. |
| WeChat Pay integration | Out of scope. |
| Bundling PadLocal token | Legal risk for Holon. User pays PadLocal directly. |

---

## 11. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| User's WeChat account gets banned | Strong onboarding warnings + Lite-mode opt-out + rate limits + human-in-loop default + "we can't recover banned accounts" disclaimer |
| Tencent breaks PadLocal protocol | Document re-scan recovery path; V2 evaluate alternative puppets (Paimon, etc.) |
| Brand damage from "Holon got my WeChat banned" stories | Default install is Lite (no WeChat). Full mode is opt-in with disclosure. Marketing emphasizes "you stay in control." |
| Customer support burden when accounts banned | Self-service recovery guide; for chronic users, escalate to "consider Lite mode" |
| PadLocal service outage | Holon falls back to manual paste mode; UI shows "PadLocal down, switch to manual until restored" |
| Personal WeChat data leakage | All content stays local by default (per storage design req); send audit hashed; explicit user consent for any non-local flow |
| Chinese network restrictions on PadLocal/Holon | Out of immediate scope; if China-mainland deployment becomes priority, add Aliyun OSS storage backend + evaluate VPN-resilient PadLocal config |

---

## 12. Spec Edits Implied (downstream tasks)

- `docs/architecture/data-model.md`: Add `WeChatConnectorConfig`, `WeChatSendAuditEvent`, extend `Ask.source` with `wechat` variant
- `docs/architecture/peer-communication-architecture.md`: Add § "WeChat as External Connector (not a Core 2 peer)"
- `docs/architecture/security-threat-model.md`: New section on WeChat data flow, ToS posture, PadLocal trust model
- `docs/architecture/connector-foundations.md` (new): Generalize PresenceConnector base (WeChat is first instance; informs future Slack/Teams)
- `docs/install/wechat-setup.md` (new): User-facing setup guide
- New ADR: "WeChat integration via Wechaty/PadLocal; personal account only V1; WeChat Work deferred"
- New ADR: "Read-heavy design — WeChat reading is core value, sending is rate-limited human-in-loop"

---

## 13. Pickup Instructions for Requirements Agent

When you pick this up:

1. Read this doc + ADR-029 + the 3 sibling design reqs (storage, triage skills, interview skills)
2. Note coordination:
   - Triage skill kind extension (per triage design req) must land before V1.1 of this
   - Interview skill kind extension (per interview design req) is independent but on same `kind` enum migration
   - Storage design req's local-first principle applies — WeChat content stays local by default
3. Open ADRs:
   - "WeChat integration via Wechaty/PadLocal — personal account only V1"
   - "Connector foundations — Presence vs API class (WeChat is first Presence)"
   - "Read-heavy WeChat design — sending is bounded human-in-loop"
4. Plan iteration sequence:
   - V1.1 = connector + read + triage + intent extraction (~2 iterations)
   - V1.2 = send with limits (~1 iteration)
   - V1.3 = digest + UI polish (~1 iteration)
   - V1.4 = file/voice (~1 iteration)
5. Coordinate security review for the data flow (Wechaty → PadLocal → Tencent + back); document PadLocal trust model clearly
6. Set up PadLocal developer sandbox before V1.1 starts — owner needs a real account to test

---

## 14. Owner's Direct Quotes (anchoring)

From 2026-05-20:

> "wechat 是我下一个重点链接的对象 你看 hermes 是不是已经解决了 或者网上有啥好的解决方法 你调研下 写个新 feature request"

> "我的诉求 是 机器人给wechat跟新信息 老板这边可能会受到一些信息 (可能只有重要的才有) 或者老板直接通过 wechat 给员工发 需要从wechat把信息拿下来"

> "我的老板和员工都是有wechat的 我的holon链接是各自的wechat 他们之间消息传递和整理等"

> "不上wechat work 就是私人的wechat 个人的wechat. 假定员工和老板都用 不用那就没啥事了 那就沟通不需要wechat"

> "1. summary 信息 ok 简单 2 发送不太行"

> "我只是偶尔发 控制发的个数 这个可以做到"

> "发送这边一个员工一天就发几条 老板倒是 [收] 到好多条"

---

## 15. Why This Final Design Is Right

1. **Matches owner's actual ICP** — Chinese SMB on personal WeChat, not enterprise WeChat Work
2. **Read-heavy is the killer value** — 200 inbound → 3 important is what owner can't do alone
3. **Send constraints are realistic** — 5-15/day with human-in-loop is far below ban-trigger volumes
4. **Multi-Holon team mesh leverages Core 2** — ADR-029 architecture earns its keep here
5. **PadLocal as external dependency** — protects Holon legally + economically (no infra cost, no resale liability)
6. **Per-user opt-in with full disclosure** — each team member accepts ToS risk individually, defensible
7. **Lite-mode safety valve** — users who don't want WeChat connection can still use Holon for internal team work
8. **Phased delivery is parallel-safe** — V1.1 of this can run alongside V1.1 of Storage + Triage + Interview
9. **All four Engineering Rules honored** — audit, owner-mediated, attenuation, no-silent-failure built in
10. **Realistic risk posture** — acknowledges Wechaty ToS reality; doesn't pretend; mitigates with constraints

---

End of refined feature request. Implementation can begin from this doc + companion design reqs without further owner input (open questions all resolved).

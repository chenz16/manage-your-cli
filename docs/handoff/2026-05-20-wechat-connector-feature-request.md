# Design Requirement / Feature Request — WeChat Connector

Date: 2026-05-20
Author: owner ↔ assistant design discussion
Status: **SUPERSEDED** by `2026-05-20-wechat-personal-team-design-req.md` (same day, later session)
Reason superseded: Owner direction crystallized to "personal WeChat only, all team on Holon" — WeChat Work path deprioritized, multi-Holon team mesh becomes primary scenario, send is rate-limited human-in-loop not opt-in V2 plugin. See successor doc for the locked design.
Target iteration: SEE SUCCESSOR
Pickup by: SEE SUCCESSOR
Related: ADR-029 (substrate model), `2026-05-19-storage-architecture-design-req.md` (BYOC), `2026-05-19-triage-skills-design-req.md` (auto-triage for inbound messages), 7fc92a3 (Integrations promotion), Engineering Rules #4, #6, #7, #8

> **THIS DOC IS HISTORICAL CONTEXT ONLY. Implementation should follow the successor doc.**
> Original TL;DR (now outdated): WeChat has no clean official path for SMB-owner personal accounts.
> Build in **3 phases** — manual paste (V1.0, today) → WeChat Work API (V1.x, official + safe) → Wechaty-based personal WeChat (V2, opt-in + sandboxed, with explicit ToS warning).
> Hermes does NOT have WeChat support. Holon must build the connector.

---

## 0. Context

Owner direction (2026-05-20):

> "wechat 是我下一个重点链接的对象 你看 hermes 是不是已经解决了 或者网上有啥好的解决方法 你调研下 写个新 feature request"

For Holon's primary ICP (Chinese / Chinese-speaking SMB owners, marketing freelancers, PR consultants), WeChat is **the dominant communication channel** — far more than Slack or email for that audience. Without WeChat, Holon's Connectors story has a hole the size of the Chinese-speaking market.

But WeChat is the **hardest** mainstream messaging platform to integrate with legitimately. This document surveys all viable options + recommends a phased path.

---

## 1. Hermes Status

Verified by codebase scan (2026-05-20):

- ✅ No WeChat connector / SDK / plugin exists in `packages/`, `apps/`, or `deps/hermes/`
- ✅ No `wechat` / `weixin` / `wx_` / `微信` strings in any source code
- ✅ Only mentions are in user-facing docs (distribution channel for installer)
- 🟡 Hermes upstream (`nousresearch/hermes-agent`) does not ship a WeChat tool either

**Implication**: We must build the WeChat connector from scratch. No starter code, no piggyback.

---

## 2. WeChat Platform Survey (the messy truth)

WeChat is not one platform — it's **four platforms** with vastly different integration stories:

| Platform | What it is | Has official API? | Holon fit |
|---|---|---|---|
| **WeChat 个人号** (personal account) | The thing 99% of users have | ❌ **NO official API** | Owner's daily comm, but ToS forbids automation |
| **WeChat 公众号** (Official Account) | Brand/publisher accounts (订阅号 / 服务号) | ✅ Yes (limited) | If SMB owner runs an OA, fits |
| **企业微信 / WeChat Work** | Enterprise version, separate app, integrates with personal contacts | ✅ Yes (comprehensive) | Best official path for SMB |
| **微信小程序** (Mini Programs) | Apps inside WeChat | N/A (build target, not connector) | Out of scope |

### 2.1 WeChat Official Account (公众号) API

- Docs: <https://developers.weixin.qq.com/>
- Account types: **订阅号** (subscriptions, daily 1 broadcast) / **服务号** (services, 4 broadcasts/month + better APIs)
- Authentication: AppID + AppSecret per account
- Capabilities:
  - Receive messages from subscribers (text/image/voice/location)
  - Reply within **48 hours** of user's message ("客服消息")
  - Send **template messages** (pre-approved, structured, for transactions)
  - Material management, user tagging
- **Critical limitations**:
  - Cannot initiate conversations (must wait for user to message first)
  - Templates require WeChat approval (slow, restrictive)
  - 服务号 requires verified **business** (营业执照 + ¥300/year), not for individuals
  - Subscribers see the OA's brand, not the owner's identity
- **Holon fit**: 🟡 Useful if SMB owner already runs an OA for their business, but most don't

### 2.2 WeChat Work (企业微信) API

- Docs: <https://developer.work.weixin.qq.com/>
- Free for small orgs (< 200 active users)
- Authentication: CorpID + AppSecret per "app" within the corp
- Capabilities (extensive):
  - Send/receive messages (text/image/file/markdown/card)
  - Group chat send/receive
  - **外部联系人** (External Contact) feature: WeChat Work users can talk to personal WeChat users — bridges the gap!
  - Webhook bot mode (simplest entry point)
  - Calendar, document, attendance, approval workflows
  - OAuth for user identification
- **Limitations**:
  - Owner needs WeChat Work account (free but separate setup)
  - External contacts: WeChat Work side initiates; personal WeChat side sees "Wang from XYZ Co" rather than "Wang"
  - Some advanced features (auto-reply to external contacts) require 企业认证 (corp verification, ~¥300)
- **Holon fit**: ⭐⭐⭐⭐⭐ **Best official path**. Recommended primary target.

### 2.3 Wechaty (third-party, popular but grey)

- Docs: <https://wechaty.js.org/>
- TS/Node/Python SDK; multi-platform (WeChat / WhatsApp / Discord / etc.)
- For personal WeChat, requires a "**puppet**" backend that emulates a client:

| Puppet | Cost | Stability | Risk |
|---|---|---|---|
| **PadLocal** | ~$24/month per account | ⭐⭐⭐⭐ stable, runs on iPad protocol | Medium ban risk |
| **Paimon** | Token-based | ⭐⭐⭐ newer | Higher |
| **WeChat Web** | Free | ❌ killed in 2017 by Tencent | Effectively dead |
| **PadPlus / PadPro** | Varies | ⭐⭐⭐ | Medium |
| OpenAI / hostie puppets | N/A | for OpenAI not WeChat | N/A |

- **Critical issue**: Using Wechaty against personal WeChat **violates WeChat ToS** (User Agreement §7.1.2: "may not use third-party plugins or robots"). Accounts can be:
  - 限制登录 (login limited) for hours/days
  - 永久封号 (permanently banned) for repeat / high-volume violations
- Used widely in Chinese AI/bot dev community despite risk
- Account most likely to be banned: new accounts, high-volume sends, mass group joining, abnormal login locations

### 2.4 WeChatTweak / Desktop Hooks

- macOS: <https://github.com/Sunnyyoung/WeChatTweak-macOS> (DLL injection)
- Windows: Various 逆向 projects (WeChatPYAPI, WeChatFerry, etc.)
- **Highest ban risk**: detected as modified client
- Hard to maintain (breaks each WeChat client update)
- **Not viable for legitimate product distribution**

### 2.5 Cloud bot services (商业 SaaS)

- Various Chinese SaaS wrap Wechaty/PadLocal and resell (MaiBot, MaiAI, Lzy.ai, etc.)
- Same ToS risk shifted to them
- ~¥99-499/month per number
- **Not a path for Holon** unless we white-label one, which is fragile

---

## 3. Recommended Integration Strategy — 3 Phases

### Phase 1 (V1.0, ship immediately): Manual paste — zero infrastructure

**Pattern**: User copies WeChat conversation, pastes into Holon chat. Holon's existing skills process the text. Output goes back to Holon (which user copies back to WeChat).

```
Holon "+ New ask"  (or direct chat)
   ↓
Owner pastes: 
  "我客户王总在微信上说: '下周三能不能开会讨论方案?'
   帮我起草一个专业的回复, 我给他确认时间."
   ↓
Holon staff handles it → draft response
   ↓
Owner copy → paste back into WeChat → send
```

**Pros**:
- ✅ 0 dev, 0 infra, 0 ToS risk, 0 setup
- ✅ Works for any WeChat user (personal / OA / Work)
- ✅ Already works today with existing Holon

**Cons**:
- ❌ Manual copy-paste friction
- ❌ No real-time / inbound triage
- ❌ No automation
- ❌ Not a "connector" in the architectural sense

**Action**: Add explicit copy-paste UX hint in Holon onboarding for Chinese users. **No code change needed**. Mention in docs.

### Phase 2 (V1.x, build first official connector): WeChat Work integration

**Build target**: Holon registers as a WeChat Work app inside owner's WeChat Work corp. Webhook receives events; Holon sends replies via API.

```
User's WeChat (personal or Work)
   ↓ (External Contact protocol)
WeChat Work corp (owner registered)
   ↓ (App-mode webhook)
Holon BFF (webhook receiver)
   ↓ (route to triage skill OR surface in Asks tab)
Owner reviews / staff handles
   ↓ (reply via WeChat Work API)
Back to user
```

**Architecture** (fits "Presence Connector" pattern from connector classification):

```typescript
class WeChatWorkConnector implements PresenceConnector {
  // Setup (one-time, owner does in /integrations page):
  config: {
    corp_id: string;
    app_secret: string;        // encrypted in Tauri keyring
    app_id: number;
    webhook_endpoint: URL;     // Holon BFF generates
    verify_token: string;      // for WeChat callback verification
  };

  // Inbound: WeChat Work POSTs to webhook
  async handleIncoming(event: WeChatEvent): Promise<void> {
    // Decrypt + parse (WeChat uses AES with verify_token)
    const message = decrypt(event, this.config.verify_token);
    
    // Create Ask in Holon
    const ask = await createAskFromMessage({
      source: 'wechat_work',
      sender: message.from_user_id,
      content: message.text,
      thread_id: message.chat_id,
      raw_message: message,
    });
    
    // Triage skills run (per triage-skills design req)
    await triageDispatcher.process(ask);
  }

  // Outbound: Holon staff replies
  async sendMessage(to: WeChatUserId, content: string): Promise<MessageId> {
    return wechatWorkAPI.send(this.config.corp_id, this.config.app_id, to, content);
  }
}
```

**Setup flow for owner** (in `/integrations` page):

```
[Connect WeChat Work]
  ↓ Owner has WeChat Work account?
     ✓ Yes:
       1. Show: "Go to work.weixin.qq.com → Create internal app"
       2. Owner pastes CorpID + AppSecret + AppID
       3. Holon generates webhook URL + verify_token
       4. Owner pastes webhook URL into WeChat Work app config
       5. Test connection → ✅
     ✗ No:
       Show signup link (work.weixin.qq.com), 5-min walkthrough
       Free for <200 users
```

**Capabilities V1**:
- Receive messages from WeChat Work users (internal + external contacts)
- Send replies via Holon staff
- Triage skills auto-handle (per existing design)
- Audit log every message in/out

**Pros**:
- ✅ Official API, no ToS risk
- ✅ Production-grade, won't break
- ✅ Comprehensive features (groups, files, etc.)
- ✅ Reaches external personal WeChat contacts via 外部联系人 (the "bridge" feature)

**Cons**:
- 🟡 Owner needs WeChat Work setup (~10 min)
- 🟡 Personal-only WeChat users without Work can't be reached directly (only via 外部联系人 which requires owner-side Work account)
- 🟡 Corp verification fee (¥300) needed for some advanced features (not blocking V1)

**Effort estimate**: 2-3 iterations
- 1 iter for WeChat Work API client library + auth + webhook receiver
- 1 iter for Holon BFF integration (Ask creation, triage routing)
- 0.5 iter for /integrations page UX
- 0.5 iter for audit + observability

### Phase 3 (V2, opt-in for power users): Wechaty personal WeChat support

**Build target**: Holon ships an **optional plugin** that runs a Wechaty bridge for personal WeChat. **Off by default**. Explicit warning + opt-in. Owner pays for PadLocal token separately.

**Architecture**:

```
Holon desktop app (Tauri)
   ├─ Default install: NO Wechaty
   └─ Settings → Integrations → "Personal WeChat (beta, advanced)"
       ↓ Read warning, accept
       Holon downloads Wechaty bridge as a separate process
       ↓
       Owner enters PadLocal token (paid externally)
       ↓
       Wechaty bridge connects to PadLocal puppet
       ↓
       Tauri spawns Wechaty subprocess (like Hermes)
       ↓
       Events forwarded to Holon BFF same as Work connector
```

**Critical warnings (mandatory UX)**:

```
⚠️  Personal WeChat Integration — Read carefully

Connecting your personal WeChat to Holon uses unofficial methods 
that may violate WeChat's Terms of Service. This carries real risk:

  • WeChat may limit your login for hours or days
  • In rare cases, accounts can be permanently banned
  • Tencent updates regularly break these integrations
  • Holon team cannot recover banned accounts

We recommend:
  ✅ Use WeChat Work for business contacts (no ban risk)
  ✅ Use manual copy-paste for occasional personal use
  
If you still want to proceed:
  • Use a NEW or LOW-VALUE WeChat account, never your main one
  • Keep send volume low (< 50 messages/day)
  • You are solely responsible for ToS compliance

[ I understand the risks — proceed ]   [ Cancel ]
```

**Constraints we enforce in V2**:
- Rate limiting (max N sends/day, owner-configurable but hard cap)
- No mass-add-friend or mass-join-group APIs
- Audit every message
- Owner can revoke connection any time (force shutdown of Wechaty subprocess)

**Effort estimate**: 2-3 iterations (after V1.x Work connector is solid)

### Phase 4 (deferred / V2.x or V3): WeChat Official Account API

For SMB owners who run a 公众号. Lower priority than Work; build only on customer demand.

Effort estimate: 1-2 iterations.

---

## 4. Cross-cutting Design Decisions

### 4.1 Connector Classification (per ADR-029 follow-up Presence vs API)

WeChat is firmly **Presence-class**:
- Push model (events come to Holon, not Holon polls)
- Webhook receiver in Holon BFF mandatory
- Real-time SLA expectation (users expect reply within seconds, not next-poll)
- Bot/app identity (separate from personal user identity)

This means we need the **PresenceConnector** infrastructure (separate from API connectors like Gmail). If that hasn't been built yet, WeChat integration should drive its design alongside the future Slack/Teams work.

### 4.2 Identity model

| WeChat platform | Holon presents as | Owner identity | Recipient sees |
|---|---|---|---|
| WeChat Work app | A WeChat Work "app" (bot) | Owner is the app admin | "Holon Assistant" (app name owner picks) |
| WeChat OA | The OA brand | Owner is OA admin | The OA brand |
| Wechaty personal | **Owner's account itself** (impersonation) | — | Owner's own name, contacts don't know it's automated |

**Important ethical/legal note**: For Wechaty personal mode, Holon is effectively impersonating the owner. Some jurisdictions may require disclosure to recipients. V2 should ship with an optional "Auto-disclosure" feature ("[Auto-replied by Holon — Owner will follow up]") that owner can enable per-contact or globally.

### 4.3 Message routing into Holon

Once a WeChat event reaches the Holon BFF:

```
WeChat event (webhook OR Wechaty)
   ↓
Normalize to Ask (per existing Holon Ask data model)
   ↓
TriageDispatcher (per 2026-05-19-triage-skills-design-req.md)
   ↓
   ├─ auto_accept → routed to staff (e.g., "Sally" handles client questions)
   ├─ auto_decline → polite WeChat reply via API
   └─ surface_to_owner → owner sees in Asks tab with WeChat badge
```

**This means**: WeChat connector and Triage Skills must be designed compatibly. The triage skill should know how to handle `ask.source = "wechat_work" | "wechat_personal" | "wechat_oa"`.

### 4.4 Data residency & cross-border concerns

For Chinese-mainland owners:
- WeChat Work API endpoints are in China (qq.com)
- Holon's local-first architecture means **owner's messages stay local** (per storage design req)
- BUT if owner uses cloud storage backend (S3/Drive), the data flows there
- For Chinese owners, consider supporting **Aliyun OSS / Tencent COS** as cloud backend options (storage design req should add this for the China audience)

### 4.5 Engineering Rule compliance

- **Rule #4 (no silent failure)**: WeChat API errors (rate limit, invalid token, message-too-long, banned account) all surface to UI with retry/owner action options
- **Rule #6 (owner-mediated)**: Inbound WeChat asks default to `pending_owner` unless triage skill auto-accepts (which itself is owner-pre-authorized per rules design)
- **Rule #7 (authority attenuation)**: Holon staff sending via WeChat have toolScope per substrate (a virtu with `wechat_work:read` only can't suddenly send)
- **Rule #8 (audit completeness)**: Every WeChat message in/out emits audit event with `{platform, direction, message_id, content_hash, ts, staff_id, ask_id}`. Content itself audited separately (encrypted) per privacy posture.

---

## 5. UI Surfaces

### Integrations page (existing, per 7fc92a3)

Adds a WeChat section with the 3 sub-types:

```
─── Messaging connectors ──────────────────────────
  
  WeChat Work (企业微信)           [ Connect → ]    ⭐ Recommended
  ✓ Official API, no ToS risk
  ✓ Reach external personal WeChat via 外部联系人
  ○ Requires WeChat Work account (free for <200 users)
  
  WeChat Official Account (公众号)  [ Connect → ]
  ✓ Official API
  ○ Requires verified business OA
  ○ Limited (48h reply window, broadcast-style)
  
  WeChat Personal (个人微信)        [ Connect → ]   ⚠️ Beta · Advanced
  ⚠️ Uses unofficial methods, ToS risk, account ban possibility
  ○ Most flexible but most risky
  ○ Requires PadLocal token (~$24/mo external cost)
```

### Asks tab (existing)

WeChat asks get a badge showing which platform + thread context:

```
┌──────────────────────────────────────────────────────────┐
│ 💬 WeChat Work · Client thread "ACME Project"            │
│ From: Wang Chen                                           │
│ "下周三能不能开会讨论方案?"                                │
│ 🤖 Auto-routed to Sally · SLA 1h                          │
└──────────────────────────────────────────────────────────┘
```

### Staff config (existing)

Per-staff toolScope gets WeChat tools:

```
Sally's tools:
  ☑ gmail:read
  ☑ wechat_work:read
  ☑ wechat_work:reply_in_thread     ← can reply but not initiate
  ☐ wechat_work:initiate            ← cannot start new conversations
  ☐ wechat_personal:*               ← no personal WeChat access
```

---

## 6. Acceptance Criteria

### V1.x (WeChat Work — primary scope)

1. ✅ Owner can connect WeChat Work account via `/integrations` page in <10 minutes
2. ✅ Inbound message from WeChat Work appears as Ask in Holon within 5 seconds
3. ✅ Triage skill can auto-accept WeChat asks and route to virtu staff
4. ✅ Holon staff can reply via WeChat Work API; reply appears in recipient's WeChat
5. ✅ Group chats supported (staff can be added to relevant groups)
6. ✅ External Contact (外部联系人) protocol works — owner's WeChat Work can talk to recipients on personal WeChat
7. ✅ Audit log captures every message in/out with content hash, sender, recipient, ts
8. ✅ Token storage in Tauri keyring (encrypted), never plaintext on disk
9. ✅ API errors (rate limit, invalid token, message-too-long) surface in UI with actionable retry
10. ✅ Owner can revoke connection any time; data persists for export but no new sends/receives

### V2 (Wechaty personal — opt-in)

1. ✅ Personal WeChat connector is OFF by default, requires explicit opt-in with ToS warning
2. ✅ PadLocal token configurable (owner pays external service)
3. ✅ Rate limits enforced (configurable, hard cap < 200/day)
4. ✅ Auto-disclosure feature configurable (owner can opt-in to "[Auto-replied by Holon]" suffix)
5. ✅ Audit + monitoring same as Work
6. ✅ Owner can kill Wechaty subprocess any time

---

## 7. Open Questions

| Q | Question | First-draft assumption |
|---|---|---|
| Q1 | Build WeChat Work first, then Personal? | **Yes**. Work is official + safer + faster to ship. |
| Q2 | Ship WeChat OA in V1.x or defer? | **Defer to V1.x or V2** — only build on real customer pull. |
| Q3 | For personal WeChat, do we bundle Wechaty SDK or treat as separate plugin? | **Separate plugin** — keeps default install clean of ToS-grey code. |
| Q4 | Auto-disclosure default for personal WeChat? | **Off** (user choice) — but show prominent toggle |
| Q5 | Do we support Chinese cloud backends (Aliyun OSS / Tencent COS) for Chinese owners? | **Yes** — add to storage design req as Phase 1.2.5 |
| Q6 | Group chat default behavior — auto-respond or only when mentioned? | **Only when @-mentioned** — to avoid spam |
| Q7 | Rate limit defaults for Personal WeChat | **50 sends/day, 200/day hard cap, configurable lower** |
| Q8 | Show WeChat content in audit log as plaintext or hashed? | **Hashed by default**; plaintext only when owner explicitly opts in for debugging |

---

## 8. Out of Scope for V1.x

- WeChat Mini Programs (different ecosystem)
- WeChat Pay / payment flows
- Moments (朋友圈) integration — sensitive, limited API
- Voice messages transcription (V2+ — needs STT)
- Video / image OCR from WeChat media (V2+)
- WeChat group QR-code auto-join (high ban risk)
- Mass marketing / broadcast on personal accounts (ToS violation + ethically wrong)
- Sticker/emoji handling beyond text fallback (V2+)

---

## 9. Spec Edits Implied

- `docs/architecture/data-model.md`: Add `wechat_*_config` config tables; `Ask.source` enum gains `wechat_work | wechat_oa | wechat_personal`
- `docs/architecture/peer-communication-architecture.md`: Note: WeChat sources route through Triage before reaching owner inbox
- New ADR: "WeChat Work as first WeChat connector (V1.x); Personal WeChat (V2) is opt-in plugin with ToS warning"
- New ADR: "Presence Connector base class spec — WeChat drives its design (informs future Slack/Teams)"
- `docs/architecture/security-threat-model.md`: New section on WeChat data flow; personal-account impersonation; rate limit enforcement
- `docs/architecture/connector-foundations.md` (new): General Presence vs API connector framework
- `docs/install/wechat-work-setup.md` (new): User-facing setup guide for WeChat Work

---

## 10. Phased Delivery Plan

| Phase | Scope | Time estimate |
|---|---|---|
| **V1.0 (now)** | Manual paste UX — onboarding hint, no code change | <1 day |
| **V1.x.1** | PresenceConnector base abstraction (designed alongside this) | 1 iteration |
| **V1.x.2** | WeChat Work API client + auth + webhook receiver | 1 iteration |
| **V1.x.3** | Holon BFF integration: Ask intake → Triage routing → Staff handling → API reply | 1 iteration |
| **V1.x.4** | `/integrations` setup flow + per-staff toolScope + audit | 1 iteration |
| **V1.x.5** | External Contact (外部联系人) support — owner's Work can reach personal WeChat | 0.5 iteration |
| **V1.x.6** | Group chat support (@-mention triggered) | 0.5-1 iteration |
| **V2.x.1** | Wechaty personal WeChat plugin (opt-in, off by default) | 2 iterations |
| **V2.x.2** | WeChat Official Account API (if demand exists) | 1-2 iterations |
| **V3+** | Voice transcription, image OCR, sticker fallback, advanced features | separate ADRs |

V1.x.1-V1.x.6: ~5-6 iterations total. Parallel with other connector work.

---

## 11. Pickup Instructions for Requirements Agent

When you pick this up:

1. Read this doc + ADR-029 + 2026-05-19-triage-skills-design-req.md + 2026-05-19-storage-architecture-design-req.md
2. Confirm Q1-Q8 acceptable to owner
3. Note coordination:
   - `PresenceConnector` base abstraction should land BEFORE WeChat Work (it's the foundation; reuses for future Slack/Teams)
   - Triage skills V1.1+ must handle WeChat-source asks
   - Aliyun OSS / Tencent COS storage backend should land for Chinese owners (update storage design req)
4. Open ADR drafts for:
   - WeChat Work as primary integration target
   - PresenceConnector base class
5. Plan V1.x.1 (PresenceConnector base) as a foundational refactor; subsequent WeChat iterations build on it
6. Coordinate with security review for the personal WeChat plugin (V2) — must be reviewed for ban-vector mitigation
7. Set up WeChat Work developer sandbox before V1.x.2 — owner needs a real Work corp to test against

---

## 12. Owner's Direct Quote

From 2026-05-20:

> "wechat 是我下一个重点链接的对象 你看 hermes 是不是已经解决了 或者网上有啥好的解决方法 你调研下 写个新 feature request"

---

## 13. Why This Approach Is Right

1. **Officially-supported path first** (WeChat Work) — no ToS risk, production-grade, won't break
2. **Manual paste as V1.0 stopgap** — ship value to users immediately while we build proper integration
3. **Personal WeChat as opt-in plugin** — respects users who accept ToS risk, but doesn't expose the average user to bans
4. **Reuses Triage Skills infrastructure** — WeChat-source asks flow through same triage pipeline as peer/email asks
5. **Identity model is clear** — bot identity (Work / OA) vs impersonation (personal) is explicit; users informed
6. **Engineering Rule #4 / #6 / #7 / #8 honored** — audit, owner-mediated, attenuation, no-silent-failure all addressed in design
7. **Drives PresenceConnector base class design** — WeChat is the first complex Presence connector; the abstractions we build here unlock Slack/Teams/Discord/Telegram later
8. **Respects Chinese user data residency** — storage backends should expand to Aliyun OSS / Tencent COS

---

## 14. Risks / Anti-Patterns to Avoid

| Risk | Mitigation |
|---|---|
| Ship Personal WeChat as default → users get banned → brand damage | Plugin model + explicit opt-in + warnings + rate limits |
| Tencent breaks Wechaty unexpectedly → users stuck | V1.x.1-x.6 doesn't depend on Wechaty; Wechaty is V2 plugin only |
| WeChat Work API quota exhaustion on busy owners | Quota monitoring + per-app rate budget surfacing in UI |
| Personal WeChat impersonation undisclosed → trust violation | Auto-disclosure feature, surfaced prominently |
| Customer support burden when personal accounts get banned | Strong upfront warnings; "we can't recover banned accounts" disclaimer |
| Chinese network policy changes affecting Holon (e.g., VPN block) | Document Chinese-mainland install path separately; consider Aliyun/Tencent-hosted relay for V2.x |

---

End of feature request.

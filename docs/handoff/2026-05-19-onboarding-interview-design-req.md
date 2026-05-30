# Design Requirement — Onboarding Interview Skill + Meeting Mode

> **Status: Historical record.** This document captures a point-in-time
> snapshot. References to **Hermes** / `hermes-acp` /
> `hermes_profile_generic_v1` describe the runtime used by the sister
> repo [`holon-engineering`](https://github.com/chenz16/holon-engineering)
> at the time of writing. `manage-your-cli` does not bundle, link to, or
> depend on Hermes — its live substrate is a direct multi-CLI adapter
> (`claude` / `codex` / `gemini` / `qwen`) under
> [`packages/core/src/cli-adapters.ts`](../../packages/core/src/cli-adapters.ts)
> and [`apps/web/lib/warm-agent.ts`](../../apps/web/lib/warm-agent.ts).
> The body below is preserved unedited for history.

Date: 2026-05-19
Author: owner ↔ assistant design discussion (this web session)
Status: **design-requirement-proposed**
Target iteration: next available after storage + triage-skills (≥ iter-020)
Pickup by: Requirements Agent → iteration `requirements.md` + `plan.md`
Related: ADR-029 (coworker substrate), 2026-05-19-triage-skills-design-req (skill kind extension), iter-009 (skill catalog), iter-006 (chat surface), iter-028 (per-staff Hermes sessions), Engineering Rules #4 (no silent failure), #6 (owner-mediated), #8 (audit completeness)

> Design-requirement-proposed handoff. Requirements Agent should expand into
> formal iteration requirements + plan + ADRs.

---

## 0. Context — The Insight

Holon's chat surface is **structurally identical to a customer-discovery interview**:

```
Normal SaaS chat:                   Customer interview:
"How can I help?"                   "Tell me about your work"
"I want to do X"                    "I'm struggling with X"
"Let me help with that"             "Tell me more about X"
"Here's the result"                 "What have you tried for X?"

           ↑ different products      ↑ Holon is shaped like this
```

Owner observation (2026-05-19, screenshot of real session):

> "我现在这个聊天软件 直接能收集 痛点和难点 我是不是CEO在这种情况下 要主动模拟一采访的人 并把采访记录弄下来 或者弄个采访专业 让这个人第一次使用的时候 跟采访专业聊天 这样我就可以收集数据了"

Translation: My chat app naturally collects pain points. As CEO, should I impersonate an interviewer, or build an interview specialist that talks to first-time users so I can collect data?

Refinement (same session):

> "可以是开会模式 让采访专员来对话 (后期语音或者文字打字都行)"

Translation: It can be meeting mode — let the interview specialist talk. Later support voice or text typing.

**This combines product-led growth + customer research into a single feature.** Every new user contributes scenarios to the founder's research library while getting a value-add onboarding experience. The interview-as-product-feature is uniquely possible because Holon's product flow IS the interview format.

---

## 1. Owner-Stated Requirements

1. **Interview specialist (采访专员)** — a dedicated AI persona, not the default desk-AI, that drives structured interviews
2. **Meeting mode** — a distinct UI session (full-screen, focused, time-bounded), different from normal chat
3. **Voice or text** — V1 text only, V2 support voice as well
4. **First-use trigger** — interview specialist greets new users during onboarding (with consent)
5. **Data captured** — interview output flows to founder's scenarios library for research

---

## 2. Three-Layer Strategy (Phased)

### Layer 1: Founder-as-Interviewer (Now, 0 dev cost)

For the first 10-20 users, the **founder personally** acts as the interview specialist via Holon's existing chat surface. No new feature needed. Founder logs key quotes manually into `scenarios/scenario-NNN.md` files.

**Why start here**: Patterns emerge from human interviews that automated interviews can't (yet) capture. The interview-skill questions in Layer 2 are designed *from* what worked in Layer 1.

### Layer 2: Interview Skill in Meeting Mode (V1.1, primary scope of this doc)

A new skill `kind: "interview"` drives a structured Q&A session in a new UI mode called **Meeting Mode**. First-time users opt-in during onboarding; output flows to founder's scenarios library.

### Layer 3: Passive Conversation Mining (V2, deferred)

All user ↔ desk-AI conversations get post-hoc tagged for pain signals, willing-to-pay indicators, tool-history mentions. Aggregated across users in founder dashboard. **Requires strong consent UX**; deferred to V2 (separate ADR).

---

## 3. Meeting Mode — New Session Type

### What "Meeting Mode" means

A chat session with these distinguishing properties:

| Property | Normal chat | Meeting mode |
|---|---|---|
| UI layout | Sidebar + chat panel | **Full-screen, distraction-free** |
| Duration | Open-ended | **Time-bounded** (default 15 min, user-configurable) |
| Driven by | User | **The skill** (interview specialist asks questions) |
| Output | Casual messages | **Structured artifact** (scenario summary) |
| Background | Same as app | **Dimmed / accent color** to signal "in session" |
| End state | Conversation continues | **Wrapped up**, user reviews summary, exits to chat |
| Interruptible? | Yes | **Optionally locked** to prevent context loss |
| Future capability | — | **Voice + transcription** |

This is a new product surface. Not just CSS — a different *interaction posture*.

### Why this is a session, not just a chat variant

Sessions get first-class data model treatment:

```typescript
interface MeetingSession {
  id: SessionId;
  kind: "interview" | "planning" | "review" | "freeform";  // V1 only "interview"
  driven_by_skill_id: SkillId;          // the interview specialist
  participant_user_id: UserId;
  started_at: ts;
  ended_at?: ts;
  
  duration_target_min?: number;          // soft cap (default 15)
  duration_hard_cap_min?: number;        // hard cap (default 30)
  
  status: "active" | "completed" | "abandoned" | "expired";
  
  // The structured output the session produces
  artifact?: SessionArtifact;
  
  // Audit / research
  recorded_for_research: boolean;        // opt-in flag from user consent
  consent_recorded_at?: ts;
  consent_scope: "this_session_only" | "until_revoked";
  
  // Transcript pointer (text V1, audio later)
  transcript_path: string;               // relative path to transcript file
}

interface SessionArtifact {
  type: "scenario_summary" | "planning_doc" | "review_notes";
  content: string;                       // markdown
  extracted_fields?: Record<string, unknown>;  // structured extraction
}
```

Meeting sessions are persisted (separate table from regular chat messages), have their own lifecycle, and produce artifacts that flow elsewhere (e.g., scenarios library for interview-type sessions).

### Where in code

```
packages/core/src/sessions/
  session-types.ts            — MeetingSession, SessionArtifact, SessionState types
  meeting-session-runtime.ts  — drives a session via the configured skill
  session-store.ts            — CRUD + persistence

apps/web/app/meetings/        — new route (replaces the removed /meetings)
  page.tsx                    — list / start meeting
  active/[id]/page.tsx        — full-screen meeting mode UI
  
packages/api-contract/src/
  session.ts                  — wire types
  skill.ts                    — add `kind: "interview"` (also adds "triage" per
                                companion design req)
```

---

## 4. Interview Skill Architecture

### Skill kind extension (consistent with triage skills)

```typescript
type Skill = TaskSkill | TriageSkill | InterviewSkill;

interface InterviewSkill {
  id: SkillId;
  kind: "interview";
  name: string;
  description: string;
  
  // The interview specialist's persona
  persona: {
    name: string;                    // e.g., "Casey, Customer Research Specialist"
    avatar_emoji?: string;           // e.g., "🎙"
    voice_style: "warm" | "professional" | "casual";   // for future TTS
  };
  
  // The interview structure
  intro: string;                     // what the skill says when meeting opens
  questions: InterviewQuestion[];    // ordered (with conditional branches)
  outro: string;                     // wrap-up summary template
  
  // Output shape
  artifact_template: string;         // markdown template the artifact follows
  extracted_fields: ExtractionSchema[];  // structured data to extract from
                                          // transcript via LLM
  
  // System (researcher-only visibility)
  visibility: "system_internal" | "user_visible";
  data_destination: "founder_research_inbox" | "user_workspace" | "both";
  
  // Consent UX (user-facing strings)
  consent_prompt: string;
  consent_default: "opt_in" | "opt_out";   // V1 always opt_in (user must say yes)
}

interface InterviewQuestion {
  id: string;
  text: string;
  follow_ups?: string[];             // dynamic follow-ups based on response
  branch_on?: {
    condition: string;               // LLM-evaluated
    if_yes_skip_to?: string;
    if_no_skip_to?: string;
  };
  required: boolean;
}
```

### Built-in: the "First Look" interview skill (ships in fixture)

Default interview skill for onboarding. ~10 questions, ~12 minutes:

| # | Question (English) | Why we ask |
|---|---|---|
| 1 | "Tell me about your work — what do you do day-to-day?" | Establish role/industry |
| 2 | "What's the most time-consuming thing you wish you could delegate?" | Surface pain point |
| 3 | "How are you handling it today? Any tools, contractors, or just hours?" | Map current workaround + spend |
| 4 | "How much time per week does this eat?" | Quantify pain |
| 5 | "If a magic button could automate 80% of it, what would your week look like?" | Aspiration / outcome |
| 6 | "Have you tried other tools for this? Which ones, why didn't they stick?" | Competitive landscape from their view |
| 7 | "Roughly what would that magic button be worth to you, monthly?" | WTP signal |
| 8 | "Who else on your team or in your circle has the same problem?" | Referral potential, network density |
| 9 | "What kind of result do you want Holon to produce — a draft you review, or done-and-sent?" | Autonomy preference signal |
| 10 | "If I follow up in 4 weeks to see how it went, mind if I email you?" | Opt-in for follow-up + future interviews |

After Q10, the skill summarizes back to user (~5 sentences) and asks for any corrections. Then writes the scenario artifact.

### Output: scenario artifact format (auto-deposited into scenarios library)

```markdown
# Scenario [NNN] — [Name], [Role/Industry] — Auto-captured 2026-05-19

## Interview metadata
- Session id: ses_01ABC...
- Skill: First Look (built-in)
- Duration: 14 min
- Mode: Meeting mode (text)
- Consent scope: until_revoked

## Person
[Auto-extracted from Q1]

## Top pain points (extracted from Q2-Q4)
1. ...

## Current workaround (Q3)
...

## Time investment (Q4)
...

## Tools tried (Q6)
...

## Willingness to pay (Q7)
...

## Network signal (Q8)
...

## Autonomy preference (Q9)
...

## Follow-up consent (Q10)
- [ ] Email: [if granted]
- [ ] Date: [4 weeks out]

## Raw transcript
[Full transcript follows or linked]

## Tags
[Auto-tagged based on extracted fields]
```

These land in `scenarios/auto/scenario-NNN.md` (gitignored). Founder reviews + promotes high-value ones to `scenarios/curated/`.

---

## 5. Consent + Privacy (Non-Negotiable)

This feature creates a research-data pipeline. **It must be transparently opt-in** to be ethical and to avoid legal/PR disaster.

### Consent flow (mandatory)

```
First time opening Holon (after install):
┌─────────────────────────────────────────────────────────────┐
│  Welcome to Holon                                            │
│                                                              │
│  Before we set up your AI team, would you like to talk      │
│  to Casey — our customer research specialist — for          │
│  ~15 minutes about your work?                                │
│                                                              │
│  This helps Holon get better for people like you.           │
│  Your responses will be:                                     │
│  ✓ Recorded as a "scenario" that the Holon team reviews    │
│  ✓ Anonymized (no real names, emails, or PII)              │
│  ✓ Deletable any time from Settings → Privacy              │
│                                                              │
│  [ Yes, let's do it (15 min) ]   [ No thanks, skip ]        │
│                                                              │
│  You can also start an interview later from Meetings.       │
└─────────────────────────────────────────────────────────────┘
```

Hard requirements:

| ✅ Must do | ❌ Must NOT do |
|---|---|
| Show what data is collected | Hide it in EULA |
| User can decline without losing access | Gate Holon usage on consent |
| Settings → Privacy lists all interview transcripts | Black-box data lake |
| User can delete their transcripts any time (cascades to founder library) | Treat as immutable once captured |
| PII redaction before founder ever sees it | Send raw transcripts straight to founder |
| Quarterly transparency report to opt-in users ("your data helped us add X") | Take and ghost |

### PII redaction pipeline

```
Interview transcript (with names, emails, company names)
   ↓
[PII Redactor — LLM pass, runs locally]
   ↓
Redacted transcript ([NAME_REDACTED], [EMAIL_REDACTED], etc.)
   ↓
[Extraction — pull structured fields]
   ↓
scenario artifact (PII-free) → founder library
   ↓
Original transcript stored encrypted, owner can decrypt for their own review
                                  but never the founder
```

### Engineering Rules compliance

- **Rule #4 (no silent failure)**: failed interview saves trigger visible UI error; consent revocation is irreversible (delete = delete)
- **Rule #6 (owner-mediated)**: the data flowing to founder requires explicit user authority; not auto-shared
- **Rule #8 (audit completeness)**: every consent action emits `interview.consent_granted/revoked` audit events; every transcript share emits `interview.shared_with_founder` event

---

## 6. Voice Support (V2+ Roadmap)

Voice is **out of V1 scope** but the architecture must not preclude it.

### V2 voice stack (planned)

```
User speech
   ↓
[STT — Whisper API (cloud) or whisper.cpp (local)]
   ↓
text → InterviewSkill engine (same as V1)
   ↓
text response
   ↓
[TTS — OpenAI TTS / Azure / ElevenLabs / local Piper]
   ↓
audio out → user
```

V1 architecture decisions that enable V2:

1. **Transcript is the canonical record** (not audio) — V1 just gets typed; V2 gets STT'd
2. **InterviewSkill is text-driven** even with voice — voice is I/O modality, not core
3. **Session model carries `modality: "text" | "voice" | "hybrid"`** field from V1
4. **Persona has `voice_style` field** from V1 (unused until V2)
5. **Tauri audio APIs** available in our existing stack — no new dependency for V2

V2 considerations (NOT V1):
- Audio file storage (sensitive — needs same consent + redaction as transcript)
- Latency budget for back-and-forth (target sub-1s)
- Background noise / multi-speaker
- Accent / dialect support
- Cost (per-minute STT/TTS adds up)

---

## 7. UI: Meeting Mode

### Entry points

1. **Onboarding flow** (first-time install) → consent dialog → meeting mode starts
2. **Meetings page** (new `/meetings` route) → "Start a new meeting" → pick interview specialist → meeting mode starts
3. **Founder-triggered** (admin only) → "Re-interview user X" for longitudinal research

### Meeting mode UI sketch

```
┌──────────────────────────────────────────────────────────────────┐
│  🎙  In meeting with Casey · 4 min / 15 min                  ⊗  │ ← top bar
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│                                                                  │
│  Casey 🎙                                                        │
│  "Tell me about your work — what do you do day-to-day?"         │
│                                                                  │
│  You                                                             │
│  "I run a 2-person marketing consultancy. Mostly DTC clients."  │
│                                                                  │
│  Casey 🎙                                                        │
│  "Got it. What's the most time-consuming thing you wish you     │
│   could delegate?"                                               │
│                                                                  │
│                                                                  │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│  [ Your answer...                                              ] │ ← input
│                                                            [Send] │
└──────────────────────────────────────────────────────────────────┘
```

Distinguishing features:
- Full-screen overlay (other Holon UI hidden)
- Timer prominent in top bar
- Skill's persona name + emoji prominent
- Single conversation focus, no sidebar
- ESC or X to exit (with "Are you sure? Progress saved" confirm)
- After last question: switch to "summary review" view, user can edit before save

### Settings → Privacy (new page or section)

```
Privacy → Research Data
  Your interview transcripts:
    🎙  First Look · 2026-05-19 · 14 min · [View] [Delete]
    🎙  Q1 Followup · 2026-06-12 · 8 min · [View] [Delete]
  
  [ ⚙ Settings ]
  ☑ Allow Holon team to use my interview data for research
  ☑ Allow follow-up emails about my use of Holon
  ☐ Allow my anonymized usage patterns (V2)
```

---

## 8. Acceptance Criteria

1. ✅ New skill with `kind: "interview"` can be created and configured
2. ✅ First-time install triggers consent dialog before any data is collected
3. ✅ User who consents enters meeting mode automatically
4. ✅ Meeting mode UI is full-screen, distraction-free, with timer + persona
5. ✅ Skill drives Q&A flow per defined questions; user types responses; flow advances
6. ✅ Time exceeded → soft prompt ("Want to wrap up?") at duration_target; hard exit at duration_hard_cap
7. ✅ End of meeting: structured artifact is generated (scenario summary)
8. ✅ Artifact lands in `scenarios/auto/` (gitignored, local-first)
9. ✅ User can review + edit summary before save
10. ✅ User can delete transcript any time via Settings → Privacy; cascades to founder library
11. ✅ Consent state recorded in audit log
12. ✅ PII redaction pipeline runs before any data leaves user's machine for founder review
13. ✅ Founder admin dashboard shows count of scenarios, top tags, can drill into individual (PII-redacted) transcripts
14. ✅ Skipped onboarding can be triggered later from `/meetings` page

---

## 9. Open Questions

| Q | Question | First-draft assumption |
|---|---|---|
| Q1 | Default consent posture for V1 | **opt-in** (must say yes) — never opt-out by default |
| Q2 | Is meeting mode locked (can't escape) or pausable? | **Pausable** with confirm dialog; not locked |
| Q3 | Should the interview skill use the owner's already-configured runtime (Hermes) or a dedicated lightweight one? | **Owner's Hermes** in V1, reuses iter-028 per-staff session pattern |
| Q4 | Do recurring users get re-interviewed periodically? | **Optional** — Settings toggle "Send me an interview reminder every 90 days" |
| Q5 | Should scenarios be auto-tagged with industry/role for founder dashboard filtering? | **Yes** — LLM extracts tags from Q1 answer |
| Q6 | Audio file retention policy when V2 voice ships | **Default delete after transcript generated**; user can opt-in to keep audio |

---

## 10. Out of Scope for V1.x

- Voice STT/TTS (V2+)
- Multi-participant interviews (V2+)
- Calendar integration / scheduled interviews (V2+)
- Real-time interview analytics during the session (V2+)
- AI joining external Zoom/Meet calls as interview specialist (V3+)
- Cross-language interview support (V2+ — V1 English + simple Chinese)

---

## 11. Spec Edits Implied

- `docs/architecture/data-model.md`: New `meeting_sessions` table, `session_artifacts` table, extend `skill` with kind=interview
- `docs/architecture/local-agent-management.md`: New § on meeting-mode sessions vs regular chats
- `docs/architecture/ui-architecture.md`: Meeting Mode surface spec
- New ADR: "Meeting Mode as a distinct session type; interview-type skill drives it"
- New ADR: "Customer research data pipeline — consent, PII redaction, founder access"
- `docs/architecture/security-threat-model.md`: Add interview data flow + PII redaction to threat model
- `docs/architecture/auth-and-identity.md`: Update for user-consent records

---

## 12. Phased Delivery Plan

| Phase | Scope | Time estimate |
|---|---|---|
| **V1.0 (now)** | Founder manually runs interviews via Holon chat (Layer 1) — no code needed | 0 dev, ~1 day setup |
| **V1.1** | `meeting_sessions` schema + Skill kind=interview + 1 built-in "First Look" skill | 1-2 iterations |
| **V1.2** | Meeting Mode UI (full-screen overlay + timer + persona) | 1 iteration |
| **V1.3** | Consent flow + PII redaction pipeline + Settings → Privacy page | 1-2 iterations |
| **V1.4** | Founder admin dashboard for scenarios | 1 iteration |
| **V1.5** | Onboarding integration (first-install trigger) | 0.5 iteration |
| **V2.x** | Voice (STT + TTS) | separate ADR |
| **V2.x** | Passive conversation mining (Layer 3) | separate ADR |
| **V2.x** | Recurring interviews + longitudinal tracking | separate ADR |

V1.1 can start immediately after triage-skills V1.1 lands (both modify skill kind enum — better to serialize that one schema change).

---

## 13. Pickup Instructions for Requirements Agent

When you pick this up:

1. Read this doc + ADR-029 + 2026-05-19-triage-skills-design-req.md + iter-009 (skill catalog) + iter-028 (per-staff sessions)
2. Verify Q1-Q6 still acceptable to owner
3. Note coordination: V1.1 of this doc + V1.1 of triage-skills both add to skill `kind` enum — recommend single migration covering both kinds
4. Note coordination: scenarios library (from `2026-05-19-storage-architecture-design-req.md` informal mention) is the destination for interview artifacts — define folder structure compatible
5. ADR for Meeting Mode session type
6. ADR for customer-research data pipeline (consent + PII + founder access)
7. Coordinate with security review for the data pipeline (Engineering Rule #6 + GDPR posture for V1.x)

---

## 14. Owner's Direct Quotes

From 2026-05-19 design discussion:

> "我现在这个聊天软件 直接能收集 痛点和难点 我是不是CEO在这种情况下 要主动模拟一采访的人 并把采访记录弄下来 或者弄个采访专业 让这个人第一次使用的时候 跟采访专业聊天 这样我就可以收集数据了"

> "可以是开会模式 让采访专员来对话 (后期语音或者文字打字都行)"

---

## 15. Why This Design Is Right (Critique Applied)

1. **Reuses skill infrastructure** (same kind extension as triage skills) — no new "interviewer" subsystem to learn
2. **Introduces "session" as first-class concept** — opens path to V2 voice, V3 multi-party meetings, calendar integration without re-architecting
3. **Consent-first design** — bakes in privacy from V1.1, not retrofitted later under regulatory pressure
4. **Founder gets research at scale** — by V1.5 every new user contributes structured scenarios, no extra effort
5. **User experience is value-add** — onboarding becomes "I told it about myself, it set me up" rather than "I filled out a boring form"
6. **PII redaction is non-skippable** — built into pipeline, not optional
7. **Aligns with existing Engineering Rules** — owner-mediated authority on data sharing, audit completeness, no silent failure on consent revocation
8. **Path to revenue intelligence** — Q7 (willingness to pay) responses across N users gives the founder real pricing data
9. **Network density signal** — Q8 (who else has this problem) surfaces referral / community opportunities

---

End of design requirement.

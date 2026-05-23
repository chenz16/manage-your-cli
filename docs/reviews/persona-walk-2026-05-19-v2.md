# V1.0 Persona Walkthrough v2 — Sarah Chen — 2026-05-19 post-polish-streak

**Branch:** `review/persona-v2-20260519` · **SHA:** `7726f1a` · **Reviewer:** persona-walk read-only audit (curl-only — DO NOT touch code/fixtures)

## Context

14 product-polish ships landed today (b6e6a8a → 7726f1a). This walkthrough validates the new state against the Sarah-Chen SMB persona that nearly every commit explicitly targets. CEO Gmail E2E is **verified working** (real streaming response with real invoice / vendor data on the test mailbox). Persistence layer (TD-011 p1+p2) is **partially working** — overlay loads, but the dev sandbox is in a fresh-install state (`owner_name=""`, `integrations=[]`) which surfaces several first-launch gaps the polish stream did not cover.

## Profile

- **Sarah Chen, 38** — owner of a 6-person Frankfurt-trade-show booth-design firm in Shanghai.
- Non-technical. Has Gmail. Just installed Holon. Browser lands on http://localhost:3000.
- Reads bilingual UI naturally; prefers Chinese for chat input.
- Wants: "tell me what's important in my inbox + draft my client replies."
- Will **bounce in 90 seconds** if she can't figure out what to type.

## Walkthrough findings (P0 / P1 / P2 sorted)

### P0 — would block first-launch ship

- [ ] **`/api/v1/me` owner persistence ≠ chat-tool OAuth store.** `curl /api/v1/me` returns `owner_name=""`, `owner_intro=""`, `integrations=[]` — yet `POST /api/v1/chat/owner/stream` with a Frankfurt-email query returns a real Gmail-tool response citing Invoice #1900671765, Nicole Herman, €500 Wise installment. Two stores disagree on whether Gmail is connected. **/me will render "No connectors" while chat works fine** — Sarah disconnects in confusion, breaking the working path. (`apps/web/app/me/*`, `apps/web/app/api/v1/me/route.ts`, `apps/web/app/api/v1/chat/owner/stream/route.ts`. This is exactly the failure-shape 011c71f tried to fix — verify it didn't reintroduce a *second* divergence.)
- [ ] **Dev-server hard crash mid-stream.** During the CEO chat E2E probe (`curl -N` to `/api/v1/chat/owner/stream`), the Next dev server died for ~2s — every subsequent route returned `000` (connection refused) for ~10s, then recovered with a **28-second first-paint on `/`** (cold-recompile after crash). On a real customer's machine this is "the app froze, I'm closing the tab." Re-runs of the same prompt are stable, so this is a recovery-after-stream issue, not steady-state. (Likely Next 15 dev-server route HMR + async-iter SSE interplay.)
- [ ] **`/members` shows "0 total" and "members yet"** despite TD-011 phase 2a claiming `dynamicStaff` survives restart. `GET /api/v1/staff` returns `{items:[]}` — but `GET /api/v1/me` returns the Desk AI owner_assistant by id (`staff_01HKQ8…`), so there IS a staff record server-side that the `/staff` endpoint isn't returning. Sarah opens `/members` expecting "my Desk AI" + her starter team and sees an empty roster with a `+ Hire` button. Either (a) `/api/v1/staff` should include the owner_assistant, or (b) `/members` should explain the difference between Desk AI (singular) and hired staff (plural) in its empty-state. (Today there is **no empty-state coaching on `/members`** — the page is the only one in the day-one set without it, gap between 88bb4df and 7726f1a.)

### P1 — would frustrate after 5 min use

- [ ] **No persona matches Sarah.** `/api/v1/personas` returns 8 cards: Marketing Director (Robotics & AI), Eng Manager, **Founder/Solo GM**, HR, Sales Director, Product Manager (Consumer App), Finance Controller, Research Director. **None is "SMB owner / trade show / agency / events / construction / freight"** — Sarah picks Founder/Solo GM by elimination, gets a starter team (Sam, Lin) that doesn't fit booth-design work at all. The whole HireDialog "trade-show keyword → Email Triage" suggestion (c909545) and ChatEmptyState chips (88bb4df) recognize her vocabulary — but the **persona picker, the very first onboarding choice, doesn't**. The intent-detection ladder breaks at the highest step.
- [ ] **Connectors page (b6e6a8a) shows 3 connector cards (Gmail, Google Drive, GitHub, Hugging Face — actually 4) but no live status.** /me renders the names + Connect buttons but with `integrations=[]` the page can never display "Connected as sales@winautousa.com" — even though the CEO chat tool clearly has those tokens. The connector cards are pure decoration until the integrations contract is unified (see P0 #1).
- [ ] **`/onboarding` first paint is `Loading…` only.** Server-rendered HTML for `/onboarding` is `<div>Loading…</div>` and nothing else — client hydration is the whole UI. On Sarah's WSL2-class hardware first-paint may be 2-5s of a blank loading screen, no progress indicator, no "this should take ~3 minutes." Add a server-rendered shell with the step skeleton + a "5 steps · ~3 min" header.
- [ ] **`/me` Maintenance section text is technical:** "Mock fixtures stay intact" / "Sandbox directory `/home/chenz/project/holon-engineering/workspace/owner-sandbox`" / "agent_profile_id: hermes_profile_owner_v1" — Sarah doesn't know what a sandbox is, what a profile_id is, or what "Mock fixtures" means. These leaked-internals strings predate today's stream but stand out post-polish.
- [ ] **`/me` Identity section labels in mixed languages:** "Persona / 工作风格" (good), but "Owner role / title" + "Display name" + "Monthly budget (USD)" are English-only. The polish stream localized chat chips + HireDialog but not the settings page.
- [ ] **`/today` "Engineering Rule #6" label** (visible on `/inbound`) is engineer-jargon. Sarah doesn't know there are numbered engineering rules. Use the rule's content ("external work always lands in your inbox first, never auto-accepted") without the rule-number reference.

### P2 — polish / nice-to-have for V1.1

- [ ] `/me` shows the placeholder copy `"Skill edit UI lands in iter-008+; for now edit the fixture or wait for the inline editor."` directly to the customer. Replace with "Custom skills coming soon — for now pick from Examples."
- [ ] `+ Hire` dialog's three QUICK_PICKS (Email Triage / Slide Deck Maker / Research Aide) are English-labeled. For a Chinese-language owner_intro the chip labels remain English even though the underlying `sketch` could be bilingual.
- [ ] `/references` and `/templates` Examples cards' "Yours" section says `"You haven't enabled any references yet."` — but `"yours · 0 ready"` strip says `0 ready`. Two empty-states stacked vertically; consolidate.
- [ ] Connection-id placeholder text `conn_…` on `/me` is meaningless to Sarah; replace with a concrete example like `gmail-acct-prod`.
- [ ] `/deliverables` shows TWO empty-state strings ("No deliverables yet — they show up here when staff finish work." AND "No deliverables yet. Ask the Desk AI for a write-up and it'll land here.") — pick one. Doubled message reads like a bug.
- [ ] No persona-pack export for first-time SMB onboarding — Sarah will need ~20 min to author her own `owner_intro` from scratch. A "trade-show / agency / events" preset would shave that to 2 clicks.
- [ ] `/connections` empty-state says "Click Pair new connection above to add your first peer desk." — but Sarah-Chen has no peer; she's a solo owner. The very concept of "peer desk" needs a 1-sentence explainer (what is a peer? why would I want one?). 7726f1a added the panel; it landed without the "why this exists for me" framing.
- [ ] Connection terminology: nav says "Team" (good), but the Authorizations section on `/me` calls staff "the desk AI" / "all staff inherit" — three names for the same concept across two pages.

## What worked well (positives)

- **CEO chat with real Gmail E2E**: the headline V1.0 promise WORKS. "What's my next Frankfurt-related action item from email?" returned a tightly-scoped, citation-rich response (invoice #, contact name, currency, payment method, due window) from the real test mailbox — exactly the moment that converts a skeptic.
- **`/today` empty-state (ca17140)** is the strongest page in the build. The bucket legend ("what each bucket means" + 6 plain-English definitions) directly addresses Sarah's "what does this even do?" moment. Best in show.
- **`/inbound` empty-state (8d837e8)** has the "Why owner-mediated?" framing which is exactly right for the trust beat that gates the Hire-staff conversion.
- **`/deliverables` empty-state (8d837e8)** with "Check what your AI can do at /skills" + "Delegate work via desk chat" is a tight 2-action panel.
- **`/skills` (0da9f5a)** above-strip explainer + WHEN_TO_USE per card + EXAMPLE badges nails the "what is this even for" beat for a non-technical owner.
- **`/references` + `/templates` (ea3eb63)** mirror `/skills` consistently — Sarah only has to learn the pattern once.
- **`/connections` (7726f1a)** has a clean peer-pairing panel scaffold.
- **Connectors scope-down (b9e3ebf)** — dropping the Customize rail + per-tool toggles for V1.0 is exactly the right "授权页面只是授权" judgment call.
- **HireDialog (c909545)** persona quick-picks with blurb-not-just-label is a real win for non-technical owners.
- **useOwner() hook (d67ee34)** cleaned 4 components ahead of the SQLite-cache swap — invisible to Sarah, real win for whoever ships TD-011 phase 3.

## Top 3 things to ship NEXT (post-polish iteration)

1. **Unify the `/api/v1/me` integrations contract with the chat-tool OAuth store.** Without this, `/me` will lie to first-time customers ("Gmail not connected") while the chat works — guaranteed support ticket on day one. (Repro: curl `/api/v1/me` AND POST `/api/v1/chat/owner/stream` with an email query — compare integrations array vs tool-call success.)
2. **Ship a "SMB / Agency / Events" persona preset.** The 8 existing personas skew enterprise (Director / Manager / Controller titles) — Sarah's exact ICP has no card. Adding one persona preset is a 2-line fixture edit + LLM-generated `system_prompt` and turns the empty-handed Founder/Solo GM picker into a Sarah-shaped pick.
3. **Add `/members` empty-state + show owner_assistant in `/api/v1/staff`.** Day-one customer opens Team page → sees `0 total`. Whether the fix is including the Desk AI in the staff list OR adding an empty-state explaining the Desk AI / Hired-staff distinction, this is the **last page in the day-one set without coaching** after 8d837e8 + 7726f1a.

## Verified persistence

```
$ curl -s http://localhost:3000/api/v1/me
{"id":"staff_01HKQ8OWNERASSISTVBN3XKWTCQ","name":"Desk AI",
 "role_name":"owner_assistant","role_label":"Owner Assistant",
 "substrate":{...},
 "owner_name":"","owner_role":"","owner_intro":"",
 "system_prompt":"","integrations":[]}

$ curl -s http://localhost:3000/api/v1/staff
{"items":[]}
```

**Owner record exists post-restart (TD-011 p1 OK)** but it's a fresh-install row — `owner_name`/`integrations` are empty even though OAuth tokens clearly work via chat. Either onboarding never completed in this sandbox **or** the overlay layer doesn't merge integrations from the OAuth-token store back into `/me` (P0 #1). **Dynamic staff endpoint returns 0 items** despite TD-011 p2a claim of "dynamicStaff survives restart" — owner_assistant should at minimum be in the list (P0 #3). Re-test with a freshly completed onboarding flow before declaring TD-011 done.

## Verified Gmail E2E

```
$ curl -sN -X POST -H 'Content-Type: application/json' \
   -d '{"messages":[{"role":"user","content":"what is my next Frankfurt-related action item from email?"}]}' \
   http://localhost:3000/api/v1/chat/owner/stream

data: {"type":"done","stopReason":"end_turn","finalText":
  "Based on the emails I've read, here's your next action item:
   ## Next action: Pay the 2nd installment of Invoice #1900671765
   What's been done: 1st installment of €500 sent via Wise on May 18...
   What you owe: remaining balance on Invoice #1900671765...
   When: After the 1st €500 clears (~May 25)...
   Don't forget: Reference Invoice 1900671765 / Customer 15053350 /
     Partial Payment 2 of 2 in the remittance note, send the payment
     confirmation to Nicole Herman.
   Also worth noting: 15+ unsolicited booth-construction vendor
     spam in your inbox..."}
```

Streaming worked; real-data tool calls worked; Markdown formatting (headers, bullets, bold) preserved through SSE; final answer cites the actual invoice number, contact name, currency, payment vendor, and date window from the real test mailbox. Side observation surfaced organically ("15+ unsolicited offers"). **This is the wow-moment that ships V1.0.**

---

## Verdict (≤1 sentence)

V1.0 is **80% ready to ship to Sarah Chen** — the headline CEO/Gmail wow-moment lands flawlessly and the day-one coaching pattern (7 of 8 pages) is consistent and persona-aware, but two integration-state bugs (`/me` integrations contract divergence; empty `/api/v1/staff`) and one persona-gap (no SMB-agency preset) will trip her up before she sees the magic — fix those 3 and ship.

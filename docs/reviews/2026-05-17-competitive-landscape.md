# Competitive Landscape — Chat-First AI Workforce Consoles

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

Date: 2026-05-17
Author: Research scan (web-verified May 2026)
Scope: positions Holon against the products co-defining the "chat-first AI workforce" category.

## 1. Category framing

Three cohorts are co-defining this category Q1-Q2 2026: **incumbents collapsing their stack into chat** (Copilot, Slack/Agentforce, Linear Agent, Notion Database Agents), **enterprise agent platforms** (Glean, Sana/Workday, Relevance AI, Stack AI), and **autonomous-worker upstarts** (Lindy, Devin, MultiOn/AGI-0). Shared bet: the *front door to work* is a conversational agent brokering across apps, not a tabbed SaaS UI. Microsoft's May 2026 Copilot Cowork launch and Salesforce's March 2026 "Slack-as-agentic-OS" reframe make it official; Linear's CEO declaring "issue tracking is dead" ([The Register, Mar 2026](https://www.theregister.com/2026/03/26/linear_agent/)) is the loudest signal that even tracker-natives now bet on chat-as-control-plane.

## 2. Closest comparables (5)

**Microsoft 365 Copilot + Copilot Cowork** ([Microsoft, May 2026](https://www.microsoft.com/en-us/microsoft-365/blog/2026/05/05/copilot-cowork-from-conversation-to-action-across-skills-integrations-and-devices/)). The canonical "chat + Teams + Outlook + agents" play; built-in agents per app + Copilot Control System for ownership/permissions/analytics. **Steal:** one chat, three surfaces (Teams side, Outlook side, standalone canvas). **Avoid:** per-app agent fragmentation, enterprise-only friction. Pricing: $30/user/mo + pay-as-you-go agents.

**Lindy.ai** ([pricing](https://www.lindy.ai/pricing)). Triggers + actions across 5000+ integrations; API→browser fallback when no API exists. **Steal:** always-on triggers, browser fallback. **Avoid:** credit-metered pricing punishes multi-step work (voice calls 265 credits ≈ $2.65 each) — anti-delegation by design. Pricing: $49.99/mo Pro = 5k credits, $10/1k overage.

**Glean** ([overview](https://www.glean.com/product/overview); [pricing](https://checkthat.ai/brands/glean/pricing)). Enterprise search + assistant + multi-step agents over 100+ apps. **Steal:** the *Find → Act → Build → Automate* mental model (Sana frames identically — convergent). **Avoid:** sales-only pricing, ~$50+/user/mo, ~100-seat min ($60k+ ACV; fully-loaded $350-480k/yr). Unusable for Maya; threat to Wei.

**Cognition Devin** ([Cognition](https://cognition.ai/); [Idlen review](https://www.idlen.io/blog/devin-ai-engineer-review-limits-2026/)). Chat-first autonomous SWE; Slack-summonable; streams plan+execution; desktop support default since Feb 2026. **Steal:** async-by-default — fire task, walk away, get pinged; plan-then-execute (which Holon's `decompose_task` mirrors). **Avoid:** single-employee model — no roster, no peer delegation.

**Linear Agent** ([changelog Mar 2026](https://linear.app/changelog/2026-03-24-introducing-linear-agent)). In-app agent + plug-ins for Slack/Teams/Zendesk; *Skills* (saved workflows) + *Automations* (issue-triggered). Coding agents in 75% of Linear enterprise workspaces. **Steal:** Skills as first-class objects (Holon has it); plug-in-everywhere posture. **Avoid:** ticket-shaped work assumption. Pricing: $16/user/mo Business.

Honorable mentions: **Cursor 2.0** (agents/plans/runs as first-class sidebar objects, diff-review per conversation — [DeployHQ](https://www.deployhq.com/guides/cursor)); **Slack + Agentforce** MCP host ([Fortune Apr 2026](https://fortune.com/2026/04/01/salesforce-reinvents-slack-ai-age-takes-aim-at-microsoft-copilot/)); **Notion Database Agents** ([Notion 3.5](https://www.notion.com/releases/2026-05-13)).

## 3. Patterns common across winners

1. **Persistent chat panel as control plane.** Cursor, Copilot, Linear, Sana, Slack — all left/right panel, never popup. Holon: shipped.
2. **User-saveable named Skills.** Linear Skills, Claude Agent Skills, Notion AI blocks. Holon: shipped (Skill+Template+Reference trinity).
3. **Plan-then-execute with mid-flight intervention.** Devin streams + accepts corrections; Cursor Composer proposes diffs. Holon: partial (plan-nod, no live edit).
4. **MCP as connector layer.** Slack MCP client Mar 2026; Notion Workers; Sana as orchestration layer. Holon: not yet MCP-native.
5. **One chat, multiple surfaces.** Copilot (Teams/Outlook/standalone); Linear (in-app + Slack/Teams/Zendesk). Holon: single web surface.
6. **Action cards in chat** (clickable artifacts, deliverable links, diff cards). Holon: shipped (path-tokenizer chips).
7. **Async + notify.** Devin, Lindy, Copilot Cowork Dispatch all push on completion. Holon: partial — `/today` polls, no push.

## 4. Patterns Holon is missing

- **No MCP host/client.** Every serious player shipped MCP in Q1 2026. An MCP shim unlocks the entire MCP-tool ecosystem in ~one eng-week.
- **No multi-surface delivery.** Single web app. Competitors meet users in Slack/Teams/mobile/email. Less critical for Maya; table stakes for Wei.
- **No mid-flight intervention on long jobs.** Plan-nod-go ships; mid-execution "wait, change X" not wired. Devin + Cursor nail this.
- **No live streaming of agent state.** `/today` polls; competitors stream (SSE). Iter-011-shaped.
- **No async push.** No mobile/email/desktop notification when a deliverable lands.
- **No owner-visible cost meter** (TECH-DEBT D7). Every winner exposes usage.

## 5. Patterns Holon does uniquely (so far)

- **Flat-roster invariant.** Sana, Relevance, Stack AI happily nest agents. Holon's "no staff owns staff" trades hierarchy expressiveness for owner clarity — and a tractable UI.
- **Skill + Reference + Template trinity with user-CRUD + describe-mode authoring on all three.** Lindy has actions, Linear has Skills, Notion has templated blocks; none unify all three under one catalog with LLM-authoring.
- **Persona presets bias downstream defaults.** No competitor ships personas that bias `create_agent` and prompt scaffolds. A real V1 differentiator.
- **Deny-list authorization.** Competitors use per-agent allow-lists (Copilot Control System, Agentforce). Holon's inherit-then-subtract model is faster for solo owners.
- **Owner-mediated authority + four-crossing seam.** Architecturally unique to Core 2: external work lands in owner inbox first. No equivalent — right shape for V2's cross-desk story.

## 6. What V2 (Wei) needs that V1 doesn't

V2-blockers cluster tightly:

1. **SSO + audit log export.** Glean/Sana gate here; Copilot has Control System. Non-negotiable above ~500-person co.
2. **Per-staff cost attribution + budget enforcement.** Wei's CFO will ask.
3. **MCP host capability.** Wei's stack has MCP-exposed Jira/Confluence/Slack by mid-2026.
4. **Cross-desk handoffs (Core 2)** — Holon's wedge vs Copilot (which silos every user).
5. **Plug-in posture** — Holon-in-Slack / Holon-in-Teams, not a standalone tab.
6. **Per-handoff SLA timers** — Wei is judged on response time to peer desks.

## 7. Three concrete recommendations

1. **Ship MCP client support before iter-012.** Highest-leverage single move. Collapses years of integrations into "point at MCP server URL." Every named competitor has it or is shipping it; Holon's bespoke plugins become a long-tail liability fast. Wire at runtime-adapter so Hermes calls MCP tools the same way as local plugin tools — preserves Engineering Rule #1.

2. **Add SSE streaming + mid-flight intervention with action-card affordance.** Devin and Cursor prove the UX. Each `assign_to_staff` returns a job that streams plan/step/output back into the originating thread as a live-updating action card; owner can post "pause / change / cancel" and the job receives it. Kills the biggest V1 trust gap ("did it die or is it still working?") and demos better than any other single change.

3. **Pick one V2 plug-in surface for iter-013: Holon-in-Slack.** Not Teams (Copilot owns it), not Outlook (same). Slack is now MCP-native and Wei's company likely uses it. A `/holon` slash command mapping a thread to a Desk AI conversation, with deliverables posted back as Slack attachments, is what turns Wei from "interesting demo" to "shipping it Monday" — and forces the multi-surface architecture everything after will need.

---

Sources cited inline; cohort framing cross-checked against [Sana 2026 enterprise guide](https://sanalabs.com/agents-blog/enterprise-ai-agents-workday-sana-guide-2026), [Relevance AI pricing](https://relevanceai.com/pricing), [Cursor 2026 guide](https://www.deployhq.com/guides/cursor).

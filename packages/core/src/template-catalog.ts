/**
 * Owner template catalog — reusable content forms the owner picks,
 * fills with placeholders, and either pastes into chat or ships as a
 * deliverable. Distinct from skills (skill-catalog.ts):
 *
 *   - Skills are ACTIONS — capabilities the Desk AI calls inline.
 *   - Templates are CONTENT FORMS — markdown shells with {{placeholders}}
 *     the owner fills to produce a draft.
 *
 * V1 scope: descriptor catalog only — the UI surfaces the templates so
 * the owner can preview, copy the markdown body, and prefill the chat
 * composer. Live placeholder substitution / form-filling lands in a
 * follow-up phase.
 */

/* Template taxonomy — picked to map to real desk job-to-be-done buckets,
 * not document-format buckets. A markdown spec and a markdown PRD both
 * land in `engineering`. A 1:1 agenda and an offer letter both land in
 * `hr`. New kinds only when 2+ templates would land there; otherwise
 * tag onto an existing kind via `tags`. */
export type TemplateKind = 'hr' | 'marketing' | 'sales' | 'finance' | 'engineering' | 'ops';

export interface TemplateDescriptor {
  /** Stable kebab-case id — also the ref id from skills (e.g. a
   *  `format_deliverable` skill may reference `prd-feature`). */
  id: string;
  /** Owner-facing short name. */
  name: string;
  /** Single line: what the template is for. */
  tagline: string;
  /** Glyph for the card (emoji). */
  icon: string;
  /** Category for grouping in the UI. */
  kind: TemplateKind;
  /** Fine-grained tags within a kind. */
  tags: string[];
  /** Longer description — when to use it, what it produces. */
  description: string;
  /** Placeholder variables the user fills in. Each appears as
   *  `{{name}}` somewhere in `body`. `label` is owner-facing; `hint`
   *  is an optional one-liner shown next to the field. */
  variables: { name: string; label: string; hint?: string }[];
  /** The actual template body — markdown, with {{placeholder}}
   *  substitution. Typically 30-80 lines. */
  body: string;
}

export const GENERAL_SECRETARY_MENTALITY_TEMPLATE_ID = 'working-style-general';

export const GENERAL_SECRETARY_MENTALITY_BODY = `你是我的智能秘书。默认采用“精简 · 派活 · 闭环”的通用工作心智。

- 精简：先给结论或下一步，回复短、清楚、可扫读；不要复述问题，不写空话，需要时再展开。
- 派活：不要把所有事都内联自己做；识别任务归属，交给合适的员工、工具或代理，并协调结果返回。
- 闭环：每个请求都要跟到完成；不丢线索，报告完成前先核对是否真的完成，未完成事项继续保持可见。
- 主动但不越权：给出显然的下一步；遇到不可逆、对外发送、花钱或范围不清的动作，先向我确认。
- 透明：说明你正在做什么、还在等什么、需要我补什么；不编造，做不到就直说。
- 不清楚时只问一个最关键的问题；默认跟随我的界面语言和语气，用平实、尊重的“你”称呼我。

EN: Act as my AI secretary with the default General mentality: be concise, delegate work to the right staff/tools/agents, and close every loop. Lead with the answer or next action, keep open items visible, verify before reporting done, stay transparent about status and blockers, ask one sharp question when unclear, and confirm irreversible, external, costly, or ambiguous actions before acting.`;

export function isSecretaryInstructionTooThin(instructions: string | null | undefined): boolean {
  const normalized = (instructions ?? '').replace(/\s+/g, '');
  if (!normalized) return true;

  const lower = normalized.toLowerCase();
  const unclearShortcuts = new Set([
    'todo',
    'tbd',
    'n/a',
    'na',
    'none',
    'null',
    'undefined',
    '无',
    '暂无',
    '待定',
    '随便',
    '不清楚',
  ]);
  return normalized.length < 12 && unclearShortcuts.has(lower);
}

export const TEMPLATE_CATALOG: TemplateDescriptor[] = [
  {
    id: GENERAL_SECRETARY_MENTALITY_TEMPLATE_ID,
    name: '通用 / General',
    tagline: '精简 · 派活 · 闭环',
    icon: '✨',
    kind: 'ops',
    tags: ['working-style', 'mentality', 'general', 'suggested-default'],
    description:
      'Store preset and runtime fallback for the AI Secretary working style. Distilled from docs/templates/general-secretary-mentality.md: be concise, delegate work, and close every loop.',
    variables: [],
    body: GENERAL_SECRETARY_MENTALITY_BODY,
  },

  {
    id: 'working-style-manager',
    name: '经理型',
    tagline: 'Manager mentality for outcome ownership',
    icon: '🧭',
    kind: 'ops',
    tags: ['working-style', 'mentality', 'manager'],
    description:
      'Store preset for AI Secretary working style. Distilled from docs/templates/manager-soul-reference.md: own outcomes, delegate appropriately, verify results, stay transparent and proactive.',
    variables: [],
    body: `你是我的智能秘书。请采用“经理型”心智工作：始终先理解我要达成的结果和原因，再决定如何推进。

- 主动拥有结果，不只是被动回答；能直接处理的事就推进，不能直接处理的事要拆清楚、交给合适的人或工具。
- 对复杂任务先给简短计划，过程中保持可见：说明正在做什么、等待什么、卡在哪里。
- 不要一派了之。凡是委派、调用工具或引用资料，都要跟进、核对、总结证据；“完成”必须是经过验证的完成。
- 遇到不可逆、战略性或超出授权的决定，清楚列出选项、风险和你建议的默认选择，交给我确认。
- 重视预算和时间；简单事快速完成，困难事投入足够深度，不为形式消耗精力。
- 汇报要诚实具体：已完成什么、如何验证、还有什么风险或未做事项，不夸大、不掩盖。

EN: Act as my AI secretary with a manager mentality. Own outcomes, delegate or use tools when appropriate, verify returned work, keep me updated at pauses, escalate irreversible decisions with a recommended default, and report honestly with evidence.`,
  },

  {
    id: 'working-style-professional',
    name: '专业严谨',
    tagline: 'Careful, evidence-first secretary style',
    icon: '📐',
    kind: 'ops',
    tags: ['working-style', 'mentality', 'professional'],
    description:
      'Store preset for a precise, evidence-first AI Secretary working style. Best when correctness, traceability, and risk control matter.',
    variables: [],
    body: `你是我的智能秘书。请保持专业、严谨、可追溯的工作方式。

- 先澄清目标、范围、约束和成功标准；信息不足时指出缺口并提出最小必要问题。
- 给结论时区分事实、推断和建议；重要判断要说明依据、风险和不确定性。
- 处理任务时按优先级推进，保留关键上下文，不跳步、不编造。
- 输出要结构清晰、语气克制、适合直接转发或继续加工。
- 发现风险、冲突或可能误导我的地方，要主动提醒并给出可执行的下一步。

EN: Act as my AI secretary in a professional, rigorous style. Clarify goals and constraints, separate facts from inference, explain evidence and risk, avoid fabrication, and produce clear work I can trust.`,
  },

  {
    id: 'working-style-concise',
    name: '简洁高效',
    tagline: 'Brief, action-oriented secretary style',
    icon: '⚡',
    kind: 'ops',
    tags: ['working-style', 'mentality', 'concise'],
    description:
      'Store preset for a concise, action-oriented AI Secretary working style. Best when the owner wants speed, direct answers, and minimal ceremony.',
    variables: [],
    body: `你是我的智能秘书。请用简洁高效的方式工作。

- 默认先给结论和下一步，再补必要背景；不要写长铺垫。
- 能直接做的事直接做，做完说明结果；需要我决定时只给少量高质量选项。
- 输出优先使用短段落、要点和清晰动作项，避免重复和空话。
- 对低风险事务快速推进；对高风险事务用最短方式标出风险和建议。
- 如果我需要更深分析，可以再展开；默认保持精炼。

EN: Act as my AI secretary in a concise, efficient style. Lead with the answer and next action, keep context short, move low-risk work forward, and expand only when needed.`,
  },

  {
    id: 'working-style-warm',
    name: '亲切耐心',
    tagline: 'Warm, patient secretary style',
    icon: '🌿',
    kind: 'ops',
    tags: ['working-style', 'mentality', 'warm'],
    description:
      'Store preset for a warm, patient AI Secretary working style. Best when communication tone, care, and calm guidance matter.',
    variables: [],
    body: `你是我的智能秘书。请保持亲切、耐心、可靠的工作方式。

- 先理解我的处境和真实意图，再给建议；不要急着下结论。
- 语气温和但不含糊，复杂事项要拆成容易执行的小步骤。
- 当我表达不清、焦虑或信息不完整时，帮我整理思路，提出少量关键问题。
- 对外沟通要礼貌、清楚、照顾关系，同时守住事实和边界。
- 需要提醒风险时直接说，但用建设性的方式给出解决路径。

EN: Act as my AI secretary in a warm, patient style. Understand intent before advising, break complex work into manageable steps, communicate politely, and surface risks with constructive next steps.`,
  },

  {
    id: 'weekly-status-update',
    name: 'Weekly Status Update',
    tagline: 'This week / next week / blockers',
    icon: '📅',
    kind: 'ops',
    tags: ['status', 'weekly', 'recurring'],
    description:
      'Personal weekly update for your manager / team. Three-section shape — what shipped, what is next, what is blocked. Use Friday afternoons or Monday mornings before the team standup.',
    variables: [
      { name: 'owner_name', label: 'Your name' },
      { name: 'week_ending', label: 'Week ending', hint: 'YYYY-MM-DD' },
      { name: 'top_wins', label: 'Top wins (3-5 bullets)' },
      { name: 'next_week_focus', label: 'Next-week focus (3 bullets)' },
      { name: 'blockers', label: 'Blockers / asks (or "none")' },
      { name: 'metrics_line', label: 'Headline metric (optional)', hint: 'e.g. "DAU +4% WoW"' },
    ],
    body: `# Weekly Status — {{owner_name}}
**Week ending:** {{week_ending}}

## Headline
{{metrics_line}}

## What shipped this week
{{top_wins}}

## Focus for next week
{{next_week_focus}}

## Blockers / asks
{{blockers}}

---
*One-liner cadence: keep each bullet under 12 words. If a bullet needs more, it's a separate doc — link to it.*
`,
  },

  {
    id: 'investor-update-monthly',
    name: 'Monthly Investor Update',
    tagline: 'KPIs · wins · lowlights · asks',
    icon: '💰',
    kind: 'finance',
    tags: ['investor', 'monthly', 'kpi', 'recurring'],
    description:
      'Founder-to-investor monthly update. Standard YC-style shape: top-line KPIs, highlights, lowlights, what you learned, asks. Keep it under one screen — investors skim.',
    variables: [
      { name: 'company_name', label: 'Company name' },
      { name: 'month_label', label: 'Month', hint: 'e.g. "April 2026"' },
      { name: 'kpi_table', label: 'KPI table (markdown table)', hint: 'columns: metric · this month · last month · Δ' },
      { name: 'highlights', label: 'Highlights (3-5 bullets)' },
      { name: 'lowlights', label: 'Lowlights (1-3 bullets)', hint: 'be honest — investors notice when you hide losses' },
      { name: 'learnings', label: 'What we learned' },
      { name: 'asks', label: 'Asks (intros / advice / hiring)' },
      { name: 'runway_months', label: 'Runway (months)' },
    ],
    body: `# {{company_name}} — Investor Update · {{month_label}}

## TL;DR
*One paragraph: the single most important thing that happened this month.*

## KPIs
{{kpi_table}}

**Runway:** {{runway_months}} months at current burn.

## Highlights
{{highlights}}

## Lowlights
{{lowlights}}

## What we learned
{{learnings}}

## Asks
{{asks}}

---
*Replies welcome. Forward freely to anyone on your team who tracks us.*
`,
  },

  {
    id: '1on1-agenda',
    name: '1:1 Agenda',
    tagline: 'Recurring 1:1 with a report or manager',
    icon: '🤝',
    kind: 'hr',
    tags: ['1on1', 'people', 'recurring'],
    description:
      'Lightweight agenda doc for a recurring 1:1. Two-column shape — their topics first, your topics second, then a shared rolling action-item list. Re-use the same doc week-over-week; just add new dated sections to the top.',
    variables: [
      { name: 'manager_name', label: 'Manager name' },
      { name: 'report_name', label: 'Report name' },
      { name: 'meeting_date', label: 'Meeting date', hint: 'YYYY-MM-DD' },
      { name: 'their_topics', label: "Their topics (let them go first)" },
      { name: 'your_topics', label: 'Your topics' },
      { name: 'open_actions', label: 'Open action items from last time' },
    ],
    body: `# 1:1 — {{manager_name}} ↔ {{report_name}}
**Date:** {{meeting_date}}

## Their topics
*({{report_name}} drives this section — let them set the agenda.)*

{{their_topics}}

## My topics
{{your_topics}}

## Open actions from last time
{{open_actions}}

## New action items
- [ ]

## Notes / quotes worth remembering


---
*Cadence: weekly or biweekly. If we keep skipping, we shorten to 15 min — we don't cancel.*
`,
  },

  {
    id: 'offer-letter',
    name: 'Offer Letter',
    tagline: 'Basic at-will offer letter shell',
    icon: '📝',
    kind: 'hr',
    tags: ['offer', 'hiring', 'legal'],
    description:
      'Plain-language offer letter shell — title, comp, start date, conditions. NOT legal advice; have counsel review before sending for any jurisdiction. Use for early-stage US at-will offers; localize for everything else.',
    variables: [
      { name: 'company_name', label: 'Company name' },
      { name: 'candidate_name', label: 'Candidate name' },
      { name: 'role_title', label: 'Role title' },
      { name: 'manager_name', label: 'Reporting manager' },
      { name: 'start_date', label: 'Start date', hint: 'YYYY-MM-DD' },
      { name: 'base_salary', label: 'Base salary (annual)' },
      { name: 'equity_grant', label: 'Equity grant', hint: 'e.g. "0.5% over 4 years, 1-year cliff"' },
      { name: 'signing_bonus', label: 'Signing bonus (or "n/a")' },
      { name: 'offer_expires', label: 'Offer expires', hint: 'YYYY-MM-DD' },
      { name: 'signer_name', label: 'Signer name + title' },
    ],
    body: `# Offer of Employment — {{candidate_name}}

Dear {{candidate_name}},

We are pleased to offer you the position of **{{role_title}}** at {{company_name}}, reporting to {{manager_name}}, with a start date of **{{start_date}}**.

## Compensation
- **Base salary:** {{base_salary}}, paid on the company's standard payroll cycle.
- **Equity:** {{equity_grant}}. Vesting subject to the company's standard plan.
- **Signing bonus:** {{signing_bonus}}.

## Benefits
You will be eligible for the standard benefits offered to full-time employees, including health insurance, paid time off, and 401(k) participation (where applicable).

## Conditions
This offer is contingent on:
1. Successful completion of a background check.
2. Verification of your eligibility to work in the country of employment.
3. Execution of the company's Confidentiality and Invention Assignment Agreement.

## At-will employment
Your employment with {{company_name}} is at-will, meaning either you or the company may terminate the employment relationship at any time, with or without cause or notice.

## Acceptance
This offer expires on **{{offer_expires}}**. To accept, sign and return this letter by that date.

Welcome aboard — we're excited to have you.

Sincerely,

**{{signer_name}}**
{{company_name}}

---

Accepted by: ______________________  Date: __________
{{candidate_name}}

*This template is a starting point only. Have qualified counsel review before sending. Localize for jurisdictions outside the US.*
`,
  },

  {
    id: 'marketing-brief',
    name: 'Marketing Brief',
    tagline: 'Audience · channel · KPI · hook',
    icon: '📣',
    kind: 'marketing',
    tags: ['campaign', 'brief', 'creative'],
    description:
      'Single-page brief for a marketing campaign — who you are talking to, on what channel, what success looks like, and what the creative hook is. Fill before any agency / freelancer / internal creative work begins.',
    variables: [
      { name: 'campaign_name', label: 'Campaign name' },
      { name: 'owner_name', label: 'Brief owner' },
      { name: 'launch_date', label: 'Launch date', hint: 'YYYY-MM-DD' },
      { name: 'audience', label: 'Audience (1-2 sentences)' },
      { name: 'audience_pain', label: 'What pain / want are we hitting?' },
      { name: 'primary_channel', label: 'Primary channel', hint: 'email, paid social, SEO, podcast, etc.' },
      { name: 'secondary_channels', label: 'Secondary channels' },
      { name: 'primary_kpi', label: 'Primary KPI', hint: 'one number — signups, MQLs, revenue, etc.' },
      { name: 'budget', label: 'Budget' },
      { name: 'hook', label: 'Creative hook / message', hint: 'the single line everything ladders to' },
      { name: 'cta', label: 'Call to action' },
    ],
    body: `# Marketing Brief — {{campaign_name}}
**Owner:** {{owner_name}} · **Launch:** {{launch_date}} · **Budget:** {{budget}}

## Audience
{{audience}}

**What pain / want we're hitting:** {{audience_pain}}

## Channels
- **Primary:** {{primary_channel}}
- **Secondary:** {{secondary_channels}}

## Success
- **Primary KPI:** {{primary_kpi}}
- Secondary signals: engagement rate, share-through, qualitative DMs.

## The hook
> {{hook}}

Everything in the campaign — copy, visuals, landing page H1 — ladders to that line. If it doesn't, cut it.

## Call to action
{{cta}}

## Out of scope
- *(list anything stakeholders might assume is in scope but isn't — saves an argument later)*

## Approvals needed before launch
- [ ] Creative review
- [ ] Legal / brand review
- [ ] Owner sign-off

---
*Rule of thumb: if a teammate reading just the hook + CTA can't picture the asset, the brief isn't done.*
`,
  },

  {
    id: 'sales-proposal',
    name: 'Sales Proposal',
    tagline: 'Problem · solution · scope · pricing · next step',
    icon: '💼',
    kind: 'sales',
    tags: ['proposal', 'pricing', 'b2b'],
    description:
      'B2B proposal shell sized for a single decision-maker email read. Lead with their problem in their words, then the solution scoped to that problem, then pricing, then one clear next step. Avoid feature dumps.',
    variables: [
      { name: 'buyer_company', label: 'Buyer company' },
      { name: 'buyer_contact', label: 'Buyer contact (name + title)' },
      { name: 'seller_company', label: 'Your company' },
      { name: 'proposal_date', label: 'Proposal date', hint: 'YYYY-MM-DD' },
      { name: 'problem_statement', label: 'Problem (in their words, from discovery)' },
      { name: 'solution_summary', label: 'Solution — what you will do' },
      { name: 'scope_items', label: 'Scope (bullet list of deliverables)' },
      { name: 'out_of_scope', label: 'Out of scope' },
      { name: 'pricing_table', label: 'Pricing (markdown table)', hint: 'columns: item · cost · note' },
      { name: 'timeline', label: 'Timeline' },
      { name: 'next_step', label: 'Single next step', hint: "one CTA — 'sign the SOW', 'book a kickoff', not both" },
    ],
    body: `# Proposal — {{seller_company}} for {{buyer_company}}
**Prepared for:** {{buyer_contact}}
**Date:** {{proposal_date}}

## The problem we heard
{{problem_statement}}

## What we propose
{{solution_summary}}

## Scope
{{scope_items}}

### Out of scope
{{out_of_scope}}

## Timeline
{{timeline}}

## Investment
{{pricing_table}}

## Why us
*(2-3 sentences. Specific to their problem, not a generic capabilities pitch.)*

## Next step
{{next_step}}

---
*Validity: 30 days from the date above. Reply to confirm or to push back on scope — both are fine.*
`,
  },

  {
    id: 'prd-feature',
    name: 'PRD — Single Feature',
    tagline: 'Product requirements doc for one feature',
    icon: '🧩',
    kind: 'engineering',
    tags: ['prd', 'product', 'spec'],
    description:
      'Single-feature PRD — problem, user, solution shape, success metric, scope, open questions. Sized for one feature, not a whole product. Update in place as the feature evolves; mark sections "[locked]" once stakeholders sign off.',
    variables: [
      { name: 'feature_name', label: 'Feature name' },
      { name: 'pm_name', label: 'PM / driver' },
      { name: 'eng_lead', label: 'Eng lead' },
      { name: 'design_lead', label: 'Design lead (or "n/a")' },
      { name: 'target_release', label: 'Target release' },
      { name: 'problem', label: 'Problem (user-observable, not internal)' },
      { name: 'user_persona', label: 'Primary user (persona or role)' },
      { name: 'success_metric', label: 'Success metric', hint: 'one number, with current baseline + target' },
      { name: 'in_scope', label: 'In scope (bullet list)' },
      { name: 'out_of_scope', label: 'Out of scope (bullet list)' },
      { name: 'open_questions', label: 'Open questions' },
    ],
    body: `# PRD — {{feature_name}}
**PM:** {{pm_name}} · **Eng:** {{eng_lead}} · **Design:** {{design_lead}}
**Target release:** {{target_release}}

## Problem
{{problem}}

## Who feels it
{{user_persona}}

## Success metric
{{success_metric}}

## Proposed solution
*(One paragraph in plain language. Save the implementation detail for the tech spec.)*

### User flow (happy path)
1.
2.
3.

### Edge cases worth calling out
-

## Scope
**In scope:**
{{in_scope}}

**Out of scope (defer or never):**
{{out_of_scope}}

## Open questions
{{open_questions}}

## Decisions log
*(Append decisions as they happen — keeps context for whoever picks this up later.)*

| Date | Decision | By |
|------|----------|-----|
|      |          |     |

---
*Mark a section "[locked]" in its heading once stakeholders sign off. Locked sections need an explicit unlock before edits.*
`,
  },

  {
    id: 'meeting-minutes',
    name: 'Meeting Minutes',
    tagline: 'Attendees · decisions · action items',
    icon: '🗒️',
    kind: 'ops',
    tags: ['meeting', 'notes', 'actions'],
    description:
      'Post-meeting minutes shape — who was there, what was decided, what action items came out (with owners + due dates). The decision + action sections are the only thing readers actually need; everything else is optional context.',
    variables: [
      { name: 'meeting_title', label: 'Meeting title' },
      { name: 'meeting_date', label: 'Date', hint: 'YYYY-MM-DD' },
      { name: 'attendees', label: 'Attendees' },
      { name: 'absent', label: 'Absent (and why)' },
      { name: 'agenda', label: 'Agenda (bullets)' },
      { name: 'decisions', label: 'Decisions made' },
      { name: 'actions_table', label: 'Action items (markdown table)', hint: 'columns: action · owner · due' },
      { name: 'parking_lot', label: 'Parking lot (deferred)' },
      { name: 'next_meeting', label: 'Next meeting' },
    ],
    body: `# {{meeting_title}}
**Date:** {{meeting_date}}
**Attendees:** {{attendees}}
**Absent:** {{absent}}

## Agenda
{{agenda}}

## Decisions
{{decisions}}

## Action items
{{actions_table}}

## Parking lot
{{parking_lot}}

## Next meeting
{{next_meeting}}

---
*Distribute within 24h. If decisions or actions are wrong, reply-all within 48h — silence = agreement.*
`,
  },
];

/* ── CRUD (user-created templates + overrides on built-ins) ──────────
 *
 * Pattern mirrors staff-management-service.ts:
 *   - listTemplates merges baseline ∪ dynamic, applies overrides,
 *     filters tombstoned built-ins. User-defined templates are
 *     removed from the catalog by deleting from dynamicTemplates.
 *   - createTemplate mints a kebab-case id from name; conflicts get a
 *     short random suffix to stay unique.
 *   - updateTemplate routes to override-map (built-in) or in-place
 *     mutation (user-defined).
 *   - deleteTemplate soft-hides built-ins; removes user-defined.
 *   - Audit log JSON to stdout on every mutation (Engineering Rule #8).
 */

import * as mut from './mutable-store.js';

function kebab(s: string): string {
  return s.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'template';
}

function uniqueId(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  // Append short random suffix until unique. Few iterations needed.
  for (let i = 0; i < 8; i++) {
    const candidate = `${base}-${Math.random().toString(36).slice(2, 6)}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

function applyTemplateOverride(t: TemplateDescriptor, ov: Partial<TemplateDescriptor>): TemplateDescriptor {
  return { ...t, ...ov };
}

export function listTemplates(): TemplateDescriptor[] {
  const deleted = mut.getDeletedTemplateIds();
  const overrides = mut.getTemplateOverrides();
  const fromBaseline = TEMPLATE_CATALOG
    .filter((t) => !deleted.has(t.id))
    .map((t) => {
      const ov = overrides.get(t.id);
      return ov ? applyTemplateOverride(t, ov) : t;
    });
  const fromDynamic = mut.getDynamicTemplates().map((t) => {
    const ov = overrides.get(t.id);
    return ov ? applyTemplateOverride(t, ov) : t;
  });
  return [...fromBaseline, ...fromDynamic];
}

export function getTemplate(id: string): TemplateDescriptor | undefined {
  return listTemplates().find((t) => t.id === id);
}

export interface CreateTemplateInput {
  name: string;
  tagline?: string;
  icon?: string;
  kind: TemplateKind;
  tags?: string[];
  description?: string;
  variables?: { name: string; label: string; hint?: string }[];
  body: string;
  /** Optional explicit id (kebab-case). If omitted, derived from name. */
  id?: string;
}

export function createTemplate(input: CreateTemplateInput): TemplateDescriptor {
  const name = input.name.trim();
  if (!name) throw new Error('name is required');
  if (!input.body || !input.body.trim()) throw new Error('body is required');
  if (!input.kind) throw new Error('kind is required');

  const taken = new Set<string>(listTemplates().map((t) => t.id));
  const baseId = input.id?.trim() ? kebab(input.id) : kebab(name);
  const id = uniqueId(baseId, taken);

  const record: TemplateDescriptor = {
    id,
    name,
    tagline: (input.tagline ?? '').trim() || name,
    icon: input.icon ?? '📄',
    kind: input.kind,
    tags: Array.isArray(input.tags) ? input.tags.filter((s): s is string => typeof s === 'string') : [],
    description: (input.description ?? '').trim(),
    variables: Array.isArray(input.variables) ? input.variables : [],
    body: input.body,
  };
  mut.addDynamicTemplate(record);
  console.log(JSON.stringify({
    audit: 'template.created', id, name, ts: new Date().toISOString(),
  }));
  return record;
}

export function updateTemplate(
  id: string,
  patch: Partial<TemplateDescriptor>,
): TemplateDescriptor | null {
  // Don't allow id, kind changed in unsafe ways
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { id: _ignoredId, ...safePatch } = patch;
  const builtin = TEMPLATE_CATALOG.find((t) => t.id === id);
  if (builtin) {
    if (mut.isTemplateDeleted(id)) return null;
    mut.patchTemplateOverride(id, safePatch);
    console.log(JSON.stringify({
      audit: 'template.updated', id, fields: Object.keys(safePatch), source: 'override',
      ts: new Date().toISOString(),
    }));
    return getTemplate(id) ?? null;
  }
  const dyn = mut.getDynamicTemplate(id);
  if (!dyn) return null;
  // In-place mutation for user-defined entries — simpler than override-map.
  const merged: TemplateDescriptor = { ...dyn, ...safePatch };
  mut.addDynamicTemplate(merged);
  console.log(JSON.stringify({
    audit: 'template.updated', id, fields: Object.keys(safePatch), source: 'dynamic',
    ts: new Date().toISOString(),
  }));
  return merged;
}

export function deleteTemplate(id: string): { ok: boolean; reason?: string } {
  const builtin = TEMPLATE_CATALOG.find((t) => t.id === id);
  if (builtin) {
    if (mut.isTemplateDeleted(id)) return { ok: false, reason: 'not_found' };
    mut.markTemplateDeleted(id);
    console.log(JSON.stringify({
      audit: 'template.deleted', id, kind: 'builtin-tombstone',
      ts: new Date().toISOString(),
    }));
    return { ok: true };
  }
  const removed = mut.removeDynamicTemplate(id);
  if (!removed) return { ok: false, reason: 'not_found' };
  console.log(JSON.stringify({
    audit: 'template.deleted', id, kind: 'user-defined',
    ts: new Date().toISOString(),
  }));
  return { ok: true };
}

/** Is the descriptor a built-in (read-only-deletable) catalog entry?
 *  Used by the UI to decide whether to show a delete affordance. */
export function isBuiltInTemplate(id: string): boolean {
  return TEMPLATE_CATALOG.some((t) => t.id === id);
}

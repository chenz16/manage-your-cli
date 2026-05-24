/**
 * Owner skill catalog — the built-in capabilities the owner wields
 * through the Desk AI. NOT "staff" (those are personas with their own
 * jobs / deliverables / context). NOT "agents" (those are async workers
 * that need a brief). These are tactical capabilities the Desk AI calls
 * inline using the current chat context.
 *
 * Per user 2026-05-17:
 *   "skill是不是更好？这样能跟主进程共享上下文"
 *   "那你就不是员工把 就是老板的技能池的形式"
 *
 * V1 scope: this file is the descriptor catalog (what skills exist,
 * how to invoke, what they produce). The actual CLI tool
 * implementations are stubs in `the CLI-backed runtime`
 * and land in a follow-up phase. The UI surfaces the catalog so the
 * owner can see what's available and prefill the composer with an
 * example invocation.
 */

/* Skill taxonomy — picked to grow without re-bucketing existing entries.
 * Each kind maps to a real job-to-be-done category, not a tech category
 * (so PPT and Excel both land in "office" regardless of whether the
 * impl uses python-pptx or pandas).
 *
 * Future additions slot in cleanly:
 *   office:        Word docs, diagrams, image edits
 *   engineering:   code review, deploy, CI triage, db migration
 *   communication: drafts, meeting notes, status updates, translations
 *   research:      web search, paper digest, comparison tables, market scan
 *   ops:           file moves, backups, batch renames, OS automations
 *
 * Add new kinds only when 2+ skills would land there; otherwise tag onto
 * an existing kind via `tags`. */
export type SkillKind = 'office' | 'media' | 'engineering' | 'communication' | 'research' | 'ops';

export interface SkillDescriptor {
  /** Stable kebab-case id — also the CLI tool name. */
  id: string;
  /** Owner-facing name (short — 1-3 words). */
  name: string;
  /** Single line: what the skill does, owner-facing. */
  tagline: string;
  /** Glyph for the card (emoji or single char). */
  icon: string;
  /** Category for grouping in the UI. */
  kind: SkillKind;
  /** Fine-grained tags within a kind (for chip filters / search later).
   *  E.g. office skills tag as ['slides'] / ['spreadsheet'] / ['pdf']
   *  so a future office-section sub-filter is trivial. */
  tags: string[];
  /** Longer description — when to reach for it, what it produces. */
  description: string;
  /** Example chat invocations the user can click to prefill the composer. */
  examples: string[];
  /** Other skill ids this skill INVOKES during execution. Execution
   *  flow / chained calls (decompose_task → ambiguity_probe). UI
   *  renders these as "Calls:" chips with a verb-arrow style. Omit /
   *  empty for leaf skills.
   *
   *  Renamed from `references` 2026-05-17 per user — semantics split
   *  from `consults` (which points at passive Reference docs). */
  calls?: string[];
  /** Reference ids this skill CONSULTS while running (output-format
   *  refs that shape the deliverable, input-content refs the skill
   *  cites). UI renders these as "Consults:" chips with a book icon.
   *  Ids resolve against `listReferences()` (which unifies the
   *  reference catalog + projected templates). */
  consults?: string[];
  /** True if the underlying CLI tool exists and is wired.
   *  V1 = false for all (UI-first scaffold); flips true as we ship
   *  the tools in follow-up work. */
  implemented: boolean;
}

export const SKILL_CATALOG: SkillDescriptor[] = [
  {
    id: 'make_slides',
    name: 'Slides / PPT',
    tagline: 'Outline + python-pptx → .pptx file',
    icon: '🎞️',
    kind: 'office',
    tags: ['slides', 'pptx'],
    description:
      'Produces slide decks from a topic, an outline, or source material. Default 16:9, clean type. Returns the outline first for quick review, then the .pptx file when you confirm.',
    examples: [
      '做一个 10 页的 PPT 介绍 NVIDIA E2E AV 战略',
      'Turn this research summary into a 5-slide exec deck',
    ],
    implemented: true,
  },
  {
    id: 'make_spreadsheet',
    name: 'Spreadsheet / Excel',
    tagline: 'pandas / openpyxl → .xlsx file',
    icon: '📊',
    kind: 'office',
    tags: ['spreadsheet', 'xlsx', 'data'],
    description:
      'Reads, transforms, and emits .xlsx files via pandas + openpyxl. For analyses, returns the script plus a prose summary of what changed. Never silently drops rows — reports any filtering.',
    examples: [
      '把这个 CSV 按月份分组，每月一个 sheet',
      'Pivot last quarter\'s sales by region into an Excel report',
    ],
    implemented: true,
  },
  {
    id: 'make_pdf',
    name: 'PDF / Print Layout',
    tagline: 'pandoc / weasyprint → .pdf file',
    icon: '📄',
    kind: 'office',
    tags: ['pdf', 'print'],
    description:
      'Turns markdown or HTML content into print-ready PDFs. Tool order: pandoc → weasyprint → reportlab. Default A4, 25mm margins, serif body. Includes a footer with doc title + timestamp.',
    examples: [
      '把这份 markdown 报告打成 PDF',
      'Render the meeting notes as a 1-page handout PDF',
    ],
    implemented: true,
  },
  {
    id: 'make_chart',
    name: 'Data Viz',
    tagline: 'matplotlib / plotly → image or HTML',
    icon: '📈',
    kind: 'office',
    tags: ['chart', 'viz', 'data'],
    description:
      'Picks the chart type from the data shape (time series→line, categorical→bar, distribution→histogram, relationship→scatter). matplotlib for static PNG, plotly for interactive HTML. Always labels axes + units.',
    examples: [
      '用这些数据画一张趋势图',
      'Plot weekly active users from this CSV',
    ],
    implemented: false,
  },
  {
    id: 'web_build',
    name: 'Web Build',
    tagline: 'pnpm / vite / next build + lint + typecheck',
    icon: '🛠️',
    kind: 'engineering',
    tags: ['build', 'ci'],
    description:
      'Handles web build + deploy tasks: install, build, lint, typecheck, test, static-site generation. Always runs typecheck before declaring a build green. Reports duration, bundle size, and warnings worth surfacing.',
    examples: [
      '帮我跑一遍 web 的 typecheck + build',
      'Build the docs site and report bundle size',
    ],
    consults: ['pep-8'],
    implemented: false,
  },
  {
    id: 'summarize_inbox',
    name: 'Inbox Summary',
    tagline: 'Triage email threads → action items',
    icon: '📬',
    kind: 'communication',
    tags: ['email', 'summary', 'triage'],
    description:
      'Summarizes email threads, inbox dumps, or message logs. Format: (1) top-of-mind one-liner; (2) action items with who-asked-what + suggested response stance; (3) FYI items needing no action. Skips automated notifications.',
    examples: [
      '把昨天这些邮件总结一下，告诉我哪些必须回',
      'Summarize this thread — what are my action items?',
    ],
    // iter-011 Pass #3 (2026-05-18): flipped from false → true.
    // Wired via gmail_summarize_inbox in the CLI-backed runtime
    // tools.py — composes gmail_list_threads + gmail_read_thread + the configured CLI.
    // Owner must connect Gmail at /me → Authorizations first.
    implemented: true,
  },
  {
    id: 'format_deliverable',
    name: 'Delivery Format',
    tagline: 'Raw worker output → polished, structured report',
    icon: '✨',
    kind: 'office',
    tags: ['format', 'polish', 'report'],
    description:
      'Takes raw / unstructured worker output and reshapes it into a delivery-ready format: clear title, executive summary, sectioned body with headers, action items, source list, clickable links for any file paths. Can chain to make_pdf / make_slides / make_spreadsheet when the owner wants a specific output format.',
    examples: [
      '把这份调查结果格式化成正式报告',
      'Format this raw research dump into an exec-ready brief',
    ],
    calls: ['make_pdf', 'make_slides', 'make_spreadsheet'],
    consults: ['weekly-status-update', 'investor-update-monthly', 'prd-feature'],
    implemented: true,
  },
  {
    /* Per user 2026-05-18T18:18Z: "这个交付 其实是个dashboard dashboard要总结
     * 需求一句话总结 结果bullet point". Refined from the original 4-section
     * format (status / facts / next-steps / Open Q) to a strict 2-section
     * dashboard: 需求 (one-sentence Request) + 结果 (Result bullets).
     * Status / process / Open Q dropped — the owner reads the deliverable
     * like a dashboard line, not a report. Any agent (especially the Desk
     * AI acting as 邮件小秘) calls this when handing a deliverable back to
     * the desk owner. Process narration / intermediate findings stay in
     * the agent's private session log — MUST NOT appear in this output.
     * Companion to format_deliverable (which is for long structured
     * reports); this one is the dashboard line. */
    id: 'summarize_email_brief',
    name: 'Email Brief Summary (CEO 交付物)',
    tagline: 'Dashboard 交付物 — 需求一句话 + 结果 bullets，无过程叙事',
    icon: '✉️',
    kind: 'communication',
    tags: ['summary', 'ceo', 'email', 'deliverable', 'dashboard'],
    description:
      'Dashboard 交付物 — 需求一句话 + 结果 bullets，无过程叙事。Output contract (strictly 2 sections):\n' +
      '\n' +
      '需求 (Request): one-sentence summary of what was asked.\n' +
      '结果 (Result):  bullet points × N, each ≤15 words; concrete facts/numbers/dates/actions; no narrative.\n' +
      '\n' +
      'NO status line, NO "Background" / "Context" / "What I did" / "Next steps" / "Open Q" sections — that\'s process; it belongs in the agent\'s private session, not the deliverable. Match the owner\'s language (Chinese → Chinese, English → English). Owner\'s time is the bottleneck; brevity over completeness.',
    examples: [
      '把这次合同跟进的结果用 dashboard 格式总结给我（需求一句 + 结果 bullets）',
      'Summarize the vendor reply as a 2-section dashboard — 需求 one sentence + 结果 bullets',
    ],
    implemented: true,
  },

  /* ── Help skill (owner directive 2026-05-19T21:35Z — "帮我写个 help
   * 的 skill, 用户问问题的时候 使用这个 调用这个 skill, 可以引用一些写
   * 好的文档") ─────────────────────────────────────────────────────────
   *
   * Documentation-retrieval skill. When the owner asks a META question
   * about Holon itself (how-do-I / what-is / where-do-I-find), the Desk
   * AI invokes this skill; the skill consults the three help-reference
   * docs (ref-holon-basics / ref-holon-faq / ref-holon-chat-tips) and
   * answers from them, citing the reference name.
   *
   * Wiring posture (V1):
   *   `consults`: descriptor array — reference ids the CLI may retrieve.
   *   PULL path (CLI-invoked consult_reference tool): SHIPPED at
   *     331d10e / TD-014 RESOLVED. The CLI runtime registers
   *     consult_reference(reference_id) → GET /api/v1/references/<id>
   *     → returns markdown summary as tool result. The CLI invokes this
   *     tool itself when the user asks a META question.
   *   PUSH path (auto-inject consults summary into CLI context hook):
   *     NOT implemented — the CLI context hook today only injects the
   *     workspace snapshot (inject_workspace_snapshot). Auto-quoting
   *     consults references without a tool-call round-trip is
   *     tracked in TD-015 (filed 2026-05-19, deferred to V1.1+). */
  {
    id: 'help',
    name: 'Help',
    tagline: 'Answer "how do I X in Holon" / "what is Y" / "where is Z" from the help docs',
    icon: '🆘',
    kind: 'communication',
    tags: ['help', 'docs', 'meta', 'rag', 'self-service'],
    description:
      'When the owner asks a META question about Holon usage itself (how-to / what-is / where-to-find / why-is), consult the help reference library and answer from it. Cite the reference name in the reply ("per Holon FAQ → …") so the owner can jump to the source on /references. NOT for domain work (delegate that to staff or other skills) — only for questions about Holon\'s own surface area.\n\nReferences consulted (in priority order): ref-holon-basics (concepts: desk / staff / chat / mission / deliverable), ref-holon-faq (first-week common questions: hire, language, CLI, Gmail, slow chat), ref-holon-chat-tips (cancel / queue / @-mention / Esc shortcut).\n\nIf the question is not covered by the references, say so plainly + suggest /references "+ New" to add a new help doc rather than guessing.',
    examples: [
      'how do I hire a new staff member?',
      '怎么切换 UI 语言?',
      'what does Drops mean?',
      'how do I cancel a chat reply mid-generation?',
      '怎么连 Gmail 的?',
    ],
    consults: ['ref-holon-basics', 'ref-holon-faq', 'ref-holon-chat-tips'],
    implemented: true,
  },

  /* ── Adopted from CLI-era tool catalog ──────────────────────────────
   * 2026-05-17: user asked to pull in the CLI runtime's built-in capabilities.
   * Each lands here as a UI scaffold; the wiring to the actual CLI runtime
   * tool (e.g. image_generation_tool, browser_tool, code_execution_tool,
   * feishu_doc_tool, kanban_tools, etc.) happens when implemented
   * flips to true. */

  {
    id: 'generate_image',
    name: 'Image Generation',
    tagline: 'Text-to-image via SDXL / Imagen / DALL-E',
    icon: '🎨',
    kind: 'media',
    tags: ['image', 'gen', 'creative'],
    description:
      'Generates images from a prompt. Pick aspect ratio, style, and quantity. Returns a .png file (or several). Wires to CLI runtime\'s image_generation_tool — provider configured per the worker dispatcher\'s env. Use for slide illustrations, social posts, mockups, or "show me what X could look like" sketches.',
    examples: [
      '画一张办公场景的插画，扁平风格，1024x768',
      'Generate a hero image for a homepage about hybrid AI teams',
    ],
    implemented: false,
  },
  {
    id: 'generate_video',
    name: 'Video Generation',
    tagline: 'Text-to-video / image-to-video clips',
    icon: '🎬',
    kind: 'media',
    tags: ['video', 'gen', 'creative'],
    description:
      'Generates short video clips (typically 5-15s) from a text prompt or seed image. Slow + token-expensive — use sparingly. Returns a .mp4 file. Wires to CLI runtime\'s video generation tool stack.',
    examples: [
      '做一个 5 秒的产品演示动效',
      'Animate this static slide into a 10s teaser',
    ],
    implemented: false,
  },
  {
    id: 'browse_web',
    name: 'Browse Web',
    tagline: 'Headless browser → page content / screenshots',
    icon: '🌐',
    kind: 'research',
    tags: ['browser', 'scrape', 'fetch'],
    description:
      'Opens a URL in a headless Chromium, returns rendered text + DOM-extracted structured data, and can take screenshots. Use for: reading articles behind JS-heavy pages, scraping a single page, capturing a screenshot for a report. Backed by CLI runtime\'s browser_tool / browser_cdp_tool.',
    examples: [
      '把这个网页的主要内容提取出来',
      'Screenshot https://example.com and pull the headline + author',
    ],
    implemented: false,
  },
  {
    id: 'run_code',
    name: 'Run Code',
    tagline: 'Sandboxed Python / shell execution',
    icon: '🐍',
    kind: 'engineering',
    tags: ['python', 'code', 'sandbox'],
    description:
      'Executes Python (and small shell snippets) in a sandbox. Use for quick calculations, file transformations, one-off scripts, or testing snippets before pasting them somewhere. Backed by CLI runtime\'s code_execution_tool. The Desk AI picks this when a question is faster to compute than to derive.',
    examples: [
      '帮我算下这个 csv 里每列的均值和方差',
      'Run a quick Python snippet to validate this regex against 20 strings',
    ],
    implemented: false,
  },
  {
    id: 'feishu_doc',
    name: 'Feishu Docs',
    tagline: 'Read / write Feishu (Lark) docs + sheets',
    icon: '📕',
    kind: 'communication',
    tags: ['feishu', 'lark', 'doc'],
    description:
      'Reads and writes Feishu documents, spreadsheets, and Drive files. Use for: pulling meeting notes, syncing reports into a shared workspace, or posting deliverables to the team\'s Feishu workspace. Wires to CLI runtime\'s feishu_doc_tool / feishu_drive_tool — needs auth.',
    examples: [
      '把今天的工作日志同步到 Feishu',
      'Pull yesterday\'s meeting notes from the Feishu team folder',
    ],
    implemented: false,
  },
  {
    id: 'google_meet',
    name: 'Google Meet',
    tagline: 'Join / transcribe / summarize Meet calls',
    icon: '📞',
    kind: 'communication',
    tags: ['google', 'meet', 'transcript'],
    description:
      'Joins a Google Meet (as the owner or observer), captures the transcript, then produces a structured summary + action items. Use for: catching up on a call you missed, or having a written record of one you attended. Backed by CLI runtime\'s google_meet plugin — needs OAuth.',
    examples: [
      '帮我录这个会议并生成纪要',
      'Summarize the action items from this morning\'s standup',
    ],
    implemented: false,
  },
  {
    id: 'kanban',
    name: 'Kanban Board',
    tagline: 'Create / move cards on a project board',
    icon: '🗂️',
    kind: 'ops',
    tags: ['kanban', 'project', 'task'],
    description:
      'Creates cards, moves them across columns, and queries the board state. Use as a lightweight task tracker — the owner\'s personal next-actions board, separate from the Holon mission inbox (which is cross-desk handoffs). Backed by CLI runtime\'s kanban_tools.',
    examples: [
      '把今天没完成的事 move 到 tomorrow 那一列',
      'Create a card "Review iter-009 plan" in the Inbox column',
    ],
    implemented: false,
  },
  /* ── Meta-skill: task decomposition (plan-and-execute) ──────────── */
  {
    id: 'decompose_task',
    name: 'Decompose Task',
    tagline: 'Complex ask → ordered subtasks → routing per step',
    icon: '🪓',
    kind: 'ops',
    tags: ['plan', 'decompose', 'meta', 'judgement'],
    description:
      'Take a complex owner request and produce an executable plan. Output: an ordered list of subtasks, each with (1) a sharp single-sentence goal, (2) inputs / preconditions, (3) the staff or skill that should handle it, (4) expected deliverable shape, (5) any explicit dependencies on earlier steps. Pattern is Plan-and-Execute (surfaces the plan first for owner approval / tweak, then executes step-by-step; can re-plan on failure or new info).\n\nSkill resolution order for each subtask (per owner directive): (1) first search the local skill catalog for an existing skill that fits — prefer reuse over invention; (2) if a near-fit exists, adapt the call (different examples / different inputs) rather than inventing a new skill; (3) only escalate to research-class skills (browse_web, run_code with web fetches, external API skills) when the local catalog truly has no answer — these are slower + more expensive. Use ambiguity_probe first if the goal itself is under-specified — decomposition assumes the goal is clear.\n\nReferences: LangChain Plan-and-Execute, HTN planning, ReAct, Reflexion.',
    examples: [
      '调研 NVIDIA E2E AV 战略，写成给老板的 5 页 PPT — 先帮我列出步骤再开干',
      'Plan the migration from the configured CLI to Claude 4 across our worker dispatcher',
    ],
    calls: ['ambiguity_probe', 'browse_web', 'run_code', 'format_deliverable'],
    implemented: true,
  },

  /* ── Meta-skill: ambiguity probe ────────────────────────────────── */
  {
    id: 'ambiguity_probe',
    name: 'Ambiguity Probe',
    tagline: 'Detect under-specified asks → ask on the right axes',
    icon: '❓',
    kind: 'ops',
    tags: ['clarify', 'meta', 'judgement'],
    description:
      'When the owner\'s request leaves room for materially different outputs, the Desk AI invokes this skill BEFORE doing the work. It scans the request against fixed axes — Scope (what\'s in/out), Audience (who reads/uses it), Format (file type / length / structure), Deadline (when), Source (what input material), Constraints (budget / style / tone), Authority (who confirms before ship), Reference (any existing version to mimic) — and surfaces only the axes that are actually under-specified, with a concrete question per axis. Skip axes the request already pins down. Goal: one round of 1-3 sharp questions, not a checklist interrogation.',
    examples: [
      '我想做个市场调查报告 — 帮我先理清楚要问的几个问题',
      'Before you build the slides, what do you need me to disambiguate?',
    ],
    implemented: true,
  },

  /* ── Meta-skills: agent CRUD ────────────────────────────────────── */
  {
    id: 'create_agent',
    name: 'Create Agent',
    tagline: 'Spin up a new staff member with all fields configured',
    icon: '🧑‍💼',
    kind: 'ops',
    tags: ['team', 'hire', 'meta'],
    description:
      'Take a sketched role description from the owner and produce a complete new staff record — name, role_label, system_prompt, max_concurrent_jobs, denied_skills (deny-list against the CEO catalog), monthly_budget_millicents, proxy_staff_id. Persists via the existing create_staff CLI runtime tool. Use this when the owner says "hire me a market researcher" or "make a teammate who handles refunds".',
    examples: [
      '帮我招一个负责整理周报的员工，每月预算 100 元',
      'Spin up a junior research analyst for AV market scans, no Discord access',
    ],
    calls: ['ambiguity_probe'],
    implemented: false,
  },
  {
    id: 'update_agent',
    name: 'Update Agent',
    tagline: 'Edit an existing staff member\'s config',
    icon: '✏️',
    kind: 'ops',
    tags: ['team', 'edit', 'meta'],
    description:
      'Update one or more fields on an existing staff member: name, role_label, system_prompt, denied_skills, monthly_budget_millicents, proxy_staff_id, max_concurrent_jobs. The owner usually invokes this in plain language ("give Aria a bigger budget", "stop letting Drafter use Slack"); the skill resolves the staff and patches just the named fields.',
    examples: [
      '把 Aria 的月预算调到 200 元',
      'Stop Drafter from using Discord and Slack',
    ],
    implemented: false,
  },
  {
    id: 'dismiss_agent',
    name: 'Dismiss Agent',
    tagline: 'Fire / archive a staff member',
    icon: '🚪',
    kind: 'ops',
    tags: ['team', 'fire', 'meta'],
    description:
      'Dismiss (fire) a staff member. The record is archived — history of their deliverables stays, but they no longer appear in the active roster and any in-flight jobs are cancelled. CLI / peer / owner-assistant substrates are protected; only local_ai staff can be dismissed.',
    examples: [
      '把 Drafter 解雇了',
      'Dismiss the spreadsheet analyst — we\'re not using them anymore',
    ],
    implemented: false,
  },

  /* ── Meta-skills: skill catalog CRUD ────────────────────────────── */
  {
    id: 'create_skill',
    name: 'Create Skill',
    tagline: 'Define a new custom skill the team can invoke',
    icon: '✨',
    kind: 'ops',
    tags: ['skills', 'meta'],
    description:
      'Define a new skill the owner + every staff (subject to deny-list) can call. The owner describes what the skill does + when to use it + the example invocation; this skill produces a SkillDescriptor (id, name, tagline, kind, tags, description, examples) and a runnable body (prompt template + tool calls). Lands in the user-defined skills store, surfaced on /skills next to the built-ins.',
    examples: [
      '加一个 skill：每周一早上把上周的 deliverables 总结成周报',
      'Make a skill that turns any meeting transcript into a sub-1-page brief',
    ],
    calls: ['ambiguity_probe'],
    implemented: false,
  },
  {
    id: 'update_skill',
    name: 'Update Skill',
    tagline: 'Tweak an existing skill\'s description / examples / body',
    icon: '🔧',
    kind: 'ops',
    tags: ['skills', 'meta'],
    description:
      'Edit a user-defined skill in place. The owner can rephrase the tagline / description to nudge when the Desk AI picks it, add or remove examples, or tighten the runnable body. Built-in skills (anything shipped in SKILL_CATALOG) are read-only — fork them via create_skill if you want a variant.',
    examples: [
      '把 weekly-brief skill 的格式改成纯 markdown 不要表格',
      'Add a "monthly cadence" example to the inbox-summary skill',
    ],
    implemented: false,
  },
  /* ── Meta-skills: template CRUD (mirrors skill CRUD) ───────────── */
  {
    id: 'create_template',
    name: 'Create Template',
    tagline: 'Add a new fillable content shell (output-format ref)',
    icon: '🧩',
    kind: 'ops',
    tags: ['templates', 'meta', 'create'],
    description:
      'Create a new template (output-format reference). Direct flow: paste an existing markdown body and tag the {{placeholder}} variables. Lands in the user-defined templates store; surfaced on /references under kind=output-format.',
    examples: [
      '加一个 template：客户线索跟进的 Slack 推送格式',
      'Make a template for our weekly all-hands update',
    ],
    calls: ['ambiguity_probe'],
    implemented: false,
  },
  {
    id: 'update_template',
    name: 'Update Template',
    tagline: 'Tweak an existing template',
    icon: '📝',
    kind: 'ops',
    tags: ['templates', 'meta', 'edit'],
    description:
      'Edit a user-defined template in place — body, variables, tagline, examples. Built-in templates (anything shipped in template-catalog.ts) are read-only; fork via create_template if you want a variant.',
    examples: [
      '把 weekly-status template 里加一个 risks 段',
      'Rename the {{client_name}} placeholder to {{customer_name}} in the offer letter',
    ],
    implemented: false,
  },
  {
    id: 'delete_template',
    name: 'Delete Template',
    tagline: 'Remove a user-defined template',
    icon: '🗑️',
    kind: 'ops',
    tags: ['templates', 'meta', 'delete'],
    description:
      'Remove a user-defined template from the catalog. Built-in templates can\'t be deleted. Skills that consult the deleted id will get a "missing reference" chip in the UI.',
    examples: [
      '删除那个 internal-rfc template 没人用了',
    ],
    implemented: false,
  },

  /* ── Meta-skills: reference CRUD (per user 2026-05-17 "弄个创建
   * reference 的 skill") ─────────────────────────────────────────── */
  {
    id: 'extract_references',
    name: 'Extract References',
    tagline: 'Scan a folder → auto-create one reference per file',
    icon: '🗂️',
    kind: 'ops',
    tags: ['references', 'meta', 'ingest', 'create'],
    description:
      'Point this skill at a local folder; it enumerates files, reads each one, and produces a ReferenceDescriptor for each (auto-inferring name, kind, summary, authority from the content). Use when the owner has an existing internal docs/specs folder (`/home/.../docs/` or similar) and wants the whole library indexed as references without writing each one by hand. Each generated reference gets source_type=file with local_path pointing at the original. Companion to create_reference (one-at-a-time, more controlled). The owner reviews + accepts each generated entry before it lands in the catalog (no silent ingest).',
    examples: [
      '把 /home/me/work/specs/ 整个目录扫一遍 加成 reference',
      'Walk through ~/Documents/standards/ and propose reference entries for each PDF',
    ],
    calls: ['create_reference'],
    implemented: false,
  },
  {
    id: 'create_reference',
    name: 'Create Reference',
    tagline: 'Add a new external standard / spec / regulation',
    icon: '📚',
    kind: 'ops',
    tags: ['references', 'meta', 'create'],
    description:
      'Create a new reference entry directly by filling descriptor fields: URL or local path, name, authority, version, summary, tags, and key sections. Lands in the user-defined references store; surfaced on /references under the matching kind.',
    examples: [
      '加一个 reference：HIPAA — 我会主要拿来 audit 医疗数据流',
      'Add WCAG 2.1 as a reference — we still ship to clients on that baseline',
    ],
    calls: ['ambiguity_probe', 'browse_web'],
    implemented: false,
  },
  {
    id: 'update_reference',
    name: 'Update Reference',
    tagline: 'Tweak an existing reference\'s summary / version / sections',
    icon: '✏️',
    kind: 'ops',
    tags: ['references', 'meta', 'edit'],
    description:
      'Edit a user-defined reference — summary, version, key sections, tags. Useful when a standard issues a new version (e.g. ISO 27001:2022 → 2027) and you want to update one entry rather than create a new one. Built-in references are read-only; fork via create_reference for a variant.',
    examples: [
      '把 GDPR 那个 reference 加上 Schrems II 决议的备注',
      'Bump our WCAG entry from 2.1 to 2.2 and refresh the key sections',
    ],
    implemented: false,
  },
  {
    id: 'delete_reference',
    name: 'Delete Reference',
    tagline: 'Remove a user-defined reference',
    icon: '🗑️',
    kind: 'ops',
    tags: ['references', 'meta', 'delete'],
    description:
      'Remove a user-defined reference from the catalog. Built-in references can\'t be deleted (the standards body still exists — just untag the skills that cite it). Skills that consult the deleted id will get a "missing reference" chip in the UI.',
    examples: [
      '删除那个 internal-style-guide reference — 已经不维护了',
    ],
    implemented: false,
  },

  {
    id: 'delete_skill',
    name: 'Delete Skill',
    tagline: 'Remove a user-defined skill from the catalog',
    icon: '🗑️',
    kind: 'ops',
    tags: ['skills', 'meta'],
    description:
      'Remove a user-defined skill from the catalog. Built-in skills can\'t be deleted — only disabled at the CEO level (and even that\'s a future feature). When you delete a skill, the Desk AI stops surfacing it and every staff loses access regardless of their deny-list.',
    examples: [
      '把 weekly-brief skill 删了 没用了',
      'Delete the "twitter-post" skill — we\'re not on Twitter anymore',
    ],
    implemented: false,
  },
  {
    id: 'discord_post',
    name: 'Discord',
    tagline: 'Post messages / read channel history',
    icon: '💬',
    kind: 'communication',
    tags: ['discord', 'chat', 'community'],
    description:
      'Posts a message to a Discord channel, reads recent channel history, or pings a user. Use for: cross-posting deliverables to a community, dropping status updates into a working channel, or catching up on missed conversation. Backed by CLI runtime\'s discord_tool — needs a bot token.',
    examples: [
      '把这份报告 post 到 #weekly-updates',
      'Show me the last 20 messages in #design',
    ],
    implemented: false,
  },
];

/* ── CRUD (user-created skills + overrides on built-ins) ──────────────
 *
 * Pattern mirrors template-catalog.ts / reference-catalog.ts:
 *   - listSkills merges baseline ∪ dynamic, applies overrides,
 *     filters tombstoned built-ins. User-defined skills are
 *     removed from the catalog by deleting from dynamicSkills.
 *   - createSkill mints a kebab-case id from name; conflicts get a
 *     short random suffix to stay unique. Newly created skills default
 *     to implemented:false (the CLI runtime wiring lands later).
 *   - updateSkill routes to override-map (built-in) or in-place
 *     mutation (user-defined).
 *   - deleteSkill soft-hides built-ins; removes user-defined.
 *   - Audit log JSON to stdout on every mutation (Engineering Rule #8).
 */

import * as mut from './mutable-store.js';

function kebab(s: string): string {
  return s.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'skill';
}

function uniqueId(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let i = 0; i < 8; i++) {
    const candidate = `${base}-${Math.random().toString(36).slice(2, 6)}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

function applySkillOverride(s: SkillDescriptor, ov: Partial<SkillDescriptor>): SkillDescriptor {
  return { ...s, ...ov };
}

const SKILL_ICON_DEFAULT: Record<SkillKind, string> = {
  office: '📄',
  media: '🎨',
  engineering: '🛠️',
  communication: '💬',
  research: '🔎',
  ops: '⚙️',
};

export function listSkills(): SkillDescriptor[] {
  const deleted = mut.getDeletedSkillIds();
  const overrides = mut.getSkillOverrides();
  const fromBaseline = SKILL_CATALOG
    .filter((s) => !deleted.has(s.id))
    .map((s) => {
      const ov = overrides.get(s.id);
      return ov ? applySkillOverride(s, ov) : s;
    });
  const fromDynamic = mut.getDynamicSkills().map((s) => {
    const ov = overrides.get(s.id);
    return ov ? applySkillOverride(s, ov) : s;
  });
  return [...fromBaseline, ...fromDynamic];
}

export function getSkill(id: string): SkillDescriptor | undefined {
  return listSkills().find((s) => s.id === id);
}

export interface CreateSkillInput {
  name: string;
  tagline?: string;
  icon?: string;
  kind: SkillKind;
  tags?: string[];
  description: string;
  examples?: string[];
  calls?: string[];
  consults?: string[];
  /** Optional explicit id (kebab-case). If omitted, derived from name. */
  id?: string;
}

export function createSkill(input: CreateSkillInput): SkillDescriptor {
  const name = input.name.trim();
  if (!name) throw new Error('name is required');
  if (!input.kind) throw new Error('kind is required');
  if (!input.description || !input.description.trim()) throw new Error('description is required');

  const taken = new Set<string>([
    ...SKILL_CATALOG.map((s) => s.id),
    ...mut.getDynamicSkills().map((s) => s.id),
  ]);
  const baseId = input.id?.trim() ? kebab(input.id) : kebab(name);
  const id = uniqueId(baseId, taken);

  const record: SkillDescriptor = {
    id,
    name,
    tagline: (input.tagline ?? '').trim() || name,
    icon: input.icon ?? SKILL_ICON_DEFAULT[input.kind] ?? '✨',
    kind: input.kind,
    tags: Array.isArray(input.tags) ? input.tags.filter((s): s is string => typeof s === 'string') : [],
    description: input.description.trim(),
    examples: Array.isArray(input.examples) ? input.examples.filter((s): s is string => typeof s === 'string') : [],
    ...(Array.isArray(input.calls) && input.calls.length > 0
      ? { calls: input.calls.filter((s): s is string => typeof s === 'string') }
      : {}),
    ...(Array.isArray(input.consults) && input.consults.length > 0
      ? { consults: input.consults.filter((s): s is string => typeof s === 'string') }
      : {}),
    // New skills default to scaffold — the CLI runtime wiring hasn't
    // happened yet, by definition (only built-ins flip true).
    implemented: false,
  };
  mut.addDynamicSkill(record);
  console.log(JSON.stringify({
    audit: 'skill.created', id, name, ts: new Date().toISOString(),
  }));
  return record;
}

export function updateSkill(
  id: string,
  patch: Partial<SkillDescriptor>,
): SkillDescriptor | null {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { id: _ignoredId, ...safePatch } = patch;
  const builtin = SKILL_CATALOG.find((s) => s.id === id);
  if (builtin) {
    if (mut.isSkillDeleted(id)) return null;
    mut.patchSkillOverride(id, safePatch);
    console.log(JSON.stringify({
      audit: 'skill.updated', id, fields: Object.keys(safePatch), source: 'override',
      ts: new Date().toISOString(),
    }));
    return getSkill(id) ?? null;
  }
  const dyn = mut.getDynamicSkill(id);
  if (!dyn) return null;
  const merged: SkillDescriptor = { ...dyn, ...safePatch };
  mut.addDynamicSkill(merged);
  console.log(JSON.stringify({
    audit: 'skill.updated', id, fields: Object.keys(safePatch), source: 'dynamic',
    ts: new Date().toISOString(),
  }));
  return merged;
}

export function deleteSkill(id: string): { ok: boolean; reason?: string } {
  const builtin = SKILL_CATALOG.find((s) => s.id === id);
  if (builtin) {
    if (mut.isSkillDeleted(id)) return { ok: false, reason: 'not_found' };
    mut.markSkillDeleted(id);
    console.log(JSON.stringify({
      audit: 'skill.deleted', id, kind: 'builtin-tombstone',
      ts: new Date().toISOString(),
    }));
    return { ok: true };
  }
  const removed = mut.removeDynamicSkill(id);
  if (!removed) return { ok: false, reason: 'not_found' };
  console.log(JSON.stringify({
    audit: 'skill.deleted', id, kind: 'user-defined',
    ts: new Date().toISOString(),
  }));
  return { ok: true };
}

/** Is the descriptor a built-in (read-only-deletable) catalog entry?
 *  Used by the UI to decide whether to show a delete affordance. */
export function isBuiltInSkill(id: string): boolean {
  return SKILL_CATALOG.some((s) => s.id === id);
}

/**
 * Owner skill catalog Ã¢â‚¬â€ the built-in capabilities the owner wields
 * through the Desk AI. NOT "staff" (those are personas with their own
 * jobs / deliverables / context). NOT "agents" (those are async workers
 * that need a brief). These are tactical capabilities the Desk AI calls
 * inline using the current chat context.
 *
 * Per user 2026-05-17:
 *   "skillÃ¦ËœÂ¯Ã¤Â¸ÂÃ¦ËœÂ¯Ã¦â€ºÂ´Ã¥Â¥Â½Ã¯Â¼Å¸Ã¨Â¿â„¢Ã¦Â Â·Ã¨Æ’Â½Ã¨Â·Å¸Ã¤Â¸Â»Ã¨Â¿â€ºÃ§Â¨â€¹Ã¥â€¦Â±Ã¤ÂºÂ«Ã¤Â¸Å Ã¤Â¸â€¹Ã¦â€“â€¡"
 *   "Ã©â€šÂ£Ã¤Â½Â Ã¥Â°Â±Ã¤Â¸ÂÃ¦ËœÂ¯Ã¥â€˜ËœÃ¥Â·Â¥Ã¦Å Å  Ã¥Â°Â±Ã¦ËœÂ¯Ã¨â‚¬ÂÃ¦ÂÂ¿Ã§Å¡â€žÃ¦Å â‚¬Ã¨Æ’Â½Ã¦Â±Â Ã§Å¡â€žÃ¥Â½Â¢Ã¥Â¼Â"
 *
 * V1 scope: this file is the descriptor catalog (what skills exist,
 * how to invoke, what they produce). The actual CLI tool
 * implementations are stubs in `the CLI-backed runtime`
 * and land in a follow-up phase. The UI surfaces the catalog so the
 * owner can see what's available and prefill the composer with an
 * example invocation.
 */

/* Skill taxonomy Ã¢â‚¬â€ picked to grow without re-bucketing existing entries.
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
  /** Stable kebab-case id Ã¢â‚¬â€ also the CLI tool name. */
  id: string;
  /** Owner-facing name (short Ã¢â‚¬â€ 1-3 words). */
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
  /** Longer description Ã¢â‚¬â€ when to reach for it, what it produces. */
  description: string;
  /** Example chat invocations the user can click to prefill the composer. */
  examples: string[];
  /** Other skill ids this skill INVOKES during execution. Execution
   *  flow / chained calls (decompose_task Ã¢â€ â€™ ambiguity_probe). UI
   *  renders these as "Calls:" chips with a verb-arrow style. Omit /
   *  empty for leaf skills.
   *
   *  Renamed from `references` 2026-05-17 per user Ã¢â‚¬â€ semantics split
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
    tagline: 'Outline + python-pptx Ã¢â€ â€™ .pptx file',
    icon: 'Ã°Å¸Å½Å¾Ã¯Â¸Â',
    kind: 'office',
    tags: ['slides', 'pptx'],
    description:
      'Produces slide decks from a topic, an outline, or source material. Default 16:9, clean type. Returns the outline first for quick review, then the .pptx file when you confirm.',
    examples: [
      'Ã¥ÂÅ¡Ã¤Â¸â‚¬Ã¤Â¸Âª 10 Ã©Â¡ÂµÃ§Å¡â€ž PPT Ã¤Â»â€¹Ã§Â»Â NVIDIA E2E AV Ã¦Ë†ËœÃ§â€¢Â¥',
      'Turn this research summary into a 5-slide exec deck',
    ],
    implemented: true,
  },
  {
    id: 'make_spreadsheet',
    name: 'Spreadsheet / Excel',
    tagline: 'pandas / openpyxl Ã¢â€ â€™ .xlsx file',
    icon: 'Ã°Å¸â€œÅ ',
    kind: 'office',
    tags: ['spreadsheet', 'xlsx', 'data'],
    description:
      'Reads, transforms, and emits .xlsx files via pandas + openpyxl. For analyses, returns the script plus a prose summary of what changed. Never silently drops rows Ã¢â‚¬â€ reports any filtering.',
    examples: [
      'Ã¦Å Å Ã¨Â¿â„¢Ã¤Â¸Âª CSV Ã¦Å’â€°Ã¦Å“Ë†Ã¤Â»Â½Ã¥Ë†â€ Ã§Â»â€žÃ¯Â¼Å’Ã¦Â¯ÂÃ¦Å“Ë†Ã¤Â¸â‚¬Ã¤Â¸Âª sheet',
      'Pivot last quarter\'s sales by region into an Excel report',
    ],
    implemented: true,
  },
  {
    id: 'make_pdf',
    name: 'PDF / Print Layout',
    tagline: 'pandoc / weasyprint Ã¢â€ â€™ .pdf file',
    icon: 'Ã°Å¸â€œâ€ž',
    kind: 'office',
    tags: ['pdf', 'print'],
    description:
      'Turns markdown or HTML content into print-ready PDFs. Tool order: pandoc Ã¢â€ â€™ weasyprint Ã¢â€ â€™ reportlab. Default A4, 25mm margins, serif body. Includes a footer with doc title + timestamp.',
    examples: [
      'Ã¦Å Å Ã¨Â¿â„¢Ã¤Â»Â½ markdown Ã¦Å Â¥Ã¥â€˜Å Ã¦â€°â€œÃ¦Ë†Â PDF',
      'Render the meeting notes as a 1-page handout PDF',
    ],
    implemented: true,
  },
  {
    id: 'make_chart',
    name: 'Data Viz',
    tagline: 'matplotlib / plotly Ã¢â€ â€™ image or HTML',
    icon: 'Ã°Å¸â€œË†',
    kind: 'office',
    tags: ['chart', 'viz', 'data'],
    description:
      'Picks the chart type from the data shape (time seriesÃ¢â€ â€™line, categoricalÃ¢â€ â€™bar, distributionÃ¢â€ â€™histogram, relationshipÃ¢â€ â€™scatter). matplotlib for static PNG, plotly for interactive HTML. Always labels axes + units.',
    examples: [
      'Ã§â€Â¨Ã¨Â¿â„¢Ã¤Âºâ€ºÃ¦â€¢Â°Ã¦ÂÂ®Ã§â€Â»Ã¤Â¸â‚¬Ã¥Â¼Â Ã¨Â¶â€¹Ã¥Å Â¿Ã¥â€ºÂ¾',
      'Plot weekly active users from this CSV',
    ],
    implemented: false,
  },
  {
    id: 'web_build',
    name: 'Web Build',
    tagline: 'pnpm / vite / next build + lint + typecheck',
    icon: 'Ã°Å¸â€ºÂ Ã¯Â¸Â',
    kind: 'engineering',
    tags: ['build', 'ci'],
    description:
      'Handles web build + deploy tasks: install, build, lint, typecheck, test, static-site generation. Always runs typecheck before declaring a build green. Reports duration, bundle size, and warnings worth surfacing.',
    examples: [
      'Ã¥Â¸Â®Ã¦Ë†â€˜Ã¨Â·â€˜Ã¤Â¸â‚¬Ã©ÂÂ web Ã§Å¡â€ž typecheck + build',
      'Build the docs site and report bundle size',
    ],
    consults: ['pep-8'],
    implemented: false,
  },
  {
    id: 'summarize_inbox',
    name: 'Inbox Summary',
    tagline: 'Triage email threads Ã¢â€ â€™ action items',
    icon: 'Ã°Å¸â€œÂ¬',
    kind: 'communication',
    tags: ['email', 'summary', 'triage'],
    description:
      'Summarizes email threads, inbox dumps, or message logs. Format: (1) top-of-mind one-liner; (2) action items with who-asked-what + suggested response stance; (3) FYI items needing no action. Skips automated notifications.',
    examples: [
      'Ã¦Å Å Ã¦ËœÂ¨Ã¥Â¤Â©Ã¨Â¿â„¢Ã¤Âºâ€ºÃ©â€šÂ®Ã¤Â»Â¶Ã¦â‚¬Â»Ã§Â»â€œÃ¤Â¸â‚¬Ã¤Â¸â€¹Ã¯Â¼Å’Ã¥â€˜Å Ã¨Â¯â€°Ã¦Ë†â€˜Ã¥â€œÂªÃ¤Âºâ€ºÃ¥Â¿â€¦Ã©Â¡Â»Ã¥â€ºÅ¾',
      'Summarize this thread Ã¢â‚¬â€ what are my action items?',
    ],
    // iter-011 Pass #3 (2026-05-18): flipped from false Ã¢â€ â€™ true.
    // Wired via gmail_summarize_inbox in the CLI-backed runtime
    // tools.py Ã¢â‚¬â€ composes gmail_list_threads + gmail_read_thread + the configured CLI.
    // Owner must connect Gmail at /me Ã¢â€ â€™ Authorizations first.
    implemented: true,
  },
  {
    id: 'format_deliverable',
    name: 'Delivery Format',
    tagline: 'Raw worker output Ã¢â€ â€™ polished, structured report',
    icon: 'Ã¢Å“Â¨',
    kind: 'office',
    tags: ['format', 'polish', 'report'],
    description:
      'Takes raw / unstructured worker output and reshapes it into a delivery-ready format: clear title, executive summary, sectioned body with headers, action items, source list, clickable links for any file paths. Can chain to make_pdf / make_slides / make_spreadsheet when the owner wants a specific output format.',
    examples: [
      'Ã¦Å Å Ã¨Â¿â„¢Ã¤Â»Â½Ã¨Â°Æ’Ã¦Å¸Â¥Ã§Â»â€œÃ¦Å¾Å“Ã¦Â Â¼Ã¥Â¼ÂÃ¥Å’â€“Ã¦Ë†ÂÃ¦Â­Â£Ã¥Â¼ÂÃ¦Å Â¥Ã¥â€˜Å ',
      'Format this raw research dump into an exec-ready brief',
    ],
    calls: ['make_pdf', 'make_slides', 'make_spreadsheet'],
    consults: ['weekly-status-update', 'investor-update-monthly', 'prd-feature'],
    implemented: true,
  },
  {
    /* Per user 2026-05-18T18:18Z: "Ã¨Â¿â„¢Ã¤Â¸ÂªÃ¤ÂºÂ¤Ã¤Â»Ëœ Ã¥â€¦Â¶Ã¥Â®Å¾Ã¦ËœÂ¯Ã¤Â¸Âªdashboard dashboardÃ¨Â¦ÂÃ¦â‚¬Â»Ã§Â»â€œ
     * Ã©Å“â‚¬Ã¦Â±â€šÃ¤Â¸â‚¬Ã¥ÂÂ¥Ã¨Â¯ÂÃ¦â‚¬Â»Ã§Â»â€œ Ã§Â»â€œÃ¦Å¾Å“bullet point". Refined from the original 4-section
     * format (status / facts / next-steps / Open Q) to a strict 2-section
     * dashboard: Ã©Å“â‚¬Ã¦Â±â€š (one-sentence Request) + Ã§Â»â€œÃ¦Å¾Å“ (Result bullets).
     * Status / process / Open Q dropped Ã¢â‚¬â€ the owner reads the deliverable
     * like a dashboard line, not a report. Any agent (especially the Desk
     * AI acting as Ã©â€šÂ®Ã¤Â»Â¶Ã¥Â°ÂÃ§Â§Ëœ) calls this when handing a deliverable back to
     * the desk owner. Process narration / intermediate findings stay in
     * the agent's private session log Ã¢â‚¬â€ MUST NOT appear in this output.
     * Companion to format_deliverable (which is for long structured
     * reports); this one is the dashboard line. */
    id: 'summarize_email_brief',
    name: 'Email Brief Summary (CEO Ã¤ÂºÂ¤Ã¤Â»ËœÃ§â€°Â©)',
    tagline: 'Dashboard Ã¤ÂºÂ¤Ã¤Â»ËœÃ§â€°Â© Ã¢â‚¬â€ Ã©Å“â‚¬Ã¦Â±â€šÃ¤Â¸â‚¬Ã¥ÂÂ¥Ã¨Â¯Â + Ã§Â»â€œÃ¦Å¾Å“ bulletsÃ¯Â¼Å’Ã¦â€”Â Ã¨Â¿â€¡Ã§Â¨â€¹Ã¥Ââ„¢Ã¤Âºâ€¹',
    icon: 'Ã¢Å“â€°Ã¯Â¸Â',
    kind: 'communication',
    tags: ['summary', 'ceo', 'email', 'deliverable', 'dashboard'],
    description:
      'Dashboard Ã¤ÂºÂ¤Ã¤Â»ËœÃ§â€°Â© Ã¢â‚¬â€ Ã©Å“â‚¬Ã¦Â±â€šÃ¤Â¸â‚¬Ã¥ÂÂ¥Ã¨Â¯Â + Ã§Â»â€œÃ¦Å¾Å“ bulletsÃ¯Â¼Å’Ã¦â€”Â Ã¨Â¿â€¡Ã§Â¨â€¹Ã¥Ââ„¢Ã¤Âºâ€¹Ã£â‚¬â€šOutput contract (strictly 2 sections):\n' +
      '\n' +
      'Ã©Å“â‚¬Ã¦Â±â€š (Request): one-sentence summary of what was asked.\n' +
      'Ã§Â»â€œÃ¦Å¾Å“ (Result):  bullet points Ãƒâ€” N, each Ã¢â€°Â¤15 words; concrete facts/numbers/dates/actions; no narrative.\n' +
      '\n' +
      'NO status line, NO "Background" / "Context" / "What I did" / "Next steps" / "Open Q" sections Ã¢â‚¬â€ that\'s process; it belongs in the agent\'s private session, not the deliverable. Match the owner\'s language (Chinese Ã¢â€ â€™ Chinese, English Ã¢â€ â€™ English). Owner\'s time is the bottleneck; brevity over completeness.',
    examples: [
      'Ã¦Å Å Ã¨Â¿â„¢Ã¦Â¬Â¡Ã¥ÂË†Ã¥ÂÅ’Ã¨Â·Å¸Ã¨Â¿â€ºÃ§Å¡â€žÃ§Â»â€œÃ¦Å¾Å“Ã§â€Â¨ dashboard Ã¦Â Â¼Ã¥Â¼ÂÃ¦â‚¬Â»Ã§Â»â€œÃ§Â»â„¢Ã¦Ë†â€˜Ã¯Â¼Ë†Ã©Å“â‚¬Ã¦Â±â€šÃ¤Â¸â‚¬Ã¥ÂÂ¥ + Ã§Â»â€œÃ¦Å¾Å“ bulletsÃ¯Â¼â€°',
      'Summarize the vendor reply as a 2-section dashboard Ã¢â‚¬â€ Ã©Å“â‚¬Ã¦Â±â€š one sentence + Ã§Â»â€œÃ¦Å¾Å“ bullets',
    ],
    implemented: true,
  },

  /* Ã¢â€â‚¬Ã¢â€â‚¬ Help skill (owner directive 2026-05-19T21:35Z Ã¢â‚¬â€ "Ã¥Â¸Â®Ã¦Ë†â€˜Ã¥â€ â„¢Ã¤Â¸Âª help
   * Ã§Å¡â€ž skill, Ã§â€Â¨Ã¦Ë†Â·Ã©â€”Â®Ã©â€”Â®Ã©Â¢ËœÃ§Å¡â€žÃ¦â€”Â¶Ã¥â‚¬â„¢ Ã¤Â½Â¿Ã§â€Â¨Ã¨Â¿â„¢Ã¤Â¸Âª Ã¨Â°Æ’Ã§â€Â¨Ã¨Â¿â„¢Ã¤Â¸Âª skill, Ã¥ÂÂ¯Ã¤Â»Â¥Ã¥Â¼â€¢Ã§â€Â¨Ã¤Â¸â‚¬Ã¤Âºâ€ºÃ¥â€ â„¢
   * Ã¥Â¥Â½Ã§Å¡â€žÃ¦â€“â€¡Ã¦Â¡Â£") Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
   *
   * Documentation-retrieval skill. When the owner asks a META question
   * about Holon itself (how-do-I / what-is / where-do-I-find), the Desk
   * AI invokes this skill; the skill consults the three help-reference
   * docs (ref-holon-basics / ref-holon-faq / ref-holon-chat-tips) and
   * answers from them, citing the reference name.
   *
   * Wiring posture (V1):
   *   `consults`: descriptor array Ã¢â‚¬â€ reference ids the CLI may retrieve.
   *   PULL path (CLI-invoked consult_reference tool): SHIPPED at
   *     331d10e / TD-014 RESOLVED. The CLI runtime registers
   *     consult_reference(reference_id) Ã¢â€ â€™ GET /api/v1/references/<id>
   *     Ã¢â€ â€™ returns markdown summary as tool result. The CLI invokes this
   *     tool itself when the user asks a META question.
   *   PUSH path (auto-inject consults summary into CLI context hook):
   *     NOT implemented Ã¢â‚¬â€ the CLI context hook today only injects the
   *     workspace snapshot (inject_workspace_snapshot). Auto-quoting
   *     consults references without a tool-call round-trip is
   *     tracked in TD-015 (filed 2026-05-19, deferred to V1.1+). */
  {
    id: 'help',
    name: 'Help',
    tagline: 'Answer "how do I X in Holon" / "what is Y" / "where is Z" from the help docs',
    icon: 'Ã°Å¸â€ Ëœ',
    kind: 'communication',
    tags: ['help', 'docs', 'meta', 'rag', 'self-service'],
    description:
      'When the owner asks a META question about Holon usage itself (how-to / what-is / where-to-find / why-is), consult the help reference library and answer from it. Cite the reference name in the reply ("per Holon FAQ Ã¢â€ â€™ Ã¢â‚¬Â¦") so the owner can jump to the source on /references. NOT for domain work (delegate that to staff or other skills) Ã¢â‚¬â€ only for questions about Holon\'s own surface area.\n\nReferences consulted (in priority order): ref-holon-basics (concepts: desk / staff / chat / mission / deliverable), ref-holon-faq (first-week common questions: hire, language, CLI, Gmail, slow chat), ref-holon-chat-tips (cancel / queue / @-mention / Esc shortcut).\n\nIf the question is not covered by the references, say so plainly + suggest /references "+ New" to add a new help doc rather than guessing.',
    examples: [
      'how do I hire a new staff member?',
      'Ã¦â‚¬Å½Ã¤Â¹Ë†Ã¥Ë†â€¡Ã¦ÂÂ¢ UI Ã¨Â¯Â­Ã¨Â¨â‚¬?',
      'what does Drops mean?',
      'how do I cancel a chat reply mid-generation?',
      'Ã¦â‚¬Å½Ã¤Â¹Ë†Ã¨Â¿Å¾ Gmail Ã§Å¡â€ž?',
    ],
    consults: ['ref-holon-basics', 'ref-holon-faq', 'ref-holon-chat-tips'],
    implemented: true,
  },

  /* Ã¢â€â‚¬Ã¢â€â‚¬ Adopted from CLI-era tool catalog Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
   * 2026-05-17: user asked to pull in the CLI runtime's built-in capabilities.
   * Each lands here as a UI scaffold; the wiring to the actual CLI runtime
   * tool (e.g. image_generation_tool, browser_tool, code_execution_tool,
   * feishu_doc_tool, kanban_tools, etc.) happens when implemented
   * flips to true. */

  {
    id: 'generate_image',
    name: 'Image Generation',
    tagline: 'Text-to-image via SDXL / Imagen / DALL-E',
    icon: 'Ã°Å¸Å½Â¨',
    kind: 'media',
    tags: ['image', 'gen', 'creative'],
    description:
      'Generates images from a prompt. Pick aspect ratio, style, and quantity. Returns a .png file (or several). Wires to CLI runtime\'s image_generation_tool Ã¢â‚¬â€ provider configured per the worker dispatcher\'s env. Use for slide illustrations, social posts, mockups, or "show me what X could look like" sketches.',
    examples: [
      'Ã§â€Â»Ã¤Â¸â‚¬Ã¥Â¼Â Ã¥Å Å¾Ã¥â€¦Â¬Ã¥Å“ÂºÃ¦â„¢Â¯Ã§Å¡â€žÃ¦Ââ€™Ã§â€Â»Ã¯Â¼Å’Ã¦â€°ÂÃ¥Â¹Â³Ã©Â£Å½Ã¦Â Â¼Ã¯Â¼Å’1024x768',
      'Generate a hero image for a homepage about hybrid AI teams',
    ],
    implemented: false,
  },
  {
    id: 'generate_video',
    name: 'Video Generation',
    tagline: 'Text-to-video / image-to-video clips',
    icon: 'Ã°Å¸Å½Â¬',
    kind: 'media',
    tags: ['video', 'gen', 'creative'],
    description:
      'Generates short video clips (typically 5-15s) from a text prompt or seed image. Slow + token-expensive Ã¢â‚¬â€ use sparingly. Returns a .mp4 file. Wires to CLI runtime\'s video generation tool stack.',
    examples: [
      'Ã¥ÂÅ¡Ã¤Â¸â‚¬Ã¤Â¸Âª 5 Ã§Â§â€™Ã§Å¡â€žÃ¤ÂºÂ§Ã¥â€œÂÃ¦Â¼â€Ã§Â¤ÂºÃ¥Å Â¨Ã¦â€¢Ë†',
      'Animate this static slide into a 10s teaser',
    ],
    implemented: false,
  },
  {
    id: 'browse_web',
    name: 'Browse Web',
    tagline: 'Headless browser Ã¢â€ â€™ page content / screenshots',
    icon: 'Ã°Å¸Å’Â',
    kind: 'research',
    tags: ['browser', 'scrape', 'fetch'],
    description:
      'Opens a URL in a headless Chromium, returns rendered text + DOM-extracted structured data, and can take screenshots. Use for: reading articles behind JS-heavy pages, scraping a single page, capturing a screenshot for a report. Backed by CLI runtime\'s browser_tool / browser_cdp_tool.',
    examples: [
      'Ã¦Å Å Ã¨Â¿â„¢Ã¤Â¸ÂªÃ§Â½â€˜Ã©Â¡ÂµÃ§Å¡â€žÃ¤Â¸Â»Ã¨Â¦ÂÃ¥â€ â€¦Ã¥Â®Â¹Ã¦ÂÂÃ¥Ââ€“Ã¥â€¡ÂºÃ¦ÂÂ¥',
      'Screenshot https://example.com and pull the headline + author',
    ],
    implemented: false,
  },
  {
    id: 'run_code',
    name: 'Run Code',
    tagline: 'Sandboxed Python / shell execution',
    icon: 'Ã°Å¸ÂÂ',
    kind: 'engineering',
    tags: ['python', 'code', 'sandbox'],
    description:
      'Executes Python (and small shell snippets) in a sandbox. Use for quick calculations, file transformations, one-off scripts, or testing snippets before pasting them somewhere. Backed by CLI runtime\'s code_execution_tool. The Desk AI picks this when a question is faster to compute than to derive.',
    examples: [
      'Ã¥Â¸Â®Ã¦Ë†â€˜Ã§Â®â€”Ã¤Â¸â€¹Ã¨Â¿â„¢Ã¤Â¸Âª csv Ã©â€¡Å’Ã¦Â¯ÂÃ¥Ë†â€”Ã§Å¡â€žÃ¥Ââ€¡Ã¥â‚¬Â¼Ã¥â€™Å’Ã¦â€“Â¹Ã¥Â·Â®',
      'Run a quick Python snippet to validate this regex against 20 strings',
    ],
    implemented: false,
  },
  {
    id: 'feishu_doc',
    name: 'Feishu Docs',
    tagline: 'Read / write Feishu (Lark) docs + sheets',
    icon: 'Ã°Å¸â€œâ€¢',
    kind: 'communication',
    tags: ['feishu', 'lark', 'doc'],
    description:
      'Reads and writes Feishu documents, spreadsheets, and Drive files. Use for: pulling meeting notes, syncing reports into a shared workspace, or posting deliverables to the team\'s Feishu workspace. Wires to CLI runtime\'s feishu_doc_tool / feishu_drive_tool Ã¢â‚¬â€ needs auth.',
    examples: [
      'Ã¦Å Å Ã¤Â»Å Ã¥Â¤Â©Ã§Å¡â€žÃ¥Â·Â¥Ã¤Â½Å“Ã¦â€”Â¥Ã¥Â¿â€”Ã¥ÂÅ’Ã¦Â­Â¥Ã¥Ë†Â° Feishu',
      'Pull yesterday\'s meeting notes from the Feishu team folder',
    ],
    implemented: false,
  },
  {
    id: 'google_meet',
    name: 'Google Meet',
    tagline: 'Join / transcribe / summarize Meet calls',
    icon: 'Ã°Å¸â€œÅ¾',
    kind: 'communication',
    tags: ['google', 'meet', 'transcript'],
    description:
      'Joins a Google Meet (as the owner or observer), captures the transcript, then produces a structured summary + action items. Use for: catching up on a call you missed, or having a written record of one you attended. Backed by CLI runtime\'s google_meet plugin Ã¢â‚¬â€ needs OAuth.',
    examples: [
      'Ã¥Â¸Â®Ã¦Ë†â€˜Ã¥Â½â€¢Ã¨Â¿â„¢Ã¤Â¸ÂªÃ¤Â¼Å¡Ã¨Â®Â®Ã¥Â¹Â¶Ã§â€Å¸Ã¦Ë†ÂÃ§ÂºÂªÃ¨Â¦Â',
      'Summarize the action items from this morning\'s standup',
    ],
    implemented: false,
  },
  {
    id: 'kanban',
    name: 'Kanban Board',
    tagline: 'Create / move cards on a project board',
    icon: 'Ã°Å¸â€”â€šÃ¯Â¸Â',
    kind: 'ops',
    tags: ['kanban', 'project', 'task'],
    description:
      'Creates cards, moves them across columns, and queries the board state. Use as a lightweight task tracker Ã¢â‚¬â€ the owner\'s personal next-actions board, separate from the Holon mission inbox (which is cross-desk handoffs). Backed by CLI runtime\'s kanban_tools.',
    examples: [
      'Ã¦Å Å Ã¤Â»Å Ã¥Â¤Â©Ã¦Â²Â¡Ã¥Â®Å’Ã¦Ë†ÂÃ§Å¡â€žÃ¤Âºâ€¹ move Ã¥Ë†Â° tomorrow Ã©â€šÂ£Ã¤Â¸â‚¬Ã¥Ë†â€”',
      'Create a card "Review iter-009 plan" in the Inbox column',
    ],
    implemented: false,
  },
  /* Ã¢â€â‚¬Ã¢â€â‚¬ Meta-skill: task decomposition (plan-and-execute) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ */
  {
    id: 'decompose_task',
    name: 'Decompose Task',
    tagline: 'Complex ask Ã¢â€ â€™ ordered subtasks Ã¢â€ â€™ routing per step',
    icon: 'Ã°Å¸Âªâ€œ',
    kind: 'ops',
    tags: ['plan', 'decompose', 'meta', 'judgement'],
    description:
      'Take a complex owner request and produce an executable plan. Output: an ordered list of subtasks, each with (1) a sharp single-sentence goal, (2) inputs / preconditions, (3) the staff or skill that should handle it, (4) expected deliverable shape, (5) any explicit dependencies on earlier steps. Pattern is Plan-and-Execute (surfaces the plan first for owner approval / tweak, then executes step-by-step; can re-plan on failure or new info).\n\nSkill resolution order for each subtask (per owner directive): (1) first search the local skill catalog for an existing skill that fits Ã¢â‚¬â€ prefer reuse over invention; (2) if a near-fit exists, adapt the call (different examples / different inputs) rather than inventing a new skill; (3) only escalate to research-class skills (browse_web, run_code with web fetches, external API skills) when the local catalog truly has no answer Ã¢â‚¬â€ these are slower + more expensive. Use ambiguity_probe first if the goal itself is under-specified Ã¢â‚¬â€ decomposition assumes the goal is clear.\n\nReferences: LangChain Plan-and-Execute, HTN planning, ReAct, Reflexion.',
    examples: [
      'Ã¨Â°Æ’Ã§Â â€ NVIDIA E2E AV Ã¦Ë†ËœÃ§â€¢Â¥Ã¯Â¼Å’Ã¥â€ â„¢Ã¦Ë†ÂÃ§Â»â„¢Ã¨â‚¬ÂÃ¦ÂÂ¿Ã§Å¡â€ž 5 Ã©Â¡Âµ PPT Ã¢â‚¬â€ Ã¥â€¦Ë†Ã¥Â¸Â®Ã¦Ë†â€˜Ã¥Ë†â€”Ã¥â€¡ÂºÃ¦Â­Â¥Ã©ÂªÂ¤Ã¥â€ ÂÃ¥Â¼â‚¬Ã¥Â¹Â²',
      'Plan the migration from the configured CLI to Claude 4 across our worker dispatcher',
    ],
    calls: ['ambiguity_probe', 'browse_web', 'run_code', 'format_deliverable'],
    implemented: true,
  },

  /* Ã¢â€â‚¬Ã¢â€â‚¬ Meta-skill: ambiguity probe Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ */
  {
    id: 'ambiguity_probe',
    name: 'Ambiguity Probe',
    tagline: 'Detect under-specified asks Ã¢â€ â€™ ask on the right axes',
    icon: 'Ã¢Ââ€œ',
    kind: 'ops',
    tags: ['clarify', 'meta', 'judgement'],
    description:
      'When the owner\'s request leaves room for materially different outputs, the Desk AI invokes this skill BEFORE doing the work. It scans the request against fixed axes Ã¢â‚¬â€ Scope (what\'s in/out), Audience (who reads/uses it), Format (file type / length / structure), Deadline (when), Source (what input material), Constraints (budget / style / tone), Authority (who confirms before ship), Reference (any existing version to mimic) Ã¢â‚¬â€ and surfaces only the axes that are actually under-specified, with a concrete question per axis. Skip axes the request already pins down. Goal: one round of 1-3 sharp questions, not a checklist interrogation.',
    examples: [
      'Ã¦Ë†â€˜Ã¦Æ’Â³Ã¥ÂÅ¡Ã¤Â¸ÂªÃ¥Â¸â€šÃ¥Å“ÂºÃ¨Â°Æ’Ã¦Å¸Â¥Ã¦Å Â¥Ã¥â€˜Å  Ã¢â‚¬â€ Ã¥Â¸Â®Ã¦Ë†â€˜Ã¥â€¦Ë†Ã§Ââ€ Ã¦Â¸â€¦Ã¦Â¥Å¡Ã¨Â¦ÂÃ©â€”Â®Ã§Å¡â€žÃ¥â€¡Â Ã¤Â¸ÂªÃ©â€”Â®Ã©Â¢Ëœ',
      'Before you build the slides, what do you need me to disambiguate?',
    ],
    implemented: true,
  },

  /* Ã¢â€â‚¬Ã¢â€â‚¬ Meta-skills: agent CRUD Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ */
  {
    id: 'create_agent',
    name: 'Create Agent',
    tagline: 'Spin up a new staff member with all fields configured',
    icon: 'Ã°Å¸Â§â€˜Ã¢â‚¬ÂÃ°Å¸â€™Â¼',
    kind: 'ops',
    tags: ['team', 'hire', 'meta'],
    description:
      'Take a sketched role description from the owner and produce a complete new staff record Ã¢â‚¬â€ name, role_label, system_prompt, max_concurrent_jobs, denied_skills (deny-list against the CEO catalog), monthly_budget_millicents, proxy_staff_id. Persists via the existing create_staff CLI runtime tool. Use this when the owner says "hire me a market researcher" or "make a teammate who handles refunds".',
    examples: [
      'Ã¥Â¸Â®Ã¦Ë†â€˜Ã¦â€¹â€ºÃ¤Â¸â‚¬Ã¤Â¸ÂªÃ¨Â´Å¸Ã¨Â´Â£Ã¦â€¢Â´Ã§Ââ€ Ã¥â€˜Â¨Ã¦Å Â¥Ã§Å¡â€žÃ¥â€˜ËœÃ¥Â·Â¥Ã¯Â¼Å’Ã¦Â¯ÂÃ¦Å“Ë†Ã©Â¢â€žÃ§Â®â€” 100 Ã¥â€¦Æ’',
      'Spin up a junior research analyst for AV market scans, no Discord access',
    ],
    calls: ['ambiguity_probe'],
    implemented: false,
  },
  {
    id: 'update_agent',
    name: 'Update Agent',
    tagline: 'Edit an existing staff member\'s config',
    icon: 'Ã¢Å“ÂÃ¯Â¸Â',
    kind: 'ops',
    tags: ['team', 'edit', 'meta'],
    description:
      'Update one or more fields on an existing staff member: name, role_label, system_prompt, denied_skills, monthly_budget_millicents, proxy_staff_id, max_concurrent_jobs. The owner usually invokes this in plain language ("give Aria a bigger budget", "stop letting Drafter use Slack"); the skill resolves the staff and patches just the named fields.',
    examples: [
      'Ã¦Å Å  Aria Ã§Å¡â€žÃ¦Å“Ë†Ã©Â¢â€žÃ§Â®â€”Ã¨Â°Æ’Ã¥Ë†Â° 200 Ã¥â€¦Æ’',
      'Stop Drafter from using Discord and Slack',
    ],
    implemented: false,
  },
  {
    id: 'dismiss_agent',
    name: 'Dismiss Agent',
    tagline: 'Fire / archive a staff member',
    icon: 'Ã°Å¸Å¡Âª',
    kind: 'ops',
    tags: ['team', 'fire', 'meta'],
    description:
      'Dismiss (fire) a staff member. The record is archived Ã¢â‚¬â€ history of their deliverables stays, but they no longer appear in the active roster and any in-flight jobs are cancelled. CLI / peer / owner-assistant substrates are protected; only local_ai staff can be dismissed.',
    examples: [
      'Ã¦Å Å  Drafter Ã¨Â§Â£Ã©â€ºâ€¡Ã¤Âºâ€ ',
      'Dismiss the spreadsheet analyst Ã¢â‚¬â€ we\'re not using them anymore',
    ],
    implemented: false,
  },

  /* Ã¢â€â‚¬Ã¢â€â‚¬ Meta-skills: skill catalog CRUD Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ */
  {
    id: 'create_skill',
    name: 'Create Skill',
    tagline: 'Define a new custom skill the team can invoke',
    icon: 'Ã¢Å“Â¨',
    kind: 'ops',
    tags: ['skills', 'meta'],
    description:
      'Define a new skill the owner + every staff (subject to deny-list) can call. The owner describes what the skill does + when to use it + the example invocation; this skill produces a SkillDescriptor (id, name, tagline, kind, tags, description, examples) and a runnable body (prompt template + tool calls). Lands in the user-defined skills store, surfaced on /skills next to the built-ins.',
    examples: [
      'Ã¥Å Â Ã¤Â¸â‚¬Ã¤Â¸Âª skillÃ¯Â¼Å¡Ã¦Â¯ÂÃ¥â€˜Â¨Ã¤Â¸â‚¬Ã¦â€”Â©Ã¤Â¸Å Ã¦Å Å Ã¤Â¸Å Ã¥â€˜Â¨Ã§Å¡â€ž deliverables Ã¦â‚¬Â»Ã§Â»â€œÃ¦Ë†ÂÃ¥â€˜Â¨Ã¦Å Â¥',
      'Make a skill that turns any meeting transcript into a sub-1-page brief',
    ],
    calls: ['ambiguity_probe'],
    implemented: false,
  },
  {
    id: 'update_skill',
    name: 'Update Skill',
    tagline: 'Tweak an existing skill\'s description / examples / body',
    icon: 'Ã°Å¸â€Â§',
    kind: 'ops',
    tags: ['skills', 'meta'],
    description:
      'Edit a user-defined skill in place. The owner can rephrase the tagline / description to nudge when the Desk AI picks it, add or remove examples, or tighten the runnable body. Built-in skills (anything shipped in SKILL_CATALOG) are read-only Ã¢â‚¬â€ fork them via create_skill if you want a variant.',
    examples: [
      'Ã¦Å Å  weekly-brief skill Ã§Å¡â€žÃ¦Â Â¼Ã¥Â¼ÂÃ¦â€Â¹Ã¦Ë†ÂÃ§ÂºÂ¯ markdown Ã¤Â¸ÂÃ¨Â¦ÂÃ¨Â¡Â¨Ã¦Â Â¼',
      'Add a "monthly cadence" example to the inbox-summary skill',
    ],
    implemented: false,
  },
  /* Ã¢â€â‚¬Ã¢â€â‚¬ Meta-skills: template CRUD (mirrors skill CRUD) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ */
  {
    id: 'create_template',
    name: 'Create Template',
    tagline: 'Add a new fillable content shell (output-format ref)',
    icon: 'Ã°Å¸Â§Â©',
    kind: 'ops',
    tags: ['templates', 'meta', 'create'],
    description:
      'Create a new template (output-format reference). Direct flow: paste an existing markdown body and tag the {{placeholder}} variables. Lands in the user-defined templates store; surfaced on /references under kind=output-format.',
    examples: [
      'Ã¥Å Â Ã¤Â¸â‚¬Ã¤Â¸Âª templateÃ¯Â¼Å¡Ã¥Â®Â¢Ã¦Ë†Â·Ã§ÂºÂ¿Ã§Â´Â¢Ã¨Â·Å¸Ã¨Â¿â€ºÃ§Å¡â€ž Slack Ã¦Å½Â¨Ã©â‚¬ÂÃ¦Â Â¼Ã¥Â¼Â',
      'Make a template for our weekly all-hands update',
    ],
    calls: ['ambiguity_probe'],
    implemented: false,
  },
  {
    id: 'update_template',
    name: 'Update Template',
    tagline: 'Tweak an existing template',
    icon: 'Ã°Å¸â€œÂ',
    kind: 'ops',
    tags: ['templates', 'meta', 'edit'],
    description:
      'Edit a user-defined template in place Ã¢â‚¬â€ body, variables, tagline, examples. Built-in templates (anything shipped in template-catalog.ts) are read-only; fork via create_template if you want a variant.',
    examples: [
      'Ã¦Å Å  weekly-status template Ã©â€¡Å’Ã¥Å Â Ã¤Â¸â‚¬Ã¤Â¸Âª risks Ã¦Â®Âµ',
      'Rename the {{client_name}} placeholder to {{customer_name}} in the offer letter',
    ],
    implemented: false,
  },
  {
    id: 'delete_template',
    name: 'Delete Template',
    tagline: 'Remove a user-defined template',
    icon: 'Ã°Å¸â€”â€˜Ã¯Â¸Â',
    kind: 'ops',
    tags: ['templates', 'meta', 'delete'],
    description:
      'Remove a user-defined template from the catalog. Built-in templates can\'t be deleted. Skills that consult the deleted id will get a "missing reference" chip in the UI.',
    examples: [
      'Ã¥Ë†Â Ã©â„¢Â¤Ã©â€šÂ£Ã¤Â¸Âª internal-rfc template Ã¦Â²Â¡Ã¤ÂºÂºÃ§â€Â¨Ã¤Âºâ€ ',
    ],
    implemented: false,
  },

  /* Ã¢â€â‚¬Ã¢â€â‚¬ Meta-skills: reference CRUD (per user 2026-05-17 "Ã¥Â¼â€žÃ¤Â¸ÂªÃ¥Ë†â€ºÃ¥Â»Âº
   * reference Ã§Å¡â€ž skill") Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ */
  {
    id: 'extract_references',
    name: 'Extract References',
    tagline: 'Scan a folder Ã¢â€ â€™ auto-create one reference per file',
    icon: 'Ã°Å¸â€”â€šÃ¯Â¸Â',
    kind: 'ops',
    tags: ['references', 'meta', 'ingest', 'create'],
    description:
      'Point this skill at a local folder; it enumerates files, reads each one, and produces a ReferenceDescriptor for each (auto-inferring name, kind, summary, authority from the content). Use when the owner has an existing internal docs/specs folder (`/home/.../docs/` or similar) and wants the whole library indexed as references without writing each one by hand. Each generated reference gets source_type=file with local_path pointing at the original. Companion to create_reference (one-at-a-time, more controlled). The owner reviews + accepts each generated entry before it lands in the catalog (no silent ingest).',
    examples: [
      'Ã¦Å Å  /home/me/work/specs/ Ã¦â€¢Â´Ã¤Â¸ÂªÃ§â€ºÂ®Ã¥Â½â€¢Ã¦â€°Â«Ã¤Â¸â‚¬Ã©ÂÂ Ã¥Å Â Ã¦Ë†Â reference',
      'Walk through ~/Documents/standards/ and propose reference entries for each PDF',
    ],
    calls: ['create_reference'],
    implemented: false,
  },
  {
    id: 'create_reference',
    name: 'Create Reference',
    tagline: 'Add a new external standard / spec / regulation',
    icon: 'Ã°Å¸â€œÅ¡',
    kind: 'ops',
    tags: ['references', 'meta', 'create'],
    description:
      'Create a new reference entry directly by filling descriptor fields: URL or local path, name, authority, version, summary, tags, and key sections. Lands in the user-defined references store; surfaced on /references under the matching kind.',
    examples: [
      'Ã¥Å Â Ã¤Â¸â‚¬Ã¤Â¸Âª referenceÃ¯Â¼Å¡HIPAA Ã¢â‚¬â€ Ã¦Ë†â€˜Ã¤Â¼Å¡Ã¤Â¸Â»Ã¨Â¦ÂÃ¦â€¹Â¿Ã¦ÂÂ¥ audit Ã¥Å’Â»Ã§â€“â€”Ã¦â€¢Â°Ã¦ÂÂ®Ã¦ÂµÂ',
      'Add WCAG 2.1 as a reference Ã¢â‚¬â€ we still ship to clients on that baseline',
    ],
    calls: ['ambiguity_probe', 'browse_web'],
    implemented: false,
  },
  {
    id: 'update_reference',
    name: 'Update Reference',
    tagline: 'Tweak an existing reference\'s summary / version / sections',
    icon: 'Ã¢Å“ÂÃ¯Â¸Â',
    kind: 'ops',
    tags: ['references', 'meta', 'edit'],
    description:
      'Edit a user-defined reference Ã¢â‚¬â€ summary, version, key sections, tags. Useful when a standard issues a new version (e.g. ISO 27001:2022 Ã¢â€ â€™ 2027) and you want to update one entry rather than create a new one. Built-in references are read-only; fork via create_reference for a variant.',
    examples: [
      'Ã¦Å Å  GDPR Ã©â€šÂ£Ã¤Â¸Âª reference Ã¥Å Â Ã¤Â¸Å  Schrems II Ã¥â€ Â³Ã¨Â®Â®Ã§Å¡â€žÃ¥Â¤â€¡Ã¦Â³Â¨',
      'Bump our WCAG entry from 2.1 to 2.2 and refresh the key sections',
    ],
    implemented: false,
  },
  {
    id: 'delete_reference',
    name: 'Delete Reference',
    tagline: 'Remove a user-defined reference',
    icon: 'Ã°Å¸â€”â€˜Ã¯Â¸Â',
    kind: 'ops',
    tags: ['references', 'meta', 'delete'],
    description:
      'Remove a user-defined reference from the catalog. Built-in references can\'t be deleted (the standards body still exists Ã¢â‚¬â€ just untag the skills that cite it). Skills that consult the deleted id will get a "missing reference" chip in the UI.',
    examples: [
      'Ã¥Ë†Â Ã©â„¢Â¤Ã©â€šÂ£Ã¤Â¸Âª internal-style-guide reference Ã¢â‚¬â€ Ã¥Â·Â²Ã§Â»ÂÃ¤Â¸ÂÃ§Â»Â´Ã¦Å Â¤Ã¤Âºâ€ ',
    ],
    implemented: false,
  },

  {
    id: 'delete_skill',
    name: 'Delete Skill',
    tagline: 'Remove a user-defined skill from the catalog',
    icon: 'Ã°Å¸â€”â€˜Ã¯Â¸Â',
    kind: 'ops',
    tags: ['skills', 'meta'],
    description:
      'Remove a user-defined skill from the catalog. Built-in skills can\'t be deleted Ã¢â‚¬â€ only disabled at the CEO level (and even that\'s a future feature). When you delete a skill, the Desk AI stops surfacing it and every staff loses access regardless of their deny-list.',
    examples: [
      'Ã¦Å Å  weekly-brief skill Ã¥Ë†Â Ã¤Âºâ€  Ã¦Â²Â¡Ã§â€Â¨Ã¤Âºâ€ ',
      'Delete the "twitter-post" skill Ã¢â‚¬â€ we\'re not on Twitter anymore',
    ],
    implemented: false,
  },
  {
    id: 'discord_post',
    name: 'Discord',
    tagline: 'Post messages / read channel history',
    icon: 'Ã°Å¸â€™Â¬',
    kind: 'communication',
    tags: ['discord', 'chat', 'community'],
    description:
      'Posts a message to a Discord channel, reads recent channel history, or pings a user. Use for: cross-posting deliverables to a community, dropping status updates into a working channel, or catching up on missed conversation. Backed by CLI runtime\'s discord_tool Ã¢â‚¬â€ needs a bot token.',
    examples: [
      'Ã¦Å Å Ã¨Â¿â„¢Ã¤Â»Â½Ã¦Å Â¥Ã¥â€˜Å  post Ã¥Ë†Â° #weekly-updates',
      'Show me the last 20 messages in #design',
    ],
    implemented: false,
  },
];

/* Ã¢â€â‚¬Ã¢â€â‚¬ CRUD (user-created skills + overrides on built-ins) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
 *
 * Pattern mirrors template-catalog.ts / reference-catalog.ts:
 *   - listSkills merges baseline Ã¢Ë†Âª dynamic, applies overrides,
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
  office: 'Ã°Å¸â€œâ€ž',
  media: 'Ã°Å¸Å½Â¨',
  engineering: 'Ã°Å¸â€ºÂ Ã¯Â¸Â',
  communication: 'Ã°Å¸â€™Â¬',
  research: 'Ã°Å¸â€Å½',
  ops: 'Ã¢Å¡â„¢Ã¯Â¸Â',
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
    icon: input.icon ?? SKILL_ICON_DEFAULT[input.kind] ?? 'Ã¢Å“Â¨',
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
    // New skills default to scaffold Ã¢â‚¬â€ the CLI runtime wiring hasn't
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

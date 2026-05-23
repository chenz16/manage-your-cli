/**
 * Owner reference catalog Ã¢â‚¬â€ external reference documents the team
 * consults when running audits, reviews, or compliance checks.
 * Distinct from skills (skill-catalog.ts) and templates (template-catalog.ts):
 *
 *   - Skills are ACTIONS Ã¢â‚¬â€ capabilities the Desk AI calls inline.
 *   - Templates are CONTENT FORMS Ã¢â‚¬â€ markdown shells the owner fills.
 *   - References are LOOKUPS Ã¢â‚¬â€ external standards / specs / regulations
 *     that skills cite when doing audits, reviews, or compliance checks.
 *
 * V1 scope: descriptor catalog only Ã¢â‚¬â€ stores the canonical URL and a
 * one-paragraph summary plus optional key-section jumplinks. We do NOT
 * ingest the full text of any reference document; skills that need
 * detail fetch on demand or work from the summary + the owner's local
 * highlights. Versioning matters Ã¢â‚¬â€ references are version-sensitive,
 * so the descriptor carries an explicit `version` field.
 */

/* Reference taxonomy Ã¢â‚¬â€ picked to map to real consult-when buckets the
 * owner reaches for. Each kind groups references with similar audit /
 * review / compliance flow. Add new kinds only when 2+ entries would
 * land there; otherwise use `tags` for finer slicing. */
/* 2026-05-17: Reference is the umbrella for "things skills consult".
 * Two flavors, distinguished by kind:
 *
 *   - INPUT-CONTENT references (regulatory / industry-standard /
 *     accessibility / security / language-style / company-internal) Ã¢â‚¬â€
 *     external standards / specs / regulations. Skills cite these
 *     when checking facts or running audits.
 *
 *   - OUTPUT-FORMAT references (output-format) Ã¢â‚¬â€ fillable content
 *     shells (PRD, weekly status, offer letter). Skills consult these
 *     when shaping the deliverable. Backed by `template-catalog.ts`
 *     entries; we synthesize them into the unified `listReferences()`
 *     stream below.
 *
 * Per user: "Ã¤Â¸ÂÃ§Â®Â¡Ã¦ËœÂ¯Ã¥â€œÂªÃ¤Â¸ÂªÃ©Æ’Â½Ã¦ËœÂ¯Ã¨Â¢Â« skill Ã¥Â¼â€¢Ã§â€Â¨Ã§Å¡â€ž". Same downstream consumer,
 * so the UI presents them as one library with kind-chip filtering. */
export type ReferenceKind =
  | 'regulatory'
  | 'industry-standard'
  | 'accessibility'
  | 'security'
  | 'language-style'
  | 'company-internal'
  | 'output-format';

export interface ReferenceDescriptor {
  /** Stable kebab-case id Ã¢â‚¬â€ skills cite the reference by this id
   *  (e.g. an `accessibility_audit` skill may reference `wcag-2-2`). */
  id: string;
  /** Owner-facing short name. */
  name: string;
  /** One-line summary. */
  tagline: string;
  /** Glyph for the card (emoji). */
  icon: string;
  /** Category for grouping in the UI. */
  kind: ReferenceKind;
  /** Fine-grained tags within a kind. */
  tags: string[];
  /** Issuing authority (W3C, ISO, IETF, NIST, company name, etc). */
  authority: string;
  /** Version + release date if known Ã¢â‚¬â€ references are version-sensitive. */
  version: string;
  /** Canonical public URL where the full document lives. V1 stores only
   *  the link + summary; we do NOT ingest the full text. Skills that
   *  consult this reference fetch on demand or work from the summary
   *  + the owner's local highlights. */
  url: string;
  /** One paragraph: what this reference covers, when to consult it,
   *  what kinds of checks it enables. */
  summary: string;
  /** Optional: 3-7 most-cited sections / clauses owners often need
   *  to jump to. Each is `{ id, title, anchor }` where anchor is the
   *  fragment on the source URL (or '' if not known). */
  key_sections?: { id: string; title: string; anchor: string }[];

  /* Ã¢â€â‚¬Ã¢â€â‚¬ 2026-05-17: local source (per user) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
   * Three orthogonal axes to a reference: WHERE (location), WHAT
   * (summary), HOW (kind). The fields above already cover WHAT (summary)
   * + HOW (kind). For WHERE we now support three source flavors Ã¢â‚¬â€
   * public URL (existing), local file, local folder Ã¢â‚¬â€ distinguished by
   * `source_type`. The skills that consult a reference branch on
   * source_type to pick their retrieval strategy (HTTP fetch vs file
   * read vs folder enumerate + RAG). */
  /** Where the canonical content lives. Default 'url' (existing
   *  built-in references all point at public standards pages). */
  source_type?: 'url' | 'file' | 'folder';
  /** Absolute path on the owner's machine. Set when source_type is
   *  'file' or 'folder'. Mutually informative with `url` Ã¢â‚¬â€ a reference
   *  can have both (a public landing page + a local working copy);
   *  retrieval prefers local_path when present. */
  local_path?: string;
  /** When true for a local file reference, the owner snapshot reads and
   *  injects the file contents every turn for exact full-document quoting. */
  pinned?: boolean;
}

export const REFERENCE_CATALOG: ReferenceDescriptor[] = [
  {
    id: 'wcag-2-2',
    name: 'WCAG 2.2',
    tagline: 'Web Content Accessibility Guidelines',
    icon: 'Ã¢â„¢Â¿',
    kind: 'accessibility',
    tags: ['a11y', 'web', 'w3c'],
    authority: 'W3C',
    version: '2.2 (Oct 2023)',
    url: 'https://www.w3.org/TR/WCAG22/',
    summary:
      'W3C standard defining how to make web content more accessible to people with disabilities. Organized around four principles Ã¢â‚¬â€ Perceivable, Operable, Understandable, Robust Ã¢â‚¬â€ with conformance levels A, AA, AAA. Consult when running an accessibility audit, reviewing UI changes, or evaluating a vendor claim of "accessible". Most regulatory frameworks (EN 301 549, US Section 508, ADA case law) reference WCAG AA as the baseline.',
    key_sections: [
      { id: 'principles', title: 'Four principles (POUR)', anchor: 'perceivable' },
      { id: 'levels', title: 'Conformance levels (A / AA / AAA)', anchor: 'conformance' },
      { id: 'contrast', title: '1.4.3 Contrast (Minimum)', anchor: 'contrast-minimum' },
      { id: 'keyboard', title: '2.1.1 Keyboard', anchor: 'keyboard' },
      { id: 'focus-visible', title: '2.4.7 Focus Visible', anchor: 'focus-visible' },
      { id: 'target-size', title: '2.5.8 Target Size (Minimum)', anchor: 'target-size-minimum' },
    ],
  },
  {
    id: 'iso-27001-2022',
    name: 'ISO/IEC 27001:2022',
    tagline: 'Information security management systems (ISMS)',
    icon: 'Ã°Å¸â€Â',
    kind: 'security',
    tags: ['isms', 'iso', 'certification', 'risk'],
    authority: 'ISO/IEC',
    version: '2022',
    url: 'https://www.iso.org/standard/27001',
    summary:
      'International standard for information security management systems. Defines a risk-based ISMS Ã¢â‚¬â€ scope, leadership commitment, planning, support, operation, performance evaluation, improvement Ã¢â‚¬â€ plus 93 Annex A controls grouped into Organizational, People, Physical, and Technological themes. Consult when scoping a SOC2 / ISO 27001 audit, designing a control baseline, or evaluating an MSA security clause. Certification requires an accredited third-party audit; many enterprise procurement teams treat it as table stakes.',
    key_sections: [
      { id: 'scope', title: 'Clause 4 Ã¢â‚¬â€ Context & ISMS scope', anchor: '' },
      { id: 'leadership', title: 'Clause 5 Ã¢â‚¬â€ Leadership', anchor: '' },
      { id: 'risk', title: 'Clause 6 Ã¢â‚¬â€ Risk assessment & treatment', anchor: '' },
      { id: 'annex-a', title: 'Annex A Ã¢â‚¬â€ 93 controls (4 themes)', anchor: '' },
      { id: 'soa', title: 'Statement of Applicability (SoA)', anchor: '' },
    ],
  },
  {
    id: 'gdpr',
    name: 'GDPR',
    tagline: 'EU General Data Protection Regulation',
    icon: 'Ã°Å¸â€¡ÂªÃ°Å¸â€¡Âº',
    kind: 'regulatory',
    tags: ['privacy', 'eu', 'personal-data'],
    authority: 'European Union',
    version: 'Regulation (EU) 2016/679, in force 2018-05-25',
    url: 'https://gdpr-info.eu/',
    summary:
      'EU regulation governing the processing of personal data of people in the EU/EEA, regardless of where the processor is located. Establishes lawful bases for processing, data-subject rights (access, rectification, erasure, portability, objection), controller/processor obligations, breach-notification timelines (72h), and fines up to 4% of global annual turnover. Consult when launching a product in the EU, signing a DPA, designing a privacy review, or handling a data-subject request. Many non-EU jurisdictions have GDPR-aligned regimes (UK GDPR, LGPD in Brazil, PIPL in China).',
    key_sections: [
      { id: 'art-5', title: 'Article 5 Ã¢â‚¬â€ Principles', anchor: 'art-5-gdpr' },
      { id: 'art-6', title: 'Article 6 Ã¢â‚¬â€ Lawfulness of processing', anchor: 'art-6-gdpr' },
      { id: 'art-15', title: 'Article 15 Ã¢â‚¬â€ Right of access', anchor: 'art-15-gdpr' },
      { id: 'art-17', title: 'Article 17 Ã¢â‚¬â€ Right to erasure ("right to be forgotten")', anchor: 'art-17-gdpr' },
      { id: 'art-32', title: 'Article 32 Ã¢â‚¬â€ Security of processing', anchor: 'art-32-gdpr' },
      { id: 'art-33', title: 'Article 33 Ã¢â‚¬â€ Breach notification (72h)', anchor: 'art-33-gdpr' },
    ],
  },
  {
    id: 'pep-8',
    name: 'PEP 8',
    tagline: 'Style guide for Python code',
    icon: 'Ã°Å¸ÂÂ',
    kind: 'language-style',
    tags: ['python', 'style', 'lint'],
    authority: 'Python.org (van Rossum, Warsaw, Coghlan)',
    version: 'Living document',
    url: 'https://peps.python.org/pep-0008/',
    summary:
      'The de-facto style guide for Python code Ã¢â‚¬â€ indentation, line length, imports, naming, comments, whitespace. Most linters (flake8, ruff, pycodestyle) and formatters (black) default to PEP 8 with small documented deviations. Consult when reviewing Python code, setting up a linter config, or onboarding a contributor. PEP 8 is intentionally non-binding ("a foolish consistency is the hobgoblin of little minds") Ã¢â‚¬â€ project-specific style overrides are legitimate.',
    key_sections: [
      { id: 'indentation', title: 'Indentation (4 spaces, no tabs)', anchor: 'indentation' },
      { id: 'line-length', title: 'Maximum line length (79 / 99)', anchor: 'maximum-line-length' },
      { id: 'imports', title: 'Imports Ã¢â‚¬â€ order & grouping', anchor: 'imports' },
      { id: 'naming', title: 'Naming conventions', anchor: 'naming-conventions' },
      { id: 'comments', title: 'Comments & docstrings', anchor: 'comments' },
    ],
  },
  {
    id: 'oauth-2-1',
    name: 'OAuth 2.1',
    tagline: 'Authorization framework Ã¢â‚¬â€ consolidated best-practice spec',
    icon: 'Ã°Å¸â€â€˜',
    kind: 'industry-standard',
    tags: ['oauth', 'auth', 'ietf', 'draft'],
    authority: 'IETF OAuth Working Group',
    version: 'Draft (draft-ietf-oauth-v2-1)',
    url: 'https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1',
    summary:
      'Consolidates OAuth 2.0 (RFC 6749) plus the Security Best Current Practice (RFC 9700) into a single normative spec. Removes the deprecated Implicit and Password grants, mandates PKCE for all clients using the Authorization Code grant, tightens redirect-URI matching to exact string match, and bans bearer tokens in URL query strings. Consult when designing an OAuth integration, reviewing an SDK choice, or auditing an existing auth flow against modern best practice. Still a draft Ã¢â‚¬â€ track the latest revision for breaking changes.',
    key_sections: [
      { id: 'grants', title: 'Allowed grant types', anchor: '' },
      { id: 'pkce', title: 'PKCE Ã¢â‚¬â€ mandatory for Auth Code', anchor: '' },
      { id: 'redirect-uri', title: 'Redirect URI Ã¢â‚¬â€ exact match', anchor: '' },
      { id: 'refresh', title: 'Refresh token rotation', anchor: '' },
      { id: 'security', title: 'Security considerations', anchor: '' },
    ],
  },
  {
    id: 'nist-csf-2-0',
    name: 'NIST CSF 2.0',
    tagline: 'Cybersecurity Framework',
    icon: 'Ã°Å¸â€ºÂ¡Ã¯Â¸Â',
    kind: 'security',
    tags: ['nist', 'cybersecurity', 'framework', 'governance'],
    authority: 'NIST (US Dept. of Commerce)',
    version: '2.0 (Feb 2024)',
    url: 'https://www.nist.gov/cyberframework',
    summary:
      'High-level cybersecurity framework organized around six functions Ã¢â‚¬â€ Govern, Identify, Protect, Detect, Respond, Recover. CSF 2.0 explicitly added the Govern function to elevate cybersecurity as an enterprise risk discipline. Voluntary framework (vs. mandatory regulation) widely used as a common language across US federal contractors, critical-infrastructure operators, and increasingly the broader private sector. Consult when designing a security program, mapping controls across multiple standards, or briefing a board on cyber risk posture.',
    key_sections: [
      { id: 'govern', title: 'Govern (new in 2.0)', anchor: '' },
      { id: 'identify', title: 'Identify', anchor: '' },
      { id: 'protect', title: 'Protect', anchor: '' },
      { id: 'detect', title: 'Detect', anchor: '' },
      { id: 'respond', title: 'Respond', anchor: '' },
      { id: 'recover', title: 'Recover', anchor: '' },
    ],
  },

  /* Ã¢â€â‚¬Ã¢â€â‚¬ Help references (owner directive 2026-05-19T21:35Z Ã¢â‚¬â€ "Ã¥Â¸Â®Ã¦Ë†â€˜Ã¥â€ â„¢Ã¤Â¸Âª
   * help Ã§Å¡â€ž skill") Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
   * These three docs cover the first-day questions a new Holon owner
   * asks. They're consulted by the `help` skill (skill-catalog.ts),
   * which is invoked when the owner asks META questions about Holon
   * usage itself (how-do-I / what-is / where-do-I-find).
   *
   * Schema fit note: REFERENCE_CATALOG is the canonical place because
   * these ARE references Ã¢â‚¬â€ the `help` skill cites them. They land under
   * kind='company-internal' (closest existing bucket Ã¢â‚¬â€ "Holon" is the
   * company; doc is internal-to-Holon product docs). authority='Holon';
   * url points at an in-app deep link (/references#<id>) since these
   * have no external authority page. Full markdown content lives in
   * `summary` Ã¢â‚¬â€ V1 reference storage spec is "summary + URL" with no
   * separate content field, so we lean on the summary string. If the
   * owner asks us to expand any of these past ~250 lines, the right
   * move is to add a `content` field to ReferenceDescriptor and tag
   * source_type='inline'; logged in TECH-DEBT.md. */
  {
    id: 'ref-holon-basics',
    name: 'Holon basics',
    tagline: 'What is a desk, what is a staff, what is the chat for',
    icon: 'Ã°Å¸ÂÂ ',
    kind: 'company-internal',
    tags: ['holon', 'help', 'getting-started', 'concepts'],
    authority: 'Holon',
    version: '2026-05-19',
    url: '/references#ref-holon-basics',
    summary:
      '# Holon basics Ã¢â‚¬â€ what is a desk, what is a staff, what is the chat for\n' +
      '\n' +
      '## What is Holon?\n' +
      'Holon is a "desk app" where you (the owner) manage a small flat team of AI / human / CLI staff. Each desk is one workspace; one person; one team. You delegate work via chat; your staff do it; you review the result.\n' +
      '\n' +
      '## Core concepts\n' +
      '- **Desk** Ã¢â‚¬â€ your workspace. One per owner. Holds your team, your missions, your deliverables, your peer connections.\n' +
      '- **Staff** Ã¢â‚¬â€ an employee on your desk. Three substrates: AI (CLI-backed), human (real person reachable via email/chat), CLI (local terminal agent for code/ops). Flat roster Ã¢â‚¬â€ staff never own other staff.\n' +
      '- **Chat** Ã¢â‚¬â€ how you talk to your Desk AI ("Hi Sarah" by default; pick your own persona in onboarding). The Desk AI delegates work, calls skills, answers meta-questions about your team.\n' +
      '- **Mission** Ã¢â‚¬â€ a piece of incoming work from another desk over a peer connection. Lands in your Inbound (Asks) page; you accept or decline. Authority-attenuated (a sender can\'t grant rights they don\'t have).\n' +
      '- **Deliverable** Ã¢â‚¬â€ an artifact a staff member produced (.pdf, .pptx, .xlsx, markdown report, etc.). Shows up in Drops (Outputs).\n' +
      '- **Connection** Ã¢â‚¬â€ a durable peer relationship with another Holon desk. Carries handoffs (typed work arrangements) between you and them.\n' +
      '- **Skill** Ã¢â‚¬â€ a tactical capability the Desk AI calls inline (make_slides, summarize_inbox, decompose_task, etc.). Lives in the catalog at /skills.\n' +
      '- **Reference** Ã¢â‚¬â€ an external standard / spec / playbook your skills cite when running audits or shaping deliverables. Lives at /references.\n' +
      '\n' +
      '## Daily flow\n' +
      '1. **Open Today** (left rail) Ã¢â‚¬â€ see what\'s in flight: jobs running, missions pending, recent deliverables.\n' +
      '2. **Triage Inbound (Asks)** Ã¢â‚¬â€ peer missions sit here until you accept or decline. No auto-accept Ã¢â‚¬â€ owner-mediated authority.\n' +
      '3. **Chat with your Desk AI** Ã¢â‚¬â€ delegate work in plain language ("draft a 5-slide deck on AV market"; "summarize this inbox"). Desk AI picks the right skill or staff.\n' +
      '4. **Review Drops (Outputs)** Ã¢â‚¬â€ when a staff member finishes, the artifact lands here. Open, download, or send back for revision.\n' +
      '5. **Manage your Team via /members** Ã¢â‚¬â€ hire (+ Hire button), dismiss, edit role/budget/system prompt. Built-in substrates (owner-assistant, CLI) are protected.\n' +
      '6. **Manage your peers via /connections** Ã¢â‚¬â€ invite another desk, accept incoming connection requests, review handoff health.\n' +
      '\n' +
      '## What Holon is NOT\n' +
      '- Not a chatbot. The Desk AI is one staff member; the real work is done by your roster of staff.\n' +
      '- Not a project manager. There is no Gantt / sprints / story-points; the unit of work is a delegated job or an inbound mission.\n' +
      '- Not a CRM. Connections are peer-to-peer desks, not customer records.\n' +
      '\n' +
      '## Where to go next\n' +
      '- **/me** Ã¢â‚¬â€ your owner profile, language, CLI and connector config, integrations (Gmail, Feishu, Ã¢â‚¬Â¦).\n' +
      '- **/members** Ã¢â‚¬â€ your team.\n' +
      '- **/skills** Ã¢â‚¬â€ capabilities the Desk AI can call.\n' +
      '- **/references** Ã¢â‚¬â€ standards / specs / help docs the skills consult.\n' +
      '- **/templates** Ã¢â‚¬â€ fillable content shells (PRD, weekly status, offer letter).\n' +
      '- **/connections** Ã¢â‚¬â€ peers (other Holon desks).\n',
  },
  {
    id: 'ref-holon-faq',
    name: 'Holon FAQ',
    tagline: 'First-week common questions - hire, language, CLI, Gmail, slow chat',
    icon: 'Ã¢Ââ€œ',
    kind: 'company-internal',
    tags: ['holon', 'help', 'faq', 'troubleshooting'],
    authority: 'Holon',
    version: '2026-05-19',
    url: '/references#ref-holon-faq',
    summary:
      '# Holon FAQ Ã¢â‚¬â€ first-week common questions\n' +
      '\n' +
      '## Team & hiring\n' +
      '\n' +
      '### How do I hire a new staff member?\n' +
      'Go to **/members** Ã¢â€ â€™ click **+ Hire** (top-right). Fill in name, role label, system prompt, max concurrent jobs, and monthly budget. CLI staff use your local CLI subscription. Or ask the Secretary to hire a role and it can create a CLI agent for you.\n' +
      '\n' +
      '### How do I dismiss / fire a staff member?\n' +
      'On the member card on /members, click the Ãƒâ€” (only shows on user-defined staff). Built-in substrates (owner-assistant, CLI session) are protected Ã¢â‚¬â€ they cannot be dismissed. Dismissal archives the staff Ã¢â‚¬â€ past deliverables stay, but they no longer appear in the active roster and in-flight jobs cancel.\n' +
      '\n' +
      '### How do I @-mention a staff in chat?\n' +
      'Type `@` in the chat input Ã¢â€ â€™ typeahead pops up listing your roster Ã¢â€ â€™ pick one Ã¢â€ â€™ the message dispatches to that staff\'s private CLI session instead of the Desk AI. Useful when you want to talk to a specific employee directly (e.g. "@Aria what\'s your draft look like?").\n' +
      '\n' +
      '## Language & profile\n' +
      '\n' +
      '### How do I switch the UI language?\n' +
      '**/me** Ã¢â€ â€™ Settings section Ã¢â€ â€™ **Language** dropdown Ã¢â€ â€™ pick `auto` (follow browser), `English`, or `Ã¤Â¸Â­Ã¦â€“â€¡`. Takes effect on next route navigation; chat keeps replying in the language you write in.\n' +
      '\n' +
      '### How do I change my name / role / intro shown to the Desk AI?\n' +
      '**/me** Ã¢â€ â€™ Identity section. Updates the workspace snapshot the CLI context hook injects, so the Desk AI sees the new identity on its next turn.\n' +
      '\n' +
      '## CLI runtime\n' +
      '\n' +
      '### How do I choose a CLI runtime?\n' +
      'Use **/connectors** to create Claude Code or Codex CLI employees. The product uses your local CLI login and does not collect runtime API keys.\n' +
      '\n' +
      '### Which CLI runtimes are supported?\n' +
      'Today: Claude Code and Codex are supported in the create-CLI flow; Gemini/Qwen are planned adapter targets.\n' +
      '\n' +
      '## Integrations\n' +
      '\n' +
      '### How do I connect Gmail?\n' +
      '**/me** Ã¢â€ â€™ Authorizations section Ã¢â€ â€™ Gmail card Ã¢â€ â€™ click **Connect** Ã¢â€ â€™ Google consent screen. After consent, the `gmail_list_threads`, `gmail_read_thread`, `gmail_summarize_inbox` tools become callable from the Desk AI.\n' +
      '\n' +
      '### Why does Gmail keep disconnecting?\n' +
      'While our OAuth app is in Testing mode (pre-verification), Google expires refresh tokens after 7 days. Reconnect when this happens. Once the app gets through Google\'s verification (planned V1.1), tokens become long-lived.\n' +
      '\n' +
      '## Chat behavior\n' +
      '\n' +
      '### Why is my chat replying slowly?\n' +
      'Two layers: (1) CLI cold-start on first launch; (2) the warm Secretary process. Warm subsequent turns should be fast. If it is consistently slow, check the CLI session status and local machine load.\n' +
      '\n' +
      '### How do I cancel a reply mid-generation?\n' +
      'Press **Esc** OR click the red **Stop** button. Cancellation preserves any messages you queued behind it.\n' +
      '\n' +
      '### Can I send multiple messages while the AI is replying?\n' +
      'Yes. Keep typing Ã¢â‚¬â€ your messages queue up (shown as faded pills at the bottom of the chat). FIFO dispatch when the current reply finishes. Click Ãƒâ€” on a pill to drop one; click "Clear all queued" to drop everything pending.\n' +
      '\n' +
      '## Catalog management\n' +
      '\n' +
      '### How do I add my own skill / template / reference?\n' +
      '**/skills**, **/templates**, **/references** all have a **+ New** button. Use **+ New** to fill descriptor fields directly. User-defined entries appear under "Yours"; built-ins are collapsed under "Store" at the bottom.\n' +
      '\n' +
      '### Can I delete a built-in skill / reference?\n' +
      'Not hard-delete. You can soft-tombstone (hides from your view); admin reset (`POST /api/v1/admin/reset`) restores it. To get a variant, clone via + New rather than overwriting.\n',
  },
  {
    id: 'ref-holon-chat-tips',
    name: 'Chat tips',
    tagline: 'Cancel, queue, multi-staff dispatch, Esc shortcut',
    icon: 'Ã°Å¸â€™Â¬',
    kind: 'company-internal',
    tags: ['holon', 'help', 'chat', 'shortcuts', 'ui'],
    authority: 'Holon',
    version: '2026-05-19',
    url: '/references#ref-holon-chat-tips',
    summary:
      '# Chat tips Ã¢â‚¬â€ get more out of the chat surface\n' +
      '\n' +
      '## Cancel mid-generation\n' +
      '- Press **Esc** OR click the red **Stop** button while the AI is streaming.\n' +
      '- Cancel preserves your queue Ã¢â‚¬â€ anything you queued behind the cancelled turn still dispatches.\n' +
      '- Cancelling does NOT delete the partial assistant reply already streamed; it just stops the stream and ends the turn.\n' +
      '\n' +
      '## Send multiple messages while AI is replying\n' +
      '- Just keep typing Ã¢â‚¬â€ Enter submits; your message gets queued (shown as a faded "pill" at the bottom of the chat).\n' +
      '- FIFO dispatch: when the current reply finishes, the next queued message becomes the next user turn.\n' +
      '- Useful when you want to fire 3-4 follow-ups without waiting on each one.\n' +
      '\n' +
      '## Remove a queued message\n' +
      '- Hover the queued pill Ã¢â€ â€™ an Ãƒâ€” button appears on the right Ã¢â€ â€™ click to drop just that pill.\n' +
      '- When you have Ã¢â€°Â¥2 queued, a **Clear all queued** affordance appears at the top of the queue strip.\n' +
      '\n' +
      '## @-mention a staff (dispatch to a specific employee)\n' +
      '- Type `@` in the chat input Ã¢â€ â€™ typeahead pops with your active staff roster Ã¢â€ â€™ arrow keys / mouse-click to pick.\n' +
      '- The message dispatches to **that staff\'s private CLI session** rather than the Desk AI. Their session is isolated Ã¢â‚¬â€ has its own history, granted_skills, system_prompt.\n' +
      '- The reply shows up in the same chat panel, prefixed with the staff name.\n' +
      '\n' +
      '## Owner thread vs staff thread\n' +
      '- Chat with **no @** Ã¢â€ â€™ routes to the **Desk AI** (Owner persona; full workspace snapshot context).\n' +
      '- Chat with `@SomeStaff` Ã¢â€ â€™ routes to **that staff\'s** CLI runtime session (their persona; their granted_skills; their tool scope).\n' +
      '- The "thread" you see in the panel is your unified view; the routing is per-message based on the @-prefix.\n' +
      '\n' +
      '## Multi-staff dispatch (Teams-style)\n' +
      '- @-mention multiple staff in one message ("`@Aria @Drafter please coordinate on the deck`") Ã¢â€ â€™ each gets the message in their session in parallel.\n' +
      '- No calendar / no scheduling Ã¢â‚¬â€ ad-hoc dispatch only. V1 simplification; persistent group threads are V2.\n' +
      '\n' +
      '## Keyboard shortcuts (current)\n' +
      '- **Enter** Ã¢â‚¬â€ submit message (queues if AI busy).\n' +
      '- **Shift+Enter** Ã¢â‚¬â€ newline within message.\n' +
      '- **Esc** Ã¢â‚¬â€ cancel current AI reply.\n' +
      '- **@** Ã¢â‚¬â€ open staff typeahead.\n' +
      '- **/** Ã¢â‚¬â€ (planned) command palette; not yet wired.\n' +
      '\n' +
      '## Useful chat patterns\n' +
      '- **Ask for a plan first**: "draft a 5-step plan to do X then wait for my OK" Ã¢â‚¬â€ the Desk AI invokes the `decompose_task` skill and surfaces the plan before executing.\n' +
      '- **Ask for clarifying questions**: "before you start, what do you need to know?" Ã¢â‚¬â€ invokes the `ambiguity_probe` skill (1-3 sharp questions on under-specified axes).\n' +
      '- **Ask for a polished delivery**: "give me this back as a CEO dashboard" Ã¢â‚¬â€ invokes the `summarize_email_brief` skill (Ã©Å“â‚¬Ã¦Â±â€š one sentence + Ã§Â»â€œÃ¦Å¾Å“ bullets).\n',
  },
];

/**
 * Bridge: project every Template into a ReferenceDescriptor with
 * kind='output-format'. The template's body + variables stay accessible
 * via getTemplate(id); this surface gives the unified /references page
 * a single stream. URL is set to an in-app deep link the UI can route
 * (`/templates#<id>`) Ã¢â‚¬â€ owner-facing entries that don't have an
 * external authority page.
 */
function templatesAsReferences(): ReferenceDescriptor[] {
  return listTemplates().map((t) => ({
    id: t.id,
    name: t.name,
    tagline: t.tagline,
    icon: t.icon,
    kind: 'output-format' as const,
    tags: t.tags,
    authority: 'Owner',
    version: 'v1',
    url: `/templates#${t.id}`,
    summary: t.description,
    // Surface variables as "key sections" the owner can scan at a glance.
    ...(t.variables.length > 0
      ? {
          key_sections: t.variables.map((v) => ({
            id: v.name,
            title: `{{${v.name}}} Ã¢â‚¬â€ ${v.label}`,
            anchor: '',
          })),
        }
      : {}),
  }));
}

/* Ã¢â€â‚¬Ã¢â€â‚¬ CRUD (user-created references + overrides on built-ins) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
 *
 * Pattern mirrors template-catalog.ts. The unified listReferences()
 * merges:
 *   1) built-in REFERENCE_CATALOG minus tombstones, with overrides
 *   2) dynamic user-defined references, with overrides
 *   3) templates projected as output-format references (always Ã¢â‚¬â€ the
 *      template catalog is itself merge-aware via its own listTemplates).
 */

import * as mut from './mutable-store.js';
import { listTemplates } from './template-catalog.js';

function kebab(s: string): string {
  return s.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'reference';
}

function uniqueId(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let i = 0; i < 8; i++) {
    const candidate = `${base}-${Math.random().toString(36).slice(2, 6)}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

function applyReferenceOverride(r: ReferenceDescriptor, ov: Partial<ReferenceDescriptor>): ReferenceDescriptor {
  return { ...r, ...ov };
}

const REFERENCE_ICON_DEFAULT: Record<ReferenceKind, string> = {
  regulatory: 'Ã¢Å¡â€“Ã¯Â¸Â',
  'industry-standard': 'Ã°Å¸â€œÂ',
  accessibility: 'Ã¢â„¢Â¿',
  security: 'Ã°Å¸â€Â',
  'language-style': 'Ã¢Å“ÂÃ¯Â¸Â',
  'company-internal': 'Ã°Å¸ÂÂ¢',
  'output-format': 'Ã°Å¸â€œâ€ž',
};

export function listReferences(): ReferenceDescriptor[] {
  const deleted = mut.getDeletedReferenceIds();
  const overrides = mut.getReferenceOverrides();
  const fromBaseline = REFERENCE_CATALOG
    .filter((r) => !deleted.has(r.id))
    .map((r) => {
      const ov = overrides.get(r.id);
      return ov ? applyReferenceOverride(r, ov) : r;
    });
  const fromDynamic = mut.getDynamicReferences().map((r) => {
    const ov = overrides.get(r.id);
    return ov ? applyReferenceOverride(r, ov) : r;
  });
  return [...fromBaseline, ...fromDynamic, ...templatesAsReferences()];
}

export function getReference(id: string): ReferenceDescriptor | undefined {
  return listReferences().find((r) => r.id === id);
}

export interface CreateReferenceInput {
  name: string;
  kind: ReferenceKind;
  authority: string;
  version: string;
  url: string;
  tagline?: string;
  icon?: string;
  tags?: string[];
  summary?: string;
  key_sections?: { id: string; title: string; anchor: string }[];
  /** Optional explicit id (kebab-case). If omitted, derived from name. */
  id?: string;
  /** Source location flavor (defaults to 'url'). */
  source_type?: 'url' | 'file' | 'folder';
  /** Absolute path on the owner's machine when source_type is 'file'/'folder'. */
  local_path?: string;
  /** Pin a local file for exact full-document injection into the owner snapshot. */
  pinned?: boolean;
}

export function createReference(input: CreateReferenceInput): ReferenceDescriptor {
  const name = input.name.trim();
  if (!name) throw new Error('name is required');
  if (!input.kind) throw new Error('kind is required');
  if (!input.authority || !input.authority.trim()) throw new Error('authority is required');
  if (!input.version || !input.version.trim()) throw new Error('version is required');
  if (!input.url || !input.url.trim()) throw new Error('url is required');

  // Build the takenIds set against the base catalog + dynamic refs ONLY
  // Ã¢â‚¬â€ projected output-format templates share an id namespace but we
  // don't want template ids to block reference ids (the projection
  // lives in a separate kind bucket).
  const taken = new Set<string>([
    ...REFERENCE_CATALOG.map((r) => r.id),
    ...mut.getDynamicReferences().map((r) => r.id),
  ]);
  const baseId = input.id?.trim() ? kebab(input.id) : kebab(name);
  const id = uniqueId(baseId, taken);

  const record: ReferenceDescriptor = {
    id,
    name,
    tagline: (input.tagline ?? '').trim() || name,
    icon: input.icon ?? REFERENCE_ICON_DEFAULT[input.kind] ?? 'Ã°Å¸â€œÅ¡',
    kind: input.kind,
    tags: Array.isArray(input.tags) ? input.tags.filter((s): s is string => typeof s === 'string') : [],
    authority: input.authority.trim(),
    version: input.version.trim(),
    url: input.url.trim(),
    summary: (input.summary ?? '').trim(),
    ...(Array.isArray(input.key_sections) && input.key_sections.length > 0
      ? { key_sections: input.key_sections }
      : {}),
    ...(input.source_type ? { source_type: input.source_type } : {}),
    ...(input.local_path ? { local_path: input.local_path } : {}),
    ...(input.pinned !== undefined ? { pinned: input.pinned } : {}),
  };
  mut.addDynamicReference(record);
  console.log(JSON.stringify({
    audit: 'reference.created', id, name, ts: new Date().toISOString(),
  }));
  return record;
}

export function updateReference(
  id: string,
  patch: Partial<ReferenceDescriptor>,
): ReferenceDescriptor | null {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { id: _ignoredId, ...safePatch } = patch;
  const builtin = REFERENCE_CATALOG.find((r) => r.id === id);
  if (builtin) {
    if (mut.isReferenceDeleted(id)) return null;
    mut.patchReferenceOverride(id, safePatch);
    console.log(JSON.stringify({
      audit: 'reference.updated', id, fields: Object.keys(safePatch), source: 'override',
      ts: new Date().toISOString(),
    }));
    return getReference(id) ?? null;
  }
  const dyn = mut.getDynamicReference(id);
  if (!dyn) return null;
  const merged: ReferenceDescriptor = { ...dyn, ...safePatch };
  mut.addDynamicReference(merged);
  console.log(JSON.stringify({
    audit: 'reference.updated', id, fields: Object.keys(safePatch), source: 'dynamic',
    ts: new Date().toISOString(),
  }));
  return merged;
}

export function deleteReference(id: string): { ok: boolean; reason?: string } {
  const builtin = REFERENCE_CATALOG.find((r) => r.id === id);
  if (builtin) {
    if (mut.isReferenceDeleted(id)) return { ok: false, reason: 'not_found' };
    mut.markReferenceDeleted(id);
    console.log(JSON.stringify({
      audit: 'reference.deleted', id, kind: 'builtin-tombstone',
      ts: new Date().toISOString(),
    }));
    return { ok: true };
  }
  const removed = mut.removeDynamicReference(id);
  if (!removed) return { ok: false, reason: 'not_found' };
  console.log(JSON.stringify({
    audit: 'reference.deleted', id, kind: 'user-defined',
    ts: new Date().toISOString(),
  }));
  return { ok: true };
}

export function isBuiltInReference(id: string): boolean {
  return REFERENCE_CATALOG.some((r) => r.id === id);
}

export function listPinnedFileReferences(): ReferenceDescriptor[] {
  return listReferences().filter((r) => r.pinned === true && r.source_type === 'file');
}

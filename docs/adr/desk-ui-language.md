# ADR: Desk UI Language Policy (English-First with Controlled ZH Surfaces)

**Status:** Accepted (2026-05-30; owner authorized me to make the call per "按 backlog 自主接")
**Track:** Task #18 (desk UI language mix)
**Scope:** `apps/web/` (desk). Does NOT apply to `apps/mobile/` (微作, ZH-first).

## Context

The desk web UI was already mostly English, but with ad-hoc Chinese strings creeping in. Owner constraint (see `feedback_myc_ui_language` memory note): **desk apps/web = English (i18n for zh later, no hardcoded Chinese); mobile 微作 = Chinese**. Task #18 sat on "needs owner direction" for weeks because the rule needed concretizing: *where* exactly is ZH allowed, and through what mechanism?

The desk audience is the manager working in an EN-native engineering context (GitHub, README, docs, code all EN). The mobile audience is the ZH-first owner+小秘 chat experience.

## Decision

**The desk web UI is English-first.** ZH appears in exactly three controlled surfaces:

1. **Onboarding (opt-in ZH).** The first-launch flow MAY display ZH alternates when `?lang=zh-CN` is in the URL or the browser locale matches `zh-*`. Default remains EN. This covers the "Chinese SMB owner tries MYC for the first time" case without polluting steady-state UI.
2. **Persona content (verbatim).** Owner-authored persona definitions in `~/holon-agents/boss/...` may contain Chinese names, descriptions, or system prompts. The desk **renders them verbatim** — no translation, no transliteration, no normalization. Owner's data, owner's script.
3. **Conversation content (pass-through).** What owner types and what an agent responds is in whatever language the conversation happens in. The desk never overrides, auto-translates, or warns.

**Persona role labels are English.** Static UI chrome — sidebar headers, navigation, buttons, settings labels, even the *role* names ("Secretary", "Code Reviewer", "7×24 Manager") — stays English, regardless of whether owner's memory uses 中文 internally for the same concept.

## Rationale

- README, docs, repo, GitHub issues are all EN. A bilingual UI on top of an EN source tree creates a fractured experience for contributors.
- Mobile (微作) is the ZH-native surface; the split is by device, not by string.
- Freely mixed EN chrome + ZH buttons is exactly the "hardcoded Chinese" mode owner rejected.
- Opt-in ZH onboarding addresses the first-touch friction case without committing the whole product to bilingual maintenance.

## Mechanism

The i18n infrastructure already exists at `apps/web/lib/i18n/`:
- `useT.ts` — translation hook
- `get-effective-language.ts` — locale resolution
- `I18nProvider.tsx` — context
- `dictionary/` — EN as source, ZH as override

**Convention this ADR ratifies:**
- Every NEW user-facing string in `apps/web/` MUST be added through `useT()` with an EN source entry.
- ZH entries are added **lazily** — only when an onboarding surface or a string genuinely warrants it. Do NOT pre-translate everything.
- Existing hardcoded EN strings are left as-is for now (extraction to i18n keys is a follow-up slice, out of scope here).

## What this ADR does NOT do

- Does not move any existing hardcoded Chinese strings. (If any exist, follow-up task.)
- Does not add a language toggle to the UI. (Future slice.)
- Does not translate the README, docs, or this ADR to ZH.
- Does not change `apps/mobile/`. 微作 stays ZH-first per the same memory note.
- Does not introduce a build-time language gate or lint rule. (Future, if churn warrants.)

## Open questions (deferred, not blocking)

- **Date format:** user locale, `en-US` default.
- **Number format:** same.
- **RTL languages (Arabic/Hebrew):** out of scope for v0.x.
- **Future locales (日本語 / 한국어):** same i18n mechanism, same English-first principle. Add when a real user asks.

## References

- Memory note: `feedback_myc_ui_language` (owner's original constraint)
- README `## Glossary` section (canonical EN terms for project nouns)
- i18n implementation: `apps/web/lib/i18n/`
- Sibling ADRs: `connectors-vs-plugins.md`, `role-templates-and-persona-composition.md`

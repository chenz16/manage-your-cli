# Role-template seed catalog

Companion to `docs/adr/role-templates-and-persona-composition.md` (Part C).
This is a **seed plan** — none of these files exist on disk yet. Owner
reviews the ADR; seeding lands as a follow-up PR.

## Seed roles

| ID | One-line | Suggested `compose_with` defaults | Likely source |
|---|---|---|---|
| `secretary` | Owner-facing project secretary; dispatches, never executes. | `[7x24-manager]` | owner-authored (memory: `project_holon_724_manager`) |
| `7x24-manager` | Continuous-ops manager: dispatch don't DIY, surface only 🔴, never block on input. | `[]` | owner-authored (memory: `feedback_manager_orchestrate_only`) |
| `product-manager` | Owns the what/why, ships specs, prioritizes backlog, runs reviews. | `[writer-editor]` | f/awesome-chatgpt-prompts + reshape |
| `frontend-engineer` | UI implementation (React/Next), accessibility, perf budgets. | `[code-reviewer]` | wshobson/agents |
| `backend-engineer` | API/services/data layer, schemas, migrations. | `[code-reviewer, security-auditor]` | wshobson/agents |
| `mobile-engineer` | iOS + Android (RN / native), app-store delivery. | `[code-reviewer]` | wshobson/agents |
| `designer` | UX flows, IA, visual system, prototype review. | `[product-manager]` | f/awesome-chatgpt-prompts |
| `qa-tester` | Test plans, repro reports, regression gates. | `[]` | wshobson/agents |
| `code-reviewer` | Reviews diffs for correctness, simplification, regressions. | `[]` | wshobson/agents + owner skill `code-review` |
| `security-auditor` | Threat modelling, dependency audit, secret scanning. | `[code-reviewer]` | wshobson/agents (security category) |
| `writer-editor` | Docs, READMEs, release notes, copy edits. | `[]` | f/awesome-chatgpt-prompts |
| `marketer` | Positioning, landing copy, channel scripts. | `[writer-editor]` | f/awesome-chatgpt-prompts (+ owner `project_holon_marketing`) |
| `legal-reviewer` | License / ToS / privacy red-flagging (advisory, not legal advice). | `[]` | f/awesome-chatgpt-prompts |
| `finance-analyst` | Unit economics, runway, pricing scenarios. | `[]` | f/awesome-chatgpt-prompts |
| `customer-support` | Triage tickets, draft replies, route escalations. | `[writer-editor]` | f/awesome-chatgpt-prompts |

## Tag taxonomy (initial)

Used by `holon-create-agent`'s fuzzy match (§3 step 1):

- `ops`, `communication`, `project-management`
- `engineering`, `frontend`, `backend`, `mobile`, `review`, `security`
- `product`, `design`, `qa`
- `content`, `writing`, `marketing`
- `legal`, `finance`, `support`

## Notes

- `secretary` and `7x24-manager` are the two canonical owner-authored
  roles; they're the ones the owner's daily flow depends on, so they
  should land first.
- Engineering cluster (`frontend`, `backend`, `mobile`, `code-reviewer`,
  `security-auditor`, `qa-tester`) should land as a group — they
  cross-compose constantly.
- `compose_with` defaults are suggestions only — owner overrides at
  create-agent time.

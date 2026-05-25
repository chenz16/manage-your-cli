# Tech debt — skill usage statistics

**Status:** approximate version shipped (mobile); real source deferred.
**Owner decision (2026-05-25):** ship ①+② near-term, file ④ as tech debt.

## Problem

We are a thin shell: skills are invoked BY the CLI when it picks a capability
from natural language. There is **no hard "skill X invoked" event** anywhere —
the skill catalog is descriptors, and many skills are `implemented: false`
(not wired to execute at all). So there is nothing exact to count.

## What shipped (approximate, mobile)

`SkillUsageView` in `apps/mobile/.../WeizoApp.tsx`, reachable at 我 → 资产 → 使用统计.
Per skill, an **approximate** count from:
- ① deliverable titles matching the skill's name/tags/head-noun keywords
- ② owner chat transcript messages matching the same keywords
- ③ local taps in the skill panel (localStorage `holon.mobile.recentSkills.v1`)

Ranked desc, labelled **约**. Honest: intent/mention ≠ execution. Desktop link
for the (future) full view.

## The real way (deferred — ④)

Make skills **real MCP tools** (Holon MCP / the CLI-backed runtime). Then every
invocation is a tool call observable at our boundary:

1. Emit a single audit event `skill.invoked { id, caller, ts }` at the MCP
   tool-call boundary (same shape as the existing `skill.created/updated/deleted`
   audit lines in `packages/core/src/skill-catalog.ts`).
2. Persist counts (reuse the mutable-store / a small SQLite table).
3. Read API `GET /api/v1/skills/usage`.
4. Replace the mobile approximation with the real counts; keep the desk link.

This is gated on skills actually executing — doing ④ also forces the
"skills become real, runnable tools" work the owner wants. Until then, ①+②
is the honest stand-in.

## Also related

Model/CLI token usage (`usage-stats.ts`, `/api/v1/usage`) is **Claude-only**
today (parses Claude local logs). Extending to codex/gemini/qwen (read each
CLI's own session logs) is a separate, parallel piece of debt.

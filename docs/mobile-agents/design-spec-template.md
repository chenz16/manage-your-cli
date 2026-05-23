# Design Spec — `<item-id>` · `<surface-name>`

> **How to use this template.** Copy this file to `iterations/<current-iter>/design-specs/<item-id>-spec.md` and fill every section. The Dev Agent reads the resulting spec verbatim to ship code; ambiguity = bug. Per `docs/mobile-agents/design-agent.md`, every section MUST be filled (no "TBD" except in §7 Open Questions). Delete this blockquote in the final spec.

**Drafted:** `<ISO-8601 UTC, e.g., 2026-05-18T04:30Z>`
**Designer:** `mobile-design-agent` (run #`<n>`)
**Source M-L / Pass:** `<link to docs/mobile-deltas.md anchor or iterations/.../plan.md line>`
**Target surface:** `<route (e.g., /more) or component path (e.g., apps/mobile/components/PhoneShell.tsx)>`
**Predecessor spec:** `<previous spec for this surface, or "none — greenfield">`

---

## 1. Visual goal (≤2 sentences)

`<What the user sees and feels after this lands. State the user-facing intent, not the implementation.>`

Example: _"The /more page status row reads as a single horizontal rhythm — three equal columns with desk-token gold accents on the active item, paper background, 16px vertical breathing room above and below."_

---

## 2. Concrete dimensions

All values are px or token references. No "small / medium / appropriate."

| Property | Value | Notes |
|---|---|---|
| Width | `<token or px>` | e.g., `100%` or `393px` (iPhone 14 viewport) |
| Height | `<token or px>` | |
| Padding (inline) | `<token>` | e.g., `var(--space-3)` |
| Padding (block) | `<token>` | |
| Gap (between children) | `<token or px>` | |
| Border radius | `<token or px>` | |
| Border width | `<px>` | |

Add rows for any surface-specific dimensions (icon size, avatar size, badge offset).

---

## 3. CSS tokens used

List every token referenced. The Design Agent has already verified these exist in `apps/web/app/globals.css` (desk source of truth). Mobile inherits via `apps/mobile/app/globals.css` import; if a token is missing, file a desk-side delta first — do NOT patch.

| Token | Purpose in this spec |
|---|---|
| `--paper` | Background |
| `--ink` | Primary text |
| `--gold` | Active / accent |
| `--space-3` | Padding |
| ... | ... |

---

## 4. DOM hierarchy

Class names, nesting, and order are exact. Use desk's `src/ui-mock/_shared/components.css` class names where one exists; do NOT invent new class names.

```html
<section class="more-section">
  <header class="more-section__header">
    <h2 class="more-section__title"></h2>
  </header>
  <div class="more-section__row">
    <button class="more-section__item more-section__item--active"></button>
    <button class="more-section__item"></button>
    <button class="more-section__item"></button>
  </div>
</section>
```

---

## 5. State variations

Enumerate every state the surface can reach. At minimum: default, active, disabled, loading, empty, error — include the ones reachable in this surface.

| State | Token / class | Notes |
|---|---|---|
| Default | `more-section__item` | Resting state |
| Active | `more-section__item--active` | Gold accent, bolder text |
| Disabled | `more-section__item--disabled` | `opacity: 0.4`, cursor: not-allowed |
| Loading | `more-section__item--loading` | Skeleton shimmer (desk's `.skeleton` token) |
| Empty | `more-section__empty` | "No items yet" hint |
| Error | `more-section__error` | Red border (`var(--danger)`), inline error text |

---

## 6. Smoke checks (Dev Agent must verify before commit)

Each check is a runnable command or a specific visual assertion. The Dev Agent runs these verbatim.

- [ ] `pnpm -F api-contract typecheck && pnpm -F core typecheck && pnpm -F mobile typecheck` — all PASS
- [ ] `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3002/<route>` — returns `200`
- [ ] Viewport `393×852` (iPhone 14): `<one-sentence visual assertion>` (e.g., "three columns fit on one row, no overflow")
- [ ] Viewport `1920×1080` (desktop preview): `<one-sentence visual assertion>` (e.g., "phone shell centered, mibusy dark gradient outside")
- [ ] No console errors in `/tmp/holon-dev.log` after the page renders (`tail -8 /tmp/holon-dev.log`)
- [ ] All states from §5 are reachable via fixture data or `?state=` query param

---

## 7. Open questions (Dev Agent decides)

Keep ≤3 items. Each has a recommended default so Dev can ship even if the human is offline.

- **Q1:** `<the choice>`. Recommended default: `<answer>`. Why: `<one line>`.
- **Q2:** `<the choice>`. Recommended default: `<answer>`. Why: `<one line>`.

---

## 8. Out of scope (do NOT ship in this pass)

Explicitly list adjacent polish the Dev Agent might be tempted to do but should leave for a follow-up M-L. Prevents scope creep.

- `<thing>` — file as `M-L-NNN` if worth doing.

---

## Sign-off

- Design Agent: spec complete, all sections filled, tokens verified against desk's globals.css. Marker flipped to `[design-done: <SHA>]`.
- Dev Agent (later): smoke checks above all PASS, commit ships under `feat|fix(mobile-daemon): <item-id> · <one-line>`.

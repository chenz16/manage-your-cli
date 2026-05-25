# 微作 (Weizo) Mobile — Visual Polish Plan
**Audit date:** 2026-05-25  
**Auditor:** Senior product/visual designer  
**Benchmark:** WeChat (dark-mode reference screenshots in `/bugs/bug-20260525-140025-11pf5w9z/`)  
**Scope:** Visual polish only — no behavior or feature changes.

---

## 0. Design Tokens — Proposed CSS Variables (Foundation)

Replace the current scattered hard-coded greens and grays with a single coherent palette. Paste this into `:root` in `apps/mobile/app/globals.css`, replacing the current ad-hoc values.

```css
:root {
  /* ── Brand green — ONE source of truth ───────────────────────────── */
  --brand:        #1f7a44;   /* primary green: nav active, CTAs, links  */
  --brand-light:  #edf6f0;   /* tint fills: selected option, pill bg    */
  --brand-dim:    #c0ddc8;   /* tint borders: persona pill border       */
  --brand-ink:    #1a5e34;   /* text ON --brand-light (≥4.5:1)          */

  /* ── Chat bubble green (WeChat convention) ───────────────────────── */
  --bubble-user:  #95ec69;   /* outgoing bubble fill — keep per WeChat  */
  --bubble-ink:   #111111;   /* text on --bubble-user                   */

  /* ── Semantic status fills (background / text) ───────────────────── */
  --status-run-bg:   #e0f4e8;   /* running: green tint                  */
  --status-run-ink:  #1a5e34;
  --status-queue-bg: #f0f0f0;   /* queued: neutral                      */
  --status-queue-ink:#555555;
  --status-done-bg:  #eef3fb;   /* completed: blue tint                 */
  --status-done-ink: #315f9a;
  --status-fail-bg:  #fff0ee;   /* failed: red tint                     */
  --status-fail-ink: #c0392b;

  /* ── Surfaces ─────────────────────────────────────────────────────── */
  --surface-page: #ededed;   /* chat/list page background               */
  --surface-card: #ffffff;   /* card / bubble / row background          */
  --surface-nav:  #f7f7f7;   /* header + bottom nav background          */
  --surface-search: #ececec; /* search bar pill background              */

  /* ── Dividers ─────────────────────────────────────────────────────── */
  --div-strong: #d8d8d8;     /* nav top border                          */
  --div-light:  #ececec;     /* row separator, card inner lines         */

  /* ── Ink scale ────────────────────────────────────────────────────── */
  --ink-primary:   #111111;  /* titles, names                           */
  --ink-secondary: #333333;  /* body text                               */
  --ink-tertiary:  #777777;  /* sublabels, timestamps, role text        */
  --ink-muted:     #aaaaaa;  /* placeholders, disabled                  */

  /* ── Type scale (mobile-only) ─────────────────────────────────────── */
  --text-title:   17px;   /* page/nav titles  — weight 650             */
  --text-body:    15px;   /* row titles, names — weight 600            */
  --text-default: 14px;   /* body copy, inputs — weight 400            */
  --text-sub:     13px;   /* role/status sub-labels — weight 400       */
  --text-caption: 12px;   /* timestamps, tokens, labels — weight 400   */
  --text-badge:   11px;   /* status pills, model chips — weight 600    */

  /* ── Radii ────────────────────────────────────────────────────────── */
  --r-card:    8px;    /* profile hero, me-section, config cards       */
  --r-avatar:  8px;    /* contact-list square avatars                  */
  --r-avatar-sm: 6px;  /* recipient switcher small avatars             */
  --r-bubble:  14px;   /* chat bubbles                                 */
  --r-sheet:   16px;   /* bottom sheets top radius                     */
  --r-pill:    999px;  /* all status/model pills                       */

  /* ── Touch ────────────────────────────────────────────────────────── */
  --tap: 44px;         /* HIG minimum                                  */
}
```

**Element → token mapping (quick reference)**

| Element | Fill | Text | Border |
|---|---|---|---|
| Bottom nav active icon/label | — | `--brand` | — |
| Active tab underline | `--brand` | — | — |
| Primary action btn (保存, 发送 CTA) | `--brand` | `#fff` | `--brand` |
| "更换" persona pill | `--brand-light` | `--brand-ink` | `--brand-dim` |
| Chat input focus ring | — | — | `--brand` |
| Chat send button | `--brand` | `#fff` | — |
| Contacts refresh btn text | `--brand` | — | — |
| Outgoing bubble | `--bubble-user` | `--bubble-ink` | — |
| Online dot / pulse dot | `--brand` | — | — |
| QR corner brackets | `--brand` (hardcoded `#1AAD19` → replace) | — | — |
| QR scan line | `--brand` | — | — |
| Running status pill | `--status-run-bg` | `--status-run-ink` | — |
| Page background | `--surface-page` | — | — |
| Row / card background | `--surface-card` | — | — |
| Header / nav background | `--surface-nav` | — | — |

---

## P0 — Critical (visible in every screenshot, hurts credibility)

---

### P0-1 · Four separate greens create a fractured brand signal

**Problem:** The CSS contains at least four distinct green values used for semantically identical purposes — all meaning "brand / active / positive":
- `#1f7a44` — nav active, CTAs, links, persona pill, action buttons
- `#2ecc71` / `#27ae60` — language toggle active state (`globals.css:2265`)
- `#1AAD19` — QR corner brackets + scan line (`globals.css:2219–2228`)
- `#2e7d52` / `#2E7D52` — online dot, `chatmsg-avatar` bg, kanban pulse dot

None of these are the same hue. The QR scan line (`#1AAD19`) is a noticeably yellower lime; the language button (`#2ecc71`) is a lighter emerald; `#2e7d52` is a darker forest green. Side-by-side on screen they read as inconsistency, not depth.

**Why it matters:** On the 我 tab the language button and the 更换 persona pill sit in the same card. The button is `#2ecc71` (light lime), the pill border is `#d8e8dd` / bg `#edf6f0` which derives from `#1f7a44`. The contrast between them is immediately visible.

**Fix:** Collapse all five values to `--brand` (`#1f7a44`) for fills and `--brand-light`/`--brand-dim` for tints. Specific changes:

```css
/* globals.css line 2265 — language toggle active */
.mobile-me-lang-btn.is-active {
  background: var(--brand);           /* was: #2ecc71 */
  border-color: var(--brand);         /* was: #27ae60 */
  color: #fff;
  font-weight: 600;
}

/* globals.css line 2219–2228 — QR corners + scan line */
.mobile-qr-corner { border-color: var(--brand); }   /* was: #1AAD19 */
.mobile-qr-scanline {
  background: linear-gradient(90deg, transparent, var(--brand), transparent);
}

/* globals.css line 829 — online status dot */
.s-online-dot { background: var(--brand); }         /* was: #2E7D52 */

/* globals.css line 2064 — kanban pulse dot */
.weizo-kanban-pulse-dot { background: var(--brand); }/* was: #2e7d52 */

/* globals.css line 1341 — chatmsg-avatar */
.chatmsg-avatar { background: var(--brand); }        /* was: #2e7d52 */
```

---

### P0-2 · Bottom nav active state: gold underline mismatches green icons

**Problem:** The `底部 tab` (`.bottom-tabs` / `.tab-link`) uses the old **gold** system (`--gold` for the active indicator bar, `--gold-soft` for the active background). But all other interactive affordances in the Weizo shell use green (`--brand`). The result is visible in `me.png`: the 我 icon is green yet the gold shimmer from the tab bar pulls in a completely different colour system.

Looking at the WeChat reference: active tab icons are green on white — no gold. The app has a dual identity: the legacy "holon desk gold theme" leaking into the WeChat green shell.

**Why it matters:** The tab bar is rendered on every screen. The gold highlight reads as a design error rather than a deliberate accent.

**Fix:** Replace gold active state with brand green:

```css
/* globals.css lines 197–213 */
.tab-link.active {
  background: var(--brand-light);   /* was: var(--gold-soft) */
  color: var(--ink);
  font-weight: 700;
}

.tab-link.active::before {
  background: var(--brand);         /* was: var(--gold) */
}
```

Note: the `mobile-bottom-nav` / `mobile-tab-button.is-active` already correctly uses `color: #1f7a44`. The legacy `.tab-link` is only reached in the non-WeChat shell paths, but both must be consistent.

---

### P0-3 · 我 tab header uses WRONG navigation bar component

**Problem:** The 我 tab header in all `me-*.png` screenshots reads "我" in what appears to be the `mobile-wechat-header` component — a centered `17px / weight:650` title on `#f7f7f7` background. This is correct. However the QR button (`mobile-me-qr-btn`) renders as a flat `#f0efeb` square-rounded button with no visible icon on gray, making it look like a blank button next to the title. In the WeChat Me reference, the QR icon is the same weight as the title text — immediately readable.

**Fix:** Increase icon contrast and make the button purpose legible:

```css
/* globals.css lines 2206–2212 */
.mobile-me-qr-btn {
  background: var(--surface-nav);        /* unchanged */
  color: var(--ink-secondary);           /* was: #3a3a3a — same, fine */
  border: 1px solid var(--div-light);    /* ADD — gives it a visible edge */
  width: 40px; height: 40px;            /* reduce from 44px — less clunky */
  border-radius: 10px;
}
```

---

### P0-4 · Contact list avatar corners: inconsistent radius vocabulary

**Problem:** Contacts/staff use `.mobile-avatar` with `border-radius: 8px` (square-rounded, WeChat style — correct). But the `.chatmsg-avatar` (inside chat bubbles) uses `border-radius: 8px` too, yet `.s-avatar` (the legacy staff card) uses `border-radius: 50%` (circle), and the new `StaffAvatar` component uses `.mobile-staff-avatar2` with `border-radius: 18px` (heavily rounded square). Three different avatar shapes in adjacent contexts.

From the `contacts-search.png`: the four avatar shapes are all rounded-square, which is correct and matches WeChat. The inconsistency surfaces in the employee detail view where the large avatar jumps to a very heavy radius.

**Fix:** Establish one avatar vocabulary — WeChat uses consistently rounded-square at `~8px` for small and `~12px` for large. Apply via token:

```css
/* globals.css — add --r-avatar: 8px and --r-avatar-lg: 12px to :root (above) */

/* Line 1149 — contact row avatar */
.mobile-avatar { border-radius: var(--r-avatar); }    /* was: 8px ✓ */

/* Line 1339 — chat message avatar */
.chatmsg-avatar { border-radius: var(--r-avatar); }   /* was: 8px ✓ */

/* Line 1595 — StaffAvatar large (employee detail hero) */
.mobile-staff-avatar2 { border-radius: var(--r-avatar-lg, 12px); } /* was: 18px — too heavy */

/* Line 818 — legacy s-avatar (staff cards) */
.s-avatar { border-radius: var(--r-avatar); }         /* was: 50% — wrong shape */
```

---

### P0-5 · Chat input focus ring: inconsistent color and visual weight

**Problem:** `.m-chat-input:focus` (old chat, `globals.css:498`) uses `--green` (`#2E7D52`) for focus ring. The new WeChat-shell chat input (`.mobile-chat-composer .chat-input`) has `border-color: transparent` with no focus style at all (`globals.css:1264–1266`). The `.weizo-todo-input:focus` uses `border-color: #1f7a44`. Three different treatments for focus on text inputs.

WCAG 2.4.7 requires a visible focus indicator. The chat input having none is a real accessibility gap.

**Fix:**

```css
/* globals.css — new unified focus style after :root block */
.chat-input:focus,
.mobile-staff-field:focus,
.mobile-persona-editor-textarea:focus,
.weizo-todo-input:focus,
.mobile-term-input:focus {
  outline: none;
  border-color: var(--brand);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--brand) 18%, transparent);
}
```

---

## P1 — High Impact (noticeable on casual use, quick wins)

---

### P1-1 · 我 tab section cards: radius/padding out of sync with WeChat style

**Problem:** The 我 tab uses `.mobile-me-section` with `border-radius: 8px` and `.mobile-me-profile` with `border-radius: 8px`. These are correct for the WeChat-style grouped list. However the gap between cards is `10px` (`gap: 10px` on `.mobile-me`), and the padding is `12px` outer + `13px/14px` inner. WeChat uses a consistent `12px` outer margin with `~8px` inter-card gap on its 我 page. The current spacing reads slightly too loose.

The `me.png` screenshot shows the QR code card and language cards each have visible white space around them that feels inconsistent — some cards have generous internal padding, others are tight.

**Fix:**

```css
/* globals.css line 2244–2246 */
.mobile-me {
  gap: 8px;              /* was: 10px — tighten inter-card gap */
  padding: 10px 12px;    /* was: 12px — marginally tighter outer */
}

/* Ensure all me-section cards have uniform inner padding */
.mobile-me-section { padding: 12px 14px; }  /* was: 13px 14px — standardize */
.mobile-me-profile { padding: 12px 14px; }  /* was: 14px — standardize */
```

---

### P1-2 · 通讯录 list: rows lack visual separation from gray page background

**Problem:** In `contacts-search.png`, the white contact rows sit on the `#ededed` page background with only a `1px #ececec` bottom divider between them. The row list itself has `background: #fff` but there is no top/bottom margin from the page edge — the list bleeds to the edges. WeChat wraps its Contacts list in a white card that has a clear boundary from the gray page background.

Additionally the search bar (`background: #ececec`) renders correctly but it sits in the list scroll container; WeChat renders it in a separate sticky header layer above the list, which makes it feel anchored.

**Fix:**

```css
/* globals.css line 1137–1139 — contacts/staff list */
.mobile-list {
  /* Remove edge-to-edge white; let individual rows carry white bg */
  background: transparent;
}

/* Row hover/active region still white, with subtle outer context */
.mobile-row {
  background: var(--surface-card);
  /* Add 1px top border to the first child so the group has a clear cap */
}
.mobile-row:first-of-type {
  border-top: 1px solid var(--div-light);
}
```

For the search bar, add `position: sticky; top: 0; z-index: 10;` to `.mobile-search-bar` to make it always visible during scroll — currently it scrolls away immediately.

---

### P1-3 · Chat composer: send button wrong shape/color for WeChat shell

**Problem:** In `chats.png` the send button renders as a round button with `background: #1f7a44` and `↑` glyph at `36×36px`. This is correct. However the active state styling uses `background: var(--gold)` for `.m-chat-send` (old chat, line 500–503), while the new WeChat shell send button has `.mobile-chat-composer .chat-send { background: #1f7a44 }` (line 1268). The two chat shells have different send button colors. If any path renders the old `.m-chat-send`, it will appear gold instead of green.

The `↑` arrow glyph is a Unicode character at `font-size: 18px; font-weight: 600`. WeChat uses an icon. The raw character looks noticeably rougher on non-Latin fonts.

**Fix:** Unify send button styling. Replace the gold-backgrounded `.m-chat-send` with the brand green:

```css
/* globals.css line 499–503 */
.m-chat-send {
  background: var(--brand);    /* was: var(--gold) — gold is wrong here */
  color: #fff;
}
```

And for the arrow glyph, consider replacing `↑` with an SVG chevron (same as the existing `IconSpeaker`/`IconCopy` pattern already used in the action strip) to avoid font-rendering variation.

---

### P1-4 · Typography: body font size inconsistency across row types

**Problem:** The codebase has at least 6 different values for what is semantically "row title" text:
- `.mobile-row-title`: `15.5px / weight 600`
- `.s-name`: `14px / weight 600`
- `.weizo-kanban-todo-title`: `14px / weight 600`
- `.weizo-kanban-job-name`: `13px / weight 600`
- `.mobile-staff-profile-name`: `18px / weight 700`
- `.mobile-row-title` (WeChat rows): `15.5px / weight 600`

And for secondary text:
- `.mobile-row-sub`: `12.5px`
- `.s-role`: `13px`
- `.weizo-kanban-job-latest`: `12px`
- `.mobile-job-sub`: `12px`
- `.weizo-kanban-deliv-meta`: `12px`

The title size especially: `15.5px` (contact rows) vs `14px` (kanban) vs `13px` (job names) creates a hierarchy that reads as accidental, not designed.

**Fix:** Apply the proposed type scale tokens. In practice:

```css
/* globals.css — update the following to align to the scale */

/* Row titles → --text-body (15px) */
.mobile-row-title     { font-size: var(--text-body, 15px); }   /* was: 15.5px */
.weizo-kanban-todo-title { font-size: var(--text-body, 15px); }/* was: 14px */
.weizo-kanban-job-name   { font-size: var(--text-body, 15px); }/* was: 13px */

/* Sublabels → --text-sub (13px) */
.mobile-row-sub       { font-size: var(--text-sub, 13px); }    /* was: 12.5px */
.weizo-kanban-job-latest { font-size: var(--text-sub, 13px); } /* was: 12px */

/* Timestamps / tokens → --text-caption (12px) — already mostly correct */
```

---

### P1-5 · QR Hub bottom sheet: mixed background colors, missing grip indicator

**Problem:** In `qr-hub.png` the bottom sheet background is `#f2f2f2` (`.mobile-sheet` line 2196). The sheet header has no grip pill (the dark modal drag indicator WeChat and iOS standard sheets always show). The close button is a `28×28px` circle (`×` char at `18px`) which is below the 44px touch target minimum.

Inside the sheet, the "扫一扫 / 扫码连接" button is a plain bordered rectangle with an emoji (`🔍` equiv) — it looks unfinished compared to WeChat's styled scanner entry points.

**Fix:**

```css
/* globals.css line 2193–2200 */
.mobile-sheet {
  background: var(--surface-nav);   /* #f7f7f7 — slightly lighter than #f2f2f2 */
}

/* Add grip pill — insert before .mobile-sheet-head */
.mobile-sheet::before {
  content: "";
  display: block;
  width: 36px; height: 4px;
  border-radius: 2px;
  background: var(--div-strong);
  margin: 0 auto 10px;
}

/* Fix close button touch target */
.mobile-sheet-close {
  width: 44px; height: 44px;       /* was: 28×28 — below HIG minimum */
  border-radius: 50%;
  font-size: 20px;
}
```

---

### P1-6 · Recipient switcher: avatar uses `background: #e8f3ec; color: #1f7a44` (hardcoded) vs owner `#2e7d52` — inconsistent

**Problem:** In `chats.png`, the recipient switcher shows "对话: 小秘" with a small 26×26 avatar. The avatar for non-owner staff uses `background: #e8f3ec; color: #1f7a44` while the owner avatar uses `background: #2e7d52; color: #fff` (`.mobile-recipient-avatar-owner`, line 1102). These two greens side-by-side in the same row look inconsistent.

**Fix:**

```css
/* globals.css line 1099–1101 */
.mobile-recipient-avatar {
  background: var(--brand-light);   /* was: #e8f3ec — use token */
  color: var(--brand);              /* was: #1f7a44 — use token */
}

/* globals.css line 1102 */
.mobile-recipient-avatar-owner {
  background: var(--brand);         /* was: #2e7d52 — unify with brand */
  color: #fff;
}
```

---

## P2 — Nice to Have (polish pass)

---

### P2-1 · Status pills: rectangular radius (4px) vs pill (999px) — used interchangeably

**Problem:** Job status pills in `.mobile-job-status` use `border-radius: 4px` (rectangular). All other status pills in the app (`.m-job-status`, `.m-badge-*`, `.weizo-kanban-status-pill`) use `border-radius: 999px` (pill). These appear in the same 看板 view. WeChat status chips are uniformly pill-shaped.

**Fix:** Update `mobile-job-status` to use `--r-pill`:
```css
.mobile-job-status { border-radius: var(--r-pill); padding: 2px 8px; }
```

---

### P2-2 · "配置" chevron / action text in contact rows is extremely low-contrast

**Problem:** `.mobile-row-action { color: #8a8a8a; font-size: 12px }` — the text "配置" at 12px in gray on white is approximately 3.3:1 contrast ratio. WCAG 1.4.3 requires 4.5:1 for normal text. This small gray text on a 12px caption is likely failing. WeChat uses a `>` chevron icon at the same position, not a text label.

**Fix:**
```css
.mobile-row-action {
  color: var(--ink-tertiary);    /* #777 — ≈4.5:1 on white — was #8a8a8a */
  font-size: 13px;               /* bump from 12px for legibility */
}
```

Better still: replace the "配置" text with a right-pointing chevron SVG (matching `.mobile-collapse-chevron` or `.m-chev` pattern elsewhere), which is how WeChat's contacts disclosures work.

---

### P2-3 · Employee detail hero card: grid layout with double caption lines looks awkward

**Problem:** The `StaffProfile` component renders `StaffAvatar` (64px) alongside a `<span>` for the name and a second `<span class="mobile-staff-cap">双击名字进入聊天</span>` below it as an instruction. This instruction text (`color: #a8a39a; font-size: 11px`) serves a discoverability purpose but looks like placeholder/debug text in a customer-facing app. WeChat's contact detail shows avatar + name + ID cleanly — no inline instructions.

**Fix:** Remove the `双击名字进入聊天` caption from the visual presentation (keep the `onDoubleClick` handler, just add a subtle tooltip or remove the instruction entirely — the gesture is discoverable). The `点图换头像` caption below the avatar is similarly extraneous; an edit pencil icon (already rendered via `.mobile-staff-avatar2-edit`) is sufficient affordance.

In `WeizoApp.tsx` around line 2172–2178: remove the two `<span className="mobile-staff-cap">` elements.

---

### P2-4 · 看板 board sub-tab underline uses `border-bottom: 2px solid #1f7a44` inline — not tokenized

**Problem:** `.weizo-board-tab.is-active` (line 1731–1734) uses `color: #1f7a44` and `border-bottom: 2px solid #1f7a44` as hardcoded hex rather than `var(--brand)`. If the brand color is updated in the token block, these will not update.

**Fix:**
```css
.weizo-board-tab.is-active {
  color: var(--brand);
  border-bottom-color: var(--brand);
}
```

---

### P2-5 · Empty state panel in 通讯录/看板 lacks context

**Problem:** `.mobile-empty-panel` renders: "还没有员工。" — 13px gray text in a white rounded rectangle with `margin: 12px; padding: 14px`. No icon, no action. WeChat's empty states include an icon and a short explanatory line.

**Fix:** Wrap empty state content with a consistent layout — centered vertically, a 32px icon (emoji or SVG), a short title line (`14px/600`), and a muted hint (`13px/#777`). No CTA needed for read-only states.

```css
/* globals.css — upgrade .mobile-empty-panel */
.mobile-empty-panel {
  margin: 24px 12px;
  padding: 20px 16px;
  border-radius: var(--r-card);
  background: var(--surface-card);
  color: var(--ink-tertiary);
  font-size: var(--text-sub);
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
```

---

### P2-6 · Spacing: 4/8px grid violations across the kanban section

**Problem:** Kanban cards use a mix of `5px`, `6px`, `7px`, `10px`, `11px`, `13px` padding values. Examples:
- `.weizo-kanban-todo-body`: `padding: 11px 13px 10px` — none of these are on a 4px grid
- `.weizo-kanban-job-card`: `padding: 12px 13px 10px` — 13px is off-grid
- `.weizo-kanban-job-actions`: `gap: 6px` — fine (6 = 4+2, acceptable)
- `.weizo-kanban-todo-actions`: `gap: 5px` — off-grid

WeChat's list rows use clean `12px` vertical / `14px` horizontal padding throughout.

**Fix:** Round all padding/gap values to the nearest 4px:
```css
/* globals.css lines 1874–1881 */
.weizo-kanban-todo-body { padding: 12px 12px 10px; }  /* was: 11px 13px 10px */

/* globals.css lines 1927–1933 */
.weizo-kanban-job-card  { padding: 12px 12px 10px; }  /* was: 12px 13px 10px */

/* globals.css lines 1909–1915 */
.weizo-kanban-todo-actions { gap: 4px; }               /* was: 5px */
```

---

## Touch Target Audit

| Component | Current size | HIG min (44px) | Status |
|---|---|---|---|
| `.mobile-row` | `min-height: 64px` | 44px | PASS |
| `.mobile-tab-button` | flex stretch / `--mobile-nav-height: 64px` | 44px | PASS |
| `.mobile-voice-button` | `38×38px` | 44px | FAIL — 6px short |
| `.mobile-sheet-close` | `28×28px` | 44px | FAIL — 16px short |
| `.mobile-attach-button` | not sized in CSS | unknown | NEEDS AUDIT |
| `.contacts-refresh-btn` | `min-height: 30px` | 44px | FAIL — 14px short |
| `.mobile-persona-change` pill | `min-height: 34px` | 44px | FAIL — 10px short |
| `.weizo-todo-action` | `padding: 2px 7px` no height set | ~28px est. | FAIL |
| `.mobile-back-button` | `padding: 6px 4px` no min-height | ~28px est. | FAIL |

**Priority fix for all FAILs:**
```css
/* Add to each failing component */
.mobile-voice-button    { min-width: var(--tap); min-height: var(--tap); }
.mobile-sheet-close     { min-width: var(--tap); min-height: var(--tap); }
.contacts-refresh-btn   { min-height: var(--tap); }
.mobile-persona-change  { min-height: var(--tap); }
.mobile-back-button     { min-height: var(--tap); }
.weizo-todo-action      { min-height: 32px; padding: 6px 10px; } /* group: 2×actions */
```

---

## Contrast / Legibility Issues

| Text | Color | Background | Ratio | Status |
|---|---|---|---|---|
| `.mobile-row-action` "配置" | `#8a8a8a` | `#fff` | ~3.3:1 | FAIL AA (12px) |
| `.mobile-kanban-aging` ⏳N天 | `#9a6a3a` | `#fff` | ~3.8:1 | BORDERLINE |
| `.mobile-row-tokens-na` | `#b0aca4` | `#fff` | ~2.8:1 | FAIL AA |
| `.mobile-staff-cap` | `#a8a39a` | `#fff` | ~2.4:1 | FAIL AA |
| `.weizo-kanban-sample-badge` | `#8a6418` | `#f5e9d0` | ~4.2:1 | BORDERLINE |
| `.mobile-me-status` 在线 | `#1f7a44` | `#fff` | ~5.6:1 | PASS |
| `.mobile-row-title` | `#111` | `#fff` | ~19:1 | PASS |
| `.chatmsg-bubble-user` text | `#111` | `#95ec69` | ~8.5:1 | PASS |

**Fixes:**
```css
.mobile-row-action      { color: #666; }   /* from #8a8a8a → ~5:1 */
.mobile-row-tokens-na   { color: #888; }   /* from #b0aca4 → ~3.7:1 (caption size, AA Large) */
.mobile-staff-cap       { color: #777; }   /* from #a8a39a → ~4.5:1 */
```

---

## Summary: Top 8 Fixes by Impact

1. **P0-1** — Collapse 4 greens to `--brand: #1f7a44` (language button, QR scan line, online dot, chatmsg avatar). One color change, visible on every screen.
2. **P0-2** — Tab bar active state: swap gold `--gold-soft / --gold` indicator to `--brand-light / --brand`. Fixes the most jarring WeChat-vs-desk conflict.
3. **P0-4** — Avatar radius: normalize to `8px` (rows/chat) / `12px` (large hero). Kills the `50%` circle vs `18px` rounded-square inconsistency.
4. **P0-5** — Chat input focus ring: add `border-color: var(--brand)` + shadow to the WeChat-shell `.chat-input:focus`. Currently invisible.
5. **P1-1** — 我 tab card gap: reduce from `10px` to `8px` and standardize section padding to `12px 14px`. Single CSS change, tightens the whole tab.
6. **P1-4** — Row title sizes: align `.mobile-row-title` (15.5→15px), kanban job/todo titles (13–14→15px) to a single `--text-body: 15px` token.
7. **P1-5** — QR Hub sheet: add grip pill `::before`, fix close button to 44×44px.
8. **Touch targets** — `mobile-voice-button` (38→44px), `mobile-sheet-close` (28→44px), `mobile-persona-change` (34→44px), `contacts-refresh-btn` (30→44px). Four one-line fixes addressing real tap-failure risk on device.

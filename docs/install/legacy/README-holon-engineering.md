# Install Holon Personal Edition V1

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

**Welcome to Holon Personal Edition V1 — your AI desk assistant for small business owners.** Holon runs as a desk app on your PC. A small flat team of AI staff sits on the desk and does the things you'd otherwise context-switch through: read your inbox, draft replies, summarize the morning, file deliverables. You delegate; they execute; you review. No cloud, no SaaS account — the desk and your data live on your own machine.

This page is the entry point. Pick your install path below, walk the step-by-step doc it links to, and you'll have a working desk in ~15 minutes (plus a one-time ~15 min Google Cloud setup if you want Gmail integration on day one).

You got a `.exe`, an `.apk`, or both from someone — open this page on the device you're installing on, pick the row that matches your file, and follow.

---

## What Holon is (one paragraph)

Holon is a **desk app**. Your AI staff — the things that read your email, draft replies, summarize your inbox — run on your **PC**. The phone app (Android or iPhone) is just a **window into the same desk**: it does not run staff on its own, and it talks to your PC over your home Wi-Fi. So you install the PC piece first; the phone piece is optional and goes on top.

---

## Pick your install path

| You have… | Install this | What you get | Time |
|---|---|---|---|
| **Windows 10/11 PC + `Holon_X.Y.Z_x64-setup.exe`** | [`windows.md`](./windows.md) **(start here — required)** | The desk itself. Your AI staff run here. | ~5 min install + ~15 min Gmail setup |
| Android phone + `Holon-vX.Y.Z.apk` | [`android.md`](./android.md) | Phone-side view of your desk. Optional. China primary mobile path. | ~5 min |
| iPhone (no `.apk` exists for iOS) | [`iphone-pwa.md`](./iphone-pwa.md) | Phone-side view of your desk, installed from Safari as a home-screen icon. Optional. | ~5 min |

**Mac or Linux desktop?** Not shipped in V1. The codebase supports them (per ADR-005) but no installer is built yet — building from source is possible if you're comfortable with `pnpm dev`; otherwise wait for V2. See the repo `README.md` "How to get started" section.

---

## Pre-requisites checklist (before you double-click anything)

- [ ] **A PC running Windows 10 (1809+) or Windows 11.** This is your desk host — the AI staff run here, not in the cloud.
- [ ] **~500 MB free disk space.** The Windows installer is ~500 MB (Hermes runtime + bundled Python + WebView2 client). Larger than a typical productivity app — see TD-007 in `TECH-DEBT.md` for the V1.1 trim plan; modern installers (Cursor 600 MB, VS Code + extensions 300-500 MB) routinely match this size.
- [ ] **A modern browser** (Chrome / Firefox / Edge / Safari). Holon's UI runs in your default browser via `localhost:3000` — any current evergreen browser works.
- [ ] **~5 minutes for first setup.** Double-click the `.exe`, click through Next-Next-Finish, app opens. The Gmail OAuth setup below is a separate one-time chunk.
- [ ] **(Phone install only) Same Wi-Fi as the PC.** Phone reaches the PC over your home LAN; there is no cloud relay in V1.

---

## What you'll need before starting (the two things we can't automate for you)

These are the **two manual steps the customer owns** — Holon cannot do them for you because they involve external services that require your identity:

1. **A Google account** (only if you want Holon to read your Gmail). A burner / test account is fine. Free tier works.
2. **Willingness to do a one-time Google Cloud Console setup** (~15 minutes, walked step-by-step in [`../integrations/gmail-oauth.md`](../integrations/gmail-oauth.md)). You'll create your own Google Cloud project, enable the Gmail API, generate an OAuth client ID + secret, and paste them where Holon asks. This is "the hardest part" of V1 install — it's a one-time gauntlet because Google requires every app reading Gmail to have its own credentials. **V1.1 will replace this with Composio (single-click integrations); V1 has the manual path.**

If you skip Gmail, Holon still works — the AI staff can chat, hold context, run on-desk skills (PDF generation, summarization, etc.). Gmail integration just unlocks the inbox-reading skills.

---

## Install order

1. **PC first.** Open [`windows.md`](./windows.md), finish the whole page (download, install, first-run setup, sign-in). Don't skip first-run; it sets where your data lives and generates the local encryption key that protects any OAuth tokens.
2. **Connect Gmail (optional).** When the onboarding wizard hits Step 3, follow [`../integrations/gmail-oauth.md`](../integrations/gmail-oauth.md) for the Google Cloud Console walkthrough.
3. **Phone second (optional).** Only after the PC is running and reachable on Wi-Fi. Android users open [`android.md`](./android.md); iPhone users open [`iphone-pwa.md`](./iphone-pwa.md). Both ask you to pair with the PC over LAN.

---

## Where things live (TL;DR)

- **Your data:** `%LOCALAPPDATA%\com.holon.desk\` and `%APPDATA%\com.holon.desk\` on Windows. **Local-only — no cloud sync, no SaaS account.** Backups: copy those two folders.
- **Your OAuth tokens (if you connect Gmail):** stored AES-256-GCM-encrypted inside the local SQLite DB. Key is machine-local (`HOLON_TOKEN_ENC_KEY` under `%APPDATA%\com.holon.desk\`).
- **Logs (when troubleshooting):** `%LOCALAPPDATA%\com.holon.desk\logs\`.

---

## Questions you might have

- **"Do I need all three?"** No. You need Windows (the desk). Android and iPhone are alternative phone clients — pick one if you want phone access, or skip both.
- **"Is my data on someone else's server?"** No. V1 is local-only: your data lives on the PC you install Holon on. The phone app reads it from your PC over LAN. The only outbound traffic is (a) Gmail API calls when an inbox skill runs and (b) LLM API calls to whichever provider you configured (DeepSeek by default, BYOK per ADR-011).
- **"What's an 'iPhone PWA'?"** A web page that installs as a home-screen icon and launches full-screen, like a native app — but without the App Store. The whole iPhone install is "open Safari, tap Share, tap Add to Home Screen." See [`iphone-pwa.md`](./iphone-pwa.md).
- **"My installer says SmartScreen blocked it."** Expected — V1 ships unsigned. Click **More info** → **Run anyway**. Code-signing is on the V1.1 roadmap. See `windows.md` § 7 Troubleshooting.
- **"Can I uninstall cleanly?"** Yes. Control Panel → Programs → Holon → Uninstall removes the program. Your data dir is preserved so a reinstall picks up where you left off; to wipe everything, delete `%APPDATA%\com.holon.desk\` and `%LOCALAPPDATA%\com.holon.desk\` after uninstalling.
- **"V1.1 / V2 — what changes?"** Code-signing (no more SmartScreen warning), Composio integration (no more 15-min Google Cloud Console gauntlet), auto-updater, OS keychain for tokens, cloud relay for phone access off-LAN, Mac/Linux installers.

---

## Cross-references

- [`windows.md`](./windows.md) — Windows install (the main path)
- [`android.md`](./android.md) — Android APK sideload
- [`iphone-pwa.md`](./iphone-pwa.md) — iPhone PWA install
- [`../integrations/gmail-oauth.md`](../integrations/gmail-oauth.md) — Gmail OAuth: 9-step Google Cloud setup + token / revocation / audit details
- Repo root `README.md` — developer / contributor entry point (not for end users)
- `TECH-DEBT.md` TD-007 — V1.1 installer size reduction plan

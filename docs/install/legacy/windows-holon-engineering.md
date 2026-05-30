# Install Holon on Windows (Superseded — sister-repo V1 installer)

> **Status: Superseded / legacy.** This document is the V1 Windows installer
> guide for the sister repo
> [`holon-engineering`](https://github.com/chenz16/holon-engineering) —
> a Tauri 2.x desktop app that bundled the **Hermes** runtime
> (`hermes-acp` / `hermes_profile_generic_v1`).
>
> **`manage-your-cli` (this repo) has no Windows installer.** The desk runs on
> WSL/Linux from CLI subscriptions (`claude` / `codex` / `gemini` / `qwen`)
> via the multi-CLI adapter under
> [`packages/core/src/cli-adapters.ts`](../../../packages/core/src/cli-adapters.ts)
> and [`apps/web/lib/warm-agent.ts`](../../../apps/web/lib/warm-agent.ts);
> mobile clients are Android/iOS PWAs that connect to the desk.
>
> The body below is preserved unedited for history. Do not follow these
> instructions to install `manage-your-cli`.

Holon Personal Edition V1 ships as a Windows desktop application built with Tauri 2.x. This page walks through downloading the installer, first-run setup, where your data lives, and uninstalling.

Supported: Windows 10 (1809+), Windows 11, Windows Server 2019 / 2022. WSL2 hosts can run the same `.exe` from the Windows side (Holon does not need WSL).

**Time budget:** ~5 minutes for the install itself (download → double-click → first-launch), plus ~15 minutes for the one-time Google Cloud Console setup if you want Gmail integration on day one (skippable; add it later from the `/me` Authorizations panel). See [`../integrations/gmail-oauth.md`](../integrations/gmail-oauth.md) for the Gmail walkthrough.

---

## 1. Download the installer

> **Heads-up — V1.1 will make this easier.** Today the Holon source code lives in a private GitHub repository, and there is no public download page yet. The paths below reflect that reality. A one-click download page is on the V1.1 roadmap; until then, **path C (direct file send from whoever shared Holon with you) is the simplest** if you're a non-developer test user.

> **Repo access prerequisite (paths A + B).** The `holon-engineering` repo is private during V1; no `vX.Y.Z` release has been cut yet. Until that happens, the only way to download an installer through GitHub is path A, and that requires a GitHub account that has been added as a collaborator to the repo (ask the owner who shared the installer with you). Without collaborator access, GitHub's pages below return "not found" — use path C.

**A. Download the latest build from GitHub Actions** (current path for early testers + V1 customers with collaborator access)

> **What is this path doing?** GitHub is where Holon's source code lives. Every time we change the code, GitHub's build server produces a fresh installer and parks the resulting file (called an "artifact") in the **Actions** tab as a downloadable zip. You sign in with your free GitHub account, find the most recent green-checkmark build, scroll to the **Artifacts** section at the bottom of that build's page, and click the zip to download. The `<some-letters-and-numbers>` you'll see in the filename is just a code-version stamp — you do not need to understand it; any recent green build works.

1. Sign in at <https://github.com> with the GitHub account that was added as a collaborator (see prerequisite above). A free account is fine.
2. Open <https://github.com/chenz16/holon-engineering/actions/workflows/windows-installer.yml>. (If you see a "not found" page, you do not yet have collaborator access — use path C.)
3. Click the row at the top of the list — it should have a green checkmark.
4. Scroll to the **Artifacts** section near the bottom of that page. Click `holon-personal-windows-<some-letters-and-numbers>.zip` to download it.
5. Unzip the file, then double-click `Holon_X.Y.Z_x64-setup.exe` (NSIS installer — the V1 ship target). (V1 dropped MSI per TD-009; the WiX MSI path returns in V1.1.)

**B. Latest tagged release** — *coming soon, once `v0.1.0` is cut.*

Once the first `vX.Y.Z` tag lands and a GitHub Release is published, end users will be able to download the installer directly from <https://github.com/chenz16/holon-engineering/releases> without navigating the Actions UI. Until then this path returns a "not found" error (repo is private + zero `v*` tags); use path A or C.

**C. Direct file from your test-user shepherd** (recommended for non-developer V1 test users)

If you got Holon from someone who said "here's the installer, try it" — they sent you `Holon_X.Y.Z_x64-setup.exe` directly (Slack DM, WeChat, email attachment, USB stick, OneDrive link, etc.). Just save the file somewhere you can find it (Desktop or Downloads is fine) and skip to § 2.

> **How big is the file?** ~500 MB. Larger than a typical app installer; that's because Holon bundles its own Python runtime (the "Hermes" sidecar that runs AI skills) so you don't have to install Python yourself. Modern installers in this size class: Cursor ~600 MB, VS Code + extensions 300-500 MB. V1.1 will trim this (see `TECH-DEBT.md` TD-007).

**D. Build it yourself from source** (developers only)

If you have the repo cloned, Rust + MSVC + Node + pnpm + Python installed, and want to produce the `.exe` locally without using GitHub Actions:

```powershell
# from native Windows PowerShell (not WSL bash)
cd \\wsl$\Ubuntu-22.04\home\<you>\project\holon-engineering
powershell -ExecutionPolicy Bypass -File scripts\build-windows-installer-local.ps1
```

Output lands at `apps\web\src-tauri\target\release\bundle\nsis\Holon_X.Y.Z_x64-setup.exe`. The script is idempotent and refreshes PATH from the Windows registry at start, so it works whether you launch it from a native PowerShell window or from WSL via interop. See the script header for prereq install commands (`winget install Rustlang.Rustup ; rustup default stable`, etc.).

The installers are **not yet code-signed** in V1. SmartScreen will warn "Windows protected your PC" on first launch — click **More info** → **Run anyway**. This is expected for V1; code-signing is on the V1.1 roadmap.

---

## 2. Install

NSIS (`.exe`) — double-click + Next-Next-Finish:

1. Double-click `Holon_X.Y.Z_x64-setup.exe`.
2. If SmartScreen blocks: click **More info** → **Run anyway** (V1 is unsigned, see § 7).
3. Click through the wizard (default install location: `%LOCALAPPDATA%\Programs\Holon\`). No admin password needed — the installer runs as your current user (`bundle.windows.nsis.installMode: currentUser`).
4. ~500 MB install → expect ~2-3 minutes depending on disk speed.
5. Launch Holon from the Start menu or desktop shortcut.

> **MSI for managed deployment is V1.1.** V1 ships NSIS only (TD-009 — the WiX `light.exe` step fails on the deep Hermes bundle paths). For fleet rollout via Intune / SCCM / Group Policy, wait for V1.1 or use the NSIS silent flag (`Holon_X.Y.Z_x64-setup.exe /S`).

---

## 3. First launch + onboarding wizard

When the app starts, your default browser opens **`http://localhost:3000`** (the Tauri shell drives a local Next.js server). If a browser doesn't pop, manually open <http://localhost:3000> in Chrome / Firefox / Edge.

A 5-step onboarding wizard fires (iter-012 Pass #3):

1. **Welcome** — pick your persona (default: Founder / Solo GM — the small-business-owner template).
2. **Admin account** — set the owner email and a local password (stored hashed in the user-data SQLite DB; never leaves your machine).
3. **Connect Gmail** — clicking this opens a new browser tab into Google's OAuth flow.
   - **First-time Gmail connect on a fresh install requires a one-time Google Cloud Console setup (~15 min).** This is the hardest part of the V1 install — Google requires every app reading Gmail to have its own OAuth credentials, and the setup is unavoidable in V1 (V1.1 ships a Composio integration that hides this gauntlet).
   - **Follow [`../integrations/gmail-oauth.md`](../integrations/gmail-oauth.md) step by step before clicking Connect Gmail** — it walks you through creating a Google Cloud project, enabling the Gmail API, configuring the OAuth consent screen, adding yourself as a test user, creating the OAuth client (Web type), pasting redirect URIs in the right box (this is the #1 mistake), saving, copying the Client ID + Secret, and pasting them into Holon.
   - After the OAuth flow completes, Google's callback returns to `http://localhost:3000/api/auth/callback/google` (NextAuth v5 handles it per ADR-024) and redirects to `/me?integration_connected=gmail`. Holon polls `/api/v1/me` to pick up the connection. Switch back to the Holon window — Step 3 auto-advances within ~2 seconds.
   - **You can skip this and add Gmail later** from the `/me` Authorizations panel; the rest of Holon (chat, skills, deliverables) works without it.
   - Deep-link `holon://` callback (so the redirect lands inside the Tauri window instead of the system browser) is deferred to iter-014+ per Q-007 — the V1 installer does NOT register it.
4. **Pick starter skills** — the per-persona `starter_staff` + `starter_greeting` (iter-012 Pass #4). Defaults are fine for first use.
5. **Done** — Holon polls the deliverables endpoint and renders your first dashboard.

You can re-run onboarding any time from the `/me` page (AC-2.5).

---

## 4. Where your data lives (it's local-only — no cloud)

All Holon state lives under your Windows user profile. **No data leaves your machine** unless you explicitly connect an external service (Gmail, Slack, etc.) per Engineering Rule #6 (owner-mediated authority). There is no Holon SaaS account, no cloud sync, no telemetry pipeline.

| What | Path |
|---|---|
| Tauri app data (config, identity, mutable store, SQLite) | `%APPDATA%\com.holon.desk\` |
| Tauri local app cache | `%LOCALAPPDATA%\com.holon.desk\` |
| Logs (Holon shell + Node sidecar + Hermes sidecar) | `%LOCALAPPDATA%\com.holon.desk\logs\` |
| OAuth tokens (AES-256-GCM, keyed by `HOLON_TOKEN_ENC_KEY`) | inside the SQLite DB at `%APPDATA%\com.holon.desk\holon.db` |
| `HOLON_TOKEN_ENC_KEY` (auto-generated on first run, per ADR-022 / iter-011 Pass #1) | `%APPDATA%\com.holon.desk\token-enc-key` |

These paths resolve via Tauri 2.x's `app_data_dir()` / `app_local_data_dir()` for identifier `com.holon.desk`. On Windows that maps to the standard Roaming / Local profile dirs.

**To back up your desk:** copy `%APPDATA%\com.holon.desk\` to safe storage. Restore by copying back to the same path on the same machine (the encryption key is machine-local — restoring on a different machine will lose access to OAuth tokens; you re-Connect them after restore).

---

## 5. Updating

V1 has no auto-updater (deferred to iter-013+). To update, download the newer installer per § 1 and run it — the installer preserves your `%APPDATA%\com.holon.desk\` data dir.

---

## 6. Uninstall

**Windows 10/11:** **Control Panel → Programs → Programs and Features → Holon → Uninstall** (or **Settings → Apps → Installed apps → Holon → Uninstall**). You can also run `%LOCALAPPDATA%\Programs\Holon\uninstall.exe` directly.

The uninstaller removes the program files only. **Your data dir `%APPDATA%\com.holon.desk\` is left in place** so a reinstall picks up where you left off (jobs, deliverables, staff roster, OAuth tokens all preserved).

To remove all data (including OAuth tokens):

```powershell
Remove-Item -Recurse -Force "$env:APPDATA\com.holon.desk"
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\com.holon.desk"
```

Then revoke the Gmail OAuth grant at <https://myaccount.google.com/permissions> for a full server-side disconnect.

---

## 7. Troubleshooting

| Symptom | Likely cause | Action |
|---|---|---|
| **App won't start / SmartScreen blocks launch** | Unsigned binary — Windows Defender (or SmartScreen) is being cautious about an unrecognized publisher | Click **More info** → **Run anyway** on the SmartScreen dialog. If Windows Defender quarantined the installer, open **Windows Security → Protection History** → find the Holon entry → **Allow on device** → re-run the installer. V1 is unsigned (code-signing scheduled for V1.1). |
| Window opens then white screen | Node sidecar failed to start | Check `%LOCALAPPDATA%\com.holon.desk\logs\` — look for `[holon-desk:err:sidecar_missing]` or port-3000 conflict. If another app is using port 3000, close it and re-launch Holon. |
| **Can't connect Gmail / OAuth shows `invalid_client` or `redirect_uri_mismatch`** | The Google Cloud Console setup is incomplete or has a mismatch (most common: redirect URI pasted in the wrong box, or Gmail API not enabled) | Follow [`../integrations/gmail-oauth.md`](../integrations/gmail-oauth.md) step by step — it has per-error troubleshooting for each Google error message. The #1 mistake is pasting the callback URL into "Authorized JavaScript origins" instead of "Authorized redirect URIs". |
| Gmail OAuth never returns to Holon | Callback browser tab closed before NextAuth finished | The redirect lands on `http://localhost:3000/api/auth/callback/google` in your default browser (Tauri `holon://` deep-link is deferred to iter-014+ per Q-007). Wait for the tab to bounce through `/me?integration_connected=gmail`, then return to the Holon window — the `/api/v1/me` poll picks it up. If still stuck, check `%LOCALAPPDATA%\com.holon.desk\logs\` for NextAuth errors. |
| Hermes skills fail (`make_pdf`, `summarize_inbox`) | Python sidecar missing or quarantined by Windows Defender | First check `%LOCALAPPDATA%\com.holon.desk\logs\holon-desk.log` for `[holon-desk:err:hermes_spawn_failed]`. If Windows Defender quarantined `hermes-sidecar.exe`, open **Windows Security → Protection History** → **Restore** + add an exclusion for `%LOCALAPPDATA%\Programs\Holon\resources\hermes-sidecar\`. If the file is genuinely missing, reinstall. |
| Chat hangs > 30 s on first `@邮件小秘` | Hermes sidecar not running OR DeepSeek (or your configured LLM provider) API key missing | Check `%LOCALAPPDATA%\com.holon.desk\logs\holon-desk.log` for `[hermes:err]` lines. Most common: `DeepSeek API key not set` — set `DEEPSEEK_API_KEY` in the bundled `.env`. See `iterations/016-hermes-runtime-bundling/demo-recipe-windows.md` § 7 for the full Hermes troubleshooting matrix. |

For bugs not in this table, open an issue at <https://github.com/chenz16/holon-engineering/issues> with the contents of the `logs/` dir attached (or send to your test-user shepherd if you don't have repo access).

---

## Cross-references

- [`../integrations/gmail-oauth.md`](../integrations/gmail-oauth.md) — Gmail OAuth: 9-step Google Cloud Console setup, token storage, revocation, audit
- [`README.md`](./README.md) — V1 install landing page (all platforms)
- `.github/workflows/windows-installer.yml` — the GHA build pipeline producing the installer
- `scripts/build-windows-installer-local.ps1` — the local PowerShell build script (path D in § 1)
- `apps/web/src-tauri/tauri.conf.json` — bundle config (NSIS target under `bundle.windows`; MSI dropped per TD-009)
- `docs/decisions/005-v1-desktop-tauri.md` — why Tauri (ADR-005)
- `iterations/012-tauri-desktop/` — the iteration that delivered the desktop shell
- `iterations/016-hermes-runtime-bundling/demo-recipe-windows.md` — iter-016 acceptance smoke recipe (AC-5; the full end-to-end Windows VM walkthrough)
- `TECH-DEBT.md` TD-007 — Hermes bundle ~500 MB trim plan for V1.1
- `TECH-DEBT.md` TD-009 — MSI bundle restore for V1.1

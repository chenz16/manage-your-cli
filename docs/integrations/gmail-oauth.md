# Gmail OAuth — Connect, Revoke, Audit

Companion doc for the **Connect Gmail** step in onboarding (`docs/install/windows.md` § 3). Explains:

- The 9-step Google Cloud Console setup you need to do **before** clicking Connect Gmail (the hardest part of V1 install).
- Exactly which Google permissions Holon asks for.
- Where the token lives on your machine, how to revoke at any time, and what the audit log records.

So you can answer the "is this safe?" question before you click **Allow**.

> **Heads-up: this is the hardest part of V1 install. ~15 minutes, one time.** Google requires every app that reads Gmail to bring its own OAuth credentials. There is no shortcut in V1 — you create your own Google Cloud project and OAuth client, then paste the resulting Client ID + Secret into Holon. V1.1 will replace this with a Composio-mediated single-click flow (ADR-027 proposed); until then, follow § 1 below carefully. Most install failures we've seen are someone pasting the redirect URL into the wrong box on Google's Credentials screen — § 1 calls this out explicitly.

---

## 1. The 9-step Google Cloud Console setup

Do this **before** clicking **Connect Gmail** in Holon's onboarding wizard. ~15 minutes. You'll end with a Client ID + Client Secret that you paste into Holon at the end.

### Step 1 — Create (or reuse) a Google Cloud project

1. Open <https://console.cloud.google.com> in your browser. Sign in with the Google account whose Gmail you want Holon to read.
2. Top bar → click the **project picker** (says "Select a project" or the name of the current one) → **New Project**.
3. Name it anything (e.g. "Holon Personal") → **Create**.
4. Wait ~10 seconds for the project to be created, then click **Select Project** on the notification (or pick it from the project picker).

> *[screenshot: GCP Console project picker → "New Project" button]*

**If you see an error:**
- *"You have reached the limit of 10 projects"* — personal Gmail accounts cap at 10 projects. Delete an old project you don't need, then retry. **APIs & Services → no, go to the top-level menu → IAM & Admin → Manage Resources** → tick an unused project → **Delete**.

### Step 2 — Configure the OAuth consent screen

1. Left sidebar (hamburger menu top-left) → **APIs & Services → OAuth consent screen**.
2. **Audience: External** (radio button). "Anyone with a Google Account" is the label — you'll still control test-user access on a later sub-screen, so it's not actually public. → **Create**.
3. **App information:** fill in:
   - **App name:** e.g. "Holon Personal" (this is what shows on the consent screen the user sees)
   - **User support email:** your own email
   - (Skip logo, app domain, etc. — not needed for V1.)
4. **Developer contact information:** your own email → **Save and Continue**.

> *[screenshot: GCP Console "OAuth consent screen" → External + App info form]*

**If you see an error:**
- *"You must specify a support email"* — you missed the **User support email** dropdown above the "Developer contact" section. Both fields are required.
- *Project picker is on the wrong project* — the consent-screen settings are per-project; check the top bar shows the project from Step 1.

### Step 3 — Add scopes

1. On the **Scopes** screen (next step of the consent-screen wizard), click **Add or remove scopes**.
2. In the filter box, type `gmail.readonly` (no leading slash) → tick `.../auth/gmail.readonly`.
3. Clear the filter, type `userinfo.email` → tick `.../auth/userinfo.email`.
4. (Optional: `userinfo.profile` if you want Holon to show your display name on `/me`.)
5. **Update** → **Save and Continue**.

> *[screenshot: GCP Console "Add scopes" panel with gmail.readonly + userinfo.email ticked]*

**If you see an error:**
- *"Sensitive scope — your app will require verification"* — this is **informational, not blocking** for V1. The `gmail.readonly` scope is classified as "sensitive" by Google; you can still test it without verification by adding yourself as a test user (Step 4). The warning becomes blocking only when you want to publish the app to a public audience (V2+ work, not V1).

### Step 4 — Add yourself as a test user

1. **Test users** sub-screen → **+ Add users**.
2. Enter your own Google email address (the one whose Gmail Holon will read) → **Add** → **Save and Continue**.
3. Summary screen → **Back to Dashboard**.

> *[screenshot: GCP Console "Test users" panel with your email added]*

**If you see an error:**
- *Forgot to add yourself as a test user* — the consent screen will refuse with *"Access blocked: This app's request is invalid"* when you try to Connect Gmail in Step 9. Come back to **APIs & Services → OAuth consent screen → Test users → + Add users**.

### Step 5 — Create the OAuth client (Web application type)

1. Left sidebar → **APIs & Services → Credentials**.
2. **+ Create Credentials** (top of the page) → **OAuth client ID**.
3. **Application type:** **Web application** (this is critical — Holon V1 uses NextAuth's web-redirect flow, NOT the desktop / installed-app flow despite running on Windows).
4. **Name:** anything (e.g. "Holon Personal Local") — this is just for your own reference in the Credentials list.

> *[screenshot: GCP Console "Create Credentials" → "OAuth client ID" → "Application type: Web application"]*

**If you see an error:**
- *"You need to configure the consent screen first"* — go back and finish Steps 2-4. The consent screen must exist before any OAuth client can be created in this project.

### Step 6 — Set Authorized JavaScript origins (no path)

In the same "Create OAuth client ID" form:

1. Scroll down to **Authorized JavaScript origins** → **+ Add URI**.
2. Paste **`http://localhost:3000`** — **no trailing slash, no path**, just origin (scheme + host + port).

> *[screenshot: GCP Console "Authorized JavaScript origins" with `http://localhost:3000`]*

**If you see an error:**
- *"Invalid Origin: must end with a public top-level domain"* — that error only appears for non-localhost URIs; `http://localhost:3000` is special-cased and works. If you see this error you probably pasted `http://localhost:3000/api/auth/callback/google` (which includes a path) — that goes in the **next** box (Step 7), not this one. **This is the #1 mistake in V1 install.**

### Step 7 — Set Authorized redirect URIs (with path)

Still in the same form, scroll one more section down:

1. **Authorized redirect URIs** → **+ Add URI**.
2. Paste **`http://localhost:3000/api/auth/callback/google`** — the full path (no trailing slash).

> *[screenshot: GCP Console "Authorized redirect URIs" with the full callback URL]*

This is the box that catches most people. The **origin** (no path) and the **redirect URI** (full path) go in DIFFERENT boxes — the form has them stacked vertically, the labels are easy to miss.

**If you see an error:**
- After connecting in Holon, Google shows *"redirect_uri_mismatch"* — the URL in this box doesn't exactly match what NextAuth is sending. Check character-for-character: `http://localhost:3000/api/auth/callback/google` — must be `http` (not https), port 3000, full path `/api/auth/callback/google`, no trailing slash, no `www`.

### Step 8 — SAVE → copy the Client ID + Client Secret

1. Click **CREATE** at the bottom of the form. **You MUST click Create — leaving the page or hitting browser-back loses everything you just entered.**
2. A pop-up appears showing **Your Client ID** + **Your Client Secret** — both are long random strings.
3. **Copy both.** Paste them somewhere safe (a temporary scratch file is fine — you'll paste them into Holon in Step 9, then can delete the scratch).
4. **OK / Done** to dismiss the pop-up.

> *[screenshot: GCP Console "OAuth client created" pop-up with Client ID + Secret highlighted]*

**If you need them again later:** **APIs & Services → Credentials** → click the **OAuth 2.0 Client IDs** row you just created → you can copy Client ID from the top; for the Secret you may need to click **Reset Secret** (which invalidates the old one). Better to copy carefully the first time.

### Step 9 — Enable the Gmail API

1. Left sidebar → **APIs & Services → Library**.
2. Search **"Gmail API"** → click the **Gmail API** result.
3. Click **ENABLE**.
4. Wait ~10 seconds for "API enabled" confirmation.

> *[screenshot: GCP Console "Gmail API" library page with ENABLE button]*

**Why this step exists, separately from creating the OAuth client:** in Google Cloud, OAuth clients and API enablement are two independent things. You can have a perfectly configured OAuth client and still get *"403: Gmail API has not been enabled"* on your first API call. If you skip this step, Holon's first `summarize_inbox` call will fail with that exact 403.

**If you see an error:**
- *"Gmail API not found"* — you're searching the wrong library. Make sure you're in **APIs & Services → Library** (not Marketplace, not IAM). The search box is at the top of the page.
- *"You must select a project"* — top bar; confirm the project from Step 1 is selected.

### Final step — Paste Client ID + Secret into Holon

**Go back to Holon.** In the onboarding wizard at Step 3 (Connect Gmail), the UI shows two text fields:

1. **Google OAuth Client ID** — paste the Client ID you copied in Step 8.
2. **Google OAuth Client Secret** — paste the Client Secret you copied in Step 8.
3. Click **Save & Connect**.
4. Your browser opens to the Google OAuth consent screen → sign in with the **test user** account you added in Step 4 → click through the *"Google hasn't verified this app"* warning (see § 3 below for why this is safe) → grant `gmail.readonly`.
5. Browser tab bounces through `/api/auth/callback/google` → `/me?integration_connected=gmail`.
6. **Switch back to the Holon window.** Step 3 auto-advances within ~2 seconds. You're done.

If you skipped onboarding earlier and want to connect now: open `/me` → **Authorizations** section → **Connect Gmail**. Same two fields.

---

## 2. What Holon asks for

Holon requests one OAuth scope on Gmail:

| Scope | Effect |
|---|---|
| `https://www.googleapis.com/auth/gmail.readonly` | **Read-only.** Holon can list and read your messages so the `summarize_inbox` skill can produce briefings. **Cannot** send mail, modify labels, delete messages, or change account settings. |

Plus the standard identity scopes (`openid`, `email`, `profile`, `userinfo.email`) so Holon knows which account is connected and can render the address on the `/me` page.

Send / label / archive scopes (`gmail.send`, `gmail.modify`) are **not** requested in V1. If a future skill needs them, the OAuth consent screen will show the new scope before any token is issued — there is no silent scope upgrade.

## 3. "Not verified by Google" warning

On first **Allow**, Google may show: *"Google hasn't verified this app"* → **Advanced** → *"Go to Holon Personal (unsafe)"*.

This is expected. The Google Cloud project that backs the OAuth flow is **your own** (you created it in § 1) — it has not gone through Google's verification programme because Holon V1 ships as a desktop app that uses your locally-configured `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`. The warning will disappear in V1.1 when Composio (verified by Google) mediates the flow.

What this means for safety: the OAuth flow itself is the standard Google flow; the consent screen, redirect, and token grant all go through `accounts.google.com`. The warning is about app **branding verification**, not about the security of the flow.

## 4. Where the token lives

After you click **Allow**, Google issues an `access_token` + `refresh_token`. Holon stores them locally:

- **File**: inside the SQLite DB at `%APPDATA%\com.holon.desk\holon.db` (Windows) — see `docs/install/windows.md` § 4 for the equivalent paths on other platforms.
- **Encryption**: AES-256-GCM, keyed by `HOLON_TOKEN_ENC_KEY` (the 32-byte machine-local key generated on first run, per ADR-022 / iter-011 Pass #1). Tokens are never plaintext on disk. (Engineering Rule preserved: L-030 encryption-at-rest invariant.)
- **Scope**: machine-local. The token does not sync, does not leave your machine via Holon, and is not transmitted anywhere except to `gmail.googleapis.com` when a skill needs to read mail.

The OS keychain is a V2 target — V1 keeps tokens in the encrypted-store substrate.

## 5. How to revoke

You have two independent levers:

**A. Disconnect locally (one click, no network round-trip to Google).**

1. Open `/me` → Authorizations.
2. Click **Disconnect** next to the Gmail row → confirm the native prompt.
3. The encrypted token blob is wiped from the SQLite DB. Holon emits `integration.disconnected` to the audit log.

This stops Holon from being able to call Gmail. It does **not** revoke Google's grant — Google still lists Holon as an authorised app.

**B. Revoke at Google (full revocation).**

1. Visit <https://myaccount.google.com/permissions>.
2. Find your app (e.g. "Holon Personal" — the **App name** from your Google Cloud OAuth consent config in § 1 Step 2).
3. Click **Remove access**.

For a clean exit, do **both** — A first (local wipe), then B (server-side grant kill). After B, the refresh token is dead; if you Reconnect later, you will see the consent screen again.

## 6. Audit-log entry shape

Every Gmail OAuth lifecycle event emits a structured audit record (V1 posture per Engineering Rule #8 — post-emit on success, pre-emit on failure). The events are defined in `apps/web/app/api/v1/audit/emit/route.ts`:

| Event | When | Payload (selected) |
|---|---|---|
| `integration.connected` | After Allow + token persisted | `{kind: 'gmail', email}` |
| `integration.connect_failed` | OAuth denied / state mismatch / token write failed | `{kind: 'gmail', reason}` |
| `integration.token_refreshed` | Background refresh succeeded | `{kind: 'gmail'}` |
| `integration.token_refresh_failed` | Refresh token revoked / network error | `{kind: 'gmail', reason}` |
| `integration.disconnected` | Disconnect button clicked, blob wiped | `{kind: 'gmail'}` |
| `integration.disconnect_failed` | Wipe failed | `{kind: 'gmail', reason}` |

To inspect: open `%LOCALAPPDATA%\com.holon.desk\logs\` (Windows) or grep your dev-server terminal output for `integration.`. The audit log is comprehensive — every state change is captured.

## 7. Troubleshooting

| Symptom | Likely cause | Action |
|---|---|---|
| Google shows *"invalid_client"* on consent page | Client ID or Secret pasted with whitespace / wrong value | Re-copy from GCP Credentials page (§ 1 Step 8); pay attention to leading/trailing whitespace. |
| Google shows *"redirect_uri_mismatch"* | Redirect URI in GCP Credentials doesn't match what NextAuth sends | Open **GCP Credentials → your OAuth Client → Authorized redirect URIs** — verify it reads **exactly** `http://localhost:3000/api/auth/callback/google` (no trailing slash, no https, port 3000). See § 1 Step 7. |
| Google shows *"Access blocked: This app's request is invalid"* | You didn't add yourself as a test user | **GCP → OAuth consent screen → Test users → + Add users** (§ 1 Step 4). |
| First `summarize_inbox` returns *"403 Gmail API has not been enabled"* | Gmail API isn't enabled on your GCP project | **GCP → APIs & Services → Library → Gmail API → ENABLE** (§ 1 Step 9). |
| `summarize_inbox` returns "not connected" | Token store and sidecar out of sync (common after `mutable-store` reset) | Disconnect → Connect Gmail again. |
| `summarize_inbox` returns a generic error | Refresh token revoked at Google side (consent revoked, password change) | Disconnect → Connect Gmail to mint a fresh refresh token. |
| Returns to `/me` but no Gmail row | Token-encryption write failed | Verify `HOLON_TOKEN_ENC_KEY` is a valid 32-byte base64 string (44 chars). |
| Onboarding Step 3 hangs after Save & Connect | Browser popup blocker swallowed the OAuth tab | Allow popups for `localhost:3000` in your browser and retry. |

## Cross-references

- `docs/install/windows.md` — § 3 (first-run onboarding) and § 4 (data paths)
- `docs/install/README.md` — V1 install landing page (cross-platform)
- `docs/decisions/025-split-token-encryption-key.md` — ADR for the AES-256-GCM token-encryption-at-rest substrate (L-030)
- `docs/decisions/027-composio-for-integrations.md` — ADR (proposed) for V1.1 Composio aggregator that replaces this 9-step gauntlet
- `iterations/011-gmail-oauth/demo-recipe.md` — full demo recipe (the canonical source the § 1 walkthrough above is distilled from)
- `iterations/013-oauth-via-authjs/` — current OAuth implementation iteration
- `apps/web/app/api/v1/audit/emit/route.ts` — canonical audit-event schema

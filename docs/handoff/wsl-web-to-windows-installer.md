# Handoff: WSL web fixes → Windows installer side

**Living log.** WSL side (web version, owner debugs in browser) ships fixes here. Windows side (Tauri/NSIS installer) consumes them.

For each fix: **can it be applied directly?**
- ✅ **Direct** — same code path in the Tauri webview build; just `git pull`/cherry-pick or paste the diff. No installer-side change.
- ⚠️ **Needs revision** — web-only assumption (browser API, dev-server path, localhost proxy, no native FS). Windows side must adapt; revision notes inline.
- 🚫 **Do NOT port** — WSL-local env hack; would break the Windows build.

> Transfer model: WSL does not push to the shared remote without owner ask. Windows side applies from the diff blocks below (or cherry-picks once a SHA is pushed). Newest entry on top.

---

## 2026-05-22 · Fix E — WeChat read works in WSL web (specialist honors WECHAT_READ_URL) + reader bridge

**Status:** ✅ **Apply directly** (code). ⚙️ **Reader runs on Windows** — that's your side anyway.

**What/why:** WeChat read failed in the WSL web build ("fetch failed") even though the BFF + owner-command paths worked. Root cause: `apps/web/lib/wechat-specialist-agent.ts` hardcoded `http://127.0.0.1:8766` and ignored `WECHAT_READ_URL`. The owner chat delegates to this specialist, so it was the live path. Fixed to use `process.env.WECHAT_READ_URL ?? 'http://127.0.0.1:8766'` like the rest. Verified end-to-end: owner chat returns real messages.

**The reader bridge (how WSL web reaches WeChat):**
- WeChat read is Windows-only (pywxdump reads live WeChat.exe memory). The reader runs on Windows; the WSL web app proxies to it.
- WSL2 here = NAT mode → WSL `127.0.0.1` ≠ Windows `127.0.0.1`. So: reader launched with `WECHAT_READ_HOST=0.0.0.0` (new env knob; default stays 127.0.0.1 for the packaged product), and WSL `.env` (repo-root) has `WECHAT_READ_URL=http://<gateway>:8766` (gateway = `ip route show default`, currently 172.23.0.1). No firewall rule was needed for WSL→Windows-host traffic.
- One-command (re)launch from WSL: `bash scripts/launch-wechat-reader-windows.sh`.

**For the packaged Windows product:** none of the WSL bridge applies — the app and reader are co-located on Windows, so the default `127.0.0.1:8766` + `WECHAT_READ_HOST=127.0.0.1` is correct and secure. Just take the specialist-agent code fix.

---

## 2026-05-22 · Fix D — right content panel defaults to expanded on nav click

**Status:** ✅ **Apply directly** — pure client React/localStorage; identical in the Tauri webview.

**What/why:** bug-20260522-052159. The right content panel (`mainCollapsed`) restored its last-remembered collapsed state from `localStorage['holon-main-collapsed-v1']` on mount; since AppShell never remounts on client-side nav, clicking a nav item (Todo→/inbound, Drops→/deliverables…) left the panel collapsed and the content invisible. Owner: clicking = "show me this" → must default-expand.

**File:** `apps/web/app/_components/AppShell.tsx` only. Added `navResetRef` + a `[path]`-keyed effect that skips its first run (preserves same-page-reload persistence from the earlier bug-20260519-204037) and resets `mainCollapsed=false` on every subsequent navigation to a content route. Verified: typecheck 0 new errors, `/inbound` 200.

---

## 2026-05-21 · Fix C — Remove preset real-contact "Falcon Li" / `wxid_8717297174222`

**Status:** ✅ **Apply directly — EXCEPT `scripts/wechat-whitelist.json`** ⚠️ (see warning).

**What/why:** Owner objected to a real contact ("Falcon Li", `wxid_8717297174222`) being **preset** in the product (it surfaced in the chat hint "看下 Falcon Li 最后的微信消息"). "不要预置." Scrubbed every shipped/user-facing reference; replaced with generic placeholders (`张三` for zh examples, `Jane Doe` for latin-name parser tests, `filehelper` for the safe default wxid). Verified: web parser tests 10/10 pass, python tests 24/24 pass, full-repo grep shows zero `Falcon Li`/real-wxid outside historical archive docs (handoff/iterations/dev-log — left as records, not presets).

Files changed (all ✅ apply directly):
- `apps/web/app/api/v1/chat/owner/stream/route.ts` — hint example name → `张三`
- `packages/hermes-plugin-holon-owner/schemas.py` — tool-desc examples genericized (`<contact>`, `张三`, `wxid_…`)
- `scripts/wechat-read-server.mjs` — input placeholder → `张三`
- `scripts/wechat-read-pywxdump.py` — usage-example contact → `张三`
- `scripts/wechat-query-latest.py` — **default wxid `wxid_8717297174222` → `filehelper`** (was a hardcoded real person)
- `docs/install/messaging-channels-setup.md` — example whitelist genericized
- test fixtures (`test_read_wechat_messages.py`, two web `.test.ts`) — names/wxid genericized

⚠️ **`scripts/wechat-whitelist.json` — do NOT blindly overwrite on Windows.** The WSL seed dropped `wxid_8717297174222`, leaving `["filehelper"]`. But this file is **owner runtime data** (the BFF route `/api/v1/channels/wechat/whitelist` writes the owner's UI-managed wxids here, and the Windows daemon reads it). On the Windows machine it may legitimately contain real contacts the owner added. **Apply the seed/default change only to a fresh/packaged copy; never clobber the owner's live whitelist.** The fix is about not *shipping* a real wxid, not about the owner's local data.

---

## 2026-05-21 · Fix A — /connectors dead "Coming soon" cards link to where config lives

**Status:** ✅ **Apply directly** — no installer-side revision needed.

**Why it's safe for Tauri:** the change is pure in-webview React + `window.location.assign('/me')`, which is an in-app Next route navigation. Behaves identically in the Tauri webview as in the browser. `/me` (Authorizations) exists in the same codebase.

**What/why:** Gmail (and other config-elsewhere cards) rendered a *disabled* `+` ("即将支持/Coming soon"). Owner read it as broken ("好像不能配置 以前是可以的", bug-20260521-124616-kr0qp1ud). Root cause: button `active` required `cliCommand`/`action`; Gmail has neither (it's configured at /me → Authorizations / Google OAuth). Triage confirmed **not a regression**. Fix adds an optional `configHref` so such cards link to their real config page instead of going dead.

**File:** `apps/web/app/connectors/page.tsx` (only file). Verified: typecheck adds **0** new errors (the lone failure is the pre-existing `.next-prod` artifact, see Tech-debt below); `/connectors` → 200.

```diff
@@ type Connector = {
   action?: 'telegram-bot' | 'wechat-read' | 'voice-stt';
+  /** Config lives on another page (e.g. OAuth in /me). Button links there instead of opening an inline form. */
+  configHref?: string;
 };
@@ Gmail entry (category 'data')
-      { name: 'Gmail', nameZh: '邮箱', domain: 'mail.google.com', color: '#EA4335', status: 'disconnected',
+      { name: 'Gmail', nameZh: '邮箱', domain: 'mail.google.com', color: '#EA4335', status: 'disconnected', configHref: '/me',
         descEn: 'Read Gmail + draft replies (never sends)', descZh: '读取 Gmail + 起草回复（不发送）' },
@@ render: const active = ...
-              const active = Boolean(c.cliCommand) || Boolean(c.action);
+              const active = Boolean(c.cliCommand) || Boolean(c.action) || Boolean(c.configHref);
@@ the add button onClick/title
-                      onClick={active ? () => openForm(c) : undefined}
-                      title={active ? (zh ? '配置' : 'Configure') : c.status === 'wip' ? (zh ? '开发中' : 'Beta') : (zh ? '即将支持' : 'Coming soon')}
+                      onClick={active ? () => {
+                        if (c.configHref) {
+                          window.location.assign(c.configHref);
+                          return;
+                        }
+                        openForm(c);
+                      } : undefined}
+                      title={c.configHref ? (zh ? '前往配置' : 'Configure') : active ? (zh ? '配置' : 'Configure') : c.status === 'wip' ? (zh ? '开发中' : 'Beta') : (zh ? '即将支持' : 'Coming soon')}
```

**Note for Windows side:** you may want to extend `configHref` to Outlook/Drive/OneDrive too once their auth lands — same pattern, no new mechanism.

---

## Cross-environment architecture notes (affect the installer)

These aren't fixes — they're realities the WSL web work surfaced that the Windows installer must honor.

### WeChat reading is Windows-only — installer must bundle/start the :8766 reader
- The web app does **not** read WeChat itself. `apps/web/app/api/v1/wechat/read/route.ts` proxies to `WECHAT_READ_URL` (default `http://127.0.0.1:8766`).
- The actual reader (`scripts/wechat-read-server.mjs` + `scripts/wechat-read-pywxdump.py`) needs `pywxdump.get_wx_info()`, which reads the **live WeChat.exe process memory via Windows `ReadProcessMemory`** — Windows-only, cannot run inside WSL.
- **Installer implication:** the Windows package is what makes WeChat reading real. It must start the :8766 reader (bundled python + pywxdump) so the web/desktop UI's proxy resolves. WSL dev points at the same Windows :8766 over mirrored localhost.

---

## Tech-debt / env-local (🚫 do NOT port to Windows)

- **`.next-prod` in `apps/web/tsconfig.json` include + `apps/web/next-env.d.ts`** — WSL-local prod-build experiment. Pollutes `pnpm -F web typecheck` with one stale generated-type error in `.next-prod/types/.../chat/owner/stream/route.ts`. Local only; not part of any fix. Do not port. (Cleanup TODO on WSL side: drop the `.next-prod` include or delete the stale dir.)
- **`packages/hermes-plugin-holon-owner/tools.py`** `_find_repo_root`: `os.path.abspath` → `os.path.realpath` (symlink resolution for worktrees). Minor robustness fix — **safe to port** if Windows uses symlinked worktrees, otherwise no-op.

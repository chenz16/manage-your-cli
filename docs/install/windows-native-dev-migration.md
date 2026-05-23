# Holon — WSL → Windows-native dev migration (handoff)

Goal: move Holon development from WSL to **native Windows**, so WeChat read, Tauri builds,
and HMR all run on the target OS with no WSL↔Windows boundary.

> Reference for build details + the 7 build gotchas: `docs/install/windows-build-runbook.md`.
> Keep the WSL checkout as fallback until the Windows toolchain is proven (don't delete it yet).

---

## 0. One-time Windows setup (enable long paths — do this FIRST)
pnpm + the monorepo create deep/symlinked paths that overflow Windows' 260-char limit.

PowerShell **as Admin**:
```powershell
Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name LongPathsEnabled -Value 1
git config --system core.longpaths true
```
Then reboot (or at least restart the shell).

## 1. Toolchain (install natively on Windows)
- **Node — pin 20 or 22, NOT 24.** (Node 24 breaks the standalone copy-step — runbook G-004.)
  - `winget install Schniz.fnm` → `fnm install 22 ; fnm use 22 ` (or nvm-windows).
- **pnpm**: `corepack enable && corepack prepare pnpm@latest --activate`
- **Rust + MSVC**: `winget install Rustlang.Rustup` then `rustup default stable-msvc`
  + "Desktop development with C++" workload (VS Build Tools). *(Probably already present — v0.1.0/v0.1.1 built on this machine.)*
- **Python 3.11** (for Hermes runtime + wcferry) + **uv**: `winget install astral-sh.uv`
- **Git**: `winget install Git.Git`
- **WeChat** desktop (already installed/logged in — needed for the read feature).

## 2. Clone to a NATIVE Windows path (not \\wsl$)
```powershell
mkdir C:\dev ; cd C:\dev
git clone https://github.com/chenz16/holon-engineering.git
cd holon-engineering
```
Short root path (`C:\dev\...`) keeps you under the path-length limit.

## 3. Install JS deps
```powershell
pnpm install
```
If you hit `EISDIR`/symlink errors: confirm step 0 (long paths) is done, and that you're NOT
on a `\\wsl$` path. Native `C:\dev\...` + long-paths = clean.

## 4. Secrets / env
- Copy your keys into `scripts\.env.test.local` (gitignored): `DEEPSEEK_API_KEY=...`,
  optional `HOLON_FEEDBACK_GITHUB_TOKEN=...`, Gmail OAuth if used.
- For the dev server, `apps\web\.env.local` with `DEEPSEEK_API_KEY` (BYOK fallback).

## 5. Hermes Python sidecar
```powershell
cd deps\hermes ; uv sync ; cd ..\..
```

## 6. Run dev
```powershell
cd apps\web ; pnpm dev      # → http://localhost:3000
```
HMR now watches the native filesystem (no WSL watcher death). WeChat read works in dev
directly — wcferry can hook the live WeChat process (same OS, no boundary).

## 7. Build the installer (native — no more interop)
```powershell
powershell -ExecutionPolicy Bypass -File scripts\build-windows-installer-local.ps1
# customer profile (default, no secrets). Output: apps\web\src-tauri\target\release\bundle\nsis\*.exe
```
No `\\wsl$` paths, no PowerShell-over-WSL escaping. `auto-build-release.sh` is the WSL wrapper —
on native Windows you call the `.ps1` directly.

## 8. Carry-over gotchas (from this session)
- **Node ≠ 24** (copy-standalone). Pin 20/22.
- **`.next-prod` isolation** (next.config.ts reads `NEXT_DIST_DIR`) so a build never clobbers the
  dev server's `.next` — already in the code; the build sets it.
- **WeChat read** = bundled `wechat-read-daemon.exe` (resources/wechat-daemon/) + `tools.py`
  upward-search resolver. On native Windows the dev path (`python scripts\wechat-read-daemon.py --once`)
  also works since WeChat is local.
- bash cron scripts (`promote.sh` etc.) need **git-bash** on Windows (or keep them in WSL).

## 9. The 7×24 orchestration (the cron loops + the AI manager)
Currently runs in this **WSL** Claude Code session. Options:
- **(a) Move it to Windows too** — run Claude Code on Windows pointed at `C:\dev\holon-engineering`.
  Cleanest: everything one OS. The bash cron scripts run under git-bash.
- **(b) Leave orchestration in WSL, dev in Windows** — re-introduces a boundary (the loops would
  act on a different checkout). Not recommended.
Recommend (a) once dev is proven on Windows.

## 10. Cutover checklist (don't delete WSL until all green)
- [ ] `pnpm install` clean on `C:\dev\...`
- [ ] `pnpm dev` → localhost:3000 serves, HMR picks up an edit
- [ ] `cargo tauri build` / the `.ps1` produces a `.exe`
- [ ] WeChat read works in dev (read a contact)
- [ ] LLM chat works (DeepSeek key wired)
- [ ] Then: retire the WSL checkout.

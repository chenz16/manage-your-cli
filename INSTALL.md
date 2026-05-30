# Manage Your CLI — Install

A thin shell that turns your **CLI subscriptions** (Claude Code, Codex,
Gemini, Qwen, …) into a managed **team of agents**: a lean Secretary
you chat with, plus dynamic employees it creates and dispatches.

This file covers installing the **desk** (the always-on local server)
on WSL2 or Linux. Mobile apps are separate (see the Mobile section at
the bottom).

## What you need

Run the dependency check before anything else:

```bash
git clone https://github.com/<your-fork>/manage-your-cli.git
cd manage-your-cli
bash scripts/check-deps.sh
```

It reports what's missing with the exact install command per dependency.
The required set is small:

- **Node 22.x** (via [nvm](https://github.com/nvm-sh/nvm) is easiest)
- **pnpm 9.10.0** (`corepack enable && corepack prepare pnpm@9.10.0 --activate`)
- **tmux** (`sudo apt-get install -y tmux` on Debian/Ubuntu)
- **git**
- **At least one CLI you already have a subscription to:**
  - [`claude`](https://docs.anthropic.com/claude-code) — Claude Code (recommended; the secretary defaults to Haiku here)
  - [`codex`](https://github.com/openai/codex) — OpenAI Codex
  - [`gemini`](https://ai.google.dev/gemini-cli) — Gemini CLI
  - [`qwen`](https://github.com/QwenLM/qwen-code) — Qwen Code

Each CLI uses *your* login — no API keys ever live in this project. Run
the CLI once before starting the desk (`claude` / `codex` / etc.) so it
prompts you to sign in to *your* account.

Optional:

- **python3** — voice TTS server, smoke scripts
- **jq** — smoke-output formatting
- **adb** + **OpenJDK 21** — only if you want to build the Android APK
  locally
- **tailscale** — only if you want mobile to reach desk over cellular or
  a remote network. Plain LAN works without it.

## Install

```bash
corepack pnpm install
corepack pnpm -F api-contract typecheck \
  && corepack pnpm -F core typecheck \
  && corepack pnpm -F holon-mcp typecheck \
  && corepack pnpm -F web typecheck
```

## Run (dev mode)

```bash
corepack pnpm -F web exec next dev --port 3110 -H 0.0.0.0
```

Open `http://localhost:3110/` — first launch lands you on a chat with
your secretary. The "Today" tab shows what your agents are doing.

## Run (auto-restart on boot / crash)

If your distro has systemd-user (most do, including WSL2 with
`systemd=true` in `/etc/wsl.conf`), install a unit:

```bash
bash scripts/install-desk-systemd.sh
```

Useful commands after install:

```bash
systemctl --user status holon-desk    # state
systemctl --user restart holon-desk   # bounce
journalctl --user -u holon-desk -f    # follow logs
```

The unit reads/writes `~/desk-3110.log` and `~/.holon/` for state.

## Data

Everything personal lives under `~/.holon/`:

- `owner.sqlite` — projects, todos, owner state
- `warm-sessions.json` — secretary CLI session ids (for `--resume` after
  restart)
- `process-registry.json` — last seen state for the heartbeat

Boss memory (the secretary's durable notes) lives under
`~/holon-agents/boss/` as plain Markdown — you can `git init` that
directory if you want to version your knowledge base.

Personal edition stores **no telemetry** and **never** uploads anything
outside what your CLI subscription itself uploads.

## Mobile

The mobile app is a thin Capacitor wrapper around the same desk. The
desk's URL is baked into the bundle at build time via
`NEXT_PUBLIC_DESK_ORIGIN`.

- **Android**: pre-built debug APK lives in `dist/holon-mobile-debug-*.apk`
  after running `NEXT_PUBLIC_DESK_ORIGIN=http://your-desk-ip:3110
  bash scripts/build-android-apk.sh`. Side-load via `adb install -r
  dist/holon-mobile-debug-*.apk` (USB or `adb connect` over Wi-Fi).
- **iPhone**: Apple requires a $99/yr Developer Program for the dev-sign
  + side-load path. See `scripts/dev/README.md` for the maintainer
  pipeline; end users get the app via TestFlight when one's published.

## Uninstall

```bash
systemctl --user disable --now holon-desk         # if you installed the unit
rm -rf ~/.holon ~/holon-agents ~/desk-3110.log    # wipe state
```

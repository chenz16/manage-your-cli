# MYC Desk — Standalone Distribution

You're holding a pre-built copy of **Manage Your CLI** (the "desk").
You don't need to clone any source code to run it.

Source: <https://github.com/chenz16/manage-your-cli> (this tarball is the
pre-built distribution).

---

## 1. Prerequisites

- **Node.js 22 LTS** — <https://nodejs.org/> (any 22.x works).
- **At least one CLI agent** installed and on your `PATH`:
  - **Claude Code** (recommended) — <https://docs.claude.com/en/docs/claude-code>
  - **OpenAI Codex CLI** — <https://github.com/openai/codex>
  - **Gemini CLI** — <https://github.com/google-gemini/gemini-cli>
  - **Qwen CLI** — <https://github.com/QwenLM/qwen-code>

You only need one — the desk auto-detects whichever you have.

## 2. Run

```bash
tar -xzf myc-desk-standalone-v0.3.0.tar.gz
cd myc-desk-v0.3.0
bash run.sh
```

Then open <http://localhost:3110> in your browser.

To use a different port: `PORT=4000 bash run.sh`.

## 3. Mobile companion app (optional)

The Android APK is published separately on the GitHub Releases page:
<https://github.com/chenz16/manage-your-cli/releases>

When you first launch the mobile app, enter the desk URL using your
machine's LAN IP, e.g. `http://192.168.1.42:3110`. Phone and laptop must
be on the same Wi-Fi network.

Find your LAN IP:
- macOS / Linux: `ip route get 1.1.1.1` or `ifconfig`
- Windows: `ipconfig` (look for IPv4 under your Wi-Fi adapter)

## 4. Troubleshooting

**Port 3110 already in use** — run `PORT=4000 bash run.sh` (any free port).

**"No CLI found" in the UI** — confirm `claude --version` (or `codex` /
`gemini` / `qwen`) works in the same terminal *before* starting `run.sh`.
The desk inherits your `PATH` from the shell that launches it.

**Phone can't reach the desk** — your firewall is likely blocking the
port. On Windows, allow Node.js through Windows Defender Firewall. On
macOS, System Settings → Network → Firewall → allow incoming.

**Need to stop the desk** — `Ctrl+C` in the terminal running `run.sh`.

## 5. Updating

Download the next `myc-desk-standalone-v*.tar.gz` from the Releases page
and re-extract over (or alongside) this folder. Your data lives in
`~/.holon/` (or `%LOCALAPPDATA%\holon\` on Windows) — it survives
upgrades.

# Install — Manage Your CLI

`manage-your-cli` runs on a **WSL/Linux desk**. There is no Windows installer
(that was the sister repo [`holon-engineering`](https://github.com/chenz16/holon-engineering)'s
V1 Tauri build — see [`legacy/`](legacy/) for the historical record).

## Desk (the thing that runs your AI staff)

The desk runs from a checkout of this repo. Follow the repo
[`README.md`](../../README.md) → "Build / run" to bring up `pnpm dev` on
port 3000 from WSL or Linux. Your CLI subscriptions (`claude`, `codex`,
`gemini`, `qwen`) supply the intelligence; the desk only adds context,
memory, orchestration, and UI.

## Mobile (window into the desk)

The phone app is a thin client over LAN — same Wi-Fi as the desk.

| Device  | Doc                                       |
|---------|-------------------------------------------|
| iPhone  | [`iphone-pwa.md`](iphone-pwa.md)          |
| Android | [`android.md`](android.md)                |

## Messaging channels

To route inbound Telegram / WeChat into the desk inbox, see
[`messaging-channels-setup.md`](messaging-channels-setup.md).

## Historical (sister repo)

[`legacy/`](legacy/) — the V1 Windows installer + runbooks for
`holon-engineering`. Do not follow those instructions for
`manage-your-cli`.

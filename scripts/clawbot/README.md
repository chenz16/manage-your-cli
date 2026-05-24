# WeChat ClawBot QR Login

Auth half of the MYC ClawBot gateway POC.

## Quick start

```bash
./scripts/clawbot/login.sh
```

Scan the QR with WeChat iOS → token auto-saved → run `wechat-clawbot-cc serve` next.

## What it does

1. Calls `GET https://ilinkai.weixin.qq.com/ilink/bot/get_bot_qrcode?bot_type=3`  
   → returns `{"qrcode":"<id>","qrcode_img_content":"https://liteapp.weixin.qq.com/q/...","ret":0}`
2. `qrcode_img_content` is a **URL** — rendered as terminal ASCII QR via the `qrcode` Python lib
3. Long-polls `GET /ilink/bot/get_qrcode_status?qrcode=<id>` (35 s per cycle) with headers:
   - `iLink-App-Id: bot`
   - `iLink-App-ClientVersion: 131585` (upstream openclaw-weixin 2.1.1)
4. Status transitions: `wait` → `scaned` → `scaned_but_redirect` (IDC redirect) → `confirmed`
5. On `confirmed`: saves `token` + `baseUrl` + `accountId` → `~/.claude/channels/wechat/account.json` (0600)

## OSS package

Uses **nightsailer/wechat-clawbot v0.3.0** (PyPI: `wechat-clawbot`).  
CLI entry point: `wechat-clawbot-cc`.

- `wechat-clawbot-cc setup` — QR login (this script)
- `wechat-clawbot-cc serve` — start MCP channel server (next step)

## Credential location

```
~/.claude/channels/wechat/account.json   (mode 0600)
```

## Verified live (2026-05-24)

- `GET /ilink/bot/get_bot_qrcode?bot_type=3` → HTTP 200, `ret:0`, URL in `qrcode_img_content`
- Terminal QR renders and is scannable
- Poll endpoint is a long-poll: holds connection until scan — `httpx.TimeoutException` = still waiting (not an error)
- IDC redirect (`scaned_but_redirect`) handled by OSS: switches polling host mid-session

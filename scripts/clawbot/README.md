# WeChat → Secretary bridge (clawbot)

Routes inbound WeChat messages to the desk Secretary (小秘) and sends the reply back.

## How it works

```
WeChat (iOS)
   │  scan QR once
   ▼
iLink bot relay (Tencent)   ◄──── login.sh binds the account
   │  long-poll  getupdates
   ▼
gateway.py (serve.sh)
   │  POST { text, from }
   ▼
http://127.0.0.1:3110/api/v1/connectors/wechat/reply
   │  warm-agent Secretary
   ▼
{ reply: "..." }
   │  sendmessage
   ▼
WeChat (iOS) sees the reply
```

The OSS library `wechat-clawbot` (nightsailer / Python port of openclaw-weixin)
handles all iLink protocol details.  `gateway.py` is a thin adapter: poll →
call adapter → reply.

---

## Step 1 — Bind a WeChat account (one-time)

```
bash scripts/clawbot/login.sh
```

This runs `wechat-clawbot-cc setup`, which:

1. Fetches a QR code from `ilinkai.weixin.qq.com`.
2. Displays it as ASCII art in the terminal.
3. **Scan with your WeChat app** (mainland-China iOS account required).
4. Saves credentials to `~/.claude/channels/wechat/account.json`.

You only need to do this once.  Credentials persist across restarts.

> **Note:** The full round-trip requires a mainland-China iOS WeChat account.
> The QR scan is a runtime step the owner performs after deployment.

---

## Step 2 — Start the desk (if not already running)

```
HOLON_OPEN_DEMO=1 corepack pnpm -F web dev
# or the production standalone build on its port
```

Default port is 3110.  Override with `DESK_PORT` or `DESK_URL`.

---

## Step 3 — Start the gateway

```
bash scripts/clawbot/serve.sh
```

Optional environment variables:

| Variable             | Default                       | Description                          |
|----------------------|-------------------------------|--------------------------------------|
| `DESK_PORT`          | `3110`                        | Port the desk Next.js server listens |
| `DESK_URL`           | `http://127.0.0.1:${DESK_PORT}` | Full base URL override             |
| `SECRETARY_TIMEOUT`  | `120`                         | Seconds to wait for Secretary reply  |

Example with a non-default port:
```
DESK_PORT=4000 bash scripts/clawbot/serve.sh
```

---

## Files

| File               | Purpose                                             |
|--------------------|-----------------------------------------------------|
| `login.sh`         | One-time QR bind (delegates to `wechat-clawbot-cc`) |
| `serve.sh`         | Start the gateway daemon                            |
| `gateway.py`       | Poll iLink → call Secretary → send reply            |

---

## Adapter endpoint

`POST /api/v1/connectors/wechat/reply`

Request body:
```json
{ "text": "user message", "from": "sender_id@im.wechat" }
```

Response:
```json
{ "reply": "Secretary reply text" }
```

Gated to loopback (`127.x` / `::1`) only.  The gateway calls it on
`localhost`, so no auth token is required.

---

## Troubleshooting

**`No WeChat credentials found`** — run `login.sh` first.

**`desk not reachable`** — start the desk server before or alongside the gateway.

**Secretary returns empty reply** — the warm Claude process may not be running;
the first cold-start takes ~4–6s.  The gateway retries automatically on the
next message.

**`sendmessage failed`** — the iLink session token may have expired.
Re-run `login.sh` to refresh.

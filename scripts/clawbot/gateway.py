#!/usr/bin/env python3
"""
WeChat iLink → Secretary gateway daemon.

Flow:
  1. Load bound WeChat credentials from ~/.claude/channels/wechat/account.json
     (written by `wechat-clawbot-cc setup`).
  2. Long-poll iLink `getupdates` for inbound WeChat text messages.
  3. POST each message to the desk Secretary adapter endpoint:
       POST http://127.0.0.1:<DESK_PORT>/api/v1/connectors/wechat/reply
       { "text": "...", "from": "<sender_id>" }
  4. Send the Secretary's reply back to WeChat via iLink `sendmessage`.

Configuration (env vars, all optional):
  DESK_PORT          Port the desk Next.js server is listening on. Default: 3110.
  DESK_URL           Full base URL override, e.g. http://127.0.0.1:4000.
                     Takes precedence over DESK_PORT.
  SECRETARY_TIMEOUT  Seconds to wait for the Secretary reply. Default: 120.

Prerequisites:
  pip install wechat-clawbot   (already installed)
  Run `wechat-clawbot-cc setup` once to bind a WeChat account via QR scan.

Usage:
  python3 scripts/clawbot/gateway.py
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import time
from pathlib import Path

import anyio
import httpx

# ---------------------------------------------------------------------------
# Re-use the OSS library's credential store and API client — no reimplementation.
# ---------------------------------------------------------------------------
from wechat_clawbot.claude_channel.credentials import load_credentials
from wechat_clawbot.api.client import (
    WeixinApiOptions,
    close_shared_client,
    get_updates,
    send_message,
)
from wechat_clawbot.api.types import (
    MessageItem,
    MessageItemType,
    MessageState,
    MessageType,
    SendMessageReq,
    WeixinMessage,
    TextItem,
)
from wechat_clawbot.util.random import generate_id

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
_DEFAULT_DESK_PORT = "3110"
_DEFAULT_SECRETARY_TIMEOUT = 120.0  # seconds

def _desk_url() -> str:
    """Return the base URL for the desk Secretary adapter endpoint."""
    override = os.environ.get("DESK_URL", "").strip()
    if override:
        return override.rstrip("/")
    port = os.environ.get("DESK_PORT", _DEFAULT_DESK_PORT).strip()
    return f"http://127.0.0.1:{port}"

def _secretary_timeout() -> float:
    raw = os.environ.get("SECRETARY_TIMEOUT", "").strip()
    try:
        return float(raw) if raw else _DEFAULT_SECRETARY_TIMEOUT
    except ValueError:
        return _DEFAULT_SECRETARY_TIMEOUT

ADAPTER_PATH = "/api/v1/connectors/wechat/reply"

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
def _log(msg: str) -> None:
    print(f"[clawbot-gw] {msg}", flush=True)

def _err(msg: str) -> None:
    print(f"[clawbot-gw] ERROR: {msg}", file=sys.stderr, flush=True)

# ---------------------------------------------------------------------------
# Send a text reply to WeChat via iLink sendmessage
# ---------------------------------------------------------------------------
async def _send_wechat_reply(
    opts: WeixinApiOptions, to: str, text: str, context_token: str | None
) -> None:
    client_id = generate_id("desk-secretary")
    req = SendMessageReq(
        msg=WeixinMessage(
            from_user_id="",
            to_user_id=to,
            client_id=client_id,
            message_type=MessageType.BOT,
            message_state=MessageState.FINISH,
            item_list=[MessageItem(type=MessageItemType.TEXT, text_item=TextItem(text=text))],
            context_token=context_token,
        )
    )
    await send_message(opts, req)

# ---------------------------------------------------------------------------
# Call the desk Secretary adapter and return the reply text
# ---------------------------------------------------------------------------
async def _call_secretary(desk_url: str, text: str, sender_id: str, timeout: float) -> str:
    url = f"{desk_url}{ADAPTER_PATH}"
    payload = {"text": text, "from": sender_id}
    try:
        async with httpx.AsyncClient(timeout=timeout + 5.0) as client:
            resp = await client.post(url, json=payload, timeout=timeout + 5.0)
        if resp.status_code == 200:
            data = resp.json()
            reply = data.get("reply", "")
            if reply:
                return reply
            _err(f"secretary returned empty reply: {data}")
            return "(Secretary returned an empty reply)"
        else:
            body = resp.text[:400]
            _err(f"secretary adapter HTTP {resp.status_code}: {body}")
            return f"(Secretary error {resp.status_code}: {body[:120]})"
    except httpx.TimeoutException:
        _err(f"secretary adapter timed out after {timeout}s")
        return f"(Secretary did not respond within {int(timeout)}s)"
    except Exception as exc:
        _err(f"secretary adapter call failed: {exc}")
        return f"(Secretary unreachable: {exc})"

# ---------------------------------------------------------------------------
# Extract text from an iLink message item list
# ---------------------------------------------------------------------------
def _extract_text(item_list: list[MessageItem] | None) -> str:
    if not item_list:
        return ""
    for item in item_list:
        if item.type == MessageItemType.TEXT and item.text_item and item.text_item.text:
            return str(item.text_item.text)
    return ""

# ---------------------------------------------------------------------------
# Main poll loop
# ---------------------------------------------------------------------------
LONG_POLL_TIMEOUT_MS = 35_000
MAX_FAILURES = 5
RETRY_DELAY_S = 3.0
BACKOFF_DELAY_S = 30.0

async def _poll_loop(
    api_opts: WeixinApiOptions,
    desk_url: str,
    secretary_timeout: float,
) -> None:
    get_updates_buf = ""
    consecutive_failures = 0
    _log(f"Polling iLink for messages (desk={desk_url}) ...")

    while True:
        try:
            resp = await get_updates(
                base_url=api_opts.base_url,
                token=api_opts.token,
                get_updates_buf=get_updates_buf,
                timeout_ms=LONG_POLL_TIMEOUT_MS,
            )
        except Exception as exc:
            consecutive_failures += 1
            _err(f"getUpdates exception ({consecutive_failures}/{MAX_FAILURES}): {exc}")
            delay = BACKOFF_DELAY_S if consecutive_failures >= MAX_FAILURES else RETRY_DELAY_S
            await anyio.sleep(delay)
            continue

        is_error = (resp.ret is not None and resp.ret != 0) or (
            resp.errcode is not None and resp.errcode != 0
        )
        if is_error:
            consecutive_failures += 1
            _err(
                f"getUpdates error ret={resp.ret} errcode={resp.errcode} "
                f"errmsg={resp.errmsg or ''} ({consecutive_failures}/{MAX_FAILURES})"
            )
            delay = BACKOFF_DELAY_S if consecutive_failures >= MAX_FAILURES else RETRY_DELAY_S
            await anyio.sleep(delay)
            continue

        consecutive_failures = 0
        new_buf = resp.get_updates_buf
        if new_buf and new_buf != get_updates_buf:
            get_updates_buf = new_buf

        for msg in resp.msgs or []:
            if msg.message_type != MessageType.USER:
                continue
            text = _extract_text(msg.item_list)
            if not text:
                continue

            sender_id = msg.from_user_id or "unknown"
            context_token = msg.context_token

            _log(f"Received message from={sender_id} text={text[:60]!r}")

            # Call Secretary (sync-over-async: use anyio thread shim for httpx)
            reply = await _call_secretary(desk_url, text, sender_id, secretary_timeout)
            _log(f"Secretary reply ({len(reply)} chars): {reply[:80]!r}")

            # Send reply back to WeChat
            try:
                msg_opts = WeixinApiOptions(
                    base_url=api_opts.base_url,
                    token=api_opts.token,
                    context_token=context_token,
                )
                await _send_wechat_reply(msg_opts, sender_id, reply, context_token)
                _log(f"Reply sent to {sender_id}")
            except Exception as exc:
                _err(f"sendmessage failed for {sender_id}: {exc}")

# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
async def main() -> None:
    account = load_credentials()
    if not account:
        _err(
            "No WeChat credentials found.\n"
            "Run: wechat-clawbot-cc setup\n"
            "Then scan the QR code with your WeChat app."
        )
        sys.exit(1)

    _log(f"Loaded credentials: account_id={account.account_id}")
    _log(f"iLink base_url: {account.base_url}")

    desk_url = _desk_url()
    secretary_timeout = _secretary_timeout()
    _log(f"Secretary adapter: {desk_url}{ADAPTER_PATH}")
    _log(f"Secretary timeout: {secretary_timeout}s")

    api_opts = WeixinApiOptions(base_url=account.base_url, token=account.token)

    try:
        await _poll_loop(api_opts, desk_url, secretary_timeout)
    finally:
        await close_shared_client()

if __name__ == "__main__":
    anyio.run(main)

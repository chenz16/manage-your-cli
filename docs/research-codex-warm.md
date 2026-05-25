# Research: Codex CLI — Warm/Persistent Invocation for Secretary

**Date:** 2026-05-25  
**Binary:** `~/.npm-global/bin/codex` (codex-cli 0.131.0, ChatGPT-logged-in)  
**Question:** Can we run ONE long-lived codex process and feed it multiple turns with streamed structured replies — analogous to `claude --print --input-format stream-json` — to build a fast always-on Secretary?

---

## 1. Finding: YES — `codex app-server` is a full warm protocol

Codex has a **complete, documented, production-grade** persistent JSON-RPC server mode:

```
codex app-server          # stdio transport (default — spawn once, feed turns forever)
codex app-server --listen ws://127.0.0.1:PORT   # WebSocket (experimental)
codex app-server --listen unix://               # Unix domain socket
```

This is the same protocol the **VS Code extension** and the **Codex Desktop app** use internally. It is NOT experimental for the stdio transport — only WebSocket is marked experimental/unsupported.

### Protocol type
JSON-RPC 2.0 over newline-delimited JSON (JSONL), stdio. The `"jsonrpc":"2.0"` header is omitted on the wire (JSON-RPC "lite" variant). Bidirectional: client sends requests → server replies + emits async notifications.

### Version evidence
- Official docs: https://developers.openai.com/codex/app-server (live, detailed)
- Source README: https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md
- OpenAI engineering post (2026-02-04): "Unlocking the Codex harness: how we built the App Server"
- Schema generation confirmed live: `codex app-server generate-json-schema --out DIR` dumps the full schema for the installed version

---

## 2. Measured cold-start latency (baseline)

| Mode | Latency |
|------|---------|
| `codex exec "say hi"` (cold, `--json`) | **6.0s real** (measured on this machine) |
| `claude --print ...` cold turn | ~5.8s (documented in warm-agent.ts) |
| `claude` warm turn (stream-json) | ~1.8s (documented in warm-agent.ts) |
| codex app-server warm turn | **TBD — but same benefit applies**: process stays resident, only LLM round-trip per turn |

---

## 3. Exact protocol for warm Secretary integration

### 3a. Start the server (once, on Secretary init)

```typescript
import { spawn } from 'node:child_process';
const proc = spawn('codex', ['app-server'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: process.env,
});
```

### 3b. Initialization handshake (once after spawn)

Send two messages:

```jsonc
// 1. initialize request
{"method":"initialize","id":0,"params":{"clientInfo":{"name":"myc_secretary","title":"MYC Secretary","version":"0.1.0"}}}

// 2. initialized notification (no id — it's a notification)
{"method":"initialized","params":{}}
```

Wait for the `initialize` response (id=0) before proceeding. The response includes `codexHome` and `platformFamily`.

### 3c. Create a thread (once per Secretary session)

```jsonc
{"method":"thread/start","id":1,"params":{
  "model": "gpt-4o-mini",
  "approvalPolicy": "never",
  "sandbox": "read-only",
  "ephemeral": true,
  "cwd": "/home/chenz/project/myc-mobile"
}}
```

Response returns `thread.id` (e.g. `"thr_abc123"`). Save it.

To resume across server restarts: omit `ephemeral`, use `thread/resume` with the saved thread ID.

### 3d. Send a turn (each user message)

```jsonc
{"method":"turn/start","id":2,"params":{
  "threadId": "thr_abc123",
  "input": [{"type":"text","text":"What's the weather?"}]
}}
```

### 3e. Stream the reply

Read stdout lines. Key notifications to handle:

| Notification method | Purpose |
|---------------------|---------|
| `turn/started` | Turn began; contains `turn.id` |
| `item/agentMessage/delta` | Token delta — `params.delta` is the new text chunk to append |
| `item/completed` | One item (message/command/tool call) finished |
| `turn/completed` | **Turn done** — contains final `turn` object + token usage |
| `error` | Server error notification |

`item/agentMessage/delta` params shape:
```typescript
{ threadId: string; turnId: string; itemId: string; delta: string }
```

### 3f. Interrupt a turn mid-stream

```jsonc
{"method":"turn/interrupt","id":3,"params":{"threadId":"thr_abc123","turnId":"<turnId from turn/started>"}}
```

---

## 4. Integration sketch for warm-agent.ts

The existing `spawnWarm()` function already has the right shape. The changes needed:

1. **Spawn**: `spawn('codex', ['app-server'], ...)` instead of `spawn('claude', ['--print', ...])`
2. **On stdout data**: parse JSONL; dispatch on `msg.method` instead of `msg.type`
3. **Send handshake**: send `initialize` + `initialized` on first connection; save the `initialize` response to get `threadId` after `thread/start`
4. **Send turn**: write `{"method":"turn/start","id":N,"params":{"threadId":T,"input":[{"type":"text","text":prompt}]}}` instead of the current `{"type":"user","message":{...}}`
5. **Assemble reply**: accumulate `item/agentMessage/delta` → `params.delta` strings; call `onText` each delta; call `onDone` on `turn/completed`
6. **Keep-warm**: the process is already stateful — sending the next `turn/start` on the existing connection is all that's needed

The `if (binary !== 'claude') return` guard in `prewarmAgent` and `spawnWarm` should be extended to also handle `'codex'` via this new path.

**Key difference from claude stream-json:** codex app-server is multi-turn natively (thread state lives in the process); claude stream-json reconstructs context from the full history on each turn. Codex warm turns should be faster for longer conversations.

---

## 5. mcp-server mode (alternative — narrower scope)

`codex mcp-server` starts codex as an **MCP tool server** (stdio, JSON-RPC). This exposes codex's internal tools to an MCP client — NOT a conversational interface. It cannot be used to send user turns and receive assistant replies. Not applicable for Secretary.

---

## 6. exec-server mode (alternative — remote executor)

`codex exec-server` is for remote code execution (registers with a Codex Cloud instance). Not applicable for warm local Secretary.

---

## 7. exec --json (one-shot with structured output)

`codex exec --json "prompt"` emits JSONL events for a single run, then exits. Events include `thread.started`, `turn.started`, `item.completed`, `turn.completed`. Confirmed working at 6.0s cold. This is the current fallback path in warm-agent.ts — it is the slow path.

The `--json` flag does NOT make it warm. It is still one-shot, one process per turn.

---

## 8. Session resume (cold but context-preserving)

`codex exec resume --last` / `codex resume [session-id]` reloads stored conversation history and continues it. This avoids re-sending context but still cold-starts a new process per invocation (~6s). Not warm.

For the app-server, the equivalent is `thread/resume` which is truly warm (same running process).

---

## 9. Marketing vs. reality check

| Claim | Reality |
|-------|---------|
| "persistent warm session" | TRUE — app-server holds threads in memory, multi-turn, no re-spawn |
| "stdio transport stable" | TRUE — stdio is the default, non-experimental transport used by VS Code extension |
| WebSocket transport | EXPERIMENTAL/UNSUPPORTED per docs — don't use in production |
| Schema is versioned | TRUE — `generate-json-schema` dumps exact schema for the installed binary version |
| Thread history persists to disk | TRUE — JSONL rollout files in `$CODEX_HOME`; resumable after restart |
| mcp-server = warm conversational mode | FALSE — MCP server exposes tools, not a chat interface |

**One gap flagged:** The app-server README says `clientInfo.name` is used for OpenAI Compliance Logs. For enterprise use, OpenAI wants known client names registered. For personal/dev use (`myc_secretary`) this is a non-issue.

---

## 10. Recommendation (one line)

**Use `codex app-server` (stdio, ephemeral thread) for the Secretary warm path — it is a complete, stable, multi-turn JSON-RPC protocol that directly mirrors what `claude --print --input-format stream-json` does, with per-turn latency dropping from 6s (cold exec) to LLM-round-trip only (~1–2s expected).**

### Implementation priority
1. Add `codex` branch to `spawnWarm()` in `warm-agent.ts` using the protocol above
2. Remove the `if (binary !== 'claude') return` guard (or extend it) in `prewarmAgent`
3. Test: `codex app-server` → handshake → `thread/start` → two `turn/start` messages → confirm second turn is warm

---

## Sources

- [App Server – Codex | OpenAI Developers](https://developers.openai.com/codex/app-server)
- [codex-rs/app-server/README.md (openai/codex GitHub)](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md)
- [Unlocking the Codex harness (OpenAI engineering post, 2026-02-04)](https://openai.com/index/unlocking-the-codex-harness/)
- [OpenAI Publishes Codex App Server Architecture (InfoQ, 2026-02)](https://www.infoq.com/news/2026/02/opanai-codex-app-server/)
- Schema: `codex app-server generate-json-schema` (v0.131.0, generated live on this machine, `/tmp/codex-schema/`)

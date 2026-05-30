# Handoff: First-Hello Latency Optimization

> **Status: Historical record.** This document captures a point-in-time
> snapshot. References to **Hermes** / `hermes-acp` /
> `hermes_profile_generic_v1` describe the runtime used by the sister
> repo [`holon-engineering`](https://github.com/chenz16/holon-engineering)
> at the time of writing. `manage-your-cli` does not bundle, link to, or
> depend on Hermes — its live substrate is a direct multi-CLI adapter
> (`claude` / `codex` / `gemini` / `qwen`) under
> [`packages/core/src/cli-adapters.ts`](../../packages/core/src/cli-adapters.ts)
> and [`apps/web/lib/warm-agent.ts`](../../apps/web/lib/warm-agent.ts).
> The body below is preserved unedited for history.

## Status: Partially Done

## Problem
用户打开 localhost:3000 发第一条 "hello"，等待 9s 才收到回复。第二条消息只需 ~2s。

## Root Cause
首次 hello 的 9s 分解：
- **~2-3s**: Dev 模式 Next.js 按需编译 JS bundle + route handler
- **~5s**: Hermes ACP bridge 冷启动（spawn `uv run hermes acp` + ACP initialize + newSession）
- **~1.5-2s**: DeepSeek API LLM 响应

第二条消息只需 ~2s 因为 bridge 已 ready，只有 LLM 调用时间。

## What Was Done
1. **Added `warmBridge()` export** in `apps/web/lib/hermes-acp-client.ts` — calls `getBridge()` to spawn Hermes without sending a prompt
2. **Added `GET /api/v1/chat/warm` endpoint** — triggers bridge pre-heat, auto-fires on module load
3. **ChatRuntimeProvider** now fetches `/api/v1/chat/warm` on mount instead of `/api/v1/staff`
4. Verified: after warm completes, hello takes ~2.7s

## Remaining Gap (Dev Mode Only)
Dev 模式下 Next.js 不预编译路由。`/chat/warm` 只在浏览器 fetch 时才编译。所以 warm 的 5s 启动还是从浏览器 mount 后才开始。

用户体验：页面打开后需要等 **~7s** bridge 才 ready。如果 7s 内发 hello，还会等。

## Fix Options for Further Optimization
1. **Production standalone**: 所有路由预编译，auto-warm 在第一个请求时立即触发。用 `start-production.sh` 还有额外的 page warm-up 循环。
2. **Dev mode workaround**: 在 `start-production.sh` 或单独脚本中 `curl http://localhost:3000/api/v1/chat/warm` 来提前编译+触发。
3. **Faster Hermes spawn**: 目前 5s 中大部分是 Python/uv 启动。如果用 persistent Hermes daemon（不每次 spawn），冷启动可降到 <1s。但这需要 Hermes 架构变更。

## Key Files
- `apps/web/lib/hermes-acp-client.ts` — `warmBridge()`, `getBridge()`, `startBridgeViaSpawn()`
- `apps/web/app/api/v1/chat/warm/route.ts` — warm endpoint
- `apps/web/app/_components/ChatRuntimeProvider.tsx` — client-side warm trigger
- `scripts/start-production.sh` — production start script with page warm-up

## Metrics
| Scenario | Before | After |
|----------|--------|-------|
| First hello (cold, dev mode) | 9s | 6s (warm in background) |
| First hello (warm complete) | 9s | ~3s |
| Second hello | ~2s | ~2s (unchanged) |
| Production standalone | TBD | ~3s (predicted) |

# Session Handoff — 2026-05-21

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

## Context
Owner: CEO/技术创始人，直接在 Windows 上用 localhost:3000 测试。
项目: Holon — 中国中小企业老板的 AI 桌面助手（Tauri + Next.js + Hermes ACP）。
分支: main = release/稳定版，dev = 开发分支。当前在 main。

## 刚完成的工作

### First-Hello Latency Optimization (部分完成)
- 加了 `GET /api/v1/chat/warm` 端点 + `warmBridge()` — 页面加载时预热 Hermes
- `/clear` (admin/reset) 后自动 re-warm
- **结果**: 9s → 6s（dev 模式），~3s（warm 完成后）
- **残留问题**: Dev 模式下 Next.js 按需编译路由，warm route 只在浏览器 fetch 时才触发。真正要 <3s 需要 production standalone 或 persistent Hermes daemon
- 详见 `docs/handoff/2026-05-21-first-hello-latency.md`

## 待做工作（按优先级）

### P0 — 性能 (M001)
1. **First-hello 继续优化** — 考虑 persistent Hermes daemon 或 dev-start 脚本自动 curl warm
2. **页面切换慢** — dev 模式 HMR 编译，standalone 没这个问题
3. **Cold start** — 整体 app 首次打开优化

### P0 — User Story 实施 (M002)
详见 `docs/milestones/M002-user-story-implementation-plan.md`
- **Batch 1**: 每日微信摘要 + 语音转文字 + 搜索
- **Batch 2**: 5个更多用户故事
- **Batch 3**: 4个更多用户故事
- Spec 都在 `docs/handoff/` 下

### P1 — Codex 任务队列（未 dispatch）
- 8 个 bug: lang-first, cold-start, gek8ivvd, interview-nudge, llm-onboarding, u4allcbm, app-frozen, sidecar-unc-path
- Daily WeChat briefing (`docs/handoff/2026-05-21-daily-wechat-briefing-spec.md`)
- Voice-to-text Whisper (`docs/handoff/2026-05-21-voice-transcription-spec.md`)
- Per-agent LLM provider (`docs/handoff/2026-05-21-llm-provider-per-agent-spec.md`)
- In-app painpoint interview + TTS (`docs/handoff/2026-05-21-painpoint-interview-spec.md`)
- Tauri sidecar path fix (dunce crate)
- NSIS packaging fix

### P1 — Windows 桌面打包
- Tauri exe 反复崩溃（3次了），NSIS 路径问题
- 研究结论在 `docs/research/` — 建议: 修 Tauri (1-2周) 或 迁移 Electron (2-4周)
- 短期策略: web-only 模式给 owner 测试，后台持续修 Tauri

### P2 — 架构
- Chat-first UI 方向已确认（Copilot 模式）
- Hermes 依赖过重 — 长期考虑轻量化或替代
- 微信专员 agent 已上线（DeepSeek function-calling，不走 Hermes）

## 关键文件
- `apps/web/lib/hermes-acp-client.ts` — Hermes ACP bridge (spawn/socket 双模式)
- `apps/web/app/api/v1/chat/owner/stream/route.ts` — Owner chat stream (含微信 delegate)
- `apps/web/app/_components/ChatRuntimeProvider.tsx` — 客户端 runtime + warm-up
- `apps/web/lib/wechat-specialist-agent.ts` — 微信专员 (DeepSeek function-calling)
- `scripts/start-production.sh` — 一键启动 standalone + 预热
- `scripts/regression-test.sh` — 16 项自动回归测试
- `CLAUDE.md` — 完整工程规则 + 7×24 模式 + Codex 委派协议

## Owner 工作习惯
- 直言不讳，"狗日的"/"fuck" = 表达不满，不是攻击
- 期望: 先理解再行动，不要 make up，不行就报错
- 测试在 localhost:3000（dev server），不要占 3000 端口
- V-model: Owner 做需求/架构/验收，Claude 做设计/测试/集成，Codex 做实现
- 4次迭代失败或30分钟无进展 → 立即 delegate Codex

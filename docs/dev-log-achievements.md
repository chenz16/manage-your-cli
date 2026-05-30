# Holon 开发成果报告

> **Status: Historical record.** This document captures a point-in-time
> snapshot. References to **Hermes** / `hermes-acp` /
> `hermes_profile_generic_v1` describe the runtime used by the sister
> repo [`holon-engineering`](https://github.com/chenz16/holon-engineering)
> at the time of writing. `manage-your-cli` does not bundle, link to, or
> depend on Hermes — its live substrate is a direct multi-CLI adapter
> (`claude` / `codex` / `gemini` / `qwen`) under
> [`packages/core/src/cli-adapters.ts`](../packages/core/src/cli-adapters.ts)
> and [`apps/web/lib/warm-agent.ts`](../apps/web/lib/warm-agent.ts).
> The body below is preserved unedited for history.

最后更新：2026-05-21 17:30 UTC

---

## 2026-05-21 Session 成果

### ✅ 已交付

| 成果 | 描述 | 验证状态 |
|------|------|---------|
| **WeChat 消息读取** | 用 pywxdump 直接读 WeChat 本地数据库，无需 DLL 注入 | ✅ 端到端通过 |
| **微信助手（AI Agent）** | DeepSeek function calling 驱动，能读取、搜索、列出联系人 | ✅ Owner 验证通过 |
| **微信助手员工** | 自动创建为 staff，出现在 /members，可对话 | ✅ 验证通过 |
| **Owner Chat Delegate** | 主聊天框检测到微信意图 → 自动委托微信助手处理 | ✅ PowerShell 验证通过 |
| **v0.1.1 安装包** | Windows NSIS installer 112MB，含 Hermes + WeChat daemon | ✅ Build 成功，已上传 GitHub Release |
| **UX 中文化** | DigestCard 紧急度标签、错误消息、进度提示全部中文 | ✅ |
| **Onboarding 闪屏修复** | 新装不再闪正常页面再跳 onboarding | ✅ |
| **Loading 指示** | 10 个页面加 loading.tsx | ✅ |
| **错误边界** | root error.tsx 带重试按钮 | ✅ |
| **窗口最大化** | 安装后默认最大化（解决聊天面板不可见） | ✅ |
| **Bug 修复** | 5 个 bug report 处理完毕 | ✅ |

### 🔄 进行中

| 任务 | 状态 |
|------|------|
| v0.1.2 build（含微信助手代码） | Cargo + NSIS 打包中 |
| 每日微信 Briefing spec | 设计完成，待 Codex 实施 |

### 📊 测试覆盖

| 指标 | 数字 |
|------|------|
| Unit tests | 206 passed, 0 failed |
| Typecheck | 3/3 packages pass |
| API endpoints | 9/9 pass (read, search, contacts + HTTP variants) |
| Integration (chat) | 2/2 pass (owner chat + specialist) |
| Bug reports processed | 5/5 |

### 📝 产品研究

| 输出 | 文件 |
|------|------|
| 5 个目标行业 + 15 个 User Story | docs/research/target-industries-user-stories.md |
| User Story Gap 分析 | docs/research/user-story-gap-analysis.md |
| UX 模拟测试发现 | docs/handoff/2026-05-21-ux-simulation-findings.md |
| 每日微信 Briefing 架构 | docs/handoff/2026-05-21-daily-wechat-briefing-spec.md |
| WeChat 工具套件设计 | docs/handoff/2026-05-21-wechat-tools-design.md |

### 🔧 技术改进

| 改进 | 影响 |
|------|------|
| wcferry → pywxdump | 消除 DLL 注入问题，可靠性大幅提升 |
| 自动清理 stale daemon | 不再需要手动重启微信 |
| NSIS 长路径自动修复 | Build 不再因 MAX_PATH 失败 |
| standalone src-tauri 嵌套修复 | Build 不再因递归目录失败 |
| PS1 脚本 WSL → Windows native | Build 不依赖 WSL |

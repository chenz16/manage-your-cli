# 两种运行模式

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

## Web Only（日常开发/测试）

**启动**：
```bash
bash scripts/start-production.sh
```
或手动：
```bash
node scripts/wechat-read-server.mjs &
pnpm -F web dev
```

**端口**：localhost:3000（dev server）+ localhost:8766（wechat read）
**依赖**：Node 22 + pnpm + Python 3.11 + pywxdump + .env（DEEPSEEK_API_KEY）
**Hermes**：dev mode 自动 fallback 到 `uv run hermes`
**特点**：HMR 热更新，改代码即时生效，首次页面访问慢（on-demand compile）

## 打包版（Tauri exe）

**启动**：双击 `Holon_x.y.z_x64-setup.exe` 安装后打开
**端口**：localhost:3000（standalone server，Tauri 自动启动）
**依赖**：全部打包在 exe 里，用户零安装
**Hermes**：Tauri 自动 spawn sidecar，通过 HOLON_HERMES_PORT 通信
**特点**：production 预编译，页面秒开

## ⚠️ 冲突规则

- **两个不能同时跑** — 都用 3000 端口
- **切换前必须杀干净**：`taskkill //F //IM node.exe && taskkill //F //IM holon-desk.exe`
- **build 打包版时**：需要先停 web only（build 占 .next 目录）
- **build 完恢复 web only**：`bash scripts/start-production.sh`

## 切换流程

**Web Only → 打包版测试**：
```bash
taskkill //F //IM node.exe   # 停 web only
# 安装/启动 exe
```

**打包版 → Web Only**：
```bash
taskkill //F //IM holon-desk.exe
taskkill //F //IM node.exe
bash scripts/start-production.sh
```

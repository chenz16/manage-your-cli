# 两种运行模式 (Superseded — sister-repo dev / Tauri modes)

> **Status: Superseded / legacy.** Documents the V1 Tauri+NSIS exe vs
> WSL dev-server modes for [`holon-engineering`](https://github.com/chenz16/holon-engineering).
> Both modes shelled out to the bundled Hermes sidecar.
> `manage-your-cli` has no Tauri build and no Hermes sidecar — it runs
> from `pnpm dev` (or the standalone build) on WSL/Linux and the
> "two-mode conflict" rules below do not apply.

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

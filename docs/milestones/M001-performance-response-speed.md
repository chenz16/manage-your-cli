# Milestone M001: 产品反应速度

Owner: Claude (设计/验证) + Codex (实施)
Status: planning
Created: 2026-05-21

## Baseline（当前测量）

| 页面 | 冷启动时间 | 测量方式 |
|------|----------|---------|
| 首页 (/) | 39s | curl dev mode |
| /members | 14s | curl dev mode |
| /me | 4.3s | curl dev mode |
| /connectors | 1.8s | curl dev mode |
| /inbound | 1.8s | curl dev mode |
| /skills | 1.5s | curl dev mode |

**注**：production standalone 预计 5-10s 首页，1-3s 其他页面（待测量）

## 目标

| 指标 | 目标 | 验收方式 |
|------|------|---------|
| 任意页面首次加载 | < 2s | owner 安装后体验 |
| 页面切换 | < 500ms | owner 点击体验 |
| App 启动到可用 | < 5s | owner 打开 app 计时 |

## Phase 1: 止血（本周）

### P1.1 Tauri warm-up
- App 启动后，后台自动 fetch 7 个关键 route
- 用户打开任何页面时 module 已初始化
- **验收**：owner 安装后点击各页面，体感 < 3s
- **测量**：我在 v0.1.4 build 后 curl 所有 route 记录时间

### P1.2 Fixture 预加载
- standalone server 启动时立即 loadFixtures()
- 不走 instrumentation（webpack 不允许）
- 方案：在 standalone server.js 包装脚本里 require + call
- **验收**：首个 API 调用 < 500ms

### Before/After 对比表
| 页面 | Before (baseline) | After P1 | After P2 | After P3 |
|------|-------------------|----------|----------|----------|
| / | 39s | _待测_ | | |
| /members | 14s | _待测_ | | |
| /me | 4.3s | _待测_ | | |

## Phase 2: 关键页面 CSR（2周内）

### P2.1 Today/Members/Inbound 改 client-side rendering
- 这 3 个页面最常用，SSR 毫无意义（desktop app 无 SEO）
- 改成 `'use client'` + `useEffect` + fetch API
- 页面 shell 立即渲染，数据异步加载
- **验收**：owner 体感 < 1s

### P2.2 Skeleton loading
- 页面 shell 先渲染骨架屏，数据加载后填充
- 用户看到"在加载"而不是空白

### Before/After 对比表
_同上，P2 列填充_

## Phase 3: 长期（V2 评估）

### P3.1 Next.js 16 升级评估
- 在独立分支试升级，跑 benchmark
- 如果 83% 提升属实 → 升级

### P3.2 Vite 迁移评估
- 如果 P2 后仍 > 1s → 评估 Vite
- 写迁移 cost/benefit 分析

## 闭环规则
1. 每个 Phase 完成后 → 我重新测量所有 7 个 route
2. 更新 Before/After 表
3. Owner 安装新版体验
4. 体感 OK → 该 Phase 关闭
5. 体感不 OK → 分析原因 → 调整方案 → 下一轮

## User Feedback Loop

每个 Phase 交付后：
1. Owner 安装/体验
2. Owner 给反馈（file bug report 或直接说）
3. 我分析反馈：
   - 哪些改善了？数据对比
   - 哪些没达标？为什么？
   - 下一步调整什么？
4. 写进 Before/After 表 + 调整方案
5. 下一轮 Phase

**反馈模板（owner 用）**：
- 速度体感：1-10 分
- 最慢的页面是哪个？
- 还有卡顿吗？在哪？
- 跟上一版对比感觉如何？

**我的自我评估**：
每个 Phase 后写一段：
- 这轮做对了什么？
- 做错了什么？
- 下次怎么改进？

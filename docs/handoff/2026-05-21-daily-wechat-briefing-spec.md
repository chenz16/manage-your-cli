# Spec: 每日微信 Briefing（定时自动摘要）

Status: design-ready
Priority: P0（所有 5 个目标行业都需要）
Pickup: Codex

## 用户需求

> "每天早上打开 Holon，直接看到昨天的微信消息摘要，不用一个一个问。"

## 功能描述

系统每天自动（或用户手动触发）读取所有活跃联系人的微信消息，生成一份结构化的 briefing，展示在 /inbound 或 /today 页面顶部。

## Briefing 格式

```
📱 微信日报 · 2026-05-21

📊 概览：昨天 23 个联系人发来 156 条消息

🔴 需要你回复（3个）
1. Falcon Li — 询问 AI 工具试用安排（最后消息 4h 前）
2. 张伟 — 报价确认，等你回复（最后消息 6h 前）
3. 王总 — 合同细节问题（最后消息 12h 前）

🟡 了解即可（5个）
- 李经理 — 通知下周会议改期
- 供应商A — 发了新价格表
- ...

🟢 已读不需回复（15个）
- 群消息 × 8
- 朋友圈类 × 7
```

## 技术实现

### 数据流
```
定时触发（每天 8:00 或手动）
  → wechat_contacts（获取活跃联系人 last 24h）
  → 对每个联系人 wechat_read（last 24h, limit 20）
  → 合并所有消息
  → DeepSeek 分类 + 总结（system prompt: 按紧急度分类）
  → 生成 briefing Mission（type: wechat_daily_briefing）
  → 展示在 /inbound 顶部（类似 DigestCard）
```

### 定时触发方案

**V1（简单）**：用户手动点 /inbound 页面的"生成微信日报"按钮
**V2（自动）**：Tauri 的 schedule API 或 Node cron（每天 8:00 本地时间）

### API

POST /api/v1/wechat/daily-briefing
- 触发一次 briefing 生成
- 返回 { mission_id } — 异步生成，前端轮询状态

GET /api/v1/wechat/daily-briefing?date=2026-05-21
- 获取指定日期的 briefing

### 关键文件
- scripts/wechat-read-pywxdump.py --mode contacts + --mode read（已实现）
- scripts/wechat-read-server.mjs /contacts + /read（已实现）
- apps/web/app/inbound/_components/DigestCard.tsx（已有，可扩展）
- 新增：apps/web/lib/wechat-daily-briefing.ts

### 依赖
- wechat-read-server.mjs 必须在跑
- WeChat Desktop 必须登录
- DeepSeek API key 必须配置

### 估算
- 设计：1h（本 spec）
- 实施：Codex 4-6h
- 测试：我 1h 验证

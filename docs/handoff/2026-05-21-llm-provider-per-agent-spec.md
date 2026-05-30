# Spec: Per-Agent LLM Provider Selection + Token Budget Tracking

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

Status: design-ready
Priority: P1
Pickup: Codex

---

## Part 1: Per-Agent LLM Provider Selection

### 需求
- Owner 在 /me 配置了 N 个 LLM providers（如 DeepSeek、OpenAI、Anthropic）
- 每个 agent（staff member）可以选择用哪个 provider
- **只能选一个**，不能多选（多选涉及 routing 复杂度，暂不做）
- 默认继承 owner 的 active provider
- Owner 可以随时切换某个 agent 的 provider

### 数据模型

```typescript
// 现有：Owner 的 provider 列表
interface LlmProvider {
  id: string;           // "deepseek", "openai", "anthropic", ...
  providerId: string;
  endpoint: string;
  apiKey: string;       // encrypted
  modelId: string;
  isActive: boolean;    // owner 的默认
}

// 新增：per-agent provider 配置
interface StaffLlmConfig {
  staff_id: string;
  provider_id: string | null;  // null = 继承 owner active provider
}
```

### UI

**/members → 某个 staff 的详情页 → LLM 设置**

```
LLM 模型
┌─────────────────────────────────────┐
│ ● 跟随老板设置 (DeepSeek V4 Flash) │  ← 默认
│ ○ DeepSeek V4 Flash                │
│ ○ OpenAI GPT-4o                    │
│ ○ Anthropic Claude Sonnet          │
└─────────────────────────────────────┘
只显示 owner 在 /me 配置过的 providers
```

### 实现

1. **存储**：`StaffLlmConfig` 存在 mutable-store 中（跟 staffOverrides 类似）
2. **API**：
   - GET /api/v1/staff/:id → 返回 staff 信息 + 当前 llm_provider_id
   - PATCH /api/v1/staff/:id { llm_provider_id: "openai" | null }
3. **使用**：
   - staff chat route 调用 `resolveActiveProvider()` 时，先查 staff 的配置
   - 如果 staff 有指定 → 用指定的
   - 如果 staff 没指定（null）→ 用 owner 的 active provider
   - 微信专员的 `wechat-specialist-agent.ts` 也用同样的逻辑
4. **Owner desk AI**：owner 的主聊天框始终用 owner active provider

### 关键文件
- packages/core/src/mutable-store.ts（加 staffLlmConfig Map）
- apps/web/lib/llm-provider-resolver.ts（加 resolveProviderForStaff(staffId)）
- apps/web/app/api/v1/staff/[id]/chat/route.ts（用 staff provider）
- apps/web/lib/wechat-specialist-agent.ts（用 staff provider）
- apps/web/app/members/_components/StaffDetail.tsx（UI 选择器）

---

## Part 2: Token Usage Tracking + Budget

### 需求
- 每个 agent（包括 owner desk AI）统计：
  - 累计 token 使用量（input + output）
  - 累计花费（按 provider 价格计算）
  - 最近 N 天的趋势
- Token 预算预警：
  - 每个 agent 可设置月度/日度 token 上限
  - 接近上限时（80%、100%）发 warning
  - 超过上限时：可选 block 或 warn-only

### 数据模型

```typescript
interface TokenUsageRecord {
  staff_id: string;      // "owner" for desk AI
  provider_id: string;
  timestamp: string;     // ISO
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;      // 按 provider 价格算
  context: string;       // "chat_turn" | "wechat_read" | "digest" | ...
}

interface TokenBudget {
  staff_id: string;
  daily_limit_tokens: number | null;   // null = 无限
  monthly_limit_tokens: number | null;
  daily_limit_usd: number | null;
  monthly_limit_usd: number | null;
  on_exceed: 'warn' | 'block';        // 超限行为
}

interface TokenUsageSummary {
  staff_id: string;
  today_tokens: number;
  today_cost_usd: number;
  month_tokens: number;
  month_cost_usd: number;
  budget: TokenBudget | null;
  warning_level: 'ok' | 'warning_80' | 'exceeded';
}
```

### Token 价格表（内置默认，owner 可自定义）

```typescript
const DEFAULT_PRICING: Record<string, { input_per_1m: number; output_per_1m: number }> = {
  'deepseek': { input_per_1m: 0.14, output_per_1m: 0.28 },      // DeepSeek V3
  'deepseek-chat': { input_per_1m: 0.14, output_per_1m: 0.28 },
  'gpt-4o': { input_per_1m: 2.50, output_per_1m: 10.00 },
  'gpt-4o-mini': { input_per_1m: 0.15, output_per_1m: 0.60 },
  'claude-sonnet-4-6': { input_per_1m: 3.00, output_per_1m: 15.00 },
  'claude-haiku-4-5': { input_per_1m: 0.80, output_per_1m: 4.00 },
};
```

### 实现方式

#### Skill: token-usage-tracker
通用 skill，每次 LLM 调用后自动记录：

```typescript
// 在每个 LLM 调用点 after response：
recordTokenUsage({
  staff_id: staffId ?? 'owner',
  provider_id: provider.providerId,
  input_tokens: response.usage?.prompt_tokens ?? 0,
  output_tokens: response.usage?.completion_tokens ?? 0,
  context: 'chat_turn',
});
```

#### API
- GET /api/v1/staff/:id/cost → TokenUsageSummary
- GET /api/v1/staff/:id/cost/history?days=30 → daily breakdown
- PATCH /api/v1/staff/:id/cost/budget → set limits
- GET /api/v1/cost/overview → all agents summary

#### UI
**/members → staff 详情 → Token 用量**
```
📊 Token 用量
今日：1,234 tokens · ¥0.02
本月：45,678 tokens · ¥0.89
预算：月限 100,000 tokens（45.7%）
[■■■■■░░░░░] 45.7%
```

**/me → 总览**
```
📊 团队 Token 总览
Desk AI:    12,345 tokens · ¥0.23
微信助手:    8,901 tokens · ¥0.15
Sally:       3,456 tokens · ¥0.06
──────────────────────────
总计:       24,702 tokens · ¥0.44
```

#### 预警
- 80% 时：staff 卡片显示黄色 badge "接近限额"
- 100% 时：
  - `on_exceed: 'warn'` → 红色 badge，继续工作
  - `on_exceed: 'block'` → 拒绝 LLM 调用，返回"Token 预算已用完"

### 关键文件
- 新增：packages/core/src/token-usage-service.ts
- 新增：apps/web/app/api/v1/staff/[id]/cost/route.ts
- 修改：apps/web/lib/llm-provider-resolver.ts（调用后记录 usage）
- 修改：apps/web/lib/wechat-specialist-agent.ts（调用后记录 usage）
- 修改：apps/web/app/api/v1/chat/owner/stream/route.ts（调用后记录 usage）
- 新增：apps/web/app/members/_components/TokenUsageCard.tsx

### 估算
- Provider selection: Codex 4h
- Token tracking core: Codex 6h
- Budget + 预警: Codex 4h
- UI: Codex 4h
- 测试: 我 2h

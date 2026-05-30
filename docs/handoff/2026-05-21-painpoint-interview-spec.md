# Spec: In-App 痛点访谈（语音优先）

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
Priority: P1（提升 onboarding 完成率 + 自动配置能力）
Pickup: Codex

## 用户需求

> "第一次用这个软件，不知道它能帮我干嘛。如果它能问我几个问题，了解我的痛点，然后自动帮我设置好，那就太好了。"

## 现有基础

- Onboarding 已有痛点收集入口（`lib/painpoint-state.ts`）
- Interview skill 设计已有（`docs/handoff/2026-05-19-onboarding-interview-design-req.md`）
- Meeting mode 已有 UI shell（`/meeting` route, full-screen）
- Voice transcription service 已有（`/api/v1/connectors/voice/transcribe`）

## 设计

### 访谈流程

```
用户首次安装 → Onboarding 完成 → 弹出：
"想让我更了解你的工作吗？2分钟语音对话就够了。"
[开始对话] [稍后再说]
    ↓
Meeting mode（全屏，无干扰）
    ↓
AI 用语音问（TTS）：
  Q1: "你的公司主要做什么业务？"
  Q2: "你每天花最多时间在什么事情上？"
  Q3: "微信上最让你头疼的是什么？客户消息太多？还是跟进太难？"
  Q4: "你最希望 AI 帮你做什么？"
    ↓
用户用语音回答（STT → 文字）
    ↓
AI 分析痛点 → 自动配置：
  - 匹配行业 persona
  - 设置微信白名单（重要客户优先）
  - 配置每日 briefing
  - 建议技能启用
    ↓
"配置完成！试试问微信助手：看看最近谁给我发微信了。"
```

### 技术组件

| 组件 | 用途 | 现有/新建 |
|------|------|---------|
| TTS（文字转语音） | AI 语音提问 | 新建（见 TTS spec） |
| STT（语音转文字） | 用户语音回答 | 有（voice-transcription-service） |
| Meeting mode UI | 全屏对话界面 | 有（/meeting route） |
| 痛点分析 LLM | 分析用户回答，提取痛点 | 新建（DeepSeek function calling） |
| 自动配置 | 根据痛点设置 persona/skills/whitelist | 新建（调用已有 API） |

### 访谈数据模型

```typescript
interface PainpointInterview {
  id: string;
  started_at: string;
  completed_at?: string;
  qa_pairs: Array<{
    question: string;
    answer_text: string;       // STT 转写
    answer_audio_url?: string; // 原始语音（可选保存）
  }>;
  analysis?: {
    industry: string;         // 识别的行业
    pain_points: string[];    // 提取的痛点
    recommended_persona: string;
    recommended_skills: string[];
    recommended_contacts: string[]; // 建议加白名单的联系人
  };
  config_applied: boolean;    // 是否已自动配置
}
```

### 触发时机

1. **首次使用**：onboarding 完成后弹出
2. **手动触发**：/me 页面 → "重新做痛点访谈"
3. **定期触发**（V2）：每月提醒"你的需求变了吗？"

## TTS 方案（Quick spec）

### 推荐：edge-tts（最快集成）
- Microsoft Edge 的 TTS API，免费，中文质量好
- `pip install edge-tts`
- 生成 MP3，前端 `<audio>` 播放
- 不需要 GPU，延迟 <1s

### 备选：ChatTTS（最自然）
- 开源，专为中文对话优化
- 需要 GPU 或 CPU 跑模型（~300MB）
- 更自然但更慢

### 集成方式
- 新 API endpoint: POST /api/v1/tts { text } → audio/mpeg
- 后端调 edge-tts 或 ChatTTS
- 前端 Meeting mode 播放音频

## 估算
- TTS endpoint: Codex 2h
- Meeting mode 访谈 UI: Codex 4h
- 痛点分析 + 自动配置: Codex 4h
- 测试: 我 2h

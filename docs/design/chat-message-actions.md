# 微作 聊天消息操作 & 朗读控件设计研究

**日期**: 2026-05-24  
**作者**: Design Research (docs-only)  
**范围**: `apps/mobile` 微作 WeChat 风格聊天界面的朗读（TTS）控件及逐消息操作交互设计  
**状态**: 提案 — 仅设计文档，不含代码改动

---

## 1. 当前实现诊断

### 1.1 现状描述

`MobileReadAloudButton` 组件渲染为 `<span className="mobile-tts">`，
被直接挂在 `AssistantMsg` 和 Staff 消息的 **根节点末尾**：

```tsx
// AssistantMsg (小秘)
<MessagePrimitive.Root className="chatmsg chatmsg-assistant">
  <div className="chatmsg-content">
    <MessagePrimitive.Parts />
  </div>
  <MobileReadAloudButton id={message.id} text={text} />   // ← 在 content div 外面
</MessagePrimitive.Root>

// Staff 消息
<div className={`chatmsg ${m.role === 'user' ? 'chatmsg-user' : 'chatmsg-assistant'}`}>
  <div className="chatmsg-content">{m.content}</div>
  {m.role === 'assistant' && <MobileReadAloudButton ... />}  // ← 同样在 content 外
</div>
```

CSS：`mobile-tts` 为 `inline-flex`，`mobile-tts-button` 为 28×28px 圆形按钮，
`margin-left: 6px`，`align-self: flex-end`。按钮内容：空闲态 `🔊`，播放态 `■`。

### 1.2 问题清单

| # | 问题 | 具体表现 |
|---|------|---------|
| P1 | **定位不明** | 按钮挂在气泡根节点末尾，在某些布局下呈"游离"状态悬浮于气泡右下角外侧，用户看不出它针对哪条消息 |
| P2 | **图标廉价感** | 直接使用 Unicode 字符 `🔊` / `■`，在 iOS/Android 渲染为系统 emoji，与微信风格的单色矢量图标体系完全不搭 |
| P3 | **状态不清晰** | 停止态 `■` 和播放中没有过渡动效，用户难以判断是否正在朗读；`hint` 提示框弹到气泡上方，视觉上很突兀 |
| P4 | **没有更多操作** | 只有单个朗读按钮，与用户对 AI 对话泡的预期（至少还有复制）脱节，显得功能残缺 |
| P5 | **长按无反应** | WeChat 用户肌肉记忆是"长按出菜单"，目前无此行为，反而点击就触发，容易误触 |
| P6 | **全局单一实例** | 同时只能朗读一条消息，但 UI 不阻止用户点击另一条——没有全局状态互斥提示 |
| P7 | **CSS 孤立** | `chatmsg` 类在 JSX 中使用，但 `globals.css` 里只有 `.m-chatmsg`（旧命名），缺少配套样式，排版实际依赖外部上下文推断 |

---

## 2. 竞品研究

### 2.1 ChatGPT Mobile（iOS / Android）

**朗读入口**（来源：[OpenAI 官方 Twitter/X，2024-03-04](https://x.com/OpenAI/status/1764712432939995549)，
[MacRumors，2024-03-05](https://www.macrumors.com/2024/03/05/chatgpt-read-aloud-feature-iphone-app/)，
[VentureBeat](https://venturebeat.com/ai/openai-adds-read-aloud-voiceover-to-chatgpt-allowing-it-to-speak-its-outputs/)）：

- **Mobile**：**长按助手气泡** → 弹出操作面板，其中包含"Read Aloud"选项（扬声器图标）。
- **Web**：助手消息下方的操作行（action row）中显示 Read Aloud 按钮，始终可见。
- 朗读时底部有持久化迷你播放器（进度条 + 暂停/前进 15 秒控件）。
- 操作菜单完整集合：复制（Copy）、朗读（Read Aloud）、重新生成（Regenerate）、
  点踩（Thumbs Down）、编辑（Edit，仅用户消息）。

**实际体验 vs 营销**：
- 营销强调"流畅自然声音"，实测 TTS 音质因所选声音而异，部分用户反映语调生硬  
  ([社区反馈](https://community.openai.com/t/why-doesn-t-chatgpt-read-stories-aloud-anymore/1126817))。
- Read Aloud 在多个版本更新后曾反复"消失"，有用户专门开发 Tampermonkey 脚本恢复  
  ([社区修复帖](https://community.openai.com/t/workaround-restore-read-aloud-tts-controls-in-chatgpt-tampermonkey-userscript-one-click-install/1356650))。

### 2.2 Claude Mobile App（iOS / Android）

**朗读入口**（来源：[Claude Help Center — Voice mode](https://support.claude.com/en/articles/11101966-use-voice-mode)）：

- Claude 主打"完整语音对话"（Voice Mode），而非单条消息 TTS。
- Voice Mode 下整个对话都是实时语音交互，没有"朗读某条消息"的独立按钮。
- 消息下方有 🔈 图标（对应 Voice Mode 回放），点击后重播该条回复。
- 无明显的逐消息操作行（没有 Copy/Regen 悬浮 row）——操作通过系统长按 + 系统剪贴板完成。

**现实差距**：Anthropic 主力推 Voice Mode，对非语音用户的单条朗读支持相对薄弱；
功能完整度不如 ChatGPT 的 per-message action row。

### 2.3 Google Gemini App（Android / iOS）

**朗读入口**（来源：[Google Gemini Help — Android](https://support.google.com/gemini/answer/14579631?hl=en&co=GENIE.Platform%3DAndroid)，
[社区帖"speaker icon gone"](https://support.google.com/gemini/thread/318280054/where-has-the-speaker-read-icon-gone?hl=en)）：

- 消息下方有常驻 **内联操作行**（inline action row），包含：扬声器🔊、点赞👍、点踩👎、分享、更多（⋯）。
- 朗读按钮 **始终可见**，不需要长按，点击即播；播放中按钮变为停止图标。
- 操作行图标为单色矢量，与 Google Material You 设计语言一致。
- 社区反馈：扬声器图标曾在某次更新后消失（2025 年初），后来重新出现；说明 Google 对此入口有过反复。

**现实差距**：Gemini 的内联 action row 是对 ChatGPT 长按菜单的改良版——发现成本更低；
但在消息列表较长时，每条消息都展示整行图标会产生视觉噪音。

### 2.4 微信（WeChat）——最重要参考

**交互模型**（来源：[微信帮助中心 — 翻译](https://help.wechat.com/cgi-bin/micromsg-bin/oshelpcenter?opcode=2&plat=3&lang=en&id=1208117b2mai1410246b6B3Q)，
[INFO Guangdong — WeChat 8.0.60](https://info.newsgd.com/node_9c0fe5b9f4/c4298116c2.shtml)，
[The Egg — WeChat 8.0.21/22](https://www.theegg.com/social/china/wechat-feature-updates-on-new-ios-and-android-versions/)）：

- **长按气泡** → 半透明黑底上下文菜单，图标+文字网格排列（每行 4-5 个），常见选项：
  **复制、转发、收藏、引用回复、翻译、撤回、删除、多选**。
- **语音消息**：点击直接播放（单次点击），再次点击暂停；没有独立"朗读"按钮——
  因为语音消息本身就是音频，播放是其原生行为。
- **文字消息没有朗读**：微信官方没有对文字消息的 TTS 朗读功能，
  这意味着用户没有"点一下就朗读文字"的肌肉记忆——所以朗读对微作是新功能，
  入口设计需要适度显眼，但仍应符合微信上下文菜单的操作惯例。
- 微信菜单是**图标+中文标签**，单色线性图标（非 emoji），字号约 11-12px。

**关键洞察**：微信用户对"长按 → 菜单"是高度训练的，但菜单里没有"朗读"预期。
因此微作的朗读入口若只放长按菜单，发现率低；若单独浮出图标按钮，又与微信风格脱节。
**最佳解法：两者结合——小型操作行默认隐藏，tap 气泡后短暂显示；
同时长按保留菜单兼容路径。**

### 2.5 通用 Mobile UX 原则综合

来源：[Bricxlabs — 16 Chat UI Patterns 2026](https://bricxlabs.com/blogs/message-screen-ui-deisgn)，
[Fuselabcreative — Chatbot UI Design Patterns 2026](https://fuselabcreative.com/chatbot-interface-design-guide/)，
[UX Patterns.dev — AI Chat](https://uxpatterns.dev/patterns/ai-intelligence/ai-chat)：

| 模式 | 适用场景 | 缺点 |
|------|---------|------|
| **内联常驻操作行** | 操作频繁，功能发现优先（Gemini） | 视觉噪音多，小屏挤 |
| **Tap 气泡 → 短暂显示操作行** | 操作频率中等，保持界面干净 | 初次用户不知道要 tap |
| **长按上下文菜单** | 操作频率低，微信式用户（ChatGPT mobile） | 发现成本高，不适合高频朗读 |
| **固定操作行在 Composer 上方** | 全局操作（如"朗读当前回复"） | 歧义大，不知道针对哪条 |

**推荐**：对朗读频率中等、微信用户的 微作 场景，**Tap 气泡 → 短暂显示操作行**
是最佳平衡，且可以叠加长按菜单作为次级路径。

---

## 3. 推荐设计方案

### 3.1 核心决策

**选择：Tap 助手气泡 → 气泡下方短暂浮出操作条（action strip）**，
配合长按触发完整操作菜单（与微信一致）。

**理由**：
1. 发现率高于纯长按（Gemini 实践印证），又不像 Gemini 常驻操作行那样嘈杂。
2. 与微信长按习惯兼容（长按还是有菜单，用户不会觉得"不像微信"）。
3. 朗读是中等频率操作（不是每条都听），短暂显示刚好合适。
4. 气泡下方紧贴放置，与哪条消息关联一目了然——解决 P1 问题。

### 3.2 操作条（Action Strip）设计规格

**V1 范围**（精简，可扩展）：

| 按钮 | 图标 | 标签 | 状态 |
|------|------|------|------|
| 朗读 / 停止 | 单色线性扬声器（或动态波形） | 朗读 / 停止 | 空闲 / 播放中 / 加载中 |
| 复制 | 单色线性复制 | 复制 | 点击后 1s 变为"已复制" |

> **不在 V1 的功能**：重试（Regen）、翻译、引用——这些进长按菜单，不入 action strip。
> 理由：V1 保持最小化，聚焦最高价值操作。重试操作在 assistant-ui 框架中有独立机制。

**触发逻辑**：
- **Tap 气泡正文** → 操作条浮出，3 秒后自动收起（若未交互）；
  若已点击朗读，则播放期间保持可见（停止按钮常驻）。
- **长按气泡** → 原生操作菜单（复制、转发……），其中也包含"朗读"选项。
- **点击其他地方** → 操作条收起。

**全局互斥**：一次只能朗读一条消息。当消息 A 正在朗读时，
点击消息 B 的朗读按钮应先自动停止 A 再开始 B（通过共享上下文或全局状态）。

### 3.3 状态设计

| 状态 | 图标 | 标签 | 样式 |
|------|------|------|------|
| 空闲 | 🔊 线性扬声器（SVG） | 朗读 | 灰色文字 + 灰色图标，透明底 |
| 加载中 | 三点脉冲动画 | 加载… | 绿色主色 |
| 播放中 | 停止方块（■ → SVG） | 停止 | 绿色主色，轻微背景高亮 |
| 错误 | × 图标 | 失败 | 红色，1s 后恢复空闲态 |

**注意**：`hint` 浮层（当前实现）改为 toast 式短暂提示（淡入淡出），
不再用 `position: absolute` 弹到气泡上方。

### 3.4 样式规范（WeChat Shell Token 对齐）

```
Action Strip 容器：
  - background: var(--paper)（白色）
  - border: 1px solid var(--line)（#E5E5EA）
  - border-radius: 18px（胶囊形）
  - padding: 4px 10px
  - gap: 16px
  - align-self: flex-start（左对齐，跟随助手气泡方向）
  - margin-top: 4px，margin-left: 0（顶住气泡左边）
  - animation: fadeIn 120ms ease-out

按钮单元：
  - display: flex; flex-direction: row; align-items: center; gap: 4px
  - icon: 16px × 16px SVG（单色 currentColor）
  - label: 11px, color: var(--muted)（#8E8E93）
  - 活跃态：color: var(--green)（#1f7a44）
  - tap target: 最小 44px（iOS HIG 标准），用 padding 补足

禁用：单色 emoji → 完全去掉，改用 SVG 图标
```

---

## 4. ASCII 线框图

### 4.1 空闲态（tap 气泡后）

```
┌─────────────────────────────────────┐
│  小秘头像                            │
│  ┌────────────────────────────────┐ │
│  │ 这是助手的回复内容。今天天气不错，  │ │
│  │ 你有什么想聊的吗？               │ │
│  └────────────────────────────────┘ │
│  ╭──────────────────╮               │
│  │ 🔊 朗读  ·  ⎘ 复制 │   ← action strip
│  ╰──────────────────╯               │
│                                     │
│  我: 好的，谢谢。                    │
└─────────────────────────────────────┘
```

Action strip 紧贴气泡底部左对齐，胶囊形白色底，单色图标+中文标签。

### 4.2 播放中状态

```
┌─────────────────────────────────────┐
│  小秘头像                            │
│  ┌────────────────────────────────┐ │
│  │ 这是助手的回复内容。今天天气不错，  │ │  ← 气泡无变化（不高亮气泡本身）
│  │ 你有什么想聊的吗？               │ │
│  └────────────────────────────────┘ │
│  ╭───────────────────────────────╮  │
│  │ ■ 停止  ·  ⎘ 复制             │  │  ← 停止图标，绿色高亮
│  ╰───────────────────────────────╯  │
│                                     │
│  ▶▶▶ 正在朗读… ▏▎▍▌  ← 可选：底部迷你进度条（V2）
└─────────────────────────────────────┘

停止按钮：
  color: var(--green)  ←  #1f7a44
  border-color: var(--green)（轻微绿边框）
```

### 4.3 长按菜单（兼容路径）

```
┌─────────────────────────────────────┐
│  （背景模糊/半透明遮罩）              │
│  ┌────────────────────────────────┐ │
│  │ 这是助手的回复内容。今天天气不错，  │ │  ← 气泡轻微缩放放大（iOS 弹出效果）
│  │ 你有什么想聊的吗？               │ │
│  └────────────────────────────────┘ │
│                                     │
│  ┌──────────────────────────────┐   │
│  │  ⎘    🔊    ↗    ★    ✕    │   │  ← 图标行（单色 SVG）
│  │ 复制  朗读  转发  收藏  删除  │   │  ← 标签行（11px 灰色）
│  └──────────────────────────────┘   │
└─────────────────────────────────────┘
```

菜单样式对齐微信：白底、圆角 12px、阴影、图标+标签纵排，单色线性图标。

### 4.4 加载中状态（朗读开始前短暂等待）

```
  ╭────────────────────────────────╮
  │ ●·· 加载中  ·  ⎘ 复制         │
  ╰────────────────────────────────╯
  三点脉冲：opacity: 0.3→1.0 循环，间隔 300ms
```

### 4.5 错误状态（1s 后自动恢复）

```
  ╭────────────────────────────────╮
  │ ✕ 朗读失败  ·  ⎘ 复制         │   ← 红色图标+文字，1s fadeOut → 恢复空闲
  ╰────────────────────────────────╯
```

---

## 5. 实现备注

### 5.1 涉及文件

| 文件 | 改动范围 |
|------|---------|
| `apps/mobile/app/_components/WeizoApp.tsx` | 重写 `MobileReadAloudButton` → `MessageActionStrip`；修改 `AssistantMsg` 和 Staff 消息渲染处 |
| `apps/mobile/app/globals.css` | 删除 `.mobile-tts*` 规则，新增 `.msg-action-strip*` 规则 |

### 5.2 与 speak()/stop() 引擎集成

本设计不改动 TTS 引擎逻辑。新组件仍通过相同接口调用：

```ts
// 保持不变
import { speak as deviceTtsSpeak, stop as deviceTtsStop } from '../_lib/device-tts';

// 改动只在 UI 层：MobileReadAloudButton → MessageActionStrip
// speak(text) / stop() 调用点不变
```

**全局互斥状态**（建议）：在父组件或 React Context 维护 `playingMessageId: string | null`。
当 `playingMessageId !== null && playingMessageId !== thisMessageId` 时，
朗读按钮渲染为禁用态（灰色），点击会先 stop() 再 speak()。

### 5.3 Action Strip 显示逻辑

```
气泡容器（chatmsg-assistant）onPointerUp → setShowActions(true)
长按检测：onPointerDown 记录时间，onPointerUp 判断 >500ms → 菜单
showActions → 3000ms timeout → setShowActions(false)
正在播放时：忽略 timeout（保持显示）
```

### 5.4 CSS 补丁方向（`chatmsg` 命名问题）

当前 JSX 用 `chatmsg` / `chatmsg-assistant`，CSS 中无对应规则（只有旧 `.m-chatmsg`）。
建议在修复 action strip 时同步补全 `chatmsg` 的 CSS（参考 `.m-chatmsg` 迁移，
将布局规则从 `.m-chatmsg` 复制到 `.chatmsg`），使 `chatmsg-assistant`
有明确的 `display: flex; flex-direction: column; align-items: flex-start` 定义，
以保证 action strip 的 `align-self: flex-start` 和 `margin-top` 如期生效。

### 5.5 SVG 图标方案

抛弃 Unicode emoji，使用内联 SVG 或 Lucide React（项目已有）：
- 扬声器：`<Volume2 />` (Lucide) — 16×16
- 停止：`<Square />` (Lucide) — 16×16
- 复制：`<Copy />` (Lucide) — 16×16

Lucide 图标为单色 `currentColor`，适配 WeChat 风格的单色线性图标语言。

---

## 6. 执行摘要

**一句话建议**：将当前孤悬于气泡外的 `🔊` emoji 按钮，
改为"tap 气泡 → 短暂浮出胶囊形操作条（朗读 + 复制）"，配合长按菜单作为次级路径；
完全对齐微信交互惯例，用单色 SVG 替换 emoji，彻底消除山寨感。

**V1 范围**：操作条仅含「朗读」+「复制」两项，最小化实现。  
**V2 扩展**：底部迷你播放进度条、长按菜单更多项、全局朗读状态管理。

---

*参考来源：*
- [OpenAI: ChatGPT Read Aloud announcement (X, 2024-03-04)](https://x.com/OpenAI/status/1764712432939995549)
- [MacRumors: ChatGPT read aloud iPhone (2024-03-05)](https://www.macrumors.com/2024/03/05/chatgpt-read-aloud-feature-iphone-app/)
- [VentureBeat: OpenAI adds Read Aloud voiceover](https://venturebeat.com/ai/openai-adds-read-aloud-voiceover-to-chatgpt-allowing-it-to-speak-its-outputs/)
- [OpenAI Community: Read Aloud workaround/TTS restored](https://community.openai.com/t/workaround-restore-read-aloud-tts-controls-in-chatgpt-tampermonkey-userscript-one-click-install/1356650)
- [Claude Help Center: Voice mode](https://support.claude.com/en/articles/11101966-use-voice-mode)
- [Google Gemini Help: Android app](https://support.google.com/gemini/answer/14579631?hl=en&co=GENIE.Platform%3DAndroid)
- [Google Gemini Community: Speaker icon gone](https://support.google.com/gemini/thread/318280054/where-has-the-speaker-read-icon-gone?hl=en)
- [WeChat Help Center: Message translation](https://help.wechat.com/cgi-bin/micromsg-bin/oshelpcenter?opcode=2&plat=3&lang=en&id=1208117b2mai1410246b6B3Q)
- [INFO Guangdong: WeChat 8.0.60 updates](https://info.newsgd.com/node_9c0fe5b9f4/c4298116c2.shtml)
- [The Egg: WeChat 8.0.21/22 feature updates](https://www.theegg.com/social/china/wechat-feature-updates-on-new-ios-and-android-versions/)
- [Bricxlabs: 16 Chat UI Patterns 2026](https://bricxlabs.com/blogs/message-screen-ui-deisgn)
- [Fuselabcreative: Chatbot UI Design Guide](https://fuselabcreative.com/chatbot-interface-design-guide/)

# Spec: 微信语音消息转文字

Status: design-ready
Priority: P0（中国 SMB 用户大量使用语音消息）
Pickup: Codex

## 用户需求

> "客户发语音我得一条一条听，太浪费时间了。AI 能不能直接把语音变成文字然后总结？"

## 当前状态

微信语音消息在 pywxdump 读取时显示为 `[语音]`，内容丢失。
WeChat 本地存储语音为 Silk 格式（.silk / .aud），可以提取。

## 技术方案

### 方案 A：本地 Whisper（推荐）
1. pywxdump 读取时提取语音文件路径
2. Silk → PCM/WAV 转换（silk-python 库，已安装）
3. Whisper（openai-whisper 或 faster-whisper）本地转录
4. 转录文本替换 `[语音]` 标记

**优点**：离线、免费、隐私安全
**缺点**：首次加载模型 1-2GB，转录速度依赖 CPU/GPU

### 方案 B：SenseVoice API
项目已有 `/api/v1/connectors/voice/transcribe` 路由和 `voice-transcription-service.ts`。
可以复用这条链路。

### 方案 C：DeepSeek Audio（如果支持）
直接把音频发给 LLM 处理。目前 DeepSeek 不支持音频输入。

## 实现计划

### Phase 1：提取语音文件路径
- 在 `wechat-read-pywxdump.py` 中，type=34（语音）的消息
- 从 MSG 表的 CompressContent 或 BytesExtra 提取 silk 文件路径
- WeChat 语音文件通常在 `WeChat Files/<wxid>/voice2/` 目录

### Phase 2：Silk → WAV 转换
- 用 silk-python（已安装）：`silk.decode(silk_data)` → PCM bytes
- 或用 ffmpeg（如果装了）

### Phase 3：Whisper 转录
- `pip install faster-whisper`（比 openai-whisper 快 4x）
- 加载 base 模型（~150MB）用于中文
- 每条语音 1-5 秒转录

### Phase 4：集成到读取流程
- wechat-read-pywxdump.py 读到 type=34 时：
  1. 找到 silk 文件
  2. 转 WAV
  3. Whisper 转录
  4. 返回 `text: "[语音转文字] 客户说：下周三能不能开会？"`
- 可选：加 `--transcribe` flag 控制是否转录（默认 on）

## 依赖
- silk-python 3.x（已安装）
- faster-whisper（需安装）
- WeChat 语音文件目录可访问

## 估算
- Phase 1-2：Codex 2h
- Phase 3-4：Codex 4h
- 测试验证：我 1h

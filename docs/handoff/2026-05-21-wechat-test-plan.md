# WeChat 功能测试计划（Updated 2026-05-21 17:00 UTC）

## 我（Claude）能自动测试的

### API 层（curl 验证）
| # | 测试 | 命令 | 预期 | 自动化 |
|---|------|------|------|--------|
| A1 | pywxdump 读取 | `python scripts/wechat-read-pywxdump.py --mode read --contact "Falcon Li" --limit 3` | ok=true, count>0 | ✅ |
| A2 | pywxdump 搜索 | `python scripts/wechat-read-pywxdump.py --mode search --keyword "AI" --limit 5` | ok=true, messages含关键词 | ✅ |
| A3 | pywxdump 联系人列表 | `python scripts/wechat-read-pywxdump.py --mode contacts --limit 10` | ok=true, contacts非空 | ✅ |
| A4 | HTTP server read | `curl http://127.0.0.1:8766/read?contact=Falcon+Li&limit=3` | ok=true | ✅ |
| A5 | HTTP server search | `curl http://127.0.0.1:8766/search?keyword=AI&limit=5` | ok=true | ✅ |
| A6 | HTTP server contacts | `curl http://127.0.0.1:8766/contacts?limit=10` | ok=true | ✅ |
| A7 | 联系人模糊匹配 | `...--contact "Falcon"` (不是完整名) | 自动匹配到 Falcon Li -WinDiesel | ✅ |
| A8 | 不存在的联系人 | `...--contact "NotExist999"` | ok=false, error=contact_not_found | ✅ |
| A9 | 空参数 | `curl http://127.0.0.1:8766/read` (无 contact) | ok=false, error=missing_contact | ✅ |

### 代码质量
| # | 测试 | 命令 | 自动化 |
|---|------|------|--------|
| B1 | typecheck 全包 | `pnpm -F api-contract typecheck && pnpm -F core typecheck && pnpm -F web typecheck` | ✅ |
| B2 | core 单测 | `pnpm -F core test` | ✅ |
| B3 | runtime-openclaw 单测 | `pnpm -F runtime-openclaw test` | ✅ |
| B4 | runtime-telegram 单测 | `pnpm -F runtime-telegram test` | ✅ |
| B5 | api-contract 单测 | `pnpm -F api-contract test` | ✅ |
| B6 | Hermes plugin 单测 | `cd packages/hermes-plugin-holon-owner && python -m pytest tests/` | ✅ |

### 聊天集成（PowerShell curl，因 Git Bash 编码问题）
| # | 测试 | 预期 | 自动化 |
|---|------|------|--------|
| C1 | 读取消息 | POST stream "读取 Falcon Li 微信" → tool_call + 中文总结 | ✅ (PowerShell) |
| C2 | 追问 | 接 C1 追问"最后一条是啥" → 能回答 | ✅ (PowerShell) |
| C3 | 无联系人 | "读取微信消息"（不指定人）→ 提示指定联系人 | ✅ (PowerShell) |
| C4 | 非微信问题 | "今天天气怎么样" → 走正常 Hermes，不触发微信 | ✅ (PowerShell) |

## 需要 Owner 手动测试的

### UI 交互（浏览器）
| # | 测试 | 操作 | 预期 |
|---|------|------|------|
| D1 | 聊天读取微信 | 浏览器 localhost:3000 → 聊天框输入"读取 Falcon Li 的微信" | 看到 tool_call 动画 → 中文总结 |
| D2 | 追问测试 | D1 之后输入"他最后说了什么" | 能回答具体内容 |
| D3 | 微信助手员工 | /members 页面 → 看到"微信助手"卡片 | 卡片显示，点进去能对话 |
| D4 | Connector 触发 | /connectors → WeChat Read → 配置连接 → /members 自动出现微信助手 | 员工自动创建 |
| D5 | 安装包测试 | 安装 Holon exe → 打开 → 聊天里问微信 | 完整链路在 exe 里工作 |
| D6 | 窗口最大化 | 安装后首次打开 → 窗口默认最大化 | 聊天面板可见 |
| D7 | Onboarding | 全新安装 → 不闪正常页面，直接进 onboarding | 无闪屏 |

### 边界情况（Owner 判断）
| # | 测试 | 操作 |
|---|------|------|
| E1 | 微信未登录时读取 | 关掉微信桌面版 → 问"读取微信" → 应报错"微信未运行" |
| E2 | 中文名联系人 | "读取 张伟 的微信" → 正确匹配中文联系人 |
| E3 | 群聊消息 | "读取 XXX群 的微信" → 能读群消息（@chatroom wxid） |
| E4 | 大量消息 | "读取最近7天 Falcon Li 的微信 200条" → 性能可接受（<30s） |

## 新增测试（2026-05-21 17:00 UTC）

### Specialist Agent（DeepSeek function calling）
| # | 测试 | 方法 | 预期 | 结果 |
|---|------|------|------|------|
| F1 | 微信助手 staff 自动创建 | GET /api/v1/staff → 看 wechat_specialist | 存在 | ✅ 通过 |
| F2 | 微信助手 function calling | /members → 微信助手 → "看看 Falcon Li 最后聊了啥" | LLM 自然语言回复 + 真实消息 | ✅ owner 验证通过 |
| F3 | /clear 命令 | 微信助手聊天框输入 /clear | 清空对话（带确认） | 待 owner 测 |
| F4 | Owner chat delegate | 主聊天框 → "读取 Falcon Li 微信" | "正在让微信助手处理" → 总结 | 待 owner 测 |
| F5 | 追问能力 | F2 后 → "他最后一条是啥" | 能回答具体内容（LLM 有上下文） | 待 owner 测 |
| F6 | 搜索 | 微信助手 → "搜索微信里提到 AI 的消息" | 返回跨联系人搜索结果 | 待 owner 测 |
| F7 | 联系人列表 | 微信助手 → "最近谁给我发微信了" | 返回活跃联系人 | 待 owner 测 |

### 最新自动测试结果（2026-05-21 17:00 UTC）
- Typecheck 3/3 pass ✅
- Unit tests 206/206 pass ✅
- pywxdump read/search/contacts: 3/3 pass ✅
- HTTP endpoints read/search/contacts: 3/3 pass ✅
- v0.1.2 build: 🔄 cargo 编译中

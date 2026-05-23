# Handoff — Coworker substrate model (ADR-029) + left-nav restructure

Date: 2026-05-19
Branch: `claude/employee-hierarchy-design-1aumA`
From: web Claude session (owner ↔ AI 设计讨论)
To: local CLI (Claude Code / Codex) for pickup

> 这是一份"平面"handoff —— 让本地 AI 自己读完就能开干。所有路径都是 repo 相对路径,所有 commit hash 都已 push 到 origin。

---

## 0. TL;DR(给本地 AI 的一句话)

**用户跟我讨论了 Holon 三类员工(virtu / cli-agent / peer)的本质区别,把 spec 该改的地方写成了 `docs/decisions/029-coworker-substrate-model.md`(proposed 状态),并顺手把左导航重排成"动词优先"。** 你的任务是接力把 ADR-029 走完最后一公里 —— 改 spec、改数据模型、改 substrate 命名,以及把 Connector 的 Presence/API 分类补进 029。

---

## 1. 已经做完的两件事

### 1.1 ADR-029 proposed
- 文件: `docs/decisions/029-coworker-substrate-model.md`
- Commit: `086f0ea`
- 状态: `proposed (2026-05-19)`
- 核心结论:
  - 三个 substrate 类型按 **runtime 所有权** 切分: `local_ai` (Holon 自己的 runtime, Hermes V1) / `cli_agent` (第三方本地 LLM-CLI, 如 Claude Code/Codex) / `peer` (远端 desk, Core 2)
  - `RuntimeAdapter` 是通用 agent 接口,**不是 Hermes-locked**; virtu + cli-agent 共享这个接口,peer 走 Core 2 不走 adapter
  - "CLI" 现 spec 定义混了 —— 既指 ffmpeg 这种哑工具又指 Claude Code 这种 agent CLI。决议: `cli_agent` 专指 agentic LLM-CLI;哑工具延迟到未来 tool/MCP catalog 层
  - Owner 视角是单一"同事"概念 + 3 badge (virtual/cli/peer);工程层是两条路径(RuntimeAdapter + Core 2)
  - **同事之间不互相指挥** —— virtu 要 enlist 别的同事必须 `draft_handoff()` 到 owner outbox 等批准。virtu 可以直接调"工具"(SaaS connector / MCP / 哑 CLI),区分判据 = "需不需要 coaching"
  - Connector 在 ADR-029 里被当作一个 flat 概念,**未拆分** —— 见下面 §2.1 需要你补的内容

### 1.2 左导航重排(已 ship)
- 改动文件:
  - `apps/web/app/_components/Nav.tsx`
  - `apps/web/app/globals.css`
- Commit: `76a3959`
- 改动内容:
  - 主组从 3 项变 4 项: Today(原 Home,改成动词) / Inbound / Deliverables / **Team(从次组升上来)**
  - 次组加了"LIBRARY"小 caps 标签 + 视觉降权(小字号 / 低 opacity / 小 icon): Skills / References
  - 路由零改动,深链全部照常工作
  - 折叠 rail 模式下 LIBRARY 文字隐藏,变成淡分隔线
- 用户已 push,可以本地拉下来 `pnpm dev` 看效果

---

## 2. 你接手要做的事(优先级排序)

### 2.1 把 Connector 分类补进 ADR-029(P0 — 最简单)

讨论里用户问到: "Slack/WeChat/Telegram/Teams 这类 connector 跟 Gmail 是不是一个概念?"

结论是 **不是**,两类应该在工程层分开实现,在 UX 层合并展示:

| 类型 | 例子 | 触发模式 | 身份 | 谁负责 |
|---|---|---|---|---|
| **Presence 类** | Slack / WeChat / Telegram / Teams / Discord / Feishu | **Push** (对方主动找你) | **bot identity** (频道里看到 bot 用户) | Holon BFF 接 webhook + agent runtime 处理事件 |
| **API 类** | Gmail / Calendar / Notion / Jira / Drive | **Pull** (你主动调它) | **owner-as-self** (owner OAuth token) | Agent runtime tool call 即可 |

**任务**: 把这段加到 `docs/decisions/029-coworker-substrate-model.md` 里 "Decision" 第 8 节(authority chain for external connectors)之后,新增 "§ 9. Connector subdivision: Presence vs API"。原来的 §9 (virtu being exposed AS peer) 顺移到 §10。

建议字段:
```typescript
interface Connector {
  id; owner_oauth_token; scopes; per_staff_scope; audit;
}
interface PresenceConnector extends Connector {
  webhook_endpoint: URL;
  bot_identity: BotProfile;
  event_router: (event) => StaffId;
}
interface ApiConnector extends Connector {
  // OAuth + 调用就够
}
```

owner UI: 一个 Connectors 页,两类卡片,配置 UI 不一样。

### 2.2 决定 substrate 命名(P0 — 用户需要点头)

ADR-029 § "Open Questions" 第 1 条:`local_ai` vs `virtu` vs `holon_ai`,选一个并贯穿 DB enum / TypeScript types / UI badges。

我的推荐: **`local_ai`** —— 跟现有 spec 一致(`docs/architecture/local-agent-management.md` 用 `local_ai`),改动面最小。`virtu` 是用户日常口头语,可以保留为 UI badge 文本,但 enum 值还是 `local_ai`。

如果用户在你接手前已经点了头,直接按那个走。如果没点,把这个问题列在你的回执里 surface 给用户。

### 2.3 Spec 编辑(P1 — 主体活儿)

ADR-029 "Spec Edits Implied" 部分列了下面这些。**严格按 CLAUDE.md 流程**: 不要直接改 `docs/architecture/*.md`,要走 Requirements Agent 流程(spec-update 通过 ADR 落地)。

- `docs/architecture/local-agent-management.md` § 5: 重写 substrate 定义; 把 "CLI Executor" 改为 "CLI Agent" (agentic LLM-CLI); 把 ffmpeg / gh / build-script 这些哑工具的例子移出去(留个 forward-reference 到未来 tool/MCP 层)
- `docs/architecture/data-model.md`: substrate enum 更新; per-substrate config 拆 3 张子表 (`local_ai_config` / `cli_agent_config` / `peer_config`),一对一外键挂在 `staff` 表上
- `docs/architecture/runtime-adapter-interface.md`: 新增一节 "CLI-agent adapter" 明确 per-task spawn 语义; 明确 peer dispatch **不**走这个接口
- `docs/architecture/ui-architecture.md`: 定义 roster card uniform 形态 + 三个 substrate-specific supervision panel + cli-agent 的 chat-thread surface

### 2.4 代码迁移(P2 — 等 spec 落地后再动)

只在 ADR-029 status 变 `accepted` 后再做:

- 数据库 migration: substrate enum + 三张 config 子表
- mibusy fixture 数据迁移: 当前 `cli` substrate 的记录,逐个 review 是不是 agentic (Claude-Code-like) —— 是 → 留作 `cli_agent`; 不是 → 临时下线或重分类
- `packages/runtime-cli-agent/` 新包,实现 `RuntimeAdapter` 接口,per-task spawn `claude-code` / `codex` 子进程
- UI: 三个 substrate-specific 监督 panel 组件 (`<LocalAiPanel>` / `<CliAgentPanel>` / `<PeerPanel>`)

### 2.5 follow-up ADR(P3 — 未来,不在本次范围)

- 新 ADR: 暴露 virtu 当 peer (V2 设计) —— ADR-029 § "Decision §10" 标记为 deferred
- 新 ADR: dumb-utility / MCP tool catalog
- 新 ADR: commit-class connector action gating (例如 `slack:write:reply` vs `slack:write:commit`)

---

## 3. 关键引用(你需要快速读的文件)

按读取顺序:

1. `docs/decisions/029-coworker-substrate-model.md` — 本次设计决议,**最先读**
2. `CLAUDE.md` § "Engineering Rules (Non-Negotiable)" — 特别是 Rule #2 (two cores), #5 (flat roster), #6 (owner-mediated), #7 (authority attenuation), #8 (audit completeness)
3. `docs/architecture/functional-architecture.md` § 2 — Two Cores frame + 四个 seam crossing
4. `docs/architecture/local-agent-management.md` § 5 — 当前 substrate 定义(你要改的对象)
5. `docs/architecture/runtime-adapter-interface.md` — RuntimeAdapter 接口现状
6. `docs/decisions/README.md` — ADR 流程(走 Requirements Agent)
7. `agents/README.md` — 三 agent 模型(Dev / Test / Requirements),你应该是哪个角色

---

## 4. 不要做的事

- ❌ **不要直接 commit 到 `docs/architecture/*.md`**。所有 spec 改动必须走 Requirements Agent + ADR accepted 之后才能落。
- ❌ **不要扩 cli-agent 到长期 session attach 模型**。V1 死守 per-task spawn (ADR-029 § Decision 已定); long-lived session attach 列入 V2+ TECH-DEBT,见 `TECH-DEBT.md`。
- ❌ **不要把哑 CLI 工具(ffmpeg 等)也叫 `cli_agent`**。`cli_agent` 专指 agentic LLM-CLI(需要 coaching 的)。哑工具去未来 tool/MCP 层,本次不处理。
- ❌ **不要给 substrate 加第 4 类**。ADR-029 决议是 3 类已经覆盖所有 V1 用例,加新类型要新 ADR。
- ❌ **不要往别的分支 push**。harness 指定的分支是 `claude/employee-hierarchy-design-1aumA`。

---

## 5. 验收信号

完成下面这些就可以认为本次 handoff 走完:

1. ADR-029 status 从 `proposed` 变 `accepted` (用户审过)
2. ADR-029 §9 补上 Connector Presence/API 分类
3. `docs/architecture/local-agent-management.md` / `data-model.md` / `runtime-adapter-interface.md` / `ui-architecture.md` 四份 spec 更新已 PR(经 Requirements Agent)
4. mibusy fixture 中 substrate 字段已迁移
5. `packages/runtime-cli-agent/` 骨架就位(stub 实现也行,先把接口和 package 结构落)
6. 左导航改动已 merge 到主开发分支(目前在 `claude/employee-hierarchy-design-1aumA` 上 commit `76a3959`)

完成后写一份 `docs/handoff/2026-05-XX-coworker-substrate-completed.md` 回执,列出每条的 commit/PR 链接。

---

## 6. 上下文锚点(给本地 AI 的快速回放)

讨论的关键转折点(按时间序):

1. 用户提出: virtu 是不是该挂 peer/CLI 在下面? → 我答: 不,flat-roster 不变量。
2. 用户改问: 怎么设计最简单清楚? → 收敛到: "同事 vs 工具"二分法。
3. 用户补充: CLI 不是工具,是需要 babysit 的 agent(Claude Code/Codex)。 → 我答: 对,CLI 现 spec 定义混淆了哑工具和 agent CLI。
4. 用户洞察: CLI 是介入另一个 live LLM session? → 我答: 对,而且 RuntimeAdapter 接口已经是预备好的通用 agent 接口。
5. 用户反问: 那是不是又回到 agent 接口问题? → 我答: 是的,而且 spec 早就 ready。
6. 用户切轴: "CEO 打交道的对象 = 自己环境的 runtime + 别人工具的 runtime + 别人独立维护的对象"。 → 我答: 正中靶心,这就是 substrate 的本质。
7. 用户补充: owner 心智不一样,要分别照顾。 → 我答: 监督面三套 UX,不强求统一。
8. 用户进一步: virtu 重复活轻活, cli-agent 探索研究, peer 冷交付。 → 我软化: 工作-substrate 映射软,不硬。
9. 用户问: virtu 自己创建的能不能连出去? → 我拆: 三个方向 A/B/C,落点是 C(connector to SaaS)。
10. 用户问: Slack vs Gmail 是不是一个概念? → 我答: Presence vs API 两类,见 §2.1。
11. 用户问: virtu 连 CLI 有必要吗? → 我答: 没必要,coworker 不互相指挥,owner 中转。
12. 用户问: 大厂桌面那么简洁要不要抄? → 我答: 选 2 改现有,但按"动词优先"重排左导航 —— 已 ship。
13. 用户: 把 handoff 拍平给本地 AI。 → 你正在读的这份。

---

祝接得顺。有 spec 歧义请按 CLAUDE.md "When You Get Stuck" 流程,写 `dev-questions.md` 的 Q: block,继续往前走。

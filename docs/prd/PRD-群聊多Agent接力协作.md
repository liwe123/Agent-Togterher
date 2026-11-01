# PRD：群聊多 Agent 接力协作与聊天信息架构升级

> 类型：新需求（Requirement）｜状态：进行中｜目标：学习参考开源项目 DS-Bot（Fei2411/DS-Bot，`@lininn/ds-bot` v0.2.6）的「多 Bot 同群、按顺序接力发言、@ 交接、PASS 静默」交互范式，在 Agent Console 群聊中实现一条消息 @ 多个 Agent 的顺序接力执行，并围绕该链路升级群聊信息架构（接力链进度、成员面板、消息分组、时间分隔），让多智能体协作过程在群聊内可读、可控、可追溯。

---

## 1. 背景与问题

Agent Console 的 `/chats` 群聊目前只支持「一条消息 → 一个被 @ 的 Agent → 一个任务」：`MessageHub` 只取正文中第一个有效 @ 目标派发任务，其余 @ 被忽略；多 Agent 协作只能由 Manager 计划流水线（Manager → Worker → Review → Final）隐式完成，用户无法显式编排「谁先做、谁接着做」。

对照 DS-Bot 的实际行为（见 `docs/DS-Bot对标分析与改造方案.md`）：

1. **一次只发言一人、按槽位接棒**：DS-Bot 群聊每轮拥有有序 slot 列表，上一棒发言（或 PASS）后下一棒才开始；每棒看到「自上轮以来全部新消息 + 本轮发言顺序 + 自己的位置」（`src/host/groups.js:4-11, 244-259`）。
2. **@ 即交接**：回复中写 `@Name` 会把该成员插入接力顺序的下一位；`[PASS]`（含 `【PASS】`、`(PASS)`、单独 pass 等变体）表示本棒无新增内容、静默让位（`groups.js:81, 383-398`）。
3. **同群独立上下文**：群成员在群内有自己的隐藏会话，群聊不会读到成员的私聊；用户消息总会被回应（`groups.js:10-11, 585-614`）。
4. **前端信息架构**：侧栏分区展示群聊/Bot、聊天头部为居中胶囊、消息按发言人分组（首条带头像与名称）、群事件行统一渲染、右侧详情面板按实体展示成员信息（`client.js:2490-2520, 2702-2729, 7576-7647, 8848-8925`）。

Agent Console 当前缺口：

- **交互缺口**：无法显式指定多个 Agent 的接力顺序；任务执行过程只有单条「最终输出」消息，群聊里看不到「第几棒、谁在做、谁已完成」。
- **信息架构缺口**：消息逐条独立渲染（每条都重复头像/名称），长会话扫描成本高；无时间分隔；群聊成员状态、模型绑定只能跳转通讯录查看。
- **对标缺口**：DS-Bot 的「顺序发言 + @ 交接 + PASS」是多人协作可读性的关键，Agent Console 尚未具备等价能力。

---

## 2. 目标与非目标

### 2.1 目标

- **G1（接力语义）**：一条消息 @ 多个内部 Agent 时，按出现顺序去重形成接力链，作为同一个任务顺序执行；首棒为 `assigned_agent`，链写入任务数据。
- **G2（上下文传递）**：每一棒都能读到「原始任务 + 前序各棒产出 + 执行轨迹上下文」，后棒可在前棒成果上继续，而不是各自独立理解需求。
- **G3（PASS 静默）**：某棒无新增内容时可回复 `[PASS]`，该棒不产生群聊消息、标记为「已跳过」，接力继续。
- **G4（实时可见）**：WebSocket 新增 `task.relay_progress` 事件，前端实时渲染接力链（待执行 / 进行中 / 已完成 / 已跳过）与当前棒次。
- **G5（输入预演）**：输入框中 @ 多个 Agent 时，输入区上方实时预览接力顺序；发送前可确认顺序，发送后进入执行。
- **G6（群聊信息架构）**：聊天头部收敛为紧凑胶囊（会话名 + 成员数 + 连接状态）；新增可开合的成员面板（头像、角色、绑定模型、状态、最近活跃）；消息按发送者分组、按时间分隔，连续同人消息只显示一次头像与名称。
- **G7（视觉克制）**：聊天表面改用 1px 分隔线、平面化表面与语义状态色表达层级，削减发光/渐变装饰，与 DS-Bot 的「信息密度 + 结构感」一致，并贴合 `DESIGN.md` 的设计原则。

### 2.2 非目标

- **N1**：不改变既有「单 @ / 无 @ → 默认 Manager」行为；不改变 Manager 计划流水线（Manager → Worker → Review → Final）。
- **N2**：不改变外部集成节点（Cursor / Codex 等）的提及派发语义：首个有效 @ 为外部节点时仍直接派发节点，不进入接力。
- **N3**：不实现 DS-Bot 的群聊记忆（memory）、能力库（capabilities）、远程控制（relay）等更大范围能力，留作后续批次。
- **N4**：不修改鉴权、配额、租约、任务状态机既有语义；接力任务复用既有 `Task` 状态机与租约机制。
- **N5**：不新增数据库表；仅新增 `tasks` 一个可空列，迁移可回滚。

---

## 3. 用户故事

- **US1**：作为项目负责人，我在群聊里输入「@项目总设计师 @前端设计师 @测试专员 请把这个需求拆解、实现并验收」，三位 Agent 会按我写的顺序依次接力：总设计师先拆解，前端设计师接着实现，测试专员最后验收；每步产出都出现在群聊里。
- **US2**：作为用户，我能在群聊顶部看到「接力 2/3 · 前端设计师处理中」这样的进度链，清楚知道现在轮到谁、前面谁已完成、谁被跳过。
- **US3**：作为用户，我输入多个 @ 后立刻看到「接力顺序：①项目总设计师 → ②前端设计师 → ③测试专员」的预览，确认后才发送。
- **US4**：作为用户，我点开聊天头部的成员按钮，能在右侧面板看到每位 Agent 的职责、绑定模型和当前状态，不需要离开群聊去通讯录。
- **US5**：作为用户，长会话里连续多条同一 Agent 的回复只出现一次头像与名称，跨天或长时间间隔处出现时间分隔，我可以快速扫读整段协作过程。

---

## 4. 核心概念与系统交互

```text
用户在群聊输入 "@A @B @C 完成需求"
          │
          ▼
ChatComposer 实时预览接力顺序（extractMentionEntries）
          │
          ▼
POST /api/conversations/{id}/messages
          │
          ▼
MessageHub 解析全部有效 @ 目标（按出现顺序去重，≤ MAX_RELAY_AGENTS）
          │
          ├─ 首个目标为外部集成节点 → 既有节点派发（不变）
          ├─ 内部 Agent 数 = 1 → 既有单 Agent 任务（不变）
          └─ 内部 Agent 数 ≥ 2 → 接力任务
                    · assigned_agent_id = 首棒
                    · tasks.relay_agent_ids_json = [A, B, C]
          │
          ▼
AgentOrchestrator.run_task
          │
          ├─ 接力链 ≥ 2 → _run_relay_task
          │     第 1 棒 @A：上下文 = 原始任务 + 执行轨迹，产出 → TaskStep(relay_turn_1)
          │                 → 广播 task.relay_progress(started/completed)
          │                 → message.created（@A 的群聊消息）
          │     第 2 棒 @B：上下文 = 原始任务 + A 产出 + 轨迹，产出 → TaskStep(relay_turn_2)
          │     第 3 棒 @C：同上；若回复 [PASS] → 不发消息，progress=passed
          │     全部完成后 → task.completed，result = 各棒产出汇总
          └─ 其余路径不变
          │
          ▼
前端 useChat 接收 message.created / task.relay_progress / task.status_changed
          │
          ▼
RelayChain 实时渲染（待执行 / 进行中 / 已完成 / 已跳过）
```

**PASS 判定**（与 DS-Bot 对齐，大小写不敏感）：`[PASS]`、`【PASS】`、`(PASS)`、`（PASS）`、单独一行 `pass`/`pass.`/`pass!`，或空回复。

---

## 5. 功能需求 (FR)

### FR1：多 @ 接力解析与任务创建

- `MessageHub.receive_user_message` 解析正文中**全部**有效 @ 目标（沿用既有候选词最长匹配、词边界、邮箱排除、全角 `＠` 兼容规则），按出现顺序去重。
- 仅当「首个有效 @ 目标为内部 Agent」且「去重后内部 Agent 数 ≥ 2」时创建接力任务；接力链长度上限 `MAX_RELAY_AGENTS = 6`，超出部分忽略并在任务描述中保留原文。
- 接力任务写入 `tasks.relay_agent_ids_json`（JSON 数组，顺序即棒次），`assigned_agent_id` 为首棒 Agent。
- 首个 @ 为外部集成节点时，维持既有节点派发路径，不产生接力任务。
- 单 @、无 @、仅外部节点提及等既有路径行为不变。

### FR2：接力执行引擎

- `AgentOrchestrator.run_task` 在领取任务后，若 `relay_agent_ids` 长度 ≥ 2，进入 `_run_relay_task` 分支。
- 按棒次逐棒执行：每棒记录 `TaskStep`（`step_name = relay_turn_<n>`，`agent_id` 为该棒 Agent），开始置 `running`、结束置 `completed`（PASS 亦为 `completed` 且 `output = "[PASS]"`）。
- 每棒提示词包含：原始用户任务、完整接力顺序与当前棒次、前序各棒产出（按顺序）、执行轨迹上下文；并明确指示「基于前序产出交付本棒内容；若无新增内容只回复 `[PASS]`」。
- 每棒完成后向会话写入一条 `sender_type=agent` 的普通消息（正文为本棒模型产出，不加 `【】` 前缀，由前端按 Agent 身份分组展示）；PASS 棒不写消息。
- 任一棒失败：任务置 `failed`，错误信息与失败棒次写入任务结果（复用既有 `_mark_failed_resilient`），已完成棒的产出保留在 `TaskStep` 与消息流中。
- 全部完成：任务置 `completed`，`result` 为各非 PASS 棒产出的汇总（形如 `Agent 名：\n产出` 依次拼接），并刷新 `execution_trace` / `trace_summary`。
- 工具调用：接力棒与既有 Worker 执行一致，受 `agent_tools_enabled` 开关控制，工具循环复用 `_run_agent_with_tools`。

### FR3：实时接力进度事件

- 新增 WebSocket 事件类型 `task.relay_progress`，payload 字段：`task_id`、`conversation_id`、`hop_index`（1 起）、`total_hops`、`agent_id`、`agent_name`、`status`（`started` / `completed` / `passed` / `failed`）。
- 每棒开始时广播 `started`，结束按结果广播 `completed` / `passed`；失败时广播 `failed`（保留既有 `error` 事件语义）。
- 事件向后兼容：旧前端忽略未知类型即可，不影响既有事件。
- 工作区快照（`workspace.snapshot`）中的任务载荷补充 `relay_agent_ids`，保证断线重连后接力链信息不丢。

### FR4：前端接力链与输入预演

- 当会话存在进行中的接力任务时，在消息区上方渲染 `RelayChain`：按 `relay_agent_ids` 顺序展示头像 + 名称 + 状态（待执行 / 进行中 / 已完成 / 已跳过），并显示「接力 n/m」；点击可跳转对应任务详情。
- 输入框内 @ 多个 Agent 时，输入区上方实时渲染「接力顺序」预览（带序号与头像），并在发送按钮旁提示「按顺序接力执行」。
- 消息气泡在接力任务中显示棒次徽标（如 `接力 2/3`）；用户消息不显示。
- 无接力任务时组件不占位，不影响既有布局与移动端高度。

### FR5：群聊成员面板

- 聊天头部提供成员按钮（含成员数），点击开合右侧成员面板；桌面端为聊天卡片内右栏，移动端为底部抽屉/覆盖层。
- 面板每行展示：头像与状态环、名称、角色标签、绑定模型（等宽字体）、状态文字与最近活跃时间；底部提供「打开通讯录」入口。
- 面板可通过按钮、`Escape`、点击面板外关闭；按钮具备 `aria-expanded` / `aria-controls` 与键盘可达性。
- 面板只读，不提供 Agent 编辑能力（编辑仍在通讯录/设置中完成），不改变任何权限。

### FR6：消息分组与时间分隔

- 消息列表按时间排序渲染：同一发送者（同 `sender_type` + `sender_id`）连续消息合并为一个分组，仅首条显示头像与名称、末条显示时间；组内气泡使用紧凑间距与连续圆角。
- 用户消息与 Agent/系统消息不混成分组；跨天或相邻消息间隔 ≥ 30 分钟时插入时间分隔（「今天 HH:mm」「昨天 HH:mm」「M月D日 HH:mm」）。
- 自动滚动、回到底部按钮、快照对账等既有行为保持不变。

### FR7：视觉克制与设计对齐

- 聊天表面层级使用 1px 分隔线 + 表面明度差表达；可交互元素保留语义色（运行中/完成/失败/跳过），不新增紫蓝渐变、玻璃拟态或无业务含义光晕。
- 新增样式统一收敛到 `globals.css` 的 `.chat-*` 语义类，复用既有颜色/圆角/状态令牌；移动端触控目标 ≥ 44px，遵循 `prefers-reduced-motion`。
- 不改变非聊天页面的既有视觉结构（控制台、任务、工作流、设置保持不变）。

---

## 6. 验收标准 (AC)

- **AC1（解析）**：`@项目总设计师 @前端设计师 @测试专员 请接力完成需求` → 任务 `assigned_agent_id = 项目总设计师`，`relay_agent_ids = [项目总设计师, 前端设计师, 测试专员]`；重复 @ 同一 Agent 只保留一次；单 @ 与无 @ 任务字段为空；`@Cursor @前端设计师` 仍按外部节点派发。
- **AC2（执行）**：接力任务按链顺序产生 N 条 Agent 消息与 N 个 `relay_turn_n` 步骤；每棒消息正文为本棒产出；PASS 棒无消息且进度为 `passed`；任务终态 `completed` 且 `result` 含各棒产出。
- **AC3（失败）**：第 2 棒模型异常时任务 `failed`，第 1 棒步骤与消息保留，第 2 棒步骤 `failed`，广播 `task.relay_progress(failed)`。
- **AC4（事件）**：每棒各产生 1 条 `started` 与 1 条终态 `task.relay_progress`；`workspace.snapshot` 任务载荷含 `relay_agent_ids`；既有事件类型与顺序断言不回归。
- **AC5（前端）**：输入多 @ 出现接力顺序预览；执行中显示接力链与当前棒次；消息按发送者分组、跨天/超时插入时间分隔；成员面板可开合、Escape 关闭、键盘可达；移动端 375px 宽度无横向溢出。
- **AC6（测试门禁）**：后端 `pytest` 全量通过且新增接力用例覆盖 AC1–AC4；CI 同参数 `flake8 app tests --count --select=E9,F63,F7,F82 --show-source --statistics` 0 错误；前端 `npm test`、`npm run typecheck`、`npm run lint`、`npm run build` 全部通过。
- **AC7（迁移）**：`alembic upgrade head` / `downgrade base` 通过，`test_autogenerate_has_no_pending_changes` 无差异。
- **AC8（视觉 A/B）**：改动前后各截取群聊页桌面（1440×900）与移动（390×844）截图，对比接力链、成员面板、消息分组的可读性改善；截图与结论记录在《改动表》验证列/备注列。

---

## 7. 架构与改动清单

| 模块 | 文件 | 改动性质 | 说明 |
|---|---|---|---|
| 数据模型 | `backend/app/models/task.py` | 修改 | 新增 `relay_agent_ids_json` 可空列与 `relay_agent_ids` 只读属性（安全解析 JSON 数组） |
| 迁移 | `backend/alembic/versions/*_add_task_relay_agent_ids.py` | 新增 | `batch_alter_table` 加列/删列，SQLite 与 PG 双兼容、可回滚 |
| 接力工具 | `backend/app/core/relay.py` | 新增 | `MAX_RELAY_AGENTS`、`parse/dump_relay_agent_ids`、`is_pass_reply` |
| 解析派发 | `backend/app/core/message_hub.py` | 修改 | 抽离 `_iter_mention_targets` / `_resolve_mention_targets`，多 @ 去重成链、写接力字段 |
| 执行引擎 | `backend/app/core/orchestrator.py` | 修改 | 新增 `_run_relay_task`、`_broadcast_relay_progress`，在 `run_task` 分派 |
| 接力 Agent | `backend/app/agents/relay_agent.py` | 新增 | 构造「原始任务 + 接力顺序 + 前序产出 + 当前棒次」提示词并调用模型 |
| 事件协议 | `backend/app/websocket/events.py` | 修改 | `EventType` 增加 `task.relay_progress` |
| 快照 | `backend/app/websocket/snapshot.py` | 修改 | 任务载荷补 `relay_agent_ids` |
| Schema | `backend/app/schemas/task.py` | 修改 | `TaskRead` 暴露 `relay_agent_ids` |
| 后端测试 | `backend/tests/test_relay_handoff.py` | 新增 | 解析/执行/PASS/失败/事件/快照覆盖 |
| 前端类型 | `frontend/src/types/chat.ts`、`frontend/src/types/task.ts` | 修改 | `ChatTask.relay_agent_ids`、`RelayProgress`、事件联合类型 |
| 前端状态 | `frontend/src/hooks/use-chat.ts` | 修改 | 维护接力进度映射、快照对账 |
| 前端工具 | `frontend/src/lib/relay-utils.ts` | 新增 | 提及顺序提取、消息分组、时间分隔、接力状态推导（纯函数，可单测） |
| 前端组件 | `frontend/src/components/chat/relay-chain.tsx` | 新增 | 接力链进度组件 |
| 前端组件 | `frontend/src/components/chat/chat-member-panel.tsx` | 新增 | 成员面板 |
| 前端组件 | `frontend/src/components/chat/chat-page.tsx`、`message-list.tsx`、`message-bubble.tsx`、`chat-composer.tsx` | 修改 | 头部胶囊、分组渲染、接力徽标、输入预演 |
| 前端样式 | `frontend/src/app/globals.css` | 修改 | `.chat-*` 语义类与分组/时间分隔/成员面板样式 |
| 前端测试 | `frontend/tests/relay-utils.test.mjs`、`mention-utils.test.mjs` | 新增/修改 | 纯函数用例覆盖 |
| 文档 | `docs/prd/PRD-群聊多Agent接力协作.md`、`docs/DS-Bot对标分析与改造方案.md` | 新增 | 本 PRD 与对标分析报告 |

---

## 8. 数据模型

```text
tasks
  + relay_agent_ids_json TEXT NULL   -- JSON 数组，如 "[1,3,5]"；空/NULL 表示普通任务
  （既有列不变：assigned_agent_id = 首棒 Agent）

task_steps（复用，不新增列）
  step_name = "relay_turn_1" … "relay_turn_n"
  agent_id  = 当前棒 Agent
  input     = 本棒上下文摘要
  output    = 本棒产出（PASS 为 "[PASS]"）
  status    = running / completed / failed
```

解析容错：`relay_agent_ids_json` 仅接受「JSON 数组且元素均为正整数」，任何脏数据一律按空链处理（与工作流快照解析口径一致），避免脏数据阻断任务执行。

---

## 9. 里程碑

| 阶段 | 内容 | 产出 |
|---|---|---|
| M1 | 数据模型 + 迁移 + 接力工具 + 多 @ 解析 | 后端字段与任务创建可用，单测覆盖 AC1 |
| M2 | 接力执行引擎 + 事件 + 快照 | 后端端到端可用，单测覆盖 AC2–AC4 |
| M3 | 前端类型/状态 + 接力链 + 输入预演 | 群聊可看到接力过程 |
| M4 | 成员面板 + 消息分组/时间分隔 + 视觉收敛 | 信息架构升级（AC5/AC8） |
| M5 | 全量测试、A/B 截图、独立验收、变更表登记 | 交付与推送 |

---

## 10. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| 多 @ 语义改变用户预期（原本只派第一个） | 老用户行为变化 | 仅在「≥2 个内部 Agent」时启用接力；单 @/无 @/外部节点保持原语义；PRD 明确记录 |
| 接力链过长导致 Token 与耗时膨胀 | 成本与等待时间上升 | 链长上限 6；每棒上下文仅取最近 8 步/8 次调用；前端显示总棒次 |
| PASS 判定误伤正常输出 | 消息静默丢失 | 仅匹配严格的整条 PASS 形态（行首/整行），不做包含匹配；PASS 棒在任务详情可追溯 |
| 前端分组改动影响既有滚动/快照逻辑 | 回归风险 | 分组/时间分隔实现为纯函数并单测；消息数据与 id 不变，仅渲染层变化 |
| 迁移在 SQLite/PG 行为差异 | 部署失败 | 使用 `batch_alter_table`；`test_alembic_migrations` 三用例覆盖 upgrade/downgrade/autogenerate |

---

## 11. 参考依据

- 参考项目：`https://github.com/Fei2411/DS-Bot`（npm 包 `@lininn/ds-bot@0.2.6`，本地解包于 `.tmp/dsbot/package` 做只读分析）。
- 群聊顺序发言 / @ 交接 / PASS：`src/host/groups.js:4-11, 81, 102-119, 244-259, 383-398, 585-614`。
- 每轮 slot 与发言顺序展示：`src/host/groups.js:259`。
- 前端消息分组与群事件行：`client.js:7273-7360, 7549-7647`。
- 前端侧栏与详情面板：`client.js:2490-2520, 2702-2729, 8848-8925`。
- 本仓库现有相关实现：`backend/app/core/message_hub.py`、`backend/app/core/orchestrator.py`、`frontend/src/components/chat/`。

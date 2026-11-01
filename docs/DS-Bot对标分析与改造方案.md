# DS-Bot 对标分析与改造方案

> 类型：Optimization（文档，记录审查结论与改造依据，不新增产品能力）｜日期：2026-11-01｜作者：LI
> 参考项目：[Fei2411/DS-Bot](https://github.com/Fei2411/DS-Bot)（DeepSeek Harness 插件社区项目，npm 包 `@lininn/ds-bot@0.2.6`）
> 关联 PRD：[PRD-群聊多Agent接力协作](prd/PRD-群聊多Agent接力协作.md)（本批次 Requirement）
> 取证方式：本机 GitHub 直连被网络策略阻断，改为从 npm registry 拉取同源发布包 `@lininn/ds-bot@0.2.6`（582KB）解包到 `.tmp/dsbot/package` 只读分析；该包包含完整 host 源码（`src/host/*`，60+ 文件）与未压缩构建产物 `client.js`（20,143 行），足以逐行取证。

---

## 1. 审查范围与方法

| 审查对象 | 范围 | 方法 |
|---|---|---|
| Agent Console 本仓库 | 后端 `backend/app`（API / models / services / core / websocket / worker）、前端 `frontend/src`（页面 / 组件 / hooks / lib / types）、文档体系（PRD、变更追踪表、架构治理基线、HANDOFF） | 逐模块阅读 + 抽样运行（pytest / npm test / build / lint / typecheck 基线） |
| DS-Bot 参考项目 | host 逻辑（群聊调度、交接、记忆、上下文治理、权限、用量、事件协议）、client UI（设计系统、信息架构、关键组件、交互模式） | 两个只读分析子 Agent 并行取证，产出 1047 行 / 630 行带 `文件:行号` 证据的报告（`.tmp/analysis/`），本文做收敛与差距映射 |
| 质量基线 | 后端 274 passed / 44 文件；前端 62 passed + typecheck 0 + lint 0 + build 通过（改动前） | 直接复跑 |

---

## 2. Agent Console 现状审查结论

### 2.1 已经成立的核心能力

- **闭环编排**：用户 `@Agent` → `MessageHub` 建 Task → `AgentOrchestrator`（Manager 拆解 → Worker 执行 → QA 审核 → Final 汇总）→ `TaskStep`/`ModelCall` 落库 → WebSocket 实时推送。
- **工程化底座**：21 张表 + Alembic 迁移治理、任务级租约（`task_lease`）、持久化队列与独立 Worker、Redis 事件总线、RBAC 4 级角色与工作区隔离、审计、配额熔断、成本统计、任务回放。
- **前端页面**：`/` 控制台、`/chats` 群聊、`/contacts`、`/tasks`、`/tasks/[id]`（时序回放）、`/workflows`（DAG 画布与运行历史）、`/settings` 六个子页；M3 深色设计 token（`globals.css`）+ 移动端底部导航。
- **文档流程**：14 列变更追踪表由 `docs/generate_change_log.py` 从 git 历史生成，PRD.html 由 `build_prd_html.py` 生成，`docs/Agent任务守则.md` 定义类型判定 / PRD 三处同步 / 测试验收 / 推送门禁。

### 2.2 与 DS-Bot 对标后暴露的缺口

| 维度 | DS-Bot 做法 | Agent Console 现状 | 影响 |
|---|---|---|---|
| 多 Agent 显式协作 | 群成员按 slot 顺序接力，`@Name` 即交接，`[PASS]` 静默让位（`groups.js:4-11,81,382-394,455-572`） | 一条消息只取第一个 `@` 目标；多 Agent 只能由 Manager 计划流水线隐式完成 | 用户无法显式编排「谁先做、谁接着做」，群聊看不到接力过程 |
| 群聊可读性 | 发言人分组（首条带头像/名字）、时间分隔 30min 阈值、事件行统一渲染（`client.js:7549-7647,7939`） | 每条消息重复头像/名称；无时间分隔；无接力/事件表达 | 长会话扫描成本高，过程不可见 |
| 实体详情 | 右侧 320–520 可拖拽详情面板，按实体展示模型/权限/记忆/用量（`client.js:2729-2757,16922-17012`） | 群聊内无成员面板，需跳转 `/contacts` | 群聊中确认「谁在用什么模型、状态如何」成本高 |
| 长期记忆 | bot/group/team 三作用域 + memory review + 面板（`memory.js`、`README.md#memory`） | 仅有单任务上下文回灌（`execution_trace`），无跨会话记忆 | 跨天任务重复交代背景；后续批次 |
| 上下文治理 | checkRatio → steward → checkpoint / 新 part，FTS5 全文检索（`steward.js`、`parts.js:277-618`） | 单任务上下文裁剪（execution_trace），无 checkpoint / 全文索引 | 长任务上下文仍是一刀切；后续批次 |
| 用量与角色 | 用量按时间/Bot/模型三维聚合（`usage.js`）；用户/Main Bot/群管理员/成员四级能力矩阵（`roster.js`） | 成本面板按模型/任务聚合；RBAC 面向「人对控制台」 | 群聊协作视角的用量与权限尚未对齐；后续批次 |
| 设计系统 | 4 主题 × 8 颜色键 → 17 个 `--bt-*` 变量；accent 对比度推导；1px 发丝线 + 平面层级（`client.js:1769-1822,2388`） | M3 token 完整，但语义层（线/ink 层级/msg 宽度）散落在组件内，聊天表面装饰偏重 | 聊天页视觉密度与结构感不足 |

> 结论：Agent Console 在「任务编排 / 数据治理 / 权限审计」上已明显强于 DS-Bot；差距集中在**群聊协作语义**与**聊天信息架构**。本批次只补齐这两个高价值缺口，其余（记忆、上下文治理、用量维度、角色矩阵）登记为后续批次。

---

## 3. DS-Bot 前端 UI 设计的可学习点

### 3.1 设计系统（token 驱动整站）

- **8 颜色键 × 4 主题**（bg/sidebar/bubble/card/text/user/userText/accent）→ 运行时派生 17 个 `--bt-*` 语义变量；亮暗自适应只在两条规则里完成（`client.js:1769-1822`）。
- **accent 前景色用 WCAG 相对亮度公式推导**（`client.js:1791-1792`），换 accent 不破对比度。
- **层级替代阴影**：.5px 发丝线 + `inset 0 0 0 1px` 内描边代替投影；阴影只给真正覆盖内容的浮层（菜单/模态）。
- **字阶紧凑**：11–22px、行高 = 字号 + 4~6、数字全部 `tabular-nums`；数据（ID/时间/模型/Token）才用等宽。
- **动效由物理参数生成**：`springEasing` 采样生成 CSS `linear()`（`client.js:2181-2201`），并统一提供 `prefers-reduced-motion` 与 quiet/normal/lively 三档降级（36 处覆盖）。

### 3.2 信息架构

| 层 | DS-Bot 做法 | 可迁移判断 |
|---|---|---|
| 侧栏 | 主 Bot 磁贴 + Bot/群聊/DSH Agent 混排、置顶优先、活预览、未读/待审批点（`client.js:8848-8924`） | 需要群聊实体先落地，本批不做；登记 P1 |
| 聊天头 | 居中 40px 胶囊（名称 + 进入箭头 + 记忆提示槽），内容从下方穿过（`client.js:2524-2546,3294-3299`） | **本批采用**：会话名 + 成员数 + 实时状态胶囊，点击开成员面板 |
| 消息流 | 发言人分组（首条头像 + 名字 + 时间）、组内气泡连续圆角、30min 时间分隔、新消息分隔（`client.js:7549-7647,7939`） | **本批采用** |
| 右侧面板 | 320–520 可拖拽，按实体展示模型/权限/记忆/用量（`client.js:2729-2757`） | **本批采用简化版**：群成员面板（只读）；拖拽改宽登记 P1 |
| 事件行 | 入群/接力暂停/审批/完成等统一渲染为居中单行事件（非空气泡）（`client.js:7549-7574`） | 本批以「接力链」承担同类语义；事件行登记 P2 |
| 设置 | 1100×780 模态 + 198px 左侧分页 + 交错入场（`client.js:15932-16310`） | 本批不动；登记 P1 |

### 3.3 关键组件

- **消息气泡**：18px 圆角，分组首/尾收窄到 6px；最大宽度由 `--bt-msg-w` 控制；hover 才出现工具条并预留 82px（`client.js:2551-2553,2966-2989`）。
- **发言人头**：22px 头像 + 名字（用该 Bot 的 ink 色）+ 11px 时间 + 耗时（`client.js:7576-7584`）。
- **角色形象**：20 个手绘形状 + 19 ink + 9 状态动画 + 角标（working/alert/admin/main），远超普通头像（`client.js:1383-1493,2394-2481,3592-3626`）。本批不替换形象库，仅复用「状态环 + 角标」语义。
- **@ 提及**：转成带 Bot mask 头像的 16px 行内 chip，无下划线（`client.js:1936-1946,2563-2564`）。登记 P1。
- **人工确认卡片**：提问/Widget/密钥/浏览器接管四类共用 `bt-q` 卡片语法 + raised/settled 两态 + 单卡仲裁（`client.js:2578-2650,3888-3921`）。登记 P1/P2。

### 3.4 明确不照搬

1. **寄居宿主的 CSS 片段编译器**与 `--dsh-*`/`--dsw-*` 变量依赖（`client.js:3518-3588`）——Agent Console 有自己的 DOM，用稳定语义类即可。
2. **11–13px 的超高信息密度**——按现有 M3 尺度放大 1.15~1.25 倍再落地。
3. **暗色下语义色未重映射**——本仓库继续使用 `--status-*` 双档语义色。
4. **单文件两万行 + 内联 CSS 模板**——按 token → 原子组件 → 页面三层组织。

---

## 4. DS-Bot 后端交互逻辑的可学习点

### 4.1 群聊发言调度（本批次直接借鉴）

- **一轮 = 有序 slot 列表**，一次只有一个 speaker：上一棒发布或 PASS 后下一棒才开始（`src/host/groups.js:455-572`）。
- **每棒 prompt 固定包含**：成员与规则、群公告、自己未见过的消息（单轮最多 24 行 + 上轮 8 行）、谁在忙、**本轮发言顺序与自己的位置**（`groups.js:229-264`）。
- **@ 即交接**：回复里 `@Name` 把该成员插到调用者后面第一位；已发言过的成员会被再给一次机会（`groups.js:382-394`）。
- **PASS 语义**：整条回复只是 `[PASS]`/`【pass】`/空串 → 不写群消息、记 passed；本轮无人作答且只有 admin 时补一条系统提示（`groups.js:81,514-563`）。
- **relay 上限**：Bot→Bot 连续接力超过 3×成员数时**暂停而不丢弃**，用户发言或点 Continue 后恢复（`groups.js:39-40,469-487,955-968`）。

### 4.2 交接工作树（后续批次）

一次请求开一个 work，子工作挂在 parent.open；只有全部子工作返回才把合并结果上报；结果读取后出队；成环拒绝；长结果（>2000 字符）先写 `handoff-results/<id>.txt` 再引用（`src/host/handoffs.js:30-186`）。

### 4.3 记忆与上下文治理（后续批次）

- 三作用域记忆（bot/group/team），Markdown 存储 + 固定限额（条目 300 / MEMORY.md 4000 / topic 16000 / 40 topics）+ journal + memory review 流水线（`memory.js:41,88-187,749-843`）。
- 上下文三条线：可用窗口 − 回复预留；hard line 95%；check line = checkRatio × 可用窗口（默认 0.8）。过线后由小模型 steward 二选一：原地压缩成 checkpoint（摘要 + 逐字保留最近消息）或换新 part + handoff note；旧段进 FTS5 索引（`steward.js`、`parts.js:277-618`）。

### 4.4 权限、用量与事件协议（后续批次）

- 双主体权限矩阵：User / Agent × Main Bot / 群管理员 / 成员；「改权限」类操作只允许用户（`roster.js:452-491`）。
- 用量账本：日志回填 + 实时流两条来源，按时间/Bot/模型三维聚合（`usage.js:141-153`）。
- 实时协议：view（随 revision）与 live（不随 revision）分离 + room-progress 单独查询；SSE/WS 推 5 类事件（`channel.js`, `feed.js`）。

---

## 5. 本批次落地范围（C-267 起，对应 PRD）

### 5.1 Requirement（已实现，见 PRD 与变更追踪表）

| FR | 落地内容 | 主要落点 |
|---|---|---|
| FR1 | 多 @ 解析成有序接力链、写 `tasks.relay_agent_ids_json`、单 @/无 @/外部节点语义不变 | `core/message_hub.py`、`core/relay.py`、`models/task.py`、Alembic 迁移 |
| FR2 | `_run_relay_task` 逐棒执行：原始任务 + 前序产出 + 轨迹上下文；PASS 静默；失败保留已完成棒；结果汇总 | `core/orchestrator.py`、`agents/relay_agent.py` |
| FR3 | 新增 `task.relay_progress` 事件；快照任务载荷补 `relay_agent_ids` | `websocket/events.py`、`websocket/snapshot.py` |
| FR4 | 接力链组件 + 输入区接力顺序预览 + 消息棒次徽标 | `components/chat/relay-chain.tsx`、`chat-composer.tsx`、`message-bubble.tsx` |
| FR5 | 群成员面板（桌面右栏 / 移动抽屉，Escape 关闭，只读） | `components/chat/chat-member-panel.tsx`、`chat-page.tsx` |
| FR6 | 消息按发送者分组、跨天 / 30min 时间分隔 | `lib/relay-utils.ts`、`message-list.tsx`、`message-bubble.tsx` |
| FR7 | 聊天表面收敛：居中胶囊头、1px 分隔、语义状态色、`.chat-*` 语义类 | `app/globals.css`、`chat-page.tsx` |

### 5.2 与 DS-Bot 的取舍

- **采用**：slot 顺序语义（用户 @ 顺序即棒次）、PASS 静默、发言顺序可见、按发言人分组的消息流、时间分隔、只读实体面板、胶囊头部、平面层级。
- **暂不采用**：relay 上限暂停/继续（当前接力为「用户单次指令的有限链」，链长上限 6，暂无无限 Bot 互调风险）、隐藏会话已读位点（接力棒次是任务内一次性顺序，不需要跨轮已读游标）、事件行体系（后续批次）。

### 5.3 后续批次建议（登记，不在本次范围）

| 批次 | 内容 | 依据 |
|---|---|---|
| P1-1 | 记忆三作用域 + memory review + 记忆面板 | host 分析 §4 / §9.2 M12-M15 |
| P1-2 | 上下文治理：checkRatio → steward → checkpoint / 新 part + FTS 检索 | host 分析 §5 / §9.2 M16-M19 |
| P1-3 | 交接工作树 + 长结果落盘 + relay 暂停/继续 | host 分析 §3 / §9.1 M6-M8 |
| P1-4 | 群聊实体化（GroupChat/GroupMember/Round/Slot + 每成员隐藏会话） | host 分析 §9.1 M1-M2 |
| P1-5 | 用量三维聚合 + 群管理员角色矩阵 | host 分析 §6-§7 |
| P2-1 | 侧栏团队列 + 右侧可拖拽详情面板 + 命令面板 | UI 分析 §5 P0-2/P1-1/P1-2 |
| P2-2 | @ chip 化、动作卡片、Widget 卡片、三档动效 | UI 分析 §5 P0-7/P0-6/P1-6/P2 |

---

## 6. 视觉 A/B 结论（2026-11-01）

同一后端数据、同一 1440×900 / 390×844 视口，用生产构建分别截取改动前（baseline，HEAD）与改动后（new）的群聊页：

| 对比项 | 改动前（baseline） | 改动后（new） | 结论 |
|---|---|---|---|
| 头部 | 页面大标题「协作频道」+ 会话卡片内第二层标题 + 头像组 | 单一紧凑胶囊头（会话名 + 成员数 + 实时状态），点击开成员面板 | 层级由两层降为一层，首屏留给消息 |
| 接力过程 | 无（只能看最终消息） | 接力链「接力 1/3 · Task #2」逐棒状态 + 消息棒次徽标「接力 2/2」 | 多 Agent 协作过程首次在群聊内可见 |
| 消息分组 | 每条消息重复头像与名称 | 同发送者连续消息合并为分组，仅首条显示头像/名称、末条显示时间 | 长会话扫描成本下降 |
| 时间分隔 | 无 | 首条/跨天/超 30 分钟插入「今天 / 昨天 / 日期」分隔 | 会话节奏可读 |
| 成员信息 | 需跳转 /contacts | 右侧成员面板（桌面）/ 抽屉（移动）：角色、绑定模型、状态、最近活跃 | 群聊内即可完成成员核对 |
| 输入区 | 快捷指令被压缩成竖排文字 | 快捷指令与 @ 角色横向排列，多 @ 时出现接力顺序预览 | 输入区可读性与接力可预期性提升 |

证据文件位于 `docs/ab-20261101/`：

- 桌面底部：[baseline-chats-desktop-bottom.png](ab-20261101/baseline-chats-desktop-bottom.png) / [new-chats-desktop-bottom.png](ab-20261101/new-chats-desktop-bottom.png)
- 桌面顶部：[baseline-chats-desktop-top.png](ab-20261101/baseline-chats-desktop-top.png) / [new-chats-desktop-top.png](ab-20261101/new-chats-desktop-top.png)
- 成员面板：[new-chats-members.png](ab-20261101/new-chats-members.png)
- 移动端：[baseline-chats-mobile.png](ab-20261101/baseline-chats-mobile.png) / [new-chats-mobile.png](ab-20261101/new-chats-mobile.png)

> 说明：截图使用本地 SQLite 开发库 + 直接播种的演练数据（不调用真实模型），目的是对比信息架构与视觉表达；接力执行链路由后端单测（tests/test_relay_handoff.py 11 passed）覆盖。

---

## 7. 证据索引（本次引用）

| 结论 | 证据 |
|---|---|
| DS-Bot 一次一个 speaker 的 round 生命周期 | `ds-bot/src/host/groups.js:455-572` |
| 每棒 prompt 的发言顺序与已读窗口 | `groups.js:229-264` |
| PASS 判定 | `groups.js:81` |
| @ 插队/补发言 | `groups.js:382-394` |
| relay 上限与暂停恢复 | `groups.js:39-40,469-487,955-968` |
| 交接 work 树与长结果落盘 | `src/host/handoffs.js:30-186` |
| 记忆三作用域与限额 | `src/host/memory.js:41,88-187` |
| 上下文治理 steward / part | `src/host/steward.js`、`parts.js:277-618` |
| 前端主题与 token | `ds-bot/client.js:1769-1822,2388` |
| 前端消息分组与事件行 | `client.js:7549-7647,7939` |
| 前端胶囊头与详情面板 | `client.js:2524-2546,2729-2757` |
| 前端角色状态机 | `client.js:1383-1493,2394-2481,3592-3626` |
| 分析子 Agent 原始报告 | [DS-Bot后端交互逻辑分析.md](DS-Bot分析报告/DS-Bot后端交互逻辑分析.md)（1047 行）、[DS-Bot前端UI与交互模式分析.md](DS-Bot分析报告/DS-Bot前端UI与交互模式分析.md)（630 行） |

---

*本文为只读审查与方案文档，不含代码改动；代码改动见 PRD-群聊多Agent接力协作 与《改动表》。*

# PRD：Agent Console MVP（多智能体协同运行台）

> 类型：新需求（Requirement）｜状态：已实施｜关联提交：`599e268`（+ 加固 `ca6322d`、`0a27d86`）

---

## 1. 背景与问题

多个 AI Agent 此前是散落的：模型配置在 `config/models.yaml`，执行日志埋在数据库，
没有统一的界面来「看健康、派任务、追执行、查结果」。工程负责人与独立开发者只能
靠 API / 脚本拼凑，无法在几秒内回答三个核心问题：**系统现在是否健康、谁正在做什么、
下一步需要我处理什么**。

同时，单一 LLM 直答模式（一次 prompt 一次回答）无法胜任需要拆解与协作的复杂任务——
缺少「Manager 拆解 → Worker 执行 → QA 审核 → 汇总」的编排能力。

### 本轮要解决的问题
1. 没有可观察、可操作的多 Agent 协同台，Agent 之间无法围绕一个任务协作。
2. 任务执行过程（拆解/子任务/审核/汇总）不可见，失败无法定位到具体步骤。
3. 模型调用成本与延迟不落账，无法回答「每次调用花了多少钱、多慢」。
4. 进程崩溃后任务状态丢失，无法恢复。

## 2. 目标与非目标

**目标**
- G1：用户在群聊 `@Agent` 派发任务，任务被持久化并按编排流水线执行。
- G2：多 Agent 流水线「Manager 拆解 → Worker 执行 → QA 审核 → 最终汇总」，结果回到群聊。
- G3：全程实时可视：任务状态、步骤时间线、Agent 状态灯、模型调用日志通过单个 WebSocket 推送。
- G4：系统健康可查（连接状态 / Provider 配置 / 任务并发），异常可恢复。
- G5：每个模型调用记录 provider/model/token/成本/延迟/是否降级。

**非目标（N1-N3）**
- N1：不做 Worker 并行执行（SQLite 单写者，串行；PostgreSQL 到位后用 `asyncio.gather` 并行）。
- N2：不做消息队列（Celery/Redis），`run_task(task_id)` 保持队列友好入口，未来可切换。
- N3：不做多进程广播（进程内 WebSocket Manager，接口已抽象可换 Redis Pub/Sub）。

## 3. 用户故事

- US1：作为用户，我在群聊输入 `@项目总设计师 帮我重构订单模块`，任务被拆成子任务分给对应 Worker，全程每个步骤实时可见。
- US2：作为用户，我想在运行总览一眼看到工作区连接状态、6 个 Agent 谁在忙、当前有哪些任务在跑。
- US3：作为用户，我想在任务详情页看到「拆解 → 每个 Worker 执行 → 测试专员审核 → 最终汇总」的时间线与每次模型调用的 token/成本/延迟。
- US4：作为用户，服务重启后，未完成任务应自动恢复继续，而不是卡在 pending/running。

## 4. 功能需求（FR）

| 编号 | 需求 | 优先级 |
|------|------|--------|
| FR1 | 群聊 `@Agent` 派发任务：消息落库并创建 `Task`（PENDING），入口 `run_task(task_id)` 无状态可复用 | P0 |
| FR2 | 单 Agent 路径：分配 Agent 直接执行（system prompt + 任务描述 → chat_completion） | P0 |
| FR3 | 多 Agent 流水线：`manager_plan` → `worker_execute_{id}`（逐个 Worker）→ `review_results` → `final_summary`，各阶段生成 `TaskStep` | P0 |
| FR4 | 六种 WebSocket 事件按工作区广播：`message.created` / `task.status_changed` / `task.step_changed` / `agent.status_changed` / `model.call_finished` / `error` | P0 |
| FR5 | 任务状态机：PENDING → RUNNING → COMPLETED / FAILED；`_claim_pending_task` 原子认领防止重复执行 | P0 |
| FR6 | 模型调用落账 `ModelCall`：provider / model / prompt+completion tokens / latency_ms / cost / status / error_message | P0 |
| FR7 | 模型降级链：`config/models.yaml` 定义 fallback，主 Provider 失败自动切换并标记 `fallback_used` | P0 |
| FR8 | 失败恢复：任务失败 → 步骤标 failed、任务标 FAILED、错误消息回群聊并广播 error 事件；主 session 失效时用 fallback session 补写 | P0 |
| FR9 | 并发控制：单工作区最多 3 个进行中任务，超出返回 429 | P1 |
| FR10 | 前端四页：运行总览 `/`、群聊 `/chats`、任务 `/tasks`、任务详情 `/tasks/[id]`（步骤时间线 + 模型调用日志） | P0 |
| FR11 | 错误信息脱敏：LiteLLM 错误中替换 API Key 与 `sk-*`/32 位以上连续字符 | P1 |

## 5. 非功能需求（NFR）

- **本地优先**：零配置 SQLite，`Base.metadata.create_all` 初始化；模型均为标准 SQLAlchemy 定义，换 PostgreSQL 只改 `DATABASE_URL`。
- **可扩展**：`run_task` 入口与 WebSocket 广播接口已抽象，后续换 Redis 队列/Pub/Sub 不破坏调用方。
- **可观测**：每次模型调用/任务步骤/Agent 状态变更都持久化 + 广播，前端可追溯。
- **安全**：错误消息不泄露密钥；结果消息与任务结果长度受限（error_message ≤ 4000 字符）。
- **性能**：单进程 SQLite 串行执行，单次模型调用毫秒级；WebSocket 广播按工作区隔离。

## 6. 验收标准（AC）

- AC1：`docker compose up` 后默认工作区与 6 个 Agent 就位；群聊 `@项目总设计师 帮我...` 回车 → 任务创建并执行。
- AC2：多 Agent 任务在任务详情页呈现完整步骤时间线（manager_plan / worker_execute_N / review_results / final_summary），每步有 input/output。
- AC3：Agent 状态灯、任务徽章、消息气泡随 WebSocket 事件实时变化，无刷新。
- AC4：模型调用日志含 provider/model/token/latency/cost/fallback 标记；降级发生时 `fallback_used=true`。
- AC5：杀进程重启后，PENDING 任务可重新执行、未完成状态不丢失（`_claim_pending_task` 原子认领 + fallback session）。
- AC6：后端 `pytest` 全过（本轮含 task 执行、task recovery、message_hub、litellm_service、orchestrator 测试）；前端 `lint/test/build` 通过。

## 7. 里程碑

| 阶段 | 内容 | 产出 |
|------|------|------|
| M1 | 单 Agent 执行 + 消息/任务持久化 + 基础 WebSocket | 群聊可派单，Agent 回话 |
| M2 | 多 Agent 流水线（Manager/Worker/QA/Final）+ TaskStep 时间线 | 复杂任务可拆解执行 |
| M3 | 运行总览 + 任务列表/详情 + 模型调用日志 | 全程可视 |
| M4 | 加固：任务认领原子化、失败恢复、并发控制、成本提取、测试补齐 | 稳定性达标 |

## 8. 变更追踪登记

| 改动时间 | ID | 状态 | Git 提交 | 作者 | 改动类型 | 影响范围 | 改动内容 | 前端技术 | 后端技术 | 是否有数据库 | 破坏性变更 | 验证结果 | 备注 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| MVP 基线前 | 基线前（未入表） | 已完成 | [599e268](https://github.com/liwe123/Agent-Togterher/commit/599e268) | LI | Requirement | 前端、后端、数据库 | Agent Console MVP：多 Agent 编排、WebSocket 实时可视、任务/消息/模型调用持久化、前端四页 | Next.js 16 + React 19 + Tailwind；useChat/useTasks/useAgentConsole/useSettings | FastAPI + SQLite + LiteLLM；orchestrator/message_hub；Agent/Message/Task/TaskStep/ModelCall 模型 | 是(全表) | 是 | pytest + lint/test/build 通过 | 含加固 ca6322d/0a27d86 |
| 2026-08-09 | 单任务上下文连续性保障 | 草案 | 待提交 | LI | Enhancement | 后端编排、Agent prompt、任务详情、测试 | 为同一条任务引入上下文回灌与轨迹摘要；模型每轮调用前注入任务级上下文；Manager/Worker/Review/Final 共享同一任务轨迹；补充 AB test 与冒烟测试 | Next.js 16 + React 19；任务详情页上下文视图 | FastAPI + SQLite + LiteLLM；orchestrator 上下文构建器；manager/worker/review/final agent prompt 扩展 | 是（新增上下文轨迹逻辑） | 否 | AB test / smoke test 待执行 | 以任务级上下文连续性为目标 |

---

## 9. 已实施摘要（实施部分）

**关键文件**
- 后端：`backend/app/core/orchestrator.py`（编排/认领/失败恢复）、`backend/app/core/message_hub.py`（事件契约）、`backend/app/services/litellm_service.py`（调用/降级/成本）、`backend/app/agents/*.py`（Manager/Worker/QA/Final prompts）、`backend/app/api/v1/endpoints/*.py`（conversations/messages/tasks/agents/workspaces/health）
- 前端：`frontend/src/hooks/use-chat.ts` / `use-tasks.ts` / `use-agent-console.ts`、`frontend/src/components/chat/*`、`frontend/src/components/tasks/*`、`frontend/src/components/console/*`

**验证结果**：后端 pytest 40 passed；前端 Node test 28 passed；ESLint 0 错误；TypeScript + Next build 通过；失败恢复与并发控制（max 3 / 429）已覆盖测试。

**后续演进**：本 MVP 之上叠加了 API Key 管理、自定义模型、视觉重构与启动脚本（见对应 PRD）。

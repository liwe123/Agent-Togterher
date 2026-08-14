# PRD：Phase 2 持久化任务队列与独立 Worker

> 类型：新需求（Requirement）｜状态：进行中｜对应《项目计划》Phase 2 平台化。

## 1. 目标

将任务执行从 API 进程内协程升级为数据库持久化队列与独立 Worker 消费模式，使任务可排队、可重试、可超时回收、可进入死信状态，并保留兼容的内联执行模式用于本地开发。

## 2. 用户故事

- 作为用户，我希望 API 重启后已提交任务仍可被 Worker 继续处理。
- 作为运维人员，我希望限制 Worker 并发，并能识别重试耗尽的死信任务。
- 作为开发者，我希望消息入口只创建并入队任务，执行器通过稳定的任务 ID 入口运行。

## 3. 功能需求（FR）

| 编号 | 需求 | 优先级 |
|---|---|---|
| FR1 | 消息与任务持久化后创建唯一队列项 | P0 |
| FR2 | 队列项支持优先级、最大尝试次数、超时和可执行时间 | P0 |
| FR3 | Worker 通过原子租约领取任务，避免同一队列项被重复消费 | P0 |
| FR4 | 失败任务按策略重新入队，耗尽次数后进入 dead 状态 | P0 |
| FR5 | Worker 启动时回收租约过期的队列项 | P0 |
| FR6 | 支持配置 Worker 并发与轮询间隔 | P1 |
| FR7 | 保留 inline 模式，便于单进程开发和渐进迁移 | P1 |

## 4. 数据模型

新增 `task_queue_items` 表，以 `task_id` 唯一关联领域任务。核心字段包括 `status`、`priority`、`attempt_count`、`max_attempts`、`timeout_seconds`、`available_at`、`lease_token`、`lease_expires_at` 和 `last_error`。

领域任务状态仍以 `tasks.status` 为事实源；队列表只表达调度和消费状态。

## 5. 后端方案

- `TaskService` 统一提供 enqueue / claim / complete / fail / recover 操作。
- `MessageHub` 在任务持久化后入队；仅在 `TASK_EXECUTION_MODE=inline` 时继续触发进程内执行。
- `python -m app.worker` 启动独立 Worker；其按配置并发领取队列项，并调用既有 `run_task(task_id)`。
- 领取和完成均校验租约 token；失败按次数进入 queued 或 dead。

## 6. 安全与治理

- Worker 不接受客户端提供的状态、租约或尝试次数。
- 错误消息最多持久化 4000 字符，避免无限膨胀。
- API 和 Worker 使用同一数据库事实源；队列租约不可代替任务执行租约。

## 7. 验收标准（AC）

- AC1：创建消息后存在唯一持久化队列项。
- AC2：高优先级可执行任务先被领取，领取后包含唯一租约。
- AC3：失败任务在未耗尽次数时重新排队，耗尽后进入 dead 且不再被领取。
- AC4：过期租约可在 Worker 启动时恢复为 queued。
- AC5：worker 模式下 API 不创建执行协程；独立 Worker 可消费任务。
- AC6：原有 inline 模式与既有任务执行测试无回归。

## 8. 里程碑与风险

- M1：队列模型与 TaskService。
- M2：MessageHub 入队与独立 Worker。
- M3：自动化测试、运行文档及 PostgreSQL 并发强化。

当前 SQLite 的并发能力有限；生产多 Worker 部署应在 PostgreSQL 迁移完成后启用，并进一步使用 `FOR UPDATE SKIP LOCKED` 优化领取语义。当前版本以条件更新保证单队列项租约的原子性。

## 9. 系统关系

本需求承接 Phase 0 的架构治理边界：API 只受理命令，`TaskService` 管理调度状态，Worker 调用执行入口，`AgentOrchestrator` 暂继续承载模型与工具执行。后续将继续拆分编排器并接入可观测性与事件总线。

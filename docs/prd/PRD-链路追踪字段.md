# PRD：链路追踪字段（Trace / Correlation，R-05）

> 类型：新需求（Requirement） ｜ 状态：已实施 ｜ 登记：变更追踪表 C-217

---

## 1. 背景与问题

`docs/架构治理基线.md` §4 定义了 trace / correlation 标识规范，但自认「尚未实现」：数据库模型只有 `task_id`/`conversation_id`/`workspace_id` 等业务外键，**没有任何独立的 trace 字段**。后果是：跨 Message → Task → TaskStep → ModelCall 的一次执行无法用一个稳定的 `trace_id` 串起来，排障与后续接入统一日志/追踪（OTel 风格）时缺少关联键（报告 REQ-B7 / R-05：`models/task.py`、`message.py`、`model_call.py` 无该字段）。

## 2. 目标与非目标

**目标**
- G1：为 `Message`、`Task`、`TaskStep`、`ModelCall` 增加 `trace_id` 与 `correlation_id` 两个可空索引字段。
- G2：建立传播语义——用户消息生成 `correlation_id`；任务继承输入消息的 correlation 并生成 `trace_id`；步骤/模型调用/结果消息继承所属任务的二者。
- G3：提供 Alembic 迁移，PG 与 SQLite 双兼容、可回滚。
- G4：标识格式统一为小写 UUID 十六进制串（32 字符）。

**非目标**
- N1：不接入 OpenTelemetry / 外部追踪后端（仅补齐字段与传播）。
- N2：不改动结构化日志字段（规范已定义，日志改造另立项）。
- N3：不为历史数据回填（新列为空表示未追踪，可空）。

## 3. 用户故事

- US1：工程师拿到一个 `trace_id`，可检索到同一执行链的全部 TaskStep 与 ModelCall。
- US2：支持人员用 `correlation_id` 串起「一条用户消息触发的全部任务」。

## 4. 功能需求（FR）

| 编号 | 需求 | 优先级 |
|------|------|--------|
| FR1 | `Message` 增加 `trace_id` / `correlation_id`（String(36)，可空，索引） | P0 |
| FR2 | `Task` 增加 `trace_id` / `correlation_id` | P0 |
| FR3 | `TaskStep` 增加 `trace_id` / `correlation_id` | P0 |
| FR4 | `ModelCall` 增加 `trace_id` / `correlation_id` | P0 |
| FR5 | 新增 `app/core/trace_context.py`：`new_trace_id/new_correlation_id/stamp_new_message/stamp_task/inherit_from_task` | P0 |
| FR6 | `MessageHub` 创建用户消息时盖 `correlation_id`；创建任务时继承 correlation 并生成 `trace_id`（含普通派发与外部节点派发两条路径） | P0 |
| FR7 | `Orchestrator.save_task_step` / `_record_model_call` / `send_result_message` 与 `integration_service` 落步骤时，从任务继承 trace/correlation | P0 |
| FR8 | Alembic 迁移为四张表加列与索引，`downgrade` 完整回滚 | P0 |

## 5. 非功能需求（NFR）

- **兼容**：新列全部可空，历史数据不受影响；不改变既有外键与查询。
- **双兼容**：迁移使用 `batch_alter_table`，SQLite / PostgreSQL 均可执行。
- **一致性**：`alembic autogenerate` 与模型保持零 diff（`test_autogenerate_has_no_pending_changes` 继续通过）。
- **可测**：传播逻辑抽为纯函数，单测覆盖。

## 6. 验收标准（AC）

- AC1：四张表均含 `trace_id` / `correlation_id`，且 `test_database.py` 登记通过。
- AC2：`test_alembic_migrations.py`（含 autogenerate 零 diff）通过。
- AC3：`stamp_new_message` 生成 correlation 且 trace 为空；`stamp_task` 继承 correlation 并生成 trace；`inherit_from_task` 完整复制二者（单测断言）。
- AC4：`trace_id`/`correlation_id` 为 32 位小写十六进制，互不相同。
- AC5：全量 `pytest` 绿；CI 同参数 flake8 0 错误。

## 7. 数据与配置模型

迁移 `c2d3e4f5a6b7`（down_revision `b7c9d1e3f5a7`）为 `messages`/`tasks`/`task_steps`/`model_calls` 各加：

- `trace_id VARCHAR(36) NULL`（索引 `ix_<table>_trace_id`）
- `correlation_id VARCHAR(36) NULL`（索引 `ix_<table>_correlation_id`）

## 8. 里程碑

| 阶段 | 内容 | 状态 |
|------|------|------|
| M1 | 四模型加列 | ✅ 完成 |
| M2 | trace_context 抽槽 + 传播接线 | ✅ 完成 |
| M3 | Alembic 迁移（可回滚） | ✅ 完成 |
| M4 | 单测 + 全量回归 + flake8 | ✅ 完成 |

## 9. 变更登记

| 改动时间 | ID | 状态 | Git 提交 | 作者 | 改动类型 | 影响范围 | 改动内容 | 前端技术 | 后端技术 | 是否有数据库 | 破坏性变更 | 验证结果 | 备注 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 待填 | C-217 | 已完成 | 待填 | LI | Requirement | 后端、数据库 | 为 Message/Task/TaskStep/ModelCall 增加 trace_id/correlation_id 并建立从消息到模型调用的传播链（R-05） | - | 新增 core/trace_context.py；四模型加列；MessageHub/Orchestrator/integration_service 接线；Alembic 迁移 c2d3e4f5a6b7；test_trace_context.py 新增 + test_database.py 登记 | 是（四表各加 trace_id/correlation_id 两列） | 否（新列可空） | 全量 252 passed；flake8 0；autogenerate 零 diff | PRD: docs/prd/PRD-链路追踪字段.md |

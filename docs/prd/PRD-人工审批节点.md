# PRD：HITL 人工审批节点

> 类型：Requirement ｜ 状态：已实施 ｜ 登记：变更追踪表 C-185

---

## 1. 背景与问题

多 Agent 任务流程在 `orchestrator._run_multi_agent_task` 中按
manager → worker(可多个) → review → final 全自动推进，review 通过后直接进入
final 汇总并落终态。对于高风险流水线（如生产部署类任务），缺少一个
「人在回路」（HITL）把关点：运维/管理员无法在 AI 审核通过后、最终执行前
人工确认或叫停任务。

## 2. 目标与非目标

**目标**
- G1：新增任务状态 `WAITING_APPROVAL`，多 Agent 流程在 review 完成后、
  final 之前可挂起等待人工审批。
- G2：提供 `POST /tasks/{id}/approve` 与 `POST /tasks/{id}/reject` 端点，
  admin 及以上角色可审批；审批结果通过 WebSocket 广播实时可见。
- G3：审批等待采用独立 session 的 DB 轮询解耦（跨进程可审批，不引入 Redis），
  等待期间不持有未 commit 事务；总超时 3600 秒，超时按驳回处理并记日志。
- G4：工作流模板节点支持 `type: "human_approval"`；任务详情页在等待审批时
  展示「通过/驳回」按钮。

**非目标**
- N1：不做审批人多级会签/委托（单次 approve/reject 即终局）。
- N2：不做审批超时的自动提醒通知（仅日志）。
- N3：不新增数据库表或列（审批状态复用 `task_steps.status` 表达）。
- N4：前端按钮暂不做角色可见性收紧（页面无角色上下文，后端已强制 admin+，
  403 拒绝；后续接入权限上下文后收紧）。

## 3. 用户故事

- US1：管理员在流水线模板中加入 human_approval 节点，任务跑到审核完成后
  自动挂起，等待他人工复核。
- US2：管理员在任务详情页看到「等待审批」步骤，点「通过」后任务继续
  final 汇总；点「驳回」任务立即终止并标记人工驳回原因。
- US3：审批等待超过 1 小时无人处理，任务按驳回自动终止并留痕。

## 4. 功能需求（FR）

| 编号 | 需求 | 优先级 |
|------|------|--------|
| FR1 | `TaskStatus` 枚举使用 `WAITING_APPROVAL = "waiting_approval"`（沿用 C-154 已有成员）；审批结果用 `TaskStep.status` 表达：`waiting` / `approved` / `rejected` | P0 |
| FR2 | `orchestrator._run_multi_agent_task` 增加 `requires_approval` 参数；`run_task` 入口按任务描述头反查工作流模板（`【执行工作流流水线：<display_name>】` → 同工作区/系统模板），`nodes_json` 含 `type=="human_approval"` 节点即置 True | P0 |
| FR3 | `_request_approval(task)`：落 `step_name="human_approval"`、`status="waiting"` 步骤，任务置 `WAITING_APPROVAL` 并广播；approved → 步骤置 approved、任务回 RUNNING 继续 final；rejected/超时 → 步骤置 rejected、任务置 FAILED（result 说明人工驳回） | P0 |
| FR4 | `_wait_approval(step_id)`：模块级常量 `APPROVAL_POLL_INTERVAL_SECONDS=2`、`APPROVAL_TIMEOUT_SECONDS=3600`；每 2 秒用独立 session（可注入 `approval_session_factory`）轮询该步骤最新 status，等待期间不持有未 commit 事务 | P0 |
| FR5 | 新增 `POST /tasks/{task_id}/approve` 与 `POST /tasks/{task_id}/reject`：非 `WAITING_APPROVAL` 状态返回 409；approve 将最近一条 waiting 的 human_approval 步骤置 approved、任务回 RUNNING 并广播；reject 置 rejected、任务置 FAILED（result=人工驳回）并广播；均写审计日志；权限复用 RBAC 兼容守卫 `min_role="admin"`（viewer/member 禁止） | P0 |
| FR6 | `WorkflowNode` schema 增加 `type: str = "agent"`（枚举 agent \| human_approval） | P1 |
| FR7 | 前端任务详情页：human_approval 步骤等待中或任务处于 `waiting_approval` 时渲染「通过/驳回」按钮，调用审批端点后刷新详情；`task-format.ts` 补「人工审批」步骤标签与 waiting/approved/rejected 状态文案 | P1 |

## 5. 非功能需求（NFR）

- **可靠性**：审批等待跨进程解耦（纯 DB 轮询），API 进程与 Worker 进程任一侧
  均可完成审批；超时 3600s 兜底，任务不会永久挂起。
- **性能**：轮询间隔 2s，单条主键查询，无锁竞争；等待期间零长事务。
- **安全**：审批端点强制 admin 及以上角色（RBAC 兼容守卫），并记录审计日志
  （`task.approval.approved` / `task.approval.rejected`）。
- **兼容**：`requires_approval` 默认 False，普通任务与既有工作流行为不变；
  无新表新列、无 Alembic 迁移（复用 task_steps 与 tasks.status 既有列，
  waiting_approval 值已在 C-154 迁移中放宽）。

## 6. 验收标准（AC）

- AC1：工作流含 human_approval 节点的任务，review 完成后任务状态为
  `waiting_approval`，且存在 `human_approval`/`waiting` 步骤。
- AC2：另一 session 写库 approved 后，挂起方在轮询间隔内观察到并继续执行
  final，任务最终 COMPLETED，步骤为 approved。
- AC3：写库 rejected 后任务 FAILED、result 含「人工驳回」、步骤为 rejected，
  且不产生 final_summary 步骤。
- AC4：非 `WAITING_APPROVAL` 状态调用 approve/reject 返回 409。
- AC5：审批端点操作后任务状态变化广播 `task.status_changed`，并写审计日志。
- AC6：`pytest backend/tests` 全绿（含新增 `test_human_approval.py` 6 例）。

## 7. 数据与配置模型

无新表新列。状态全部落在既有字段：

- `tasks.status`：新增使用枚举值 `waiting_approval`（C-154 已放宽列宽）。
- `task_steps.step_name = "human_approval"`：审批步骤。
- `task_steps.status`：`waiting` → `approved` / `rejected`。

模块级常量（`backend/app/core/orchestrator.py`）：

- `APPROVAL_POLL_INTERVAL_SECONDS = 2.0`：轮询间隔。
- `APPROVAL_TIMEOUT_SECONDS = 3600`：审批总超时，超时按驳回处理。

## 8. 里程碑

| 阶段 | 内容 | 状态 |
|------|------|------|
| M1 | orchestrator 审批挂起（requires_approval / _request_approval / _wait_approval / 模板检测） | ✅ 完成 |
| M2 | approve/reject 端点 + 审计日志 + 广播 | ✅ 完成 |
| M3 | WorkflowNode type 字段 | ✅ 完成 |
| M4 | 前端审批按钮 + 标签/状态文案映射 | ✅ 完成 |
| M5 | test_human_approval.py（6 例）+ 全量回归 | ✅ 完成 |

## 9. 变更登记

| 改动时间 | ID | 状态 | Git 提交 | 作者 | 改动类型 | 影响范围 | 改动内容 | 前端技术 | 后端技术 | 是否有数据库 | 破坏性变更 | 验证结果 | 备注 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 待填 | C-185 | 已完成 | 待填 | LI | Requirement | 后端、前端 | 多 Agent 任务在 review 后、final 前插入 HITL 人工审批挂起点，管理员可通过端点或任务详情页通过/驳回，超时按驳回兜底 | task-detail-page.tsx TaskSteps 审批按钮 + task-format.ts 人工审批标签与状态文案 | orchestrator 审批挂起/DB 轮询 + tasks.py approve/reject 端点 + enums 复用 WAITING_APPROVAL + workflow schema 节点 type 字段 | 否（复用 task_steps） | 是（TaskStatus 新增 waiting_approval 使用；前端类型联合已同步） | pytest 全绿 | PRD: docs/prd/PRD-人工审批节点.md |

## 10. 已知限制与后续事项

- workflows.py 渲染循环未跳过 human_approval 节点的 prompt 渲染（该文件在本
  需求的禁改清单内）；审批节点 prompt 会随描述进入 manager 上下文，不影响
  挂起语义，后续可优化为跳过渲染。
- 前端审批按钮对所有可见者展示，后端强制 admin+（403 拒绝），待前端接入
  角色/权限上下文后做可见性收紧（见 N4）。
- 审批等待期间任务租约续租会因状态非 RUNNING 而停止，租约过期后任务也不会
  被重复领取（claim 仅匹配 PENDING），但租约字段语义与队列租约统一问题归入
  C-17x 架构债跟踪。
